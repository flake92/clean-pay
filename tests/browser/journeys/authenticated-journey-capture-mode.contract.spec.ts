import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  AUTHENTICATED_JOURNEY_LIVE_PAIR_CAPTURE_ENV,
  authenticatedJourneyLivePairCaptureEnabled,
  authenticatedJourneyLivePairCaptureEnvironment,
} from "./authenticated-journey-capture-mode";

test("leaves the immutable baseline path unchanged unless live-pair capture is explicit", () => {
  expect(authenticatedJourneyLivePairCaptureEnabled({})).toBe(false);
  expect(authenticatedJourneyLivePairCaptureEnabled(
    authenticatedJourneyLivePairCaptureEnvironment(),
  )).toBe(true);
});

test("fails closed for every near-miss live-pair capture value", () => {
  for (const value of [
    "",
    "1",
    "true",
    " authenticated-chatwoot-stabilization-v1",
    "authenticated-chatwoot-stabilization-v1 ",
    "authenticated-chatwoot-stabilization-v2",
  ]) {
    expect(() => authenticatedJourneyLivePairCaptureEnabled({
      [AUTHENTICATED_JOURNEY_LIVE_PAIR_CAPTURE_ENV]: value,
    })).toThrow(/invalid exact contract value/);
  }
});

test("captures the authenticated Chatwoot boundary at the first owned cabinet", async () => {
  const source = await readFile(
    path.resolve(__dirname, "application.journey.spec.ts"),
    "utf8",
  );
  const scenarioStart = source.indexOf(
    'test("telegram-oidc-cabinet-profile-link-referral-passkey"',
  );
  const login = source.indexOf("await loginWithTelegramOidc(page, true)", scenarioStart);
  const capture = source.indexOf(
    "const firstAuthenticatedChatwoot = captureAuthenticatedChatwoot",
    login,
  );
  const firstCheckpoint = source.indexOf(
    'await journey.checkpoint("telegram-oidc-cabinet")',
    capture,
  );
  const finalPage = source.indexOf(
    'await gotoHeading(page, "/link-account", "Способы входа")',
    firstCheckpoint,
  );
  const reuse = source.indexOf(
    "const authenticatedChatwoot = firstAuthenticatedChatwoot\n"
      + "    ?? await waitForChatwootBoundary(page);",
    finalPage,
  );

  expect(scenarioStart).toBeGreaterThan(-1);
  expect(login).toBeGreaterThan(scenarioStart);
  expect(capture).toBeGreaterThan(login);
  const captureBlock = source.slice(capture, firstCheckpoint);
  expect(captureBlock).toContain(
    '? await test.step("chatwoot telegram OIDC A-to-B exact characterization", async () => {',
  );
  expect(captureBlock).toContain("await waitForAuthenticatedChatwootFixture(page);");
  expect(captureBlock).toContain("return waitForChatwootBoundary(page);");
  expect(captureBlock).toContain("    : null;");
  expect(source).toContain('&& (call.value === "hide" || call.value === "show")');
  expect(firstCheckpoint).toBeGreaterThan(capture);
  expect(finalPage).toBeGreaterThan(firstCheckpoint);
  expect(reuse).toBeGreaterThan(finalPage);
});
