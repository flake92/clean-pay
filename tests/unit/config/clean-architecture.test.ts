import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function files(pattern: string) {
  return globSync(pattern).map((file) => ({ file, source: readFileSync(file, "utf8") }));
}

describe("clean architecture boundaries", () => {
  it("keeps application use cases independent from frameworks and adapters", () => {
    for (const { file, source } of files("src/backend/application/**/*.{ts,tsx}")) {
      expect(source, file).not.toMatch(/from ["']next(?:\/|["'])/);
      expect(source, file).not.toMatch(/@\/backend\/(?:database|integrations|cache|config|errors)\//);
      expect(source, file).not.toMatch(/@prisma\/client/);
      expect(source, file).not.toContain("@/shared/remnashop/");
    }
  });

  it("keeps domain contracts independent from outer layers and providers", () => {
    for (const { file, source } of files("src/shared/domain/**/*.{ts,tsx}")) {
      expect(source, file).not.toMatch(/@\/(?:app|backend|frontend)\//);
      expect(source, file).not.toMatch(/@\/shared\/(?:presentation|remnashop|pwa)\//);
      expect(source, file).not.toMatch(/from ["']next(?:\/|["'])/);
      expect(source, file).not.toMatch(/@prisma\/client/);
    }
  });

  it("does not leak provider contracts into application or view models", () => {
    for (const pattern of [
      "src/backend/application/**/*.{ts,tsx}",
      "src/frontend/**/*.{ts,tsx}",
      "src/shared/presentation/**/*.{ts,tsx}",
      "src/shared/payments/**/*.{ts,tsx}",
    ]) {
      for (const { file, source } of files(pattern)) {
        expect(source, file).not.toContain("@/shared/remnashop/");
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

  it("does not expose the removed internal browser transport", () => {
    expect(globSync("src/app/api/bff/**/route.ts")).toEqual([]);
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).toContain("removedBrowserTransportPaths");
    expect(proxy).toContain("'/api/bff/payments/status'");
  });

  it("uses concrete adapters only from application composition roots", () => {
    const legacyInfrastructureFacades = [
      "@/backend/auth/email-verification",
      "@/backend/auth/passkeys",
      "@/backend/auth/remnashop-link",
      "@/backend/auth/telegram-account-merge",
      "@/backend/payments/history-sync",
      "@/backend/payments/idempotency",
      "@/backend/payments/reconciliation",
      "@/backend/payments/records",
      "@/backend/payments/user-merge",
      "@/backend/sessions/web-session",
    ];

    for (const { file, source } of files("src/app/**/*.{ts,tsx}")) {
      for (const facade of legacyInfrastructureFacades) {
        expect(source, file).not.toContain(`from "${facade}"`);
        expect(source, file).not.toContain(`from '${facade}'`);
      }
    }
  });

  it("keeps Telegram callback business orchestration out of the HTTP controller", () => {
    const controller = readFileSync("src/app/auth/telegram/callback/route.ts", "utf8");

    expect(controller).toContain("completeTelegramCallback(");
    expect(controller).not.toContain("remnashopMergeUsers(");
    expect(controller).not.toContain("remnashopLinkTelegram(");
    expect(controller).not.toContain("withPaymentOwnerChangeFence(");
    expect(controller).not.toContain("reconcileUserFromRemnashopAuth(");
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
      if (!source.includes("@/backend/database/")) continue;
      expect(file.replaceAll("\\", "/"), file).toMatch(/^src\/backend\/(?:database|integrations)\//);
    }
  });
});
