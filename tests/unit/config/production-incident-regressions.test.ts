import { globSync, readFileSync } from "node:fs";

import ts from "typescript";
import { describe, expect, it } from "vitest";
import { assertRedisOvercommitValue } from "../../../deploy/prod/host-safety.mjs";

type TransactionConcurrencyViolation = {
  file: string;
  line: number;
  combinator: string;
  transactionClient: string;
};

const concurrentPromiseCombinators = new Set(["all", "allSettled", "any", "race"]);

function referencesIdentifier(node: ts.Node, name: string) {
  let found = false;

  function visit(candidate: ts.Node) {
    if (ts.isIdentifier(candidate) && candidate.text === name) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(candidate, visit);
  }

  visit(node);
  return found;
}

function transactionConcurrencyViolations(sourceText: string, file = "inline.ts") {
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);
  const violations: TransactionConcurrencyViolation[] = [];

  function inspectTransactionCallback(callback: ts.ArrowFunction | ts.FunctionExpression) {
    const parameter = callback.parameters[0]?.name;
    if (!parameter || !ts.isIdentifier(parameter)) return;
    const transactionClient = parameter.text;

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node)
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression)
        && node.expression.expression.text === "Promise"
        && concurrentPromiseCombinators.has(node.expression.name.text)
        && node.arguments.some((argument) => referencesIdentifier(argument, transactionClient))
      ) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        violations.push({
          file,
          line: line + 1,
          combinator: `Promise.${node.expression.name.text}`,
          transactionClient,
        });
      }

      ts.forEachChild(node, visit);
    }

    visit(callback.body);
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node)
      && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === "$transaction"
    ) {
      const callback = node.arguments[0];
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        inspectTransactionCallback(callback);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return violations;
}

describe("production incident regressions", () => {
  it("detects concurrent work on one interactive Prisma transaction connection", () => {
    expect(transactionConcurrencyViolations(`
      prisma.$transaction(async (tx) => {
        await Promise.all([
          tx.webUser.findUnique({ where: { id: "one" } }),
          lookupOwner(tx),
        ]);
      });
    `)).toEqual([
      expect.objectContaining({
        line: 3,
        combinator: "Promise.all",
        transactionClient: "tx",
      }),
    ]);
  });

  it("allows sequential interactive queries and Prisma batch transactions", () => {
    expect(transactionConcurrencyViolations(`
      await prisma.$transaction(async (tx) => {
        await tx.webUser.findUnique({ where: { id: "one" } });
        await lookupOwner(tx);
      });
      await prisma.$transaction([
        prisma.webUser.findUnique({ where: { id: "one" } }),
        prisma.webUser.findUnique({ where: { id: "two" } }),
      ]);
    `)).toEqual([]);
  });

  it("keeps every production interactive transaction serialized", () => {
    const violations = globSync("src/**/*.{ts,tsx}").flatMap((file) =>
      transactionConcurrencyViolations(readFileSync(file, "utf8"), file),
    );

    expect(violations).toEqual([]);
  });

  it("prevents rollout scripts from force-recreating stateful dependencies", () => {
    const deploymentFiles = [
      "deploy.sh",
      "start.sh",
      ...globSync("deploy/**/*.{sh,mjs,yml,yaml}"),
    ];

    for (const file of deploymentFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("--force-recreate");
      expect(source, file).not.toMatch(/\b(?:docker\s+)?(?:compose\s+)?volume\s+prune\b/);
      expect(source, file).not.toMatch(/\bcompose\s+down\s+(?:[^\n]*\s)?-v\b/);
    }

    const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
    expect(compose).toContain("postgres-data:/var/lib/postgresql/data");
    expect(compose).toContain("redis-data:/data");
    expect(compose).toMatch(/volumes:\s*\n\s+postgres-data:\s*\n\s+redis-data:/);
  });

  it("blocks production startup when Redis memory overcommit is unsafe", () => {
    const deploy = readFileSync("deploy.sh", "utf8");
    const legacyStart = readFileSync("start.sh", "utf8");
    const nodeDeploy = readFileSync("deploy/prod/prod.mjs", "utf8");

    expect(deploy).toContain("ensure_redis_host_memory_policy");
    expect(deploy).toContain("/proc/sys/vm/overcommit_memory");
    expect(deploy.indexOf("ensure_redis_host_memory_policy\n  ensure_network"))
      .toBeGreaterThan(-1);
    expect(legacyStart).toContain("ensure_redis_host_memory_policy");
    expect(legacyStart.indexOf("ensure_redis_host_memory_policy\n  ensure_network"))
      .toBeGreaterThan(-1);
    expect(nodeDeploy).toContain("assertRedisHostMemoryPolicy();");
    expect(nodeDeploy.indexOf("assertRedisHostMemoryPolicy();"))
      .toBeLessThan(nodeDeploy.indexOf("ensureEdgeNetwork();", nodeDeploy.indexOf('case "up"')));

    expect(() => assertRedisOvercommitValue("1\n")).not.toThrow();
    for (const unsafeValue of ["0", "2", "", "invalid"]) {
      expect(() => assertRedisOvercommitValue(unsafeValue), unsafeValue)
        .toThrow("Redis requires vm.overcommit_memory=1");
    }
  });
});
