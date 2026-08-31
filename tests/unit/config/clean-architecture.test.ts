import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

function files(pattern: string) {
  return globSync(pattern).map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function importedModules(source: string) {
  return [...source.matchAll(/\b(?:from|import|require)\s*(?:\(\s*)?["']([^"']+)["']/g)]
    .map((match) => match[1]!);
}

function astImportedModules(source: string) {
  const sourceFile = ts.createSourceFile(
    "architecture-boundary.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const modules: string[] = [];

  function stringArgument(node: ts.CallExpression) {
    const [argument] = node.arguments;
    return argument && ts.isStringLiteralLike(argument) ? argument.text : null;
  }

  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      modules.push(node.moduleSpecifier.text);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (
        ts.isExternalModuleReference(reference)
        && reference.expression
        && ts.isStringLiteralLike(reference.expression)
      ) {
        modules.push(reference.expression.text);
      }
    } else if (
      ts.isCallExpression(node)
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === "require")
      )
    ) {
      const dependency = stringArgument(node);
      if (dependency) modules.push(dependency);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return modules;
}

function projectPath(importer: string, dependency: string) {
  const candidate = dependency.startsWith("@/")
    ? path.resolve("src", dependency.slice(2))
    : dependency.startsWith(".")
      ? path.resolve(path.dirname(importer), dependency)
      : null;

  return candidate
    ? path.relative(process.cwd(), path.normalize(candidate)).replaceAll("\\", "/")
    : null;
}

function projectDependencies(file: string, source: string) {
  return importedModules(source)
    .map((dependency) => ({ dependency, resolved: projectPath(file, dependency) }))
    .filter((item): item is { dependency: string; resolved: string } => item.resolved !== null);
}

function astProjectDependencies(file: string, source: string) {
  return astImportedModules(source)
    .map((dependency) => ({ dependency, resolved: projectPath(file, dependency) }))
    .filter((item): item is { dependency: string; resolved: string } => item.resolved !== null);
}

function modulePath(file: string) {
  return file.replaceAll("\\", "/").replace(/\.(?:ts|tsx)$/, "");
}

function dependencyCycles(entries: Array<{ file: string; source: string }>) {
  const filesByModule = new Map(
    entries.map(({ file }) => [modulePath(file), file.replaceAll("\\", "/")]),
  );
  const graph = new Map<string, string[]>();

  for (const { file, source } of entries) {
    const importer = modulePath(file);
    const dependencies = astProjectDependencies(file, source).flatMap(({ resolved }) => {
      const candidate = modulePath(resolved);
      for (const moduleId of [candidate, `${candidate}/index`]) {
        if (filesByModule.has(moduleId)) return [moduleId];
      }
      return [];
    });
    graph.set(importer, [...new Set(dependencies)].sort());
  }

  const indexByModule = new Map<string, number>();
  const lowLinkByModule = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  let nextIndex = 0;

  function connect(module: string) {
    const index = nextIndex++;
    indexByModule.set(module, index);
    lowLinkByModule.set(module, index);
    stack.push(module);
    onStack.add(module);

    for (const dependency of graph.get(module) ?? []) {
      if (!indexByModule.has(dependency)) {
        connect(dependency);
        lowLinkByModule.set(
          module,
          Math.min(lowLinkByModule.get(module)!, lowLinkByModule.get(dependency)!),
        );
      } else if (onStack.has(dependency)) {
        lowLinkByModule.set(
          module,
          Math.min(lowLinkByModule.get(module)!, indexByModule.get(dependency)!),
        );
      }
    }

    if (lowLinkByModule.get(module) !== indexByModule.get(module)) return;

    const component: string[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === module) break;
    }
    const selfCycle = component.length === 1
      && (graph.get(component[0]!) ?? []).includes(component[0]!);
    if (component.length > 1 || selfCycle) cycles.push(component.sort());
  }

  for (const moduleId of [...graph.keys()].sort()) {
    if (!indexByModule.has(moduleId)) connect(moduleId);
  }

  return cycles.sort((left, right) => left.join("\0").localeCompare(right.join("\0")));
}

function unusedApplicationPorts(
  ports: Array<{ file: string }>,
  applicationFiles: Array<{ file: string; source: string }>,
) {
  const consumedContracts = new Set(
    applicationFiles.flatMap(({ file, source }) =>
      projectDependencies(file, source).map(({ resolved }) => modulePath(resolved)),
    ),
  );

  return ports.map(({ file }) => modulePath(file)).filter((contract) => !consumedContracts.has(contract));
}

describe("clean architecture boundaries", () => {
  it("uses PrimeFlex as the only utility CSS system", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    const globals = readFileSync("src/app/globals.css", "utf8");
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const source = files("src/**/*.{ts,tsx}").map(({ source: contents }) => contents).join("\n");

    expect(dependencies).not.toHaveProperty("tailwindcss");
    expect(dependencies).not.toHaveProperty("@tailwindcss/postcss");
    expect(globSync("postcss.config.*")).toEqual([]);
    expect(globals).not.toContain('@import "tailwindcss"');
    expect(layout).toContain('import "primeflex/primeflex.css"');
    expect(source).not.toMatch(/(?:^|[\s"'`])(?:items-start|items-center|justify-between)(?=$|[\s"'`])/);
  });

  it("keeps navigation shell rendering independent from the subscription provider", () => {
    const shell = readFileSync("src/app/_components/app-shell.tsx", "utf8");
    const navigation = readFileSync("src/application/navigation/load-navigation.ts", "utf8");

    expect(shell).not.toContain("requestSubscriptionCatalog");
    expect(navigation).not.toContain("SubscriptionCatalog");
    expect(navigation).not.toContain("loadOffers");
  });

  it("resolves alias and relative imports before applying layer rules", () => {
    expect(projectPath("src/shared/domain/value.ts", "../../backend/database/prisma"))
      .toBe("src/backend/database/prisma");
    expect(projectPath("src/frontend/components/view.tsx", "@/backend/config/env"))
      .toBe("src/backend/config/env");
    expect(projectPath("src/application/payments/use-case.ts", "node:crypto")).toBeNull();
    expect(importedModules('const adapter = require("@/backend/database/prisma")'))
      .toEqual(["@/backend/database/prisma"]);
    expect(astImportedModules([
      'import type { Actor } from "@/application/models/actor";',
      'export { policy } from "@/shared/domain/policy";',
      'const lazy = import("@/backend/integrations/provider");',
      '// require("@/backend/ignored-comment")',
    ].join("\n"))).toEqual([
      "@/application/models/actor",
      "@/shared/domain/policy",
      "@/backend/integrations/provider",
    ]);
  });

  it("keeps the production TypeScript module graph acyclic", () => {
    expect(dependencyCycles(files("src/**/*.{ts,tsx}"))).toEqual([]);
  });

  it("keeps production source independent from deployment tooling", () => {
    for (const { file, source } of files("src/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of astProjectDependencies(file, source)) {
        expect(
          resolved,
          `${file} imports deployment module ${dependency} (${resolved})`,
        ).not.toMatch(/^deploy\//);
      }
    }
  });

  it("detects cycles through both alias and relative imports", () => {
    expect(dependencyCycles([
      {
        file: "src/application/orders/place-order.ts",
        source: 'import { reserve } from "./reserve";',
      },
      {
        file: "src/application/orders/reserve.ts",
        source: 'export { place } from "@/application/orders/place-order";',
      },
    ])).toEqual([[
      "src/application/orders/place-order",
      "src/application/orders/reserve",
    ]]);
  });

  it("keeps application use cases independent from frameworks and adapters", () => {
    for (const { file, source } of files("src/application/**/*.{ts,tsx}")) {
      for (const dependency of importedModules(source)) {
        expect(
          dependency.startsWith("@/application/")
          || dependency.startsWith("@/shared/domain/"),
          `${file} imports outer or provider module ${dependency}`,
        ).toBe(true);
      }
    }
  });

  it("keeps domain contracts independent from outer layers and providers", () => {
    for (const { file, source } of files("src/shared/domain/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        expect(
          resolved.startsWith("src/shared/domain/"),
          `${file} imports non-domain module ${dependency} (${resolved})`,
        ).toBe(true);
      }
      expect(source, file).not.toMatch(/from ["']next(?:\/|["'])/);
      expect(source, file).not.toMatch(/@prisma\/client/);
    }
  });

  it("keeps all shared policies independent from application and adapters", () => {
    for (const { file, source } of files("src/shared/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        expect(
          resolved.startsWith("src/shared/"),
          `${file} imports non-shared module ${dependency} (${resolved})`,
        ).toBe(true);
      }
    }
  });

  it("keeps proxy policies Edge-compatible behind the stable proxy facade", () => {
    const policyFiles = files("src/shared/edge/proxy-*.ts");

    expect(policyFiles.map(({ file }) => file.replaceAll("\\", "/")).sort()).toEqual([
      "src/shared/edge/proxy-auth-policy.ts",
      "src/shared/edge/proxy-mutation-policy.ts",
      "src/shared/edge/proxy-route-policy.ts",
      "src/shared/edge/proxy-security-policy.ts",
    ]);

    for (const { file, source } of policyFiles) {
      for (const { dependency, resolved } of astProjectDependencies(file, source)) {
        expect(
          resolved.startsWith("src/shared/"),
          `${file} imports a non-shared dependency ${dependency} (${resolved})`,
        ).toBe(true);
      }
      expect(source, `${file} imports a Node-only module`).not.toMatch(/from ["']node:/);
      expect(source, `${file} imports Next.js`).not.toMatch(/from ["']next(?:\/|["'])/);
      expect(source, `${file} reads process globals`).not.toContain("process.");
      expect(source, `${file} depends on backend`).not.toContain("@/backend/");
    }

    const facade = readFileSync("src/proxy.ts", "utf8");
    const sourceFile = ts.createSourceFile(
      "src/proxy.ts",
      facade,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const exports = sourceFile.statements
      .filter((statement) => ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ))
      .flatMap((statement) => {
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          return [statement.name.text];
        }
        if (ts.isVariableStatement(statement)) {
          return statement.declarationList.declarations.flatMap((declaration) =>
            ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
          );
        }
        return [];
      });

    expect(exports).toEqual(["proxy", "config"]);
  });

  it("isolates durable Telegram callback persistence behind its repository", () => {
    const modules = files(
      "src/backend/integrations/telegram/durable-callback*.ts",
    );
    expect(modules.map(({ file }) => file.replaceAll("\\", "/")).sort()).toEqual([
      "src/backend/integrations/telegram/durable-callback-contract.ts",
      "src/backend/integrations/telegram/durable-callback-decoder.ts",
      "src/backend/integrations/telegram/durable-callback-orchestrator.ts",
      "src/backend/integrations/telegram/durable-callback-repository.ts",
      "src/backend/integrations/telegram/durable-callback-transitions.ts",
      "src/backend/integrations/telegram/durable-callback-transport.ts",
      "src/backend/integrations/telegram/durable-callback.ts",
    ]);

    for (const { file, source } of modules) {
      const normalized = file.replaceAll("\\", "/");
      if (normalized.endsWith("durable-callback-repository.ts")) continue;
      expect(source, `${normalized} bypasses the callback repository`)
        .not.toContain("@/backend/database/prisma");
      expect(source, `${normalized} imports the Prisma runtime`)
        .not.toContain("@prisma/client");
    }

    const facade = readFileSync(
      "src/backend/integrations/telegram/durable-callback.ts",
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "durable-callback.ts",
      facade,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    const exports = sourceFile.statements.flatMap((statement) => {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
      if (!ts.isNamedExports(statement.exportClause)) return [];
      return statement.exportClause.elements.map((element) => element.name.text);
    });
    expect(exports.sort()).toEqual([
      "DURABLE_TELEGRAM_CALLBACK_MAX_IN_FLIGHT_MS",
      "DURABLE_TELEGRAM_CALLBACK_RESULT_TTL_MS",
      "DurableTelegramCallbackCheckpoint",
      "DurableTelegramCallbackClaimConflictError",
      "DurableTelegramCallbackOwnership",
      "DurableTelegramCallbackReplay",
      "TelegramCallbackCookieProof",
      "checkpointDurableTelegramIdentity",
      "checkpointDurableTelegramIdentityResolved",
      "checkpointDurableTelegramOutcome",
      "checkpointDurableTelegramProvider",
      "checkpointDurableTelegramRecoveryCommitted",
      "claimDurableTelegramProviderReady",
      "completeDurableTelegramMerge",
      "completeDurableTelegramSession",
      "createDurableTelegramCallbackSession",
      "failDurableTelegramCallback",
      "loadDurableTelegramCallback",
      "markDurableTelegramProviderDispatching",
      "markDurableTelegramRecoveryDispatching",
      "markDurableTelegramRemnashopDispatching",
      "releaseDurableTelegramCallback",
      "runWithDurableTelegramCallbackLease",
    ].sort());
  });

  it("keeps Telegram OIDC behind a stable facade and a single repository", () => {
    const modules = files("src/backend/integrations/telegram/oidc*.ts");
    expect(modules.map(({ file }) => file.replaceAll("\\", "/")).sort()).toEqual([
      "src/backend/integrations/telegram/oidc-codec.ts",
      "src/backend/integrations/telegram/oidc-orchestrator.ts",
      "src/backend/integrations/telegram/oidc-repository.ts",
      "src/backend/integrations/telegram/oidc-transport.ts",
      "src/backend/integrations/telegram/oidc.ts",
    ]);

    for (const { file, source } of modules) {
      const normalized = file.replaceAll("\\", "/");
      if (normalized.endsWith("oidc-repository.ts")) continue;
      expect(source, `${normalized} bypasses the OIDC repository`)
        .not.toContain("@/backend/database/prisma");
      expect(source, `${normalized} imports the Prisma runtime`)
        .not.toContain("@prisma/client");
    }

    const facade = readFileSync(
      "src/backend/integrations/telegram/oidc.ts",
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "oidc.ts",
      facade,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    const exports = sourceFile.statements.flatMap((statement) => {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
      if (!ts.isNamedExports(statement.exportClause)) return [];
      return statement.exportClause.elements.map((element) => element.name.text);
    });
    expect(exports.sort()).toEqual([
      "TelegramAuthStateAlreadyConsumedError",
      "clearTelegramAuthCookies",
      "clearTelegramAuthCookiesOnResponse",
      "createTelegramAuthorizationResponse",
      "createTelegramPopupStartResponse",
      "readTelegramCallbackCookieProof",
      "resetTelegramOidcJwksForTests",
      "resumeTelegramOidcCodeExchange",
      "resumeTelegramProviderAuthentication",
      "verifyTelegramCallback",
      "verifyTelegramPopupToken",
      "verifyTelegramWidgetCallbackPayload",
    ].sort());
  });

  it("keeps Remnawave decoding, identity policy and credential transport isolated", () => {
    const modules = files("src/backend/integrations/remnawave/*.ts");
    expect(modules.map(({ file }) => file.replaceAll("\\", "/")).sort())
      .toEqual([
        "src/backend/integrations/remnawave/client.ts",
        "src/backend/integrations/remnawave/decoders.ts",
        "src/backend/integrations/remnawave/identity-transitions.ts",
        "src/backend/integrations/remnawave/orchestrator.ts",
        "src/backend/integrations/remnawave/transport.ts",
      ]);

    const facadePath = "src/backend/integrations/remnawave/client.ts";
    const facade = readFileSync(facadePath, "utf8");
    const sourceFile = ts.createSourceFile(
      facadePath,
      facade,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    const exports = sourceFile.statements.flatMap((statement) => {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
      if (!ts.isNamedExports(statement.exportClause)) return [];
      return statement.exportClause.elements.map((element) => element.name.text);
    });
    expect(exports.sort()).toEqual([
      "assertRemnawaveIdentitySynchronizationConfigured",
      "getLiveRemnawaveSubscriptionUrl",
      "synchronizeRemnawaveUserIdentity",
    ]);

    const decoders = readFileSync(
      "src/backend/integrations/remnawave/decoders.ts",
      "utf8",
    );
    const transitions = readFileSync(
      "src/backend/integrations/remnawave/identity-transitions.ts",
      "utf8",
    );
    const orchestrator = readFileSync(
      "src/backend/integrations/remnawave/orchestrator.ts",
      "utf8",
    );
    const transport = readFileSync(
      "src/backend/integrations/remnawave/transport.ts",
      "utf8",
    );

    for (const [file, source] of [
      ["decoders.ts", decoders],
      ["identity-transitions.ts", transitions],
    ]) {
      expect(source, `${file} reaches runtime configuration or transport`)
        .not.toMatch(
          /@\/backend\/(?:config|observability|integrations\/http)|\bfetch\(|process\.|next\//,
        );
    }
    expect(orchestrator).not.toMatch(
      /credentialedFetch|readBoundedJsonFromUnknown|recordUpstreamRequest/,
    );
    expect(transport).toContain("credentialedFetch");
    expect(transport).toContain("readBoundedJsonFromUnknown");
    expect(transport).toContain("recordUpstreamRequest");
    expect(transport).toContain("cancelUpstreamResponseBody");
  });

  it("keeps web-session orchestration behind transport and repository boundaries", () => {
    const facadePath =
      "src/backend/integrations/sessions/web-session-service.ts";
    const orchestrator = readFileSync(
      "src/backend/integrations/sessions/web-session-orchestrator.ts",
      "utf8",
    );
    const repository = readFileSync(
      "src/backend/integrations/sessions/web-session-repository.ts",
      "utf8",
    );
    const transitions = readFileSync(
      "src/backend/integrations/sessions/web-session-transitions.ts",
      "utf8",
    );
    const transport = readFileSync(
      "src/backend/integrations/sessions/web-session-transport.ts",
      "utf8",
    );

    expect(orchestrator).toContain(
      "@/backend/integrations/sessions/web-session-repository",
    );
    expect(orchestrator).toContain(
      "@/backend/integrations/sessions/web-session-transitions",
    );
    expect(orchestrator).toContain(
      "@/backend/integrations/sessions/web-session-transport",
    );
    expect(orchestrator).not.toContain("@/backend/database/prisma");
    expect(orchestrator).not.toMatch(
      /\bprisma\.|next\/headers|next\/server|@prisma\/client/,
    );
    expect(repository).toContain("@/backend/database/prisma");
    expect(repository).not.toContain(
      "@/backend/integrations/sessions/web-session-revocation",
    );
    expect(repository).not.toMatch(/next\/headers|next\/server/);
    expect(transitions).not.toMatch(
      /@\/backend\/database|next\/headers|next\/server|\bprisma\.|\$transaction/,
    );
    expect(transport).toContain('from "next/headers"');
    expect(transport).not.toMatch(/@\/backend\/database|\bprisma\.|\$transaction/);

    const facade = readFileSync(facadePath, "utf8");
    const sourceFile = ts.createSourceFile(
      facadePath,
      facade,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    const exports = sourceFile.statements.flatMap((statement) => {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
      if (!ts.isNamedExports(statement.exportClause)) return [];
      return statement.exportClause.elements.map((element) => element.name.text);
    });
    expect(exports.sort()).toEqual([
      "assertEmailVerificationPolicy",
      "clearWebSession",
      "clearWebSessionCookies",
      "createDurableCallbackWebSession",
      "createWebSession",
      "createWebSessionForRemnashopUser",
      "createWebSessionOnResponse",
      "getCurrentRefreshSessionCandidateReadOnly",
      "getCurrentSession",
      "getCurrentSessionReadOnly",
      "getCurrentUser",
      "getWebSessionUserIdFromAccessCookie",
      "refreshCurrentAccessCookie",
      "refreshTokenGraceMs",
      "replaceWebSessionAfterPasswordChange",
      "revokeAllWebSessionsForUser",
      "rotateRefreshTokenFamily",
      "setDurableCallbackReplayCookies",
      "setDurableCallbackWebSessionCookies",
      "upgradeCurrentSessionToFull",
    ].sort());
  });

  it("isolates payment user-merge persistence behind its stable facade", () => {
    const modules = files(
      "src/backend/integrations/payments/payment-user-merge*.ts",
    );
    expect(modules.map(({ file }) => file.replaceAll("\\", "/")).sort()).toEqual([
      "src/backend/integrations/payments/payment-user-merge-orchestrator.ts",
      "src/backend/integrations/payments/payment-user-merge-repository.ts",
      "src/backend/integrations/payments/payment-user-merge-service.ts",
      "src/backend/integrations/payments/payment-user-merge-transitions.ts",
    ]);

    for (const { file, source } of modules) {
      const normalized = file.replaceAll("\\", "/");
      if (normalized.endsWith("payment-user-merge-repository.ts")) continue;
      expect(source, `${normalized} bypasses the payment merge repository`)
        .not.toContain("@/backend/database/prisma");
      expect(source, `${normalized} imports the Prisma runtime`)
        .not.toContain("@prisma/client");
    }

    const facade = readFileSync(
      "src/backend/integrations/payments/payment-user-merge-service.ts",
      "utf8",
    );
    const sourceFile = ts.createSourceFile(
      "payment-user-merge-service.ts",
      facade,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    expect(sourceFile.statements.every(ts.isExportDeclaration)).toBe(true);
    const exports = sourceFile.statements.flatMap((statement) => {
      if (!ts.isExportDeclaration(statement) || !statement.exportClause) return [];
      if (!ts.isNamedExports(statement.exportClause)) return [];
      return statement.exportClause.elements.map((element) => element.name.text);
    });
    expect(exports.sort()).toEqual([
      "assertNoActivePaymentDispatches",
      "assertPaymentOwnerChangeFenceHeld",
      "lockPaymentOwnerFence",
      "markPaymentOwnerChangeLocalFinalized",
      "markPaymentOwnerChangeUpstreamMutationStarted",
      "preflightPaymentOperationsForUserMerge",
      "reconcileCompletedPaymentOwnerChange",
      "transferPaymentOperationsForUserMerge",
      "withPaymentOwnerChangeFence",
    ]);
  });

  it("does not leak provider contracts into the application boundary", () => {
    for (const pattern of [
      "src/application/**/*.{ts,tsx}",
      "src/shared/payments/**/*.{ts,tsx}",
    ]) {
      for (const { file, source } of files(pattern)) {
        expect(source, file).not.toContain("@/shared/remnashop/");
        expect(source, file).not.toContain("@simplewebauthn/");
        expect(source, file).not.toContain("@prisma/client");
      }
    }
  });

  it("keeps verify-email view, controller and pure transitions separated", () => {
    const panelPath = "src/frontend/components/verify-email-panel.tsx";
    const panel = readFileSync(panelPath, "utf8");
    const controller = readFileSync(
      "src/frontend/hooks/use-verify-email-controller.ts",
      "utf8",
    );
    const state = readFileSync(
      "src/frontend/components/verify-email-state.ts",
      "utf8",
    );

    expect(panel).toContain("@/frontend/hooks/use-verify-email-controller");
    expect(panel).not.toContain("@/app/actions/email-verification");
    expect(panel).not.toMatch(/\buse(?:Effect|Ref|State)\b/);
    expect(controller).toContain("@/app/actions/email-verification");
    expect(controller).toContain("@/frontend/components/verify-email-state");
    expect(controller).not.toContain("primereact/");
    expect(state).not.toMatch(
      /@\/app\/actions|browser-navigation|primereact\/|\buse(?:Effect|Ref|State)\b/,
    );

    const sourceFile = ts.createSourceFile(
      panelPath,
      panel,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const exports = sourceFile.statements.flatMap((statement) => {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        return [statement.name.text];
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        return ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : [];
      }
      return [];
    });
    expect(exports).toEqual(["VerifyEmailPanel"]);
  });

  it("keeps scenario views behind explicit controller and presentation boundaries", () => {
    type ViewBoundary = {
      path: string;
      boundaryImports: string[];
      runtimeExports: string[];
      allowedInfrastructureBindings?: Record<string, string[]>;
      allowedInfrastructureCallCounts?: Record<string, number>;
      allowedViewHookCounts?: Record<string, number>;
      allowedBrowserGlobalCounts?: Record<string, number>;
    };

    const views: ViewBoundary[] = [
      {
        path: "src/frontend/components/verify-email-panel.tsx",
        boundaryImports: ["@/frontend/hooks/use-verify-email-controller"],
        runtimeExports: ["VerifyEmailPanel"],
      },
      {
        path: "src/frontend/components/account-action-required.tsx",
        boundaryImports: ["@/frontend/hooks/use-account-action-required-controller"],
        runtimeExports: ["AccountActionRequired"],
      },
      {
        path: "src/frontend/components/tariffs-panel.tsx",
        boundaryImports: [
          "@/frontend/components/tariffs-panel-presentation",
          "@/frontend/hooks/use-tariffs-panel-controller",
        ],
        runtimeExports: ["TariffsPanel"],
      },
      {
        path: "src/frontend/components/cabinet-responsive-sections.tsx",
        boundaryImports: [
          "@/frontend/components/cabinet-payment-history-presentation",
          "@/frontend/hooks/use-cabinet-payment-history-controller",
        ],
        runtimeExports: [
          "MOBILE_PAYMENT_PREVIEW_COUNT",
          "CabinetDevicesSection",
          "CabinetPaymentHistorySection",
        ],
      },
      {
        path: "src/frontend/components/cabinet-panel.tsx",
        boundaryImports: ["@/frontend/hooks/use-cabinet-panel-controller"],
        runtimeExports: ["CabinetPanel"],
      },
      {
        path: "src/frontend/components/chatwoot-widget.tsx",
        boundaryImports: ["@/frontend/components/chatwoot-widget-controller"],
        runtimeExports: ["ChatwootWidget", "ChatwootGuestBoundary"],
        allowedInfrastructureBindings: {
          react: ["useEffect"],
          "@/app/actions/chatwoot": ["loadChatwootSupportContextAction"],
          "@/frontend/lib/chatwoot": [
            "enterChatwootGuestMode",
            "loadChatwootSupportContextCached",
          ],
        },
        allowedInfrastructureCallCounts: {
          enterChatwootGuestMode: 1,
          loadChatwootSupportContextAction: 1,
          loadChatwootSupportContextCached: 1,
        },
        allowedViewHookCounts: { useEffect: 1 },
      },
      {
        path: "src/frontend/components/telegram-webapp-login.tsx",
        boundaryImports: ["@/frontend/hooks/use-telegram-webapp-login-controller"],
        runtimeExports: ["TelegramWebAppLogin"],
        allowedBrowserGlobalCounts: { window: 1 },
      },
    ];

    for (const view of views) {
      const source = readFileSync(view.path, "utf8");
      const imports = astImportedModules(source);
      const infrastructureImports = imports.filter((dependency) =>
        dependency === "react"
        || dependency === "next/navigation"
        || dependency.startsWith("@/app/actions")
        || dependency.startsWith("@/backend")
        || dependency === "@/frontend/lib/browser-navigation"
        || dependency === "@/frontend/lib/chatwoot"
      );
      expect(
        infrastructureImports,
        `${view.path} changed its exact legacy infrastructure-import allowlist`,
      ).toEqual(Object.keys(view.allowedInfrastructureBindings ?? {}));
      for (const dependency of view.boundaryImports) {
        expect(imports, `${view.path} is missing ${dependency}`)
          .toContain(dependency);
      }

      const sourceFile = ts.createSourceFile(
        view.path,
        source,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const runtimeExports: string[] = [];
      const infrastructureBindings: Record<string, string[]> = {};
      const callCounts = new Map<string, number>();
      const viewHookCounts = new Map<string, number>();
      const browserGlobalCounts = new Map<string, number>();
      const browserGlobalNames = new Set(["document", "globalThis", "navigator", "window"]);
      const statefulViewHooks = new Set([
        "useCallback",
        "useEffect",
        "useMemo",
        "useReducer",
        "useRef",
        "useRouter",
        "useState",
      ]);

      for (const statement of sourceFile.statements) {
        if (
          ts.isImportDeclaration(statement)
          && ts.isStringLiteralLike(statement.moduleSpecifier)
          && infrastructureImports.includes(statement.moduleSpecifier.text)
        ) {
          const bindings: string[] = [];
          const importClause = statement.importClause;
          if (importClause?.name) bindings.push(importClause.name.text);
          if (importClause?.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              bindings.push(`* as ${importClause.namedBindings.name.text}`);
            } else {
              bindings.push(...importClause.namedBindings.elements.map(
                (element) => element.name.text,
              ));
            }
          }
          infrastructureBindings[statement.moduleSpecifier.text] = bindings;
        }

        const exported = ts.canHaveModifiers(statement)
          && ts.getModifiers(statement)?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          );
        if (!exported) continue;
        if (ts.isFunctionDeclaration(statement) && statement.name) {
          runtimeExports.push(statement.name.text);
        }
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name)) {
              runtimeExports.push(declaration.name.text);
            }
          }
        }
      }

      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
        ) {
          const callName = node.expression.text;
          callCounts.set(callName, (callCounts.get(callName) ?? 0) + 1);
          if (statefulViewHooks.has(callName)) {
            viewHookCounts.set(
              callName,
              (viewHookCounts.get(callName) ?? 0) + 1,
            );
          }
        }
        if (
          ts.isPropertyAccessExpression(node)
          && ts.isIdentifier(node.expression)
          && browserGlobalNames.has(node.expression.text)
        ) {
          const globalName = node.expression.text;
          browserGlobalCounts.set(
            globalName,
            (browserGlobalCounts.get(globalName) ?? 0) + 1,
          );
        }
        ts.forEachChild(node, visit);
      }
      visit(sourceFile);

      expect(infrastructureBindings).toEqual(
        view.allowedInfrastructureBindings ?? {},
      );
      const allowedInfrastructureCalls = view.allowedInfrastructureCallCounts ?? {};
      expect(Object.fromEntries(
        Object.keys(allowedInfrastructureCalls).map((callName) => [
          callName,
          callCounts.get(callName) ?? 0,
        ]),
      )).toEqual(allowedInfrastructureCalls);
      expect(Object.fromEntries(viewHookCounts)).toEqual(
        view.allowedViewHookCounts ?? {},
      );
      expect(Object.fromEntries(browserGlobalCounts)).toEqual(
        view.allowedBrowserGlobalCounts ?? {},
      );
      expect(runtimeExports).toEqual(view.runtimeExports);
    }
  });

  it("keeps purchase and extension views behind thin controller boundaries", () => {
    for (const {
      componentName,
      controllerPath,
      panelPath,
      presentationPath,
    } of [
      {
        componentName: "PaymentConfirmation",
        controllerPath:
          "src/frontend/hooks/use-payment-confirmation-controller.ts",
        panelPath: "src/frontend/components/payment-confirmation.tsx",
        presentationPath:
          "src/frontend/components/payment-confirmation-presentation.ts",
      },
      {
        componentName: "ExtendConfirmation",
        controllerPath:
          "src/frontend/hooks/use-extend-confirmation-controller.ts",
        panelPath: "src/frontend/components/extend-confirmation.tsx",
        presentationPath:
          "src/frontend/components/extend-confirmation-presentation.ts",
      },
    ]) {
      const panel = readFileSync(panelPath, "utf8");
      const controller = readFileSync(controllerPath, "utf8");
      const presentation = readFileSync(presentationPath, "utf8");

      expect(panel).toContain(controllerPath
        .replace(/^src\//, "@/")
        .replace(/\.ts$/, ""));
      expect(panel).not.toMatch(
        /@\/app\/actions\/payments|payment-idempotency|confirmedPaymentOffer|\buse(?:Effect|Memo|Ref|State)\b/,
      );
      expect(controller).toContain("@/app/actions/payments");
      expect(controller).toContain("@/frontend/lib/payment-idempotency");
      expect(controller).toContain(presentationPath
        .replace(/^src\//, "@/")
        .replace(/\.ts$/, ""));
      expect(controller).not.toContain("primereact/");
      expect(presentation).not.toMatch(
        /@\/app\/actions|browser-navigation|payment-idempotency|primereact\/|\buse(?:Effect|Memo|Ref|State)\b/,
      );

      const sourceFile = ts.createSourceFile(
        panelPath,
        panel,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const exports = sourceFile.statements.flatMap((statement) => {
        if (
          ts.isFunctionDeclaration(statement)
          && statement.name
          && ts.canHaveModifiers(statement)
          && ts.getModifiers(statement)?.some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
          )
        ) {
          return [statement.name.text];
        }
        if (ts.isExportDeclaration(statement) && statement.exportClause) {
          return ts.isNamedExports(statement.exportClause)
            ? statement.exportClause.elements.map((element) => element.name.text)
            : [];
        }
        return [];
      });
      expect(exports).toEqual([componentName]);
    }
  });

  it("keeps payment-return presentation, browser lifecycle and pure state separated", () => {
    const panelPath = "src/frontend/components/payment-return-status.tsx";
    const controllerPath =
      "src/frontend/hooks/use-payment-return-status-controller.ts";
    const statePath =
      "src/frontend/components/payment-return-status-state.ts";
    const panel = readFileSync(panelPath, "utf8");
    const controller = readFileSync(controllerPath, "utf8");
    const state = readFileSync(statePath, "utf8");

    expect(panel).toContain(
      "@/frontend/hooks/use-payment-return-status-controller",
    );
    expect(panel).toContain(
      "@/frontend/components/payment-return-status-state",
    );
    expect(panel).not.toMatch(
      /@\/app\/actions\/payment-status|\buse(?:Callback|Effect|Ref|State|Transition)\b|\b(?:document|navigator|window)\.|setTimeout|clearTimeout/,
    );
    expect(controller).toContain("@/app/actions/payment-status");
    expect(controller).toContain(
      "@/frontend/components/payment-return-status-state",
    );
    expect(controller).toMatch(/\bdocument\.|\bnavigator\.|\bwindow\./);
    expect(controller).not.toContain("primereact/");
    expect(state).not.toMatch(
      /@\/app\/actions|primereact\/|\buse(?:Callback|Effect|Ref|State|Transition)\b|\b(?:document|navigator|window)\.|setTimeout|clearTimeout/,
    );

    const sourceFile = ts.createSourceFile(
      panelPath,
      panel,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const exports = sourceFile.statements.flatMap((statement) => {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        return [statement.name.text];
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        return ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : [];
      }
      return [];
    });
    expect(exports).toEqual(["PaymentReturnStatus"]);
  });

  it("keeps install-app presentation, browser integration and pure state separated", () => {
    const panelPath = "src/frontend/components/install-app-button.tsx";
    const controllerPath = "src/frontend/hooks/use-install-app-controller.ts";
    const statePath = "src/frontend/components/install-app-button-state.ts";
    const panel = readFileSync(panelPath, "utf8");
    const controller = readFileSync(controllerPath, "utf8");
    const state = readFileSync(statePath, "utf8");

    expect(panel).toContain("@/frontend/hooks/use-install-app-controller");
    expect(panel).not.toMatch(
      /\buse(?:Effect|Ref|State)\b|beforeinstallprompt|appinstalled|serviceWorker|telegram-webapp|\b(?:navigator|window)\./,
    );
    expect(controller).toContain('window.addEventListener("beforeinstallprompt"');
    expect(controller).toContain('window.addEventListener("appinstalled"');
    expect(controller).toContain('.register("/sw.js", { scope: "/", updateViaCache: "none" })');
    expect(controller).toContain("@/frontend/lib/telegram-webapp");
    expect(controller).toContain("@/frontend/components/install-app-button-state");
    expect(controller).not.toMatch(/next\/link|primereact\/|@\/shared\/branding/);
    expect(state).toContain("@/frontend/lib/install-app-transitions");
    expect(state).not.toMatch(
      /\buse(?:Effect|Ref|State)\b|\b(?:navigator|window|document)\.|beforeinstallprompt|appinstalled|serviceWorker|telegram-webapp|next\/|primereact\//,
    );

    const sourceFile = ts.createSourceFile(
      panelPath,
      panel,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const exports = sourceFile.statements.flatMap((statement) => {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        return [statement.name.text];
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        return ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : [];
      }
      return [];
    });
    expect(exports).toEqual(["InstallAppButton"]);
  });

  it("keeps referral presentation and browser integrations behind exact boundaries", () => {
    const panelPath = "src/frontend/components/referral-program-panel.tsx";
    const controllerPath =
      "src/frontend/hooks/use-referral-program-controller.ts";
    const presentationPath =
      "src/frontend/components/referral-program-presentation.ts";
    const panel = readFileSync(panelPath, "utf8");
    const controller = readFileSync(controllerPath, "utf8");
    const presentation = readFileSync(presentationPath, "utf8");

    expect(panel).toContain("@/frontend/hooks/use-referral-program-controller");
    expect(panel).toContain(
      "@/frontend/components/referral-program-presentation",
    );
    expect(panel).not.toMatch(
      /\buseState\b|\b(?:navigator|document|window)\.|clipboard|execCommand|\.share\b/,
    );
    expect(controller).toContain("navigator.clipboard");
    expect(controller).toContain('document.createElement("textarea")');
    expect(controller).toContain('document.execCommand("copy")');
    expect(controller).toContain("navigator.share");
    expect(controller).not.toMatch(
      /primereact\/|@\/application\/|@\/shared\/auth\/session-navigation/,
    );
    expect(presentation).not.toMatch(
      /\buseState\b|\b(?:navigator|document|window)\.|clipboard|execCommand|\.share\b|primereact\/|@\/app\/actions|@\/backend\//,
    );

    const sourceFile = ts.createSourceFile(
      panelPath,
      panel,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const exports = sourceFile.statements.flatMap((statement) => {
      if (
        ts.isFunctionDeclaration(statement)
        && statement.name
        && ts.canHaveModifiers(statement)
        && ts.getModifiers(statement)?.some(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
      ) {
        return [statement.name.text];
      }
      if (ts.isExportDeclaration(statement) && statement.exportClause) {
        return ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : [];
      }
      return [];
    });
    expect(exports.sort()).toEqual([
      "ReferralProgramPanel",
      "referralAccrualDescription",
      "referralRewardDescription",
    ].sort());
  });

  it("keeps the complete React layer free from transport and backend concerns", () => {
    for (const { file, source } of files("src/frontend/**/*.{ts,tsx}")) {
      expect(source, file).not.toMatch(/\bfetch\s*\(/);
      expect(source, file).not.toContain("/api/bff");
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        expect(resolved, `${file} imports backend module ${dependency}`).not.toMatch(/^src\/backend\//);
        if (resolved.startsWith("src/application/")) {
          expect(
            resolved.startsWith("src/application/models/"),
            `${file} imports application implementation ${dependency}`,
          ).toBe(true);
        }
      }
    }
  });

  it("prevents infrastructure from depending on framework composition or React", () => {
    for (const { file, source } of files("src/backend/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        expect(resolved, `${file} imports outer module ${dependency}`).not.toMatch(/^src\/(?:app|frontend)\//);
      }
    }
  });

  it("allows backend adapters to depend only on application contracts", () => {
    for (const { file, source } of files("src/backend/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        if (!resolved.startsWith("src/application/")) continue;
        expect(
          resolved.includes("/ports/") || resolved.startsWith("src/application/models/"),
          `${file} composes application implementation ${dependency} (${resolved})`,
        ).toBe(true);
      }
    }
  });

  it("keeps every production composition root in src/app/_composition", () => {
    expect(globSync("src/backend/composition/**/*.{ts,tsx}"), "backend composition roots")
      .toEqual([]);
    for (const file of globSync("src/**/{composition,_composition}/**/*.{ts,tsx}")) {
      expect(file.replaceAll("\\", "/"), file).toMatch(/^src\/app\/_composition\//);
    }
    for (const { file, source } of files("src/backend/integrations/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        expect(resolved, `${file} imports backend composition ${dependency}`)
          .not.toMatch(/^src\/backend\/composition\//);
      }
    }
  });

  it("routes every Server Action adapter dependency through app composition", () => {
    for (const { file, source } of files("src/app/actions/**/*.{ts,tsx}")) {
      for (const { dependency, resolved } of astProjectDependencies(file, source)) {
        expect(
          resolved,
          `${file} imports adapter ${dependency} outside app composition`,
        ).not.toMatch(/^src\/backend\//);
      }
    }
  });

  it("constructs the auth command adapter only in app composition", () => {
    const composition = readFileSync("src/app/_composition/action-runtime.ts", "utf8");
    const adapter = readFileSync("src/backend/integrations/auth/auth-commands.ts", "utf8");

    expect(adapter).toContain("export function createProductionAuthCommands()");
    expect(adapter).not.toContain("export const productionAuthCommands");
    expect(composition).toContain("createProductionAuthCommands()");
    expect(composition).toContain("export const productionAuthCommands");
  });

  it("routes every Next.js controller adapter dependency through app composition", () => {
    for (const { file, source } of files("src/app/**/*.{ts,tsx}")) {
      if (file.replaceAll("\\", "/").startsWith("src/app/_composition/")) continue;
      for (const { dependency, resolved } of astProjectDependencies(file, source)) {
        expect(
          resolved,
          `${file} imports adapter ${dependency} outside app composition`,
        ).not.toMatch(/^src\/backend\//);
      }
    }
  });

  it("keeps domain code free from packages and non-domain modules", () => {
    for (const { file, source } of files("src/shared/domain/**/*.{ts,tsx}")) {
      for (const dependency of importedModules(source)) {
        const resolved = projectPath(file, dependency);
        expect(
          resolved?.startsWith("src/shared/domain/") ?? false,
          `${file} imports package or non-domain module ${dependency}`,
        ).toBe(true);
      }
    }
  });

  it("does not retain pass-through use cases without application policy", () => {
    for (const facade of [
      "src/application/auth/claim-one-time-state.ts",
      "src/application/auth/ports/one-time-state.ts",
      "src/application/observability/write-audit-event.ts",
      "src/application/observability/ports/audit-event-repository.ts",
    ]) {
      expect(globSync(facade), facade).toEqual([]);
    }
  });

  it("keeps authentication workflow policy in the application layer", () => {
    const useCase = [
      "src/application/auth/execute-auth-command.ts",
      "src/application/auth/execute-email-registration.ts",
      "src/application/auth/execute-password-reset-confirmation.ts",
    ].map((file) => readFileSync(file, "utf8")).join("\n");
    const adapter = readFileSync("src/backend/integrations/auth/auth-commands.ts", "utf8");

    expect(useCase).toContain('action: "auth_register"');
    expect(useCase).toContain('error instanceof AuthGatewayError');
    expect(useCase).toContain("requestEmailVerification(providerSession, email)");
    expect(useCase).toContain('action: "password_reset_confirm"');
    expect(adapter).not.toContain("verificationRequired");
    expect(adapter).not.toContain("auth_register_success");
    expect(useCase).not.toMatch(/as \{ code\?: unknown \}/);
    for (const facade of [
      "src/backend/auth/email-login.ts",
      "src/backend/auth/email-register.ts",
      "src/backend/auth/password-reset.ts",
    ]) {
      expect(globSync(facade), facade).toEqual([]);
    }
  });

  it("keeps profile resolution and passkey-management policy in application use cases", () => {
    const profileUseCase = readFileSync("src/application/auth/resolve-auth-profile.ts", "utf8");
    const profileAdapter = readFileSync("src/backend/integrations/auth/auth-profile-gateway.ts", "utf8");
    const passkeyUseCase = readFileSync("src/application/auth/manage-linked-account.ts", "utf8");
    const passkeyPersistence = readFileSync("src/backend/integrations/auth/passkey-service.ts", "utf8");
    const linkAdapter = readFileSync("src/backend/integrations/auth/link-account.ts", "utf8");
    const mergeAdapter = readFileSync("src/backend/integrations/auth/telegram-account-merge-gateway.ts", "utf8");
    const mergeStore = readFileSync("src/backend/integrations/auth/telegram-account-merge-store.ts", "utf8");
    const passkeyAdapter = readFileSync("src/backend/integrations/auth/passkey-gateway.ts", "utf8");
    const paymentWorkflowAdapter = readFileSync("src/backend/integrations/payments/payment-workflow-gateway.ts", "utf8");
    const paymentStatusAdapter = readFileSync("src/backend/integrations/payments/payment-status-reader.ts", "utf8");

    expect(globSync("src/backend/auth/profile.ts")).toEqual([]);
    expect(profileUseCase).toContain("shouldReconcileVerifiedEmail");
    expect(profileUseCase).toContain("EMAIL_REQUIRED");
    expect(profileAdapter).not.toContain("shouldReconcileVerifiedEmail");
    expect(profileAdapter).not.toContain("resolveAuthProfile");
    expect(passkeyUseCase).toContain("accountAccessIssue(actor)");
    expect(passkeyPersistence).not.toContain("getCurrentSession");
    expect(passkeyPersistence).not.toContain("assertEmailVerificationPolicy");
    expect(passkeyPersistence).not.toMatch(/export async function (?:listPasskeys|deletePasskey)\b/);
    expect(linkAdapter).not.toContain("WebSessionAssuranceLevel.BOOTSTRAP");
    expect(passkeyUseCase).toContain('new LinkAccountGatewayError("PASSKEY_REQUIRED")');
    expect(mergeAdapter).not.toContain("WebSessionAssuranceLevel.BOOTSTRAP");
    expect(mergeStore).not.toContain("getCurrentSession");
    expect(readFileSync("src/application/auth/confirm-telegram-account-merge.ts", "utf8"))
      .toContain('new AccountMergeError("PASSKEY_REQUIRED")');
    expect(passkeyAdapter).toContain("if (!session) return null");
    expect(paymentWorkflowAdapter).not.toContain('throw new ServiceError("UNAUTHORIZED"');
    expect(paymentStatusAdapter).not.toContain('throw new PaymentStatusGatewayError("UNAUTHORIZED")');
    expect(readFileSync("src/application/payments/execute-payment-workflow.ts", "utf8"))
      .toContain('workflowError("UNAUTHORIZED"');
  });

  it("keeps only ports that are consumed by an application use case", () => {
    expect(unusedApplicationPorts(
      files("src/application/**/ports/*.{ts,tsx}"),
      files("src/application/**/*.{ts,tsx}"),
    )).toEqual([]);
  });

  it("detects an application port that has no use-case consumer", () => {
    expect(unusedApplicationPorts(
      [
        { file: "src/application/orders/ports/orders.ts" },
        { file: "src/application/orders/ports/orphaned-gateway.ts" },
      ],
      [
        { file: "src/application/orders/place-order.ts", source: 'import type { Orders } from "@/application/orders/ports/orders";' },
      ],
    )).toEqual(["src/application/orders/ports/orphaned-gateway"]);
  });

  it("wires payment and readiness use cases only at the application boundary", () => {
    const paymentAdapter = readFileSync("src/backend/integrations/payments/payment-workflow-gateway.ts", "utf8");
    const paymentAction = readFileSync("src/app/actions/payments.ts", "utf8");
    const readinessAdapter = readFileSync("src/backend/health/checks.ts", "utf8");
    const publicReadinessController = readFileSync("src/app/api/health/readiness/route.ts", "utf8");
    const internalReadinessController = readFileSync("src/app/api/internal/health/readiness/route.ts", "utf8");

    expect(paymentAdapter).not.toContain("executePaymentWorkflow");
    expect(paymentAction).toContain("executePaymentWorkflow(");
    expect(paymentAction).toContain("productionPaymentWorkflowGateway");
    expect(readinessAdapter).not.toContain("@/application/health/readiness");
    expect(publicReadinessController).toContain("getPublicReadiness(createProductionReadinessGateway())");
    expect(internalReadinessController).toContain("runDetailedReadiness(createProductionReadinessGateway())");
    expect(globSync("src/backend/health/readiness.ts")).toEqual([]);
  });

  it("does not expose the removed internal browser transport", () => {
    expect(globSync("src/app/api/bff/**/route.ts")).toEqual([]);
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("removedBrowserTransportPaths");
    expect(proxy).toContain("'/api/bff/payments/status'");
    expect(proxy).toContain("isRoutineReadinessProbe ? logger.debug : logger.info");
  });

  it("does not retain compatibility facades around infrastructure adapters", () => {
    for (const facade of [
      "src/backend/auth/email-verification.ts",
      "src/backend/auth/passkeys.ts",
      "src/backend/auth/redirect-policy.ts",
      "src/backend/auth/remnashop-link.ts",
      "src/backend/auth/telegram-account-merge.ts",
      "src/backend/payments/history-sync.ts",
      "src/backend/payments/idempotency.ts",
      "src/backend/payments/reconciliation.ts",
      "src/backend/payments/records.ts",
      "src/backend/payments/user-merge.ts",
      "src/backend/sessions/web-session.ts",
    ]) {
      expect(globSync(facade), facade).toEqual([]);
    }
  });

  it("keeps Telegram callback business orchestration out of the HTTP controller", () => {
    const controller = readFileSync("src/app/auth/telegram/callback/route.ts", "utf8");
    const useCase = readFileSync("src/application/auth/complete-telegram-callback.ts", "utf8");
    const gateway = readFileSync("src/backend/integrations/auth/telegram-callback-gateway.ts", "utf8");

    expect(controller).toContain("completeTelegramCallback(");
    expect(controller).not.toContain("remnashopMergeUsers(");
    expect(controller).not.toContain("remnashopLinkTelegram(");
    expect(controller).not.toContain("withPaymentOwnerChangeFence(");
    expect(controller).not.toContain("reconcileUserFromRemnashopAuth(");
    expect(controller).toContain("recoverRemnashopTelegramSession(");
    expect(useCase).toContain("withOwnerChangeFence({");
    expect(useCase).toContain("mergeIntoTelegramAccount(");
    expect(useCase).toContain("resolveVerifiedTelegramIdentity(");
    expect(useCase).toContain("stageAccountMerge(");
    expect(useCase).toContain("gateway.preflightAccountMerge(");
    expect(useCase).toContain('"/link-account?auth=telegram_email_replace"');
    expect(useCase).not.toMatch(/return gateway\.complete\(input\)/);
    expect(gateway).not.toContain("completeConsumedCallback");
    expect(gateway).not.toContain("reconcileTelegramCallbackResult");
    expect(gateway).not.toContain("stageTelegramAccountMerge");
    expect(gateway).toContain("verifyTelegramCallback");
    expect(globSync("src/backend/integrations/auth/telegram-callback-processor.ts")).toEqual([]);
  });

  it("keeps Telegram WebApp workflow policy in the application layer", () => {
    const useCase = readFileSync("src/application/auth/authenticate-telegram-webapp.ts", "utf8");
    const gateway = readFileSync("src/backend/integrations/auth/telegram-webapp-gateway.ts", "utf8");
    const action = readFileSync("src/app/actions/telegram.ts", "utf8");

    expect(useCase).toContain("authenticateProvider(normalizedInitData)");
    expect(useCase).toContain("verifiedIdentity(providerSession)");
    expect(useCase).toContain("rateLimit(verifiedIdentity.telegramId)");
    expect(useCase).toContain("reconcileIdentity(providerSession, verifiedIdentity)");
    expect(useCase).toContain("createSession({");
    expect(useCase).toContain("if (reconciled.requiresRecovery)");
    expect(useCase).toContain("recoverSession(session.id, reconciled.userId)");
    expect(gateway).not.toContain("if (!session)");
    expect(gateway).not.toContain("requiresRecovery)");
    expect(action).toContain("authenticateTelegramWebApp(productionTelegramWebAppGateway");
    expect(globSync("src/backend/integrations/auth/telegram-webapp.ts")).toEqual([]);
  });

  it("keeps human-verification ordering in application use cases", () => {
    const useCase = readFileSync("src/application/auth/execute-passkey-command.ts", "utf8");
    const gateway = readFileSync("src/backend/integrations/auth/passkey-gateway.ts", "utf8");
    const legacyService = readFileSync("src/backend/integrations/auth/passkey-service.ts", "utf8");

    expect(useCase.indexOf("commands.verifyHuman(")).toBeLessThan(useCase.indexOf("commands.assertLoginOptionsRateLimit("));
    expect(useCase.indexOf("commands.assertLoginOptionsRateLimit(")).toBeLessThan(useCase.indexOf("commands.findLoginAccount("));
    expect(useCase.indexOf("commands.recordAuthentication(")).toBeLessThan(useCase.indexOf("commands.createAuthenticatedSession("));
    expect(gateway).not.toContain("if (!account?.credentials.length)");
    expect(gateway).not.toContain("challenge.userId !== credential.userId");
    expect(legacyService).not.toMatch(/export async function (begin|finish)Passkey/);
  });

  it("keeps e-mail verification and change workflows in the application layer", () => {
    const useCase = readFileSync("src/application/auth/execute-email-verification.ts", "utf8");
    const adapter = readFileSync("src/backend/integrations/auth/email-verification.ts", "utf8");
    const profileAdapter = readFileSync("src/backend/integrations/profile/profile-adapter.ts", "utf8");

    expect(useCase.indexOf("commands.verifyHuman(")).toBeLessThan(useCase.indexOf("commands.loadActor("));
    expect(useCase.indexOf("commands.assertRequestLimits(")).toBeLessThan(useCase.indexOf("commands.requestProviderCode("));
    expect(useCase).toContain("synchronizeConfirmedAccount(commands");
    expect(useCase).toContain("mergeEmailAndTelegramAccounts(");
    expect(useCase.indexOf("commands.assertChangeLimits(")).toBeLessThan(useCase.indexOf("commands.changeProviderEmail("));
    expect(useCase.indexOf("commands.emailOwnerId(")).toBeLessThan(useCase.indexOf("commands.assertChangeCooldown("));
    expect(useCase.indexOf("commands.assertChangeCooldown(")).toBeLessThan(useCase.indexOf("commands.changeProviderEmail("));
    expect(adapter).toContain('action: "email_change_attempt"');
    expect(adapter).toContain('action: "email_change_cooldown"');
    expect(adapter).not.toContain("confirmEmailVerification(");
    expect(profileAdapter).not.toContain("email-verification-service");
    expect(profileAdapter).not.toContain("requestEmailVerification(");
    expect(profileAdapter).not.toContain("changeEmail(");
  });

  it("keeps linked-email authentication and merge policy in the application layer", () => {
    const useCase = readFileSync("src/application/auth/manage-linked-account.ts", "utf8");
    const adapter = readFileSync("src/backend/integrations/auth/link-account.ts", "utf8");

    expect(useCase).toContain('operation: "login"');
    expect(useCase).toContain('operation: "register"');
    expect(useCase).toContain("linkActorIsCurrent(actor)");
    expect(useCase).toContain("linkVerifiedEmailAccount(");
    expect(useCase).toContain("mergeLinkAccounts(");
    expect(adapter).not.toContain("linkRemnashopAccount");
    expect(adapter).not.toContain("remnashop-link-service");
  });

  it("keeps password-change retry and session replacement policy in application", () => {
    const useCase = readFileSync("src/application/profile/execute-profile-command.ts", "utf8");
    const adapter = readFileSync("src/backend/integrations/profile/profile-adapter.ts", "utf8");

    expect(useCase).toContain('error.code !== "CURRENT_PASSWORD_INVALID"');
    expect(useCase.indexOf("refreshProviderSession(session)")).toBeLessThan(useCase.indexOf("persistRefreshedProviderSession(session, refreshed)"));
    expect(useCase.indexOf("replaceLocalPasswordSession(session, changed)")).toBeLessThan(useCase.indexOf("auditPasswordChanged(session.userId)"));
    expect(adapter).not.toContain("@/backend/auth/password");
    expect(adapter).not.toContain("changePassword(");
  });

  it("keeps Telegram account-merge state machine in the application layer", () => {
    const useCase = readFileSync("src/application/auth/confirm-telegram-account-merge.ts", "utf8");
    const gateway = readFileSync("src/backend/integrations/auth/telegram-account-merge-gateway.ts", "utf8");
    const action = readFileSync("src/app/actions/link-account.ts", "utf8");

    expect(useCase).toContain('confirmation.status === "COMPLETED"');
    expect(useCase).toContain("assertOwnerUnchanged(");
    expect(useCase).toContain("assertPreflight(");
    expect(useCase).toContain("expectedSubscription !== finalSubscription");
    expect(useCase).toContain("gateway.release(confirmation");
    expect(gateway).not.toContain("confirmTelegramAccountMerge(");
    expect(action).toContain("productionTelegramAccountMergeGateway");
    expect(action).toContain("confirmLinkedTelegram(productionTelegramAccountMergeGateway)");
  });

  it("keeps Telegram session-recovery orchestration in the application layer", () => {
    const useCase = readFileSync("src/application/auth/recover-telegram-session.ts", "utf8");
    const adapter = readFileSync("src/backend/integrations/remnashop/telegram-session-recovery.ts", "utf8");
    const composition = readFileSync("src/app/_composition/telegram-session-recovery.ts", "utf8");
    const sessionGateways = readFileSync("src/app/_composition/session-gateways.ts", "utf8");
    const authorization = readFileSync("src/backend/integrations/remnashop/session-authorization.ts", "utf8");
    const recoveryDependency = readFileSync(
      "src/backend/integrations/remnashop/telegram-session-recovery-dependency.ts",
      "utf8",
    );
    const identitySync = readFileSync("src/backend/integrations/auth/provider-account-identity-sync.ts", "utf8");

    expect(useCase).toContain('emailResolution: "KEEP_TARGET"');
    expect(useCase).toContain("synchronizeProviderIdentity({");
    expect(useCase.indexOf("synchronizeProviderIdentity({"))
      .toBeLessThan(useCase.indexOf("commitLocalRecovery({"));
    expect(adapter).not.toContain('emailResolution: "KEEP_TARGET"');
    expect(adapter).not.toContain("recoverTelegramSession(");
    expect(composition).toContain("recoverTelegramSession(");
    expect(composition).toContain(
      "recoverTelegramSession: attachRemnashopTokensForTelegramSession",
    );
    expect(composition).not.toMatch(/registerRemnashop|registeredRecovery/);
    expect(authorization).toContain(
      "recoverTelegramSession = missingRemnashopTelegramRecovery",
    );
    expect(recoveryDependency).toContain("missingRemnashopTelegramRecovery");
    expect(recoveryDependency).not.toMatch(/\blet\s+registered|\bregisterRemnashop/);
    expect(authorization).not.toContain("@/application/auth/recover-telegram-session");
    expect(globSync("src/backend/composition/**/*.{ts,tsx}")).toEqual([]);
    for (const factory of [
      "createProductionAuthProfileGateway",
      "createProductionEmailVerificationCommands",
      "createProductionPasskeyCommands",
      "createProductionTelegramCallbackGateway",
      "createProductionTelegramWebAppGateway",
      "createProductionCabinetCommands",
      "createProductionPaymentStatusReader",
      "createProductionPaymentWorkflowGateway",
      "createProductionProfileCommands",
      "createEmailReminderPreferenceCommands",
      "createProductionChatwootContextGateway",
    ]) {
      expect(sessionGateways, `${factory} must be wired at the app root`)
        .toContain(`${factory}(`);
    }
    for (const { file, source } of files("src/app/**/*.{ts,tsx}")) {
      if (file.replaceAll("\\", "/").startsWith("src/app/_composition/")) continue;
      for (const { dependency, resolved } of projectDependencies(file, source)) {
        expect(
          resolved,
          `${file} bypasses the session composition root through ${dependency}`,
        ).not.toMatch(
          /^src\/backend\/integrations\/(?:auth\/(?:auth-profile-gateway|email-verification|passkey-commands|telegram-callback-gateway|telegram-webapp-gateway)|cabinet\/cabinet-commands|payments\/(?:payment-status-reader|payment-workflow-gateway)|profile\/(?:profile-adapter|email-reminder-preferences-adapter)|support\/chatwoot-context-gateway|remnashop\/session-authorization)$/,
        );
      }
    }
    expect(identitySync).toContain("@/backend/integrations/remnashop/api-client");
    expect(identitySync).not.toContain("@/backend/integrations/remnashop/client");
  });

  it("keeps session business operations out of server actions", () => {
    const action = readFileSync("src/app/actions/session.ts", "utf8");

    expect(action).toContain("clearCabinetSession(");
    expect(action).toContain("endCabinetSession(");
    expect(action).not.toContain("productionCabinetCommands.logout(");
  });

  it("keeps payment maintenance orchestration out of the HTTP controller", () => {
    const controller = readFileSync("src/app/api/internal/payments/reconcile/route.ts", "utf8");

    expect(controller).toContain("runPaymentMaintenance(");
    expect(controller).not.toContain("reconcileUnknownPayments(");
    expect(controller).not.toContain("continuePaymentHistoryBackfills(");
  });

  it("keeps Telegram start security orchestration out of the HTTP controller", () => {
    const controller = readFileSync("src/app/auth/telegram/start/route.ts", "utf8");

    expect(controller).toContain("prepareTelegramAuthStart(");
    expect(controller).not.toContain("verifyTurnstileToken(");
    expect(controller).not.toContain("assertRateLimit(");
    expect(controller).not.toContain("getCurrentUser(");
  });

  it("keeps backend orchestration free from direct database access", () => {
    for (const pattern of [
      "src/backend/auth/**/*.{ts,tsx}",
      "src/backend/payments/**/*.{ts,tsx}",
      "src/backend/sessions/**/*.{ts,tsx}",
      "src/backend/observability/**/*.{ts,tsx}",
    ]) {
      for (const { file, source } of files(pattern)) {
        expect(source, file).not.toContain("@/backend/database/prisma");
        expect(source, file).not.toMatch(/\bprisma\./);
      }
    }
  });

  it("keeps persistence dependencies out of shared and frontend code", () => {
    for (const pattern of ["src/shared/**/*.{ts,tsx}", "src/frontend/**/*.{ts,tsx}"]) {
      for (const { file, source } of files(pattern)) {
        expect(source, file).not.toContain("@/backend/database/");
        expect(source, file).not.toContain("@prisma/client");
      }
    }
  });

  it("allows database clients only in database and integration adapters", () => {
    for (const { file, source } of files("src/backend/**/*.{ts,tsx}")) {
      if (!source.includes("@/backend/database/") && !source.includes("@prisma/client")) continue;
      expect(file.replaceAll("\\", "/"), file).toMatch(/^src\/backend\/(?:database|integrations)\//);
    }
  });

  it("keeps every transactional web-session cookie effect inside the post-commit scope", () => {
    const transactionalCalls: Array<{ file: string; postCommitScoped: boolean }> = [];

    for (const { file, source } of files("src/**/*.{ts,tsx}")) {
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        if (
          ts.isCallExpression(node)
          && ts.isIdentifier(node.expression)
          && node.expression.text === "createWebSessionForRemnashopUser"
        ) {
          const [argument] = node.arguments;
          const hasTransaction = argument
            && ts.isObjectLiteralExpression(argument)
            && argument.properties.some((property) =>
              (ts.isShorthandPropertyAssignment(property)
                && property.name.text === "tx")
              || (ts.isPropertyAssignment(property)
                && ((ts.isIdentifier(property.name) && property.name.text === "tx")
                  || (ts.isStringLiteralLike(property.name) && property.name.text === "tx")))
            );
          if (hasTransaction) {
            let ancestor: ts.Node | undefined = node.parent;
            let postCommitScoped = false;
            while (ancestor) {
              if (
                ts.isCallExpression(ancestor)
                && ts.isIdentifier(ancestor.expression)
                && ancestor.expression.text === "runWithPostCommitWebSessionCookieEffects"
              ) {
                postCommitScoped = true;
                break;
              }
              ancestor = ancestor.parent;
            }
            transactionalCalls.push({
              file: file.replaceAll("\\", "/"),
              postCommitScoped,
            });
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(transactionalCalls).toEqual([{
      file: "src/backend/integrations/remnashop/session.ts",
      postCommitScoped: true,
    }]);
  });
});
