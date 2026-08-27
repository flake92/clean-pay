import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const JOURNEY_FIXTURE_CONTRACT_DOMAIN = "clean-pay-browser-journey-fixture-v5";

export const JOURNEY_FIXTURE_FILENAMES = Object.freeze([
  "../a11y-semantic-projection.ts",
  "../baseline-policy.ts",
  "../characterization-replay-policy.ts",
  "../comparison-projection.ts",
  "../console-policy.ts",
  "../fixtures.ts",
  "../journey-comparison-projection.ts",
  "../network-recorder.ts",
  "../page-characterization.ts",
  "../playwright-output-scope.ts",
  "../process-quorum.ts",
  "../redaction.ts",
  "../render-policy.mjs",
  "../render-policy.ts",
  "../screenshot-majority.ts",
  "../../../deploy/prod/role-env.mjs",
  "../../../playwright.config.ts",
  "../../../runtime/production-env-rules.mjs",
  "Caddyfile",
  "PROVIDER_OVERLAP_PROOF.md",
  "application.journey.spec.ts",
  "caddy-route-policy.ts",
  "docker-compose.journey.yml",
  "docker-compose.public-characterization.yml",
  "docker-tcp-bridge.mjs",
  "db-observer.mjs",
  "db-observer-provision.sh",
  "db-observer.contract.spec.ts",
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
  "journey-browser-policy.mjs",
  "journey-browser-policy.ts",
  "journey-connect-proxy-controller.mjs",
  "journey-connect-proxy.mjs",
  "journey-compose-runtime-attestation.contract.spec.ts",
  "journey-compose-runtime-attestation.mjs",
  "journey-network-policy.d.mts",
  "journey-network-policy.mjs",
  "journey-skip-link-policy.contract.spec.ts",
  "journey-skip-link-policy.ts",
  "journey-staging.contract.spec.ts",
  "oidc-mock.contract.spec.ts",
  "oidc-mock.mjs",
  "playwright.config.ts",
  "prepare-synthetic-env.mjs",
  "prove-provider-overlap.mjs",
  "provider-mock.contract.spec.ts",
  "provider-mock.mjs",
  "provider-overlap-browser-contract.mjs",
  "provider-overlap-proof-contract.mjs",
  "provider-overlap-proof.contract.spec.ts",
  "provider-overlap-proof.schema.json",
  "run-production-image-journey.mjs",
  "sanitized-har.contract.spec.ts",
  "sanitized-har.ts",
  "synthetic-env.contract.spec.ts",
  "synthetic-logout-storage.contract.spec.ts",
  "synthetic-logout-storage.ts",
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
