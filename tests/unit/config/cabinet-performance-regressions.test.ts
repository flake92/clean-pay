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

  it("redirects protected shells and unauthorized page models to login", () => {
    const shell = source("src/app/_components/app-shell.tsx");
    expect(shell).toContain('if (requireAuth && !shell.navigation.authenticated) redirect("/login")');

    for (const file of [
      "src/app/cabinet/page.tsx",
      "src/app/profile/page.tsx",
      "src/app/link-account/page.tsx",
      "src/app/verify-email/page.tsx",
      "src/app/extend/page.tsx",
      "src/app/payment/page.tsx",
      "src/app/payment/payment-status-page.tsx",
    ]) {
      expect(source(file), file).toContain("<AppShell requireAuth>");
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
    expect(composition).toContain("createRemnashopSubscriptionReader(authorizeVerifiedSession)");
    expect(composition).toContain("createProductionPaymentHistoryGateway(");
    for (const file of backendFiles) {
      expect(source(file), file).not.toContain('from "react"');
    }
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
});
