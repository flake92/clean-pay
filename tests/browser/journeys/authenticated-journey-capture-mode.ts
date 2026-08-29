export const AUTHENTICATED_JOURNEY_LIVE_PAIR_CAPTURE_ENV =
  "CLEAN_PAY_BROWSER_EPHEMERAL_LIVE_PAIR_CAPTURE";

const ENABLED_VALUE = "authenticated-chatwoot-stabilization-v1";

/**
 * Keeps the immutable Windows-baseline invocation unchanged. The stronger
 * authenticated fixture convergence wait is opt-in only for an explicitly
 * owned, ephemeral live-pair capture; misspellings fail closed instead of
 * silently selecting a different evidence contract.
 */
export function authenticatedJourneyLivePairCaptureEnabled(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const value = environment[AUTHENTICATED_JOURNEY_LIVE_PAIR_CAPTURE_ENV];
  if (value === undefined) return false;
  if (value !== ENABLED_VALUE) {
    throw new Error(
      `${AUTHENTICATED_JOURNEY_LIVE_PAIR_CAPTURE_ENV} has an invalid exact contract value.`,
    );
  }
  return true;
}

export function authenticatedJourneyLivePairCaptureEnvironment() {
  return Object.freeze({
    [AUTHENTICATED_JOURNEY_LIVE_PAIR_CAPTURE_ENV]: ENABLED_VALUE,
  });
}
