import {
  captureCharacterization,
  type CharacterizationRoute,
} from "./page-characterization";
import { expect, test } from "./fixtures";

const publicRoutes: CharacterizationRoute[] = [
  {
    id: "login",
    requestPath: "/login?redirect_to=%2Ftariffs%3Fsource%3Dcharacterization#auth-entry",
    kind: "public",
  },
  {
    id: "register",
    requestPath: "/register?redirect_to=%2Ftariffs%3Fsource%3Dcharacterization#registration-entry",
    kind: "public",
  },
  {
    id: "tariffs",
    requestPath: "/tariffs?source=characterization#plans",
    kind: "public",
  },
  {
    id: "support",
    requestPath: "/support?source=characterization#support",
    kind: "public",
  },
  {
    id: "install",
    requestPath: "/install?source=characterization#install",
    kind: "public",
  },
  {
    id: "offline",
    requestPath: "/offline?source=characterization#offline",
    kind: "public",
  },
];

test.describe("public route characterization", () => {
  for (const route of publicRoutes) {
    test(`${route.id} preserves its public route`, async ({ guardedPage }, testInfo) => {
      const requested = new URL(route.requestPath, "https://characterization.invalid");
      await captureCharacterization({
        page: guardedPage,
        route,
        testInfo,
        validateNavigation(finalUrl) {
          expect(finalUrl.pathname).toBe(requested.pathname);
          expect(finalUrl.search).toBe(requested.search);
          expect(finalUrl.hash).toBe(requested.hash);
        },
      });
    });
  }
});
