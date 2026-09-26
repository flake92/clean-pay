import { expect, test } from "./fixtures";
import { capturePublicOverlapCharacterization } from "./public-overlap-capture";
import { PUBLIC_OVERLAP_ROUTES } from "./public-overlap-evidence";

test.describe("ephemeral public characterization overlap capture", () => {
  for (const route of PUBLIC_OVERLAP_ROUTES) {
    test(`${route.id} captures the exact read-only route`, async ({ guardedPageQuorum }, testInfo) => {
      const requested = new URL(route.requestPath, "https://characterization.invalid");
      await capturePublicOverlapCharacterization({
        pages: guardedPageQuorum,
        route,
        testInfo,
        validateNavigation(finalUrl) {
          if (route.kind === "public") {
            expect(finalUrl.pathname).toBe(requested.pathname);
            expect(finalUrl.search).toBe(requested.search);
            expect(finalUrl.hash).toBe(requested.hash);
            return;
          }
          expect(finalUrl.pathname).toBe("/login");
          expect(finalUrl.searchParams.get("redirect_to")).toBe(
            `${requested.pathname}${requested.search}`,
          );
        },
      });
    });
  }
});
