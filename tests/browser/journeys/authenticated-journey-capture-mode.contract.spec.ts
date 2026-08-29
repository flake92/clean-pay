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
