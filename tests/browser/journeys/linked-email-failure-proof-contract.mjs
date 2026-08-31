const sha256Pattern = /^[a-f0-9]{64}$/;
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const revisionPattern = /^[a-f0-9]{40}$/;

export const AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF =
  "linked-email-auth-failed-and-rate-limited-feedback-v1";

export const LINKED_EMAIL_FAILURE_PROOF_FILENAME =
  "linked-email-failure-feedback.json";

const authFailedMessage = "Неверный e-mail или пароль.";
const rateLimitedMessage = "Слишком много попыток. Попробуйте позже.";
const providerEffectOrder = Object.freeze(Array.from(
  { length: 10 },
  () => ["linked_email_login_auth_failed", "linked_email_register_conflict"],
).flat());

export function assertLinkedEmailFailureProof(value, expected = {}) {
  exactKeys(expected, [
    "candidateApplicationImageDigest",
    "candidateMigrationImageDigest",
    "candidateRevision",
  ]);
  if (!isRecord(value)) fail();
  exactKeys(value, [
    "authFailedProviderRequestCount",
    "authorizedSemanticDiff",
    "candidateApplicationImageDigest",
    "candidateMigrationImageDigest",
    "candidateRevision",
    "databaseUnchanged",
    "emailInitiallyAbsent",
    "finalRoute",
    "formStatePreserved",
    "genericFallbackCount",
    "kind",
    "networkFallbackCount",
    "providerEffectOrder",
    "rateLimitedAttemptNumber",
    "rateLimitedMessage",
    "rateLimitedProviderRequestCount",
    "schemaVersion",
    "serverActionCount",
    "serverActionMethodsAllPost",
    "serverActionPayloadContractSha256",
    "serverActionPayloadStable",
    "serverActionResponsesAllSuccessful",
    "status",
    "submitButtonEnabled",
    "telegramLinkedFixture",
    "visibleErrorCount",
    "wrongPasswordAttemptCount",
    "wrongPasswordMessage",
  ]);
  if (value.schemaVersion !== 1
    || value.kind !== "clean-pay-authorized-linked-email-failure-feedback-proof"
    || value.status !== "linked-email-auth-failure-feedback-specific"
    || value.authorizedSemanticDiff
      !== AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF
    || value.wrongPasswordMessage !== authFailedMessage
    || value.rateLimitedMessage !== rateLimitedMessage
    || value.finalRoute !== "/link-account?reason=email-required"
    || value.telegramLinkedFixture !== true
    || value.emailInitiallyAbsent !== true
    || value.wrongPasswordAttemptCount !== 10
    || value.rateLimitedAttemptNumber !== 11
    || value.serverActionCount !== 11
    || value.serverActionMethodsAllPost !== true
    || value.serverActionResponsesAllSuccessful !== true
    || value.serverActionPayloadStable !== true
    || typeof value.serverActionPayloadContractSha256 !== "string"
    || !sha256Pattern.test(value.serverActionPayloadContractSha256)
    || value.authFailedProviderRequestCount !== 20
    || value.rateLimitedProviderRequestCount !== 0
    || JSON.stringify(value.providerEffectOrder) !== JSON.stringify(providerEffectOrder)
    || value.databaseUnchanged !== true
    || value.formStatePreserved !== true
    || value.submitButtonEnabled !== true
    || value.visibleErrorCount !== 1
    || value.genericFallbackCount !== 0
    || value.networkFallbackCount !== 0
    || !revisionPattern.test(value.candidateRevision)
    || !imageDigestPattern.test(value.candidateApplicationImageDigest)
    || !imageDigestPattern.test(value.candidateMigrationImageDigest)
    || value.candidateRevision !== expected.candidateRevision
    || value.candidateApplicationImageDigest
      !== expected.candidateApplicationImageDigest
    || value.candidateMigrationImageDigest
      !== expected.candidateMigrationImageDigest) {
    fail();
  }
  return Object.freeze({
    ...value,
    providerEffectOrder: Object.freeze([...value.providerEffectOrder]),
  });
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
  throw new Error("Linked e-mail failure proof differs from its exact authorized contract.");
}
