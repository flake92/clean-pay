const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;

export const AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF =
  "existing-unverified-email-login-verification-gate-v1";

export const UNVERIFIED_EMAIL_PROOF_FILENAME =
  "unverified-email-login.json";

export function assertUnverifiedEmailLoginProof(value, expected = {}) {
  exactKeys(expected, [
    "candidateApplicationImageDigest",
    "candidateMigrationImageDigest",
    "candidateRevision",
  ]);
  if (!isRecord(value)) fail();
  exactKeys(value, [
    "authorizedSemanticDiff",
    "cabinetNavigationCount",
    "cabinetReadCount",
    "candidateApplicationImageDigest",
    "candidateMigrationImageDigest",
    "candidateRevision",
    "finalRoute",
    "kind",
    "providerRequestCount",
    "schemaVersion",
    "serverActionCount",
    "status",
    "telegramLinkedFixture",
  ]);
  if (value.schemaVersion !== 1
    || value.kind !== "clean-pay-authorized-unverified-email-login-proof"
    || value.status !== "existing-unverified-email-login-gated"
    || value.authorizedSemanticDiff !== AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF
    || value.finalRoute
      !== "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30"
    || value.telegramLinkedFixture !== true
    || value.cabinetNavigationCount !== 0
    || value.cabinetReadCount !== 0
    || value.serverActionCount !== 2
    || !Number.isSafeInteger(value.providerRequestCount)
    || value.providerRequestCount < 4
    || value.providerRequestCount > 32
    || !revisionPattern.test(value.candidateRevision)
    || !sha256Pattern.test(value.candidateApplicationImageDigest)
    || !sha256Pattern.test(value.candidateMigrationImageDigest)
    || value.candidateRevision !== expected.candidateRevision
    || value.candidateApplicationImageDigest
      !== expected.candidateApplicationImageDigest
    || value.candidateMigrationImageDigest
      !== expected.candidateMigrationImageDigest) {
    fail();
  }
  return Object.freeze({ ...value });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, keys) {
  if (!isRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail();
  }
}

function fail() {
  throw new Error("Unverified e-mail login proof differs from its exact authorized contract.");
}
