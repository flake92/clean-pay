import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve("src");
const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

function sourceFiles() {
  return globSync("src/**/*.{ts,tsx,js,jsx,mts,cts}")
    .filter((file) => statSync(file).isFile())
    .map((file) => path.resolve(file));
}

function resolveProjectImport(
  specifier: string,
  importer: string,
  filesByPath: Map<string, string>,
) {
  const base = specifier.startsWith("@/")
    ? path.join(sourceRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(importer), specifier)
      : null;

  if (!base) return null;

  for (const candidate of [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`)),
  ]) {
    const resolved = filesByPath.get(candidate.toLowerCase());
    if (resolved) return resolved;
  }

  return null;
}

function importedProjectFiles(file: string, filesByPath: Map<string, string>) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];

  function visit(node: ts.Node) {
    let specifier: string | null = null;

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
    ) {
      specifier = node.arguments[0].text;
    }

    if (specifier) {
      const resolved = resolveProjectImport(specifier, file, filesByPath);
      if (resolved) imports.push(resolved);
    }

    ts.forEachChild(node, visit);
  }

  visit(source);
  return imports;
}

function productionRoots(files: string[]) {
  const nextEntry = /[\\/](?:page|layout|route|loading|error|not-found|template|default|manifest|robots|sitemap|icon|apple-icon|opengraph-image|twitter-image)\.(?:[cm]?[jt]sx?)$/;
  const frameworkEntry = /[\\/](?:proxy|middleware|instrumentation|instrumentation-client)\.(?:[cm]?[jt]sx?)$/;

  return files.filter((file) => nextEntry.test(file) || frameworkEntry.test(file) || file.endsWith(".d.ts"));
}

describe("dead-code regressions", () => {
  it("keeps every production source file reachable from a framework entry point", () => {
    const files = sourceFiles();
    const filesByPath = new Map(files.map((file) => [file.toLowerCase(), file]));
    const dependencies = new Map(
      files.map((file) => [file, importedProjectFiles(file, filesByPath)]),
    );
    const reachable = new Set<string>();
    const pending = productionRoots(files);

    while (pending.length > 0) {
      const file = pending.pop()!;
      if (reachable.has(file)) continue;
      reachable.add(file);
      pending.push(...(dependencies.get(file) ?? []));
    }

    expect(
      files
        .filter((file) => !reachable.has(file))
        .map((file) => path.relative(process.cwd(), file).replaceAll("\\", "/")),
    ).toEqual([]);
  });

  it("keeps retired compatibility flows out of the active architecture", () => {
    for (const retired of [
      "src/backend/auth/generic-email.ts",
      "src/backend/auth/payload.ts",
      "src/backend/integrations/auth/profile-presenter.ts",
      "src/backend/plans/public-plans.ts",
      "src/frontend/lib/payment-return-storage.ts",
    ]) {
      expect(existsSync(retired), retired).toBe(false);
    }

    const authAdapter = readFileSync("src/backend/integrations/auth/auth-commands.ts", "utf8");
    const authUseCase = readFileSync("src/application/auth/execute-auth-command.ts", "utf8");
    expect(authAdapter).toContain("remnashopIdentifyEmail");
    expect(authUseCase).toContain("identifyEmail(email)");

    for (const component of [
      "src/frontend/components/payment-confirmation.tsx",
      "src/frontend/components/extend-confirmation.tsx",
    ]) {
      const source = readFileSync(component, "utf8");
      expect(source).not.toContain("payment-return-storage");
      expect(source).toContain("operation_id=");
      expect(source).toContain("payment_id=");
    }
  });

  it("keeps composition details and retired payment aliases out of the public surface", () => {
    const requestReaders = readFileSync("src/app/_composition/request-scoped-readers.ts", "utf8");
    expect(requestReaders).not.toMatch(/export const request(?:CabinetReader|PaymentHistoryGateway)/);

    const maintenancePort = readFileSync("src/application/payments/ports/payment-maintenance.ts", "utf8");
    expect(maintenancePort).not.toContain("PaymentReconciliationResult");

    const workflowPort = readFileSync("src/application/payments/ports/payment-workflow.ts", "utf8");
    expect(workflowPort).not.toMatch(/\bPaymentWorkflow\s*=/);
  });
});
