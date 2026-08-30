import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(path, "utf8");
}

describe("cabinet performance regressions", () => {
  it("streams expensive cabinet data behind an immediate shell", () => {
    const page = source("src/app/cabinet/page.tsx");
    const shell = source("src/app/_components/app-shell.tsx");

    expect(page).toContain("<Suspense");
    expect(page).toContain("loadRequestCabinetViewModel");
    expect(page).not.toContain("export default async function CabinetPage");
    expect(page).toContain("<CabinetAccessBoundary>");
    expect(page.indexOf("<CabinetAccessBoundary>")).toBeLessThan(
      page.indexOf("<AppShell requireAuth>"),
    );
    expect(page).toContain("await connection()");
    expect(page.indexOf("await connection()"))
      .toBeLessThan(page.indexOf('await requireCabinetEntrySession("/cabinet")'));
    expect(page).toContain('await requireCabinetEntrySession("/cabinet")');
    expect(shell).toContain("loadNavigationShell");
    expect(shell).toContain("await connection()");
    expect(shell).not.toContain("loadNavigation(");
  });

  it("never refreshes provider authorization in a background navigation action", () => {
    const layout = source("src/frontend/layout/layout.tsx");

    expect(layout).not.toContain("loadNavigationAction");
    expect(layout).not.toContain("setNavigation");
    expect(() => source("src/app/actions/navigation.ts")).toThrow();
  });

  it("redirects protected shells and unauthorized page models through the refresh handler", () => {
    const shell = source("src/app/_components/app-shell.tsx");
    expect(shell).toContain("redirect(sessionRefreshPath(returnTo))");
    expect(source("src/app/referral/page.tsx")).toContain('returnTo="/referral"');
    expect(source("src/app/payment/payment-status-page.tsx"))
      .toContain("<AppShell requireAuth returnTo={returnTo}>");

    for (const file of [
      "src/app/cabinet/page.tsx",
      "src/app/profile/page.tsx",
      "src/app/link-account/page.tsx",
      "src/app/verify-email/page.tsx",
      "src/app/extend/page.tsx",
      "src/app/payment/page.tsx",
      "src/app/referral/page.tsx",
      "src/app/payment/payment-status-page.tsx",
    ]) {
      expect(source(file), file).toContain("<AppShell requireAuth");
      expect(source(file), file).not.toMatch(/redirect\(["']\/login/);
    }
  });

  it("preserves every protected page destination at its database-backed shell boundary", () => {
    expect(source("src/app/cabinet/page.tsx"))
      .toContain("<AppShell requireAuth>");
    expect(source("src/app/profile/page.tsx"))
      .toContain('<AppShell requireAuth returnTo="/profile">');
    expect(source("src/app/referral/page.tsx"))
      .toContain('<AppShell requireAuth returnTo="/referral">');
    expect(source("src/app/payment/payment-status-page.tsx"))
      .toContain("<AppShell requireAuth returnTo={returnTo}>");

    for (const [file, returnTo] of [
      ["src/app/link-account/page.tsx", "linkAccountReturnTo"],
      ["src/app/verify-email/page.tsx", "verifyEmailReturnTo"],
      ["src/app/extend/page.tsx", "extendReturnTo"],
      ["src/app/payment/page.tsx", "paymentRedirectTo"],
    ]) {
      const page = source(file);
      expect(page, file).toContain(
        `<AppShell requireAuth returnTo={${returnTo}}>`,
      );
      expect(page, file).toContain(`sessionRefreshPath(${returnTo})`);
      expect(page, file).toContain(
        `providerSessionRecoveryPath(${returnTo})`,
      );
    }

    // These two setup pages intentionally use AuthShell, but a cryptographically
    // valid access cookie is not enough: the database-backed session must still
    // be checked before either protected form is rendered.
    for (const file of [
      "src/app/register/verify-email/page.tsx",
      "src/app/passkey/setup/page.tsx",
    ]) {
      const page = source(file);
      expect(page, file).toContain("await requireRequestSession(");
      expect(page, file).not.toMatch(/redirect\(["']\/login/);
    }

    const setupBoundary = source(
      "src/app/_composition/require-request-session.ts",
    );
    expect(setupBoundary).toContain(
      "requestAuthProfileGateway.loadCurrentSession()",
    );
    expect(setupBoundary).toContain(
      "redirect(sessionRefreshPath(returnTo))",
    );
  });

  it("routes recoverable provider sessions through a cookie-capable recovery handler", () => {
    const navigation = source("src/shared/auth/session-navigation.ts");
    expect(navigation).toContain("providerSessionRecoveryPath");
    expect(navigation).toMatch(/[`"']\/auth\/session\/recover/);
    expect(navigation).toContain("safeRedirectPath(returnTo)");

    for (const file of [
      "src/app/cabinet/page.tsx",
      "src/app/profile/page.tsx",
      "src/app/link-account/page.tsx",
      "src/app/verify-email/page.tsx",
      "src/app/extend/page.tsx",
      "src/app/payment/page.tsx",
      "src/app/referral/page.tsx",
    ]) {
      expect(source(file), file).toContain("providerSessionRecoveryPath(");
      expect(source(file), file).not.toMatch(/redirect\(["']\/login/);
    }

    for (const file of [
      "src/application/models/referral.ts",
      "src/application/models/tariffs.ts",
      "src/application/referral/load-referral-program.ts",
      "src/application/subscriptions/load-tariffs.ts",
    ]) {
      expect(source(file), file).toContain('"recover-session"');
    }
    expect(source("src/frontend/components/account-action-required.tsx"))
      .toContain("providerSessionRecoveryPath(");
    expect(source("src/frontend/components/account-action-required.tsx"))
      .toContain("sessionRefreshPath(destination)");
    expect(source("src/frontend/components/cabinet-panel.tsx"))
      .not.toContain("/login?redirect_to=%2Fcabinet");
    expect(source("src/frontend/components/profile-panel.tsx"))
      .not.toContain('href="/login"');
  });

  it("coalesces provider authorization only within the current request", () => {
    const composition = source("src/app/_composition/request-scoped-readers.ts");
    const backendFiles = [
      "src/backend/integrations/auth/auth-profile-gateway.ts",
      "src/backend/integrations/remnashop/subscription-reader.ts",
      "src/backend/integrations/payments/payment-history-reader.ts",
    ];

    expect(composition).toContain('import { cache } from "react"');
    expect(composition).toContain(
      "loadRequestCurrentSession = cache(() => getCurrentSessionReadOnly())",
    );
    expect(composition).toContain("authorizeVerifiedSession");
    expect(composition).toContain("getCurrentSessionReadOnly");
    expect(composition).toContain("getStoredAuthorizedRemnashopTokens");
    expect(composition).not.toContain("getAuthorizedRemnashopTokens");
    expect(composition).toContain("createProductionLinkAccountReader(");
    expect(composition).toContain("createProductionPasskeyManagementGateway(");
    expect(composition).toContain("createProductionCheckoutReader(requestSubscriptions)");
    expect(composition).toContain("createProductionPaymentStatusReader(");
    expect(composition).toContain("createRemnashopSubscriptionCatalog(authorizeVerifiedSession)");
    expect(composition).toContain(
      "loadRequestSubscriptionOffers = cache(() => subscriptionCatalog.loadOffers())",
    );
    expect(composition).toContain("loadOffers: loadRequestSubscriptionOffers");
    const proxy = source("src/proxy.ts");
    expect(proxy).toContain("redirect_session_refresh");
    expect(composition).toContain("createRemnashopSubscriptionReader(authorizeVerifiedSession)");
    expect(composition).toContain("createProductionPaymentHistoryGateway(");
    for (const file of backendFiles) {
      expect(source(file), file).not.toContain('from "react"');
    }
  });

  it("keeps render-time readers behind the read-only session composition", () => {
    const renderedReaders = [
      "src/app/cabinet/page.tsx",
      "src/app/profile/page.tsx",
      "src/app/link-account/page.tsx",
      "src/app/verify-email/page.tsx",
      "src/app/extend/page.tsx",
      "src/app/payment/page.tsx",
      "src/app/payment/payment-status-page.tsx",
      "src/app/support/page.tsx",
      "src/app/tariffs/page.tsx",
      "src/app/_components/app-shell.tsx",
    ];

    for (const file of renderedReaders) {
      const contents = source(file);
      expect(contents, file).not.toContain("productionAuthProfileGateway");
      expect(contents, file).not.toContain("productionCheckoutReader");
      expect(contents, file).not.toContain("productionLinkAccountReader");
      expect(contents, file).not.toContain("productionPasskeyManagementGateway");
      expect(contents, file).not.toContain("productionPaymentStatusReader");
      expect(contents, file).not.toMatch(/\bgetCurrentSession\s*\(/);
      expect(contents, file).not.toMatch(/\brefreshCurrentAccessCookie\s*\(/);
    }

    const actions = source("src/app/actions/email-verification.ts");
    expect(actions).toContain("productionAuthProfileGateway");
  });

  it("does not prefetch dynamic cabinet routes from duplicated navigation links", () => {
    for (const file of [
      "src/frontend/layout/AppMenuitem.tsx",
      "src/frontend/layout/AppTopbar.tsx",
      "src/frontend/components/prime/link-button.tsx",
      "src/frontend/components/install-app-button.tsx",
    ]) {
      expect(source(file), file).toContain("prefetch={false}");
    }
  });

  it("renders payment history only from the local snapshot", () => {
    const history = source("src/application/payments/load-payment-history.ts");

    expect(history).toContain("gateway.loadRecent(userId, 20)");
    expect(history).not.toContain("gateway.authorize(");
    expect(history).not.toContain("loadCapabilities(");
    expect(history).not.toContain("loadExactTransaction(");
    expect(history).not.toContain("processPaymentHistoryPage(");
  });

  it("gives render-time Remnashop authorization no mutation capability", () => {
    const authorizer = source(
      "src/backend/integrations/remnashop/stored-session-authorization.ts",
    );
    const commandGateway = source(
      "src/backend/integrations/auth/auth-profile-gateway.ts",
    );

    expect(authorizer).toContain("getCurrentSessionReadOnly");
    expect(authorizer).toContain("revealRemnashopToken");
    expect(authorizer).not.toContain("readSession?:");
    expect(authorizer).not.toContain("getAuthorizedRemnashopTokens");
    expect(authorizer).not.toContain("acquireRemnashopTokensForSession");
    expect(authorizer).not.toContain("attachRemnashopTokens");
    expect(authorizer).not.toContain("remnashopRefreshTokens");
    expect(authorizer).not.toContain("remnashopCreateServiceSession");
    expect(authorizer).not.toContain("refreshCurrentAccessCookie");
    expect(authorizer).not.toContain("protectRemnashopToken");
    expect(authorizer).not.toContain("@/backend/database/prisma");
    expect(authorizer).not.toMatch(
      /\.(create|update|updateMany|delete|deleteMany)\(/,
    );
    expect(commandGateway).toContain("getAuthorizedRemnashopTokens");
  });

  it("keeps payment reconciliation out of Server Component rendering", () => {
    const page = source("src/app/payment/payment-status-page.tsx");
    const action = source("src/app/actions/payment-status.ts");

    expect(page).toContain("loadPaymentStatusSnapshot(");
    expect(page).not.toContain("productionPaymentMaintenanceRunner");
    expect(page).not.toContain("loadPaymentStatus(requestPaymentStatusReader");
    expect(action).toContain('"use server"');
    expect(action).toContain("productionPaymentMaintenanceRunner");
    expect(action).toContain("loadPaymentStatus(");
  });
});
