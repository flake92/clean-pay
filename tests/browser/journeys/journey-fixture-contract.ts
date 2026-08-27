import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const PINNED_JOURNEY_V5_FIXTURE_SHA256 = "7b62f993647d20582018297505f8557d201962a9bd768a5438dd3b8fa06cb5f9";

const filenames = [
  "../a11y-semantic-projection.ts",
  "../baseline-policy.ts",
  "../comparison-projection.ts",
  "../console-policy.ts",
  "../fixtures.ts",
  "../journey-comparison-projection.ts",
  "../network-recorder.ts",
  "../page-characterization.ts",
  "../redaction.ts",
  "../render-policy.ts",
  "../screenshot-majority.ts",
  "../../../deploy/prod/role-env.mjs",
  "../../../runtime/production-env-rules.mjs",
  "Caddyfile",
  "application.journey.spec.ts",
  "caddy-route-policy.ts",
  "docker-compose.journey.yml",
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
  "journey-fixtures.ts",
  "journey-global-setup.ts",
  "journey-browser-policy.ts",
  "journey-connect-proxy.mjs",
  "journey-network-policy.d.mts",
  "journey-network-policy.mjs",
  "journey-skip-link-policy.contract.spec.ts",
  "journey-skip-link-policy.ts",
  "journey-staging.contract.spec.ts",
  "oidc-mock.contract.spec.ts",
  "oidc-mock.mjs",
  "playwright.config.ts",
  "prepare-synthetic-env.mjs",
  "provider-mock.contract.spec.ts",
  "provider-mock.mjs",
  "run-production-image-journey.mjs",
  "sanitized-har.contract.spec.ts",
  "sanitized-har.ts",
  "synthetic-env.contract.spec.ts",
  "synthetic-logout-storage.contract.spec.ts",
  "synthetic-logout-storage.ts",
  "wsl-relay-target.sh",
] as const;

let asyncDigest: Promise<string> | undefined;
let syncDigest: string | undefined;

export function currentJourneyFixtureContractSha256() {
  syncDigest ??= digestFixture((filename) => readFileSync(
    path.join(__dirname, filename),
  ));
  return syncDigest;
}

export function currentJourneyFixtureContractSha256Async() {
  asyncDigest ??= digestFixtureAsync(async (filename) => readFile(
    path.join(__dirname, filename),
  ));
  return asyncDigest;
}

function digestFixture(read: (filename: string) => Uint8Array) {
  const hash = createHash("sha256");
  hash.update("clean-pay-browser-journey-fixture-v5\0", "utf8");
  for (const filename of filenames) {
    const bytes = read(filename);
    hash.update(`${filename}\0${bytes.byteLength}\0`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}

async function digestFixtureAsync(
  read: (filename: string) => Promise<Uint8Array>,
) {
  const hash = createHash("sha256");
  hash.update("clean-pay-browser-journey-fixture-v5\0", "utf8");
  for (const filename of filenames) {
    const bytes = await read(filename);
    hash.update(`${filename}\0${bytes.byteLength}\0`, "utf8");
    hash.update(bytes);
  }
  return hash.digest("hex");
}
