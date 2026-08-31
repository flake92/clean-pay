import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const JOURNEY_FIXTURE_CONTRACT_DOMAIN = "clean-pay-browser-journey-fixture-v5";

export const JOURNEY_FIXTURE_FILENAMES = Object.freeze([
  "../a11y-semantic-projection.ts",
  "../baseline-policy.ts",
  "../baseline-provenance.ts",
  "../characterization-replay-policy.ts",
  "../comparison-projection.ts",
  "../console-policy.ts",
  "../csp-console-normalizer.ts",
  "../fixtures.ts",
  "../journey-comparison-projection.ts",
  "../network-recorder.ts",
  "../page-characterization.ts",
  "../playwright-output-scope.ts",
  "../process-quorum.ts",
  "../public-overlap-capture.live.ts",
  "../public-overlap-capture.ts",
  "../public-overlap-cleanup.live.ts",
  "../public-overlap-directory-policy.mjs",
  "../public-overlap-evidence.contract.spec.ts",
  "../public-overlap-evidence.ts",
  "../public-overlap-global-teardown.ts",
  "../public-overlap-mismatch-evidence.contract.spec.ts",
  "../public-overlap-mismatch-evidence.mjs",
  "../public-overlap-pair-capture.live.ts",
  "../public-overlap-prepare.live.ts",
  "../public-overlap-proof.live.ts",
  "../public-overlap-proof.ts",
  "../public-overlap-verify.live.ts",
  "../public-overlap.playwright.config.ts",
  "../redaction.ts",
  "../render-policy.mjs",
  "../render-policy.ts",
  "../screenshot-majority.ts",
  "../turnstile-stub.ts",
  "../../../config/playwright.config.ts",
  "../../../deploy/prod/role-env.mjs",
  "../../../package.json",
  "../../../runtime/production-env-rules.mjs",
  "../../../scripts/security/prove-served-cabinet-assets.mjs",
  "../../../tsconfig.json",
  "Caddyfile",
  "CHATWOOT_PHASE_PROOF.md",
  "PROVIDER_OVERLAP_PROOF.md",
  "authenticated-journey-capture-mode.contract.spec.ts",
  "authenticated-journey-capture-mode.ts",
  "application.journey.spec.ts",
  "caddy-route-policy.ts",
  "chatwoot-phase-browser-capture.ts",
  "chatwoot-phase-browser-contract.mjs",
  "chatwoot-phase-canonical-evidence.ts",
  "chatwoot-phase-causal-contract.mjs",
  "chatwoot-phase-event-ledger.mjs",
  "chatwoot-phase-evidence-sealer.mjs",
  "chatwoot-phase-evidence-writer.mjs",
  "chatwoot-phase-proof-contract.mjs",
  "chatwoot-phase-proof-orchestrator.mjs",
  "chatwoot-phase-proof.contract.spec.ts",
  "chatwoot-phase-proof.schema.json",
  "chatwoot-live-proof-plan.mjs",
  "docker-compose.journey.yml",
  "docker-compose.public-characterization.yml",
  "docker-tcp-bridge.mjs",
  "db-observer.mjs",
  "db-observer-provision.sh",
  "db-observer.contract.spec.ts",
  "existing-unverified-email.candidate.spec.ts",
  "finalize-journey-baseline.mjs",
  "journey-baseline-policy.ts",
  "journey-boundary-contract.contract.spec.ts",
  "journey-boundary-contract.ts",
  "journey-comparison-projection.contract.spec.ts",
  "journey-fixture-contract.ts",
  "journey-fixture-manifest.mjs",
  "journey-fixtures.ts",
  "journey-generated-environment-lifecycle.contract.spec.ts",
  "journey-generated-environment-lifecycle.mjs",
  "journey-global-setup.ts",
  "journey-global-teardown.ts",
  "journey-live-pair-evidence.contract.spec.ts",
  "journey-live-pair-evidence.ts",
  "journey-live-pair-proof.ts",
  "journey-browser-policy.mjs",
  "journey-browser-policy.ts",
  "journey-connect-proxy-controller.mjs",
  "journey-connect-proxy.mjs",
  "journey-compose-runtime-attestation.contract.spec.ts",
  "journey-compose-runtime-attestation.mjs",
  "journey-error-evidence.contract.spec.ts",
  "journey-error-evidence.mjs",
  "journey-network-policy.d.mts",
  "journey-network-policy.mjs",
  "journey-owned-stack-orchestrator.contract.spec.ts",
  "journey-owned-stack-orchestrator.mjs",
  "journey-skip-link-policy.contract.spec.ts",
  "journey-skip-link-policy.ts",
  "journey-staging.contract.spec.ts",
  "journey-synthetic-environment-contract.mjs",
  "oidc-mock.contract.spec.ts",
  "oidc-mock.mjs",
  "playwright.config.ts",
  "prepare-synthetic-env.mjs",
  "prove-chatwoot-phase-stability.mjs",
  "prove-authenticated-journey-live-pair.mjs",
  "prove-public-characterization-overlap.mjs",
  "prove-provider-overlap.mjs",
  "public-overlap-failure-publication.contract.spec.ts",
  "public-overlap-failure-publication.mjs",
  "public-overlap-process-evidence.contract.spec.ts",
  "public-overlap-process-evidence.mjs",
  "public-overlap-proof-contract.mjs",
  "public-overlap-proof.contract.spec.ts",
  "provider-mock.contract.spec.ts",
  "provider-mock.mjs",
  "provider-overlap-browser-contract.mjs",
  "provider-overlap-proof-contract.mjs",
  "provider-overlap-proof.contract.spec.ts",
  "provider-overlap-proof.schema.json",
  "run-production-image-journey.mjs",
  "run-production-image-live-overlap.mjs",
  "sanitized-har.contract.spec.ts",
  "sanitized-har.ts",
  "synthetic-env.contract.spec.ts",
  "synthetic-logout-storage.contract.spec.ts",
  "synthetic-logout-storage.ts",
  "unverified-email-login-proof-contract.mjs",
  "unverified-email-login.playwright.config.ts",
  "wsl-relay-target.sh",
]);

let asyncDigest;
let syncDigest;

export function currentJourneyFixtureContractSha256() {
  syncDigest ??= digestFixture((filename) => readFileSync(
    path.join(fixtureDirectory(), filename),
  ));
  return syncDigest;
}

export function currentJourneyFixtureContractSha256Async() {
  asyncDigest ??= digestFixtureAsync(async (filename) => readFile(
    path.join(fixtureDirectory(), filename),
  ));
  return asyncDigest;
}

function digestFixture(read) {
  const hash = createHash("sha256");
  hash.update(`${JOURNEY_FIXTURE_CONTRACT_DOMAIN}\0`, "utf8");
  for (const filename of JOURNEY_FIXTURE_FILENAMES) {
    const bytes = read(filename);
    hash.update(`${filename}\0${bytes.byteLength}\0`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

async function digestFixtureAsync(read) {
  const hash = createHash("sha256");
  hash.update(`${JOURNEY_FIXTURE_CONTRACT_DOMAIN}\0`, "utf8");
  for (const filename of JOURNEY_FIXTURE_FILENAMES) {
    const bytes = await read(filename);
    hash.update(`${filename}\0${bytes.byteLength}\0`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

function fixtureDirectory() {
  return path.resolve(process.cwd(), "tests", "browser", "journeys");
}
