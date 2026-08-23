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
    expect(shell).toContain("loadNavigationShell");
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
      "src/app/payment/payment-status-page.tsx",
    ]) {
      expect(source(file), file).toContain("<AppShell requireAuth");
      expect(source(file), file).not.toMatch(/redirect\(["']\/login/);
    }
  });

  it("coalesces provider authorization only within the current request", () => {
    const composition = source("src/app/_composition/request-scoped-readers.ts");
    const backendFiles = [
      "src/backend/integrations/auth/auth-profile-gateway.ts",
      "src/backend/integrations/remnashop/subscription-reader.ts",
      "src/backend/integrations/payments/payment-history-reader.ts",
    ];

    expect(composition).toContain('import { cache } from "react"');
    expect(composition).toContain("authorizeVerifiedSession");
    expect(composition).toContain("getCurrentSessionReadOnly");
    expect(composition).toContain("readSession: getCurrentSessionReadOnly");
    expect(composition).toContain("refreshAccessCookie: skipAccessCookieRefresh");
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
});
