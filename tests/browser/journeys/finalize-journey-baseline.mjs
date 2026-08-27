import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, open, readFile, readdir, rename } from "node:fs/promises";
import path from "node:path";

const baselineCommit = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const baselineVersion = "journey-v5";
const root = path.resolve(
  process.cwd(),
  "tests",
  "browser",
  "baselines",
  `${baselineCommit}-${baselineVersion}`,
);
const projects = ["journey-390x844", "journey-768x1024", "journey-1440x900"];
const journeys = Object.freeze({
  "public-responsive-keyboard-install-offline-support": [
    "public-login",
    "public-register",
    "public-tariffs",
    "public-support",
    "keyboard-login-first-tab",
    "responsive-main-menu-open",
    "install-pristine-csp-client-boundary",
    "install-ios-pristine-csp-client-boundary",
    "offline-direct-route",
    "offline-service-worker-fallback",
    "offline-recovery-support",
  ],
  "email-register-verify-and-login": [
    "register-verification-required",
    "register-email-verified",
    "register-cabinet",
    "email-login-cabinet",
  ],
  "telegram-oidc-cabinet-profile-link-referral-passkey": [
    "telegram-oidc-cabinet",
    "cabinet-pwa-installed",
    "profile",
    "verify-email",
    "referral",
    "passkey-login-ready",
    "passkey-login-cabinet",
    "link-account-with-passkey",
  ],
  "email-account-links-and-merges-telegram": [
    "link-account-merge-confirmation",
    "link-account-merged-cabinet",
  ],
  "tariffs-payment-returns-extend-idempotency": [
    "tariffs-authenticated",
    "payment-confirmation",
    "payment-provider-checkout",
    "payment-return-from-provider",
    "payment-return-pending",
    "payment-return-success",
    "payment-return-fail",
    "extend-confirmation",
    "extend-provider-checkout",
  ],
  "telegram-webapp-browser-boundary": ["telegram-webapp-cabinet"],
});
const contractTests = Object.freeze([
  "DB observer refuses every database outside an exact disposable journey scope",
  "accepts exact PII-free journey boundary schemas",
  "rejects unknown labels, extra fields, PII, and lifecycle near misses",
  "queries the callback receipt at its exact path scope",
  "projects generated journey values by referential symbol while retaining structure",
  "keeps stable journey payload fields and dynamic formats observable",
  "does not apply generated-value projection outside the exact journey envelope",
  "projects only the exact approved first-Tab skip-link state",
  "accepts exact pixels only inside the declared skip-link paint bounds",
  "keeps screenshot route, checkpoint, focus, and style near misses fail-closed",
  "publishes no canonical baseline and refuses a reused capture staging directory",
  "validates OIDC PKCE, Basic auth, redirect, single use, and sanitized ledger order",
  "rejects authorize and token contract near misses",
  "two reset/seed cycles restore every mutable provider and OIDC state",
  "preserves a verified email identity across login and isolates Telegram auth",
  "enforces synthetic credentials and models merge, password, and Remnawave identity DTOs",
  "accepts only exact single-use Turnstile action tokens and synthetic secret",
  "payment idempotency survives lost and rate-limited committed responses and rejects key reuse",
  "Chatwoot contact probe validates the synthetic inbox and records only credential shape",
  "emits an exact redacted HAR 1.2 contract",
  "rejects every HAR field that does not derive from raw redacted evidence",
  "materializes two deterministic self-contained role environments",
  "refuses external env sources and leaves no role files",
  "preserves only the exact fixture-owned Turnstile state byte-for-byte",
  "rejects wrong origins and extra or unsafe fixture storage keys",
  "rejects malformed, extended, or non-sequential Turnstile state",
]);
const update = process.env.CLEAN_PAY_UPDATE_JOURNEY_BASELINE === "1";
const captureId = update
  ? requiredCaptureId(process.env.CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID)
  : null;
const inputRoot = update
  ? path.resolve(process.cwd(), "test-results", "browser-journey-baseline-staging", captureId)
  : root;

if (update) {
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  }).trim();
  if (revision !== baselineCommit) {
    throw new Error(`Journey finalization requires ${baselineCommit}; current revision is ${revision}.`);
  }
}

const expectedRawPaths = [];
let source;
const syntheticResetCases = [];
for (const project of projects) {
  for (const [journey, labels] of Object.entries(journeys)) {
    const directory = path.join(inputRoot, project, journey);
    const jsonPath = path.join(directory, "journey.json");
    const harPath = path.join(directory, "network.har.json");
    expectedRawPaths.push(jsonPath, harPath);
    const evidence = JSON.parse(await readFile(jsonPath, "utf8"));
    const har = JSON.parse(await readFile(harPath, "utf8"));
    assertJourneyEvidence({ evidence, har, project, journey, labels });
    source ??= evidence.source;
    if (JSON.stringify(source) !== JSON.stringify(evidence.source)) {
      throw new Error(`Journey source provenance differs in ${project}/${journey}.`);
    }
    assertSyntheticReset(evidence.syntheticReset, syntheticResetCases.length + 1);
    syntheticResetCases.push({ project, journey, value: evidence.syntheticReset });
    for (const label of labels) {
      const screenshotPath = path.join(directory, "screenshots", `${label}.png`);
      expectedRawPaths.push(screenshotPath);
      const screenshot = await readFile(screenshotPath);
      const checkpoint = evidence.checkpoints.find((value) => value.label === label);
      if (
        !checkpoint
        || checkpoint.screenshot?.bytes !== screenshot.byteLength
        || checkpoint.screenshot?.sha256 !== sha256(screenshot)
      ) {
        throw new Error(`Screenshot evidence differs in ${project}/${journey}/${label}.`);
      }
    }
  }
}

const actualFiles = (await listFiles(inputRoot))
  .filter((file) => !["metadata.json", "artifact-inventory.json"].includes(path.basename(file)))
  .sort();
const expectedFiles = [...expectedRawPaths].sort();
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  throw new Error(
    `Journey raw inventory is incomplete or contains unexpected files: expected ${expectedFiles.length}, `
    + `found ${actualFiles.length}.`,
  );
}

const entries = await Promise.all(expectedFiles.map(async (file) => {
  const bytes = await readFile(file);
  return {
    path: path.relative(inputRoot, file).replaceAll(path.sep, "/"),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}));
const aggregateFormat = "sorted path\\0bytes\\0sha256\\n";
const aggregate = entries
  .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
  .join("");
const artifactSet = {
  artifactCount: entries.length,
  aggregateSha256: sha256(aggregate),
  aggregateFormat,
};
const inventory = jsonBytes({
  schemaVersion: 1,
  baselineId: `${baselineCommit}-${baselineVersion}`,
  status: "immutable_accepted_artifact_inventory",
  source,
  artifactSet,
  entries,
});
const inventorySha256 = sha256(inventory);
const checkpointCount = Object.values(journeys)
  .reduce((total, labels) => total + labels.length, 0) * projects.length;
const metadata = jsonBytes({
  schemaVersion: 1,
  baselineId: `${baselineCommit}-${baselineVersion}`,
  status: "accepted_for_gate",
  source,
  syntheticReset: {
    caseScoped: true,
    caseCount: syntheticResetCases.length,
    sequence: `strictly increasing 1..${syntheticResetCases.length}`,
    aggregateFormat: "project\\0journey\\0canonical-json\\n",
    aggregateSha256: sha256(syntheticResetCases.map((entry) => (
      `${entry.project}\0${entry.journey}\0${JSON.stringify(entry.value)}\n`
    )).join("")),
  },
  captureMatrix: {
    projects,
    journeyCasesPerProject: Object.keys(journeys),
    browserCaseCount: projects.length * Object.keys(journeys).length,
    checkpointPngCount: checkpointCount,
    rawArtifactCount: artifactSet.artifactCount,
    contractTests,
    contractTestCount: contractTests.length,
  },
  comparison: {
    rawArtifactsPreserved: true,
    pngEquality: "byte-exact except the exact keyboard skip-link paint-bounds policy",
    har: "HAR 1.2 fields derive exactly from the redacted recorder before projection",
    serverActions: "count, order, payload digest, status, and provider mutation effects are exact",
    databaseEffects: "table names and row counts are exact; no row values are captured",
  },
  artifactSet,
  inventory: {
    file: "artifact-inventory.json",
    sha256: inventorySha256,
  },
  completionMarker: "written only after the locked Playwright command exits successfully",
});

const inventoryPath = path.join(inputRoot, "artifact-inventory.json");
const metadataPath = path.join(inputRoot, "metadata.json");
if (update) {
  if (await exists(root)) {
    throw new Error(`Immutable journey baseline already exists: ${root}.`);
  }
  await writeExclusive(inventoryPath, inventory);
  // Root metadata is the final completion marker and is written last.
  await writeExclusive(metadataPath, metadata);
  // Staging and canonical roots share a volume. Directory rename publishes
  // the fully validated set as one operation; failed suites never touch root.
  await rename(inputRoot, root);
} else {
  await assertImmutable(inventoryPath, inventory);
  await assertImmutable(metadataPath, metadata);
}

process.stdout.write(`${JSON.stringify({
  status: "accepted_for_gate",
  browserCases: projects.length * Object.keys(journeys).length,
  contractTests: contractTests.length,
  checkpointPngs: checkpointCount,
  rawArtifacts: artifactSet.artifactCount,
  aggregateSha256: artifactSet.aggregateSha256,
  inventorySha256,
  metadataSha256: sha256(metadata),
})}\n`);

function assertJourneyEvidence({ evidence, har, project, journey, labels }) {
  if (
    evidence.schemaVersion !== 2
    || evidence.baselineCommit !== baselineCommit
    || evidence.project !== project
    || evidence.journey !== journey
    || !Array.isArray(evidence.checkpoints)
    || JSON.stringify(evidence.checkpoints.map((value) => value.label)) !== JSON.stringify(labels)
    || har.log?.version !== "1.2"
    || har.log?.creator?.version !== baselineVersion
    || !Array.isArray(har.log?.entries)
    || har.log.entries.length !== evidence.network?.requests?.length
    || JSON.stringify(har._cleanPay?.network) !== JSON.stringify(evidence.network)
    || JSON.stringify(har._cleanPay?.providerEffects) !== JSON.stringify(evidence.providerEffects)
  ) {
    throw new Error(`Journey evidence contract is invalid in ${project}/${journey}.`);
  }
}

function assertSyntheticReset(value, expectedSequence) {
  const database = value?.database;
  if (
    value?.status !== "reset"
    || !/^[a-f0-9]{64}$/.test(value?.seed_sha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(value?.scenario_sha256 ?? "")
    || database?.status !== "reset"
    || database?.scopeContract !== "exact-compose-project-label"
    || !/^[a-f0-9]{64}$/.test(database?.scopeSha256 ?? "")
    || !/^[a-f0-9]{64}$/.test(database?.schemaSha256 ?? "")
    || database?.sequenceCount !== 0
    || database?.resetSequence !== expectedSequence
    || database?.transaction !== "truncate-public-application-tables-cascade-no-sequences"
    || database?.redis !== "flush-owned-db-0"
    || !Number.isSafeInteger(database?.tableCount)
    || database.tableCount <= 0
  ) {
    throw new Error(`Synthetic reset contract is invalid at sequence ${expectedSequence}.`);
  }
}

async function writeExclusive(destination, contents) {
  const handle = await open(destination, "wx");
  try {
    await handle.writeFile(contents);
  } finally {
    await handle.close();
  }
}

async function assertImmutable(destination, contents) {
  const expected = await readFile(destination);
  if (!expected.equals(contents)) {
    throw new Error(
      `Immutable journey root artifact mismatch for ${destination}: expected ${sha256(expected)}, `
      + `received ${sha256(contents)}.`,
    );
  }
}

async function listFiles(directory) {
  const values = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(values.map(async (entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(resolved) : [resolved];
  }));
  return nested.flat();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function requiredCaptureId(value) {
  const capture = value?.trim();
  if (!capture || !/^[a-f0-9]{16}$/.test(capture)) {
    throw new Error(
      "CLEAN_PAY_BROWSER_JOURNEY_CAPTURE_ID must be a unique 16-hex value for baseline capture.",
    );
  }
  return capture;
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}
