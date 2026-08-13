import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function files(pattern: string) {
  return globSync(pattern).map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function importedModules(source: string) {
  return [...source.matchAll(/\b(?:from|import|require)\s*(?:\(\s*)?["']([^"']+)["']/g)]
    .map((match) => match[1]!);
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

function modulePath(file: string) {
  return file.replaceAll("\\", "/").replace(/\.(?:ts|tsx)$/, "");
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
  it("resolves alias and relative imports before applying layer rules", () => {
    expect(projectPath("src/shared/domain/value.ts", "../../backend/database/prisma"))
      .toBe("src/backend/database/prisma");
    expect(projectPath("src/frontend/components/view.tsx", "@/backend/config/env"))
      .toBe("src/backend/config/env");
    expect(projectPath("src/application/payments/use-case.ts", "node:crypto")).toBeNull();
    expect(importedModules('const adapter = require("@/backend/database/prisma")'))
      .toEqual(["@/backend/database/prisma"]);
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
    const useCase = readFileSync("src/application/auth/execute-auth-command.ts", "utf8");
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
    expect(useCase).toContain("resolveVerifiedIdentity(");
    expect(useCase).toContain("stageAccountMerge(");
    expect(useCase).toContain("preflightAccountMerge(");
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

    for (const operation of [
      "authenticateProvider",
      "verifiedIdentity",
      "rateLimit",
      "reconcileIdentity",
      "createSession",
      "recoverSession",
    ]) {
      expect(useCase, operation).toContain(`gateway.${operation}`);
    }
    expect(useCase).toContain("if (reconciled.requiresRecovery)");
    expect(gateway).not.toContain("if (reconciled.requiresRecovery)");
    expect(action).toContain("authenticateTelegramWebApp(productionTelegramWebAppGateway");
    expect(globSync("src/backend/integrations/auth/telegram-webapp.ts")).toEqual([]);
  });

  it("keeps Telegram WebApp workflow policy in the application layer", () => {
    const useCase = readFileSync("src/application/auth/authenticate-telegram-webapp.ts", "utf8");
    const gateway = readFileSync("src/backend/integrations/auth/telegram-webapp-gateway.ts", "utf8");
    const action = readFileSync("src/app/actions/telegram.ts", "utf8");

    expect(useCase).toContain("authenticateProvider(normalizedInitData)");
    expect(useCase).toContain("verifiedIdentity(providerSession)");
    expect(useCase).toContain("rateLimit(verifiedIdentity.telegramId)");
    expect(useCase).toContain("reconcileIdentity(providerSession, verifiedIdentity)");
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
});
