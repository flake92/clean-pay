import {
  captureCharacterization,
  type CharacterizationRoute,
} from "./page-characterization";
import { expect, test } from "./fixtures";

const protectedRoutes: CharacterizationRoute[] = [
  {
    id: "protected-cabinet",
    requestPath: "/cabinet?view=subscriptions#active",
    kind: "protected-redirect",
  },
  {
    id: "protected-profile",
    requestPath: "/profile?panel=security#passkeys",
    kind: "protected-redirect",
  },
  {
    id: "protected-referral",
    requestPath: "/referral?source=characterization#program",
    kind: "protected-redirect",
  },
  {
    id: "protected-extend",
    requestPath: "/extend?subscription_id=00000000-0000-4000-8000-000000000001#offer",
    kind: "protected-redirect",
  },
  {
    id: "protected-link-account",
    requestPath: "/link-account?provider=telegram#confirm",
    kind: "protected-redirect",
  },
  {
    id: "protected-verify-email",
    requestPath: "/verify-email?redirect_to=%2Fcabinet#status",
    kind: "protected-redirect",
  },
  {
    id: "protected-passkey-setup",
    requestPath: "/passkey/setup?redirect_to=%2Fcabinet#setup",
    kind: "protected-redirect",
  },
  {
    id: "protected-payment",
    requestPath: "/payment?payment_id=00000000-0000-4000-8000-000000000002#status",
    kind: "protected-redirect",
  },
];

test.describe("anonymous protected-route characterization", () => {
  for (const route of protectedRoutes) {
    test(`${route.id} preserves the login redirect`, async ({ guardedPageQuorum }, testInfo) => {
      const requested = new URL(route.requestPath, "https://characterization.invalid");
      const expectedRedirectTarget = `${requested.pathname}${requested.search}`;
      await captureCharacterization({
        pages: guardedPageQuorum,
        route,
        testInfo,
        validateNavigation(finalUrl) {
          expect(finalUrl.pathname).toBe("/login");
          expect(finalUrl.searchParams.get("redirect_to")).toBe(expectedRedirectTarget);
        },
      });
    });
  }
});
