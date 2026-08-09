import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function files(pattern: string) {
  return globSync(pattern).map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

function importedModules(source: string) {
  return [...source.matchAll(/\b(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g)]
    .map((match) => match[1]!);
}

describe("clean architecture boundaries", () => {
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
      expect(source, file).not.toMatch(/@\/(?:app|application|backend|frontend)\//);
      expect(source, file).not.toMatch(/@\/shared\/(?:remnashop|pwa)\//);
      expect(source, file).not.toMatch(/from ["']next(?:\/|["'])/);
      expect(source, file).not.toMatch(/@prisma\/client/);
    }
  });

  it("keeps all shared policies independent from application and adapters", () => {
    for (const { file, source } of files("src/shared/**/*.{ts,tsx}")) {
      for (const dependency of importedModules(source)) {
        expect(
          dependency.startsWith("@/shared/") || dependency.startsWith("."),
          `${file} imports non-shared module ${dependency}`,
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
      expect(source, file).not.toMatch(/@\/backend\//);
    }
  });

  it("prevents infrastructure from depending on framework composition or React", () => {
    for (const { file, source } of files("src/backend/**/*.{ts,tsx}")) {
      expect(source, file).not.toMatch(/@\/(?:app|frontend)\//);
    }
  });

  it("does not expose the removed internal browser transport", () => {
    expect(globSync("src/app/api/bff/**/route.ts")).toEqual([]);
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("removedBrowserTransportPaths");
    expect(proxy).toContain("'/api/bff/payments/status'");
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

    expect(controller).toContain("completeTelegramCallback(");
    expect(controller).not.toContain("remnashopMergeUsers(");
    expect(controller).not.toContain("remnashopLinkTelegram(");
    expect(controller).not.toContain("withPaymentOwnerChangeFence(");
    expect(controller).not.toContain("reconcileUserFromRemnashopAuth(");
    expect(controller).toContain("recoverTelegramSession(");
    expect(controller).not.toContain("recoverRemnashopTelegramSession(");
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
