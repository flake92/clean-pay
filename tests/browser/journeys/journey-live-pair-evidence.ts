import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";

import { BEHAVIORAL_BASELINE_COMMIT } from "../baseline-policy";
import { authenticatedJourneyLivePairCaptureEnabled } from "./authenticated-journey-capture-mode";
import { currentJourneyFixtureContractSha256 } from "./journey-fixture-contract";
import { assertSanitizedHarContract } from "./sanitized-har";

export const JOURNEY_LIVE_PAIR_SUITE = "authenticated-journey-live-pair-v1";
export const JOURNEY_LIVE_PAIR_PROJECTS = Object.freeze([
  "journey-390x844",
  "journey-768x1024",
  "journey-1440x900",
] as const);
export const JOURNEY_LIVE_PAIR_CASES = Object.freeze({
  "public-responsive-keyboard-install-offline-support": Object.freeze([
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
  ]),
  "email-register-verify-and-login": Object.freeze([
    "register-verification-required",
    "register-email-verified",
    "register-cabinet",
    "email-login-cabinet",
  ]),
  "telegram-oidc-cabinet-profile-link-referral-passkey": Object.freeze([
    "telegram-oidc-cabinet",
    "cabinet-pwa-installed",
    "profile",
    "verify-email",
    "referral",
    "passkey-login-ready",
    "passkey-login-cabinet",
    "link-account-with-passkey",
  ]),
  "email-account-links-and-merges-telegram": Object.freeze([
    "link-account-merge-confirmation",
    "link-account-merged-cabinet",
  ]),
  "tariffs-payment-returns-extend-idempotency": Object.freeze([
    "tariffs-authenticated",
    "payment-confirmation",
    "payment-provider-checkout",
    "payment-return-from-provider",
    "payment-return-pending",
    "payment-return-success",
    "payment-return-fail",
    "extend-confirmation",
    "extend-provider-checkout",
  ]),
  "telegram-webapp-browser-boundary": Object.freeze([
    "telegram-webapp-cabinet",
  ]),
} as const);

export type JourneyLivePairRole = "baseline" | "candidate";
export type JourneyLivePairProject = (typeof JOURNEY_LIVE_PAIR_PROJECTS)[number];
export type JourneyLivePairCase = keyof typeof JOURNEY_LIVE_PAIR_CASES;

export type JourneyLivePairStackBinding = Readonly<{
  schemaVersion: 1;
  role: JourneyLivePairRole;
  source: Readonly<{
    revision: string;
    imageDigest: string;
    imageTag: string;
    migrationImageDigest: string;
    migrationImageTag: string;
    publicBuildContractSha256: string;
    fixtureContractSha256: string;
  }>;
  runtime: Readonly<{
    projectSha256: string;
    generatedEnvironmentDirectorySha256: string;
    launchReceiptSha256: string;
    runtimeAttestationSha256: string;
  }>;
}>;

type DirectoryIdentity = Readonly<{
  path: string;
  device: string;
  inode: string;
}>;

export type JourneyLivePairOwnership = Readonly<{
  root: string;
  receipt: Readonly<{
    schemaVersion: 1;
    kind: "clean-pay-authenticated-journey-live-pair-ownership";
    suite: typeof JOURNEY_LIVE_PAIR_SUITE;
    captureId: string;
    role: JourneyLivePairRole;
    binding: JourneyLivePairStackBinding;
    bindingSha256: string;
    directories: readonly DirectoryIdentity[];
  }>;
  receiptBytes: Buffer;
  receiptSha256: string;
}>;

export const JOURNEY_LIVE_PAIR_CAPTURE_ID_ENV =
  "CLEAN_PAY_BROWSER_JOURNEY_LIVE_PAIR_CAPTURE_ID";
export const JOURNEY_LIVE_PAIR_ROLE_ENV =
  "CLEAN_PAY_BROWSER_JOURNEY_LIVE_PAIR_ROLE";
export const JOURNEY_LIVE_PAIR_BINDING_SHA256_ENV =
  "CLEAN_PAY_BROWSER_JOURNEY_LIVE_PAIR_BINDING_SHA256";
export const JOURNEY_LIVE_PAIR_OWNERSHIP_SHA256_ENV =
  "CLEAN_PAY_BROWSER_JOURNEY_LIVE_PAIR_OWNERSHIP_SHA256";

const captureIdPattern = /^[a-f0-9]{16}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const imageTagPattern = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/;
const maximumArtifactBytes = 16 * 1024 * 1024;

export const journeyLivePairOutputRoot = path.resolve(
  process.cwd(),
  "test-results",
  "browser-authenticated-journey-live-pair",
);

export const JOURNEY_LIVE_PAIR_ARTIFACT_PATHS = Object.freeze(
  JOURNEY_LIVE_PAIR_PROJECTS.flatMap((project) => (
    (Object.entries(JOURNEY_LIVE_PAIR_CASES) as Array<[
      JourneyLivePairCase,
      readonly string[],
    ]>).flatMap(([journey, checkpoints]) => [
      `${project}/${journey}/journey.json`,
      `${project}/${journey}/network.har.json`,
      ...checkpoints.map((checkpoint) => (
        `${project}/${journey}/screenshots/${checkpoint}.png`
      )),
    ])
  )).sort(),
);

export function createJourneyLivePairStackBinding(
  value: JourneyLivePairStackBinding,
) {
  assertExactStackBinding(value, value.role);
  return Object.freeze({
    ...value,
    source: Object.freeze({ ...value.source }),
    runtime: Object.freeze({ ...value.runtime }),
  });
}

export function journeyLivePairBindingSha256(binding: JourneyLivePairStackBinding) {
  assertExactStackBinding(binding, binding.role);
  return sha256(canonicalJson(binding));
}

export function journeyLivePairCaptureEnvironment(options: {
  captureId: string;
  ownership: JourneyLivePairOwnership;
}) {
  const { captureId, ownership } = options;
  assertCaptureId(captureId);
  if (
    ownership.receipt.captureId !== captureId
    || sha256(ownership.receiptBytes) !== ownership.receiptSha256
  ) {
    throw new Error("Journey live-pair environment ownership is invalid.");
  }
  return Object.freeze({
    [JOURNEY_LIVE_PAIR_CAPTURE_ID_ENV]: captureId,
    [JOURNEY_LIVE_PAIR_ROLE_ENV]: ownership.receipt.role,
    [JOURNEY_LIVE_PAIR_BINDING_SHA256_ENV]: ownership.receipt.bindingSha256,
    [JOURNEY_LIVE_PAIR_OWNERSHIP_SHA256_ENV]: ownership.receiptSha256,
  });
}

export async function prepareJourneyLivePairEvidence(options: {
  captureId: string;
  baseline: JourneyLivePairStackBinding;
  candidate: JourneyLivePairStackBinding;
}) {
  assertCaptureId(options.captureId);
  const baseline = createJourneyLivePairStackBinding(options.baseline);
  const candidate = createJourneyLivePairStackBinding(options.candidate);
  assertBindingPair(baseline, candidate);
  await ensureOutputAncestors();
  const root = resolveJourneyLivePairRoot(options.captureId);
  await mkdir(root, { mode: 0o700, recursive: false });
  try {
    const roles = await Promise.all((["baseline", "candidate"] as const).map((role) => (
      prepareRoleOwnership({
        binding: role === "baseline" ? baseline : candidate,
        captureId: options.captureId,
        pairRoot: root,
        role,
      })
    )));
    const pairReceipt = Object.freeze({
      schemaVersion: 1 as const,
      kind: "clean-pay-authenticated-journey-live-pair" as const,
      suite: JOURNEY_LIVE_PAIR_SUITE,
      captureId: options.captureId,
      roles: Object.freeze(roles.map((ownership) => Object.freeze({
        role: ownership.receipt.role,
        bindingSha256: ownership.receipt.bindingSha256,
        ownershipSha256: ownership.receiptSha256,
      }))),
    });
    const pairReceiptBytes = jsonBytes(pairReceipt);
    await writeCreateOnly(path.join(root, "pair-ownership.json"), pairReceiptBytes);
    return Object.freeze({
      root,
      pairReceipt,
      pairReceiptBytes,
      pairReceiptSha256: sha256(pairReceiptBytes),
      roles: Object.freeze({ baseline: roles[0], candidate: roles[1] }),
    });
  } catch (error) {
    // Evidence is deliberately retained on preparation failure. A new capture
    // identity is required, which prevents a partial tree from being trusted.
    throw error;
  }
}

export function requireJourneyLivePairEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  if (!authenticatedJourneyLivePairCaptureEnabled(environment)) {
    throw new Error("Journey live-pair evidence requires its exact opt-in mode.");
  }
  const captureId = exactEnvironment(
    environment[JOURNEY_LIVE_PAIR_CAPTURE_ID_ENV],
    captureIdPattern,
    "capture ID",
  );
  const role = exactEnvironment(
    environment[JOURNEY_LIVE_PAIR_ROLE_ENV],
    /^(?:baseline|candidate)$/,
    "role",
  ) as JourneyLivePairRole;
  const bindingSha256 = exactEnvironment(
    environment[JOURNEY_LIVE_PAIR_BINDING_SHA256_ENV],
    digestPattern,
    "binding digest",
  );
  const ownershipSha256 = exactEnvironment(
    environment[JOURNEY_LIVE_PAIR_OWNERSHIP_SHA256_ENV],
    digestPattern,
    "ownership digest",
  );
  if (environment.CLEAN_PAY_UPDATE_JOURNEY_BASELINE !== undefined) {
    throw new Error("Journey live-pair mode must not overlap immutable baseline update mode.");
  }
  return Object.freeze({
    captureId,
    role,
    bindingSha256,
    ownershipSha256,
    root: resolveJourneyLivePairRoleRoot(captureId, role),
  });
}

export async function assertJourneyLivePairCaptureReady(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const identity = requireJourneyLivePairEnvironment(environment);
  const ownership = await readOwnership(identity);
  const files = await listFiles(path.join(ownership.root, "artifacts"), 1);
  if (files.length !== 0) {
    throw new Error("Journey live-pair capture root was already used.");
  }
  return ownership;
}

export async function writeJourneyLivePairCase(options: {
  project: string;
  journeyId: string;
  networkEvidence: Uint8Array;
  rawEvidence: Uint8Array;
  screenshots: Array<{ label: string; bytes: Uint8Array }>;
  environment?: Readonly<Record<string, string | undefined>>;
}) {
  const identity = requireJourneyLivePairEnvironment(options.environment ?? process.env);
  const ownership = await readOwnership(identity);
  const labels = expectedCheckpointLabels(options.project, options.journeyId);
  if (
    options.screenshots.length !== labels.length
    || options.screenshots.some((value, index) => value.label !== labels[index])
  ) {
    throw new Error("Journey live-pair checkpoint inventory is not exact.");
  }
  const directory = `${options.project}/${options.journeyId}`;
  const artifacts = [
    ...options.screenshots.map((screenshot) => ({
      path: `${directory}/screenshots/${screenshot.label}.png`,
      bytes: screenshot.bytes,
    })),
    { path: `${directory}/network.har.json`, bytes: options.networkEvidence },
    // journey.json is the case-local completion marker and is written last.
    { path: `${directory}/journey.json`, bytes: options.rawEvidence },
  ];
  for (const artifact of artifacts) {
    await writeOwnedArtifact(ownership, artifact.path, artifact.bytes);
  }
  return Object.freeze({
    status: "live-pair-case-captured" as const,
    root: ownership.root,
    artifactCount: artifacts.length,
  });
}

export async function sealJourneyLivePairCapture(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const identity = requireJourneyLivePairEnvironment(environment);
  const ownership = await readOwnership(identity);
  const inventory = await readExactInventory(ownership.root);
  const source = await assertExactRoleEvidence(ownership);
  const inventoryBytes = jsonBytes(inventory);
  const receipt = Object.freeze({
    schemaVersion: 1 as const,
    kind: "clean-pay-authenticated-journey-live-pair-capture" as const,
    suite: JOURNEY_LIVE_PAIR_SUITE,
    captureId: identity.captureId,
    role: identity.role,
    bindingSha256: identity.bindingSha256,
    ownershipSha256: identity.ownershipSha256,
    browserCaseCount: 18,
    checkpointPngCount: 105,
    rawArtifactCount: 141,
    resetSequence: "strictly-increasing-1-through-18",
    source,
    inventorySha256: sha256(inventoryBytes),
    inventory,
  });
  const bytes = jsonBytes(receipt);
  await writeCreateOnly(path.join(ownership.root, "capture-receipt.json"), bytes);
  await assertOwnershipDirectories(ownership.root, ownership.receipt.directories);
  return Object.freeze({ receipt, bytes, sha256: sha256(bytes), root: ownership.root });
}

export async function readJourneyLivePairCapture(options: {
  captureId: string;
  role: JourneyLivePairRole;
  bindingSha256: string;
  ownershipSha256: string;
}) {
  const identity = {
    captureId: exactEnvironment(options.captureId, captureIdPattern, "capture ID"),
    role: options.role,
    bindingSha256: exactEnvironment(options.bindingSha256, digestPattern, "binding digest"),
    ownershipSha256: exactEnvironment(
      options.ownershipSha256,
      digestPattern,
      "ownership digest",
    ),
    root: resolveJourneyLivePairRoleRoot(options.captureId, options.role),
  };
  const ownership = await readOwnership(identity);
  const receiptBytes = await readBoundedRegularFile(
    path.join(identity.root, "capture-receipt.json"),
    1024 * 1024,
  );
  const receipt = parseRecord(receiptBytes, "capture receipt");
  const inventory = await readExactInventory(identity.root);
  const expectedKeys = [
    "bindingSha256", "browserCaseCount", "captureId", "checkpointPngCount",
    "inventory", "inventorySha256", "kind", "ownershipSha256", "rawArtifactCount",
    "resetSequence", "role", "schemaVersion", "source", "suite",
  ];
  if (
    !hasExactKeys(receipt, expectedKeys)
    || receipt.schemaVersion !== 1
    || receipt.kind !== "clean-pay-authenticated-journey-live-pair-capture"
    || receipt.suite !== JOURNEY_LIVE_PAIR_SUITE
    || receipt.captureId !== identity.captureId
    || receipt.role !== identity.role
    || receipt.bindingSha256 !== identity.bindingSha256
    || receipt.ownershipSha256 !== identity.ownershipSha256
    || receipt.browserCaseCount !== 18
    || receipt.checkpointPngCount !== 105
    || receipt.rawArtifactCount !== 141
    || receipt.resetSequence !== "strictly-increasing-1-through-18"
    || receipt.inventorySha256 !== sha256(jsonBytes(inventory))
    || canonicalJson(receipt.inventory) !== canonicalJson(inventory)
  ) {
    throw new Error("Journey live-pair capture receipt is invalid or stale.");
  }
  assertSourceMatchesBinding(receipt.source, ownership.receipt.binding);
  await assertExactRoleEvidence(ownership);
  return Object.freeze({
    ownership,
    receipt,
    receiptBytes,
    receiptSha256: sha256(receiptBytes),
    root: identity.root,
  });
}

export async function readJourneyLivePairArtifact(
  root: string,
  relativePath: string,
) {
  assertArtifactPath(relativePath);
  const artifactsRoot = path.join(root, "artifacts");
  const target = path.resolve(artifactsRoot, ...relativePath.split("/"));
  assertWithin(artifactsRoot, target, "artifact read");
  return readBoundedRegularFile(target, maximumArtifactBytes);
}

export function resolveJourneyLivePairRoot(captureId: string) {
  assertCaptureId(captureId);
  const target = path.resolve(journeyLivePairOutputRoot, captureId);
  assertWithin(journeyLivePairOutputRoot, target, "pair root");
  return target;
}

export function resolveJourneyLivePairRoleRoot(
  captureId: string,
  role: JourneyLivePairRole,
) {
  if (!/^(?:baseline|candidate)$/.test(role)) {
    throw new Error("Journey live-pair role is invalid.");
  }
  const root = resolveJourneyLivePairRoot(captureId);
  const target = path.resolve(root, role);
  assertWithin(root, target, "role root");
  return target;
}

export async function writeJourneyLivePairCompletionFile(
  captureId: string,
  name: "pair-proof.json" | "completion.json",
  bytes: Uint8Array,
) {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumArtifactBytes) {
    throw new Error("Journey live-pair completion evidence is outside its bound.");
  }
  const root = resolveJourneyLivePairRoot(captureId);
  await assertExactDirectory(root, "pair root");
  await writeCreateOnly(path.join(root, name), bytes);
}

export async function readJourneyLivePairPairOwnership(captureId: string) {
  const bytes = await readBoundedRegularFile(
    path.join(resolveJourneyLivePairRoot(captureId), "pair-ownership.json"),
    1024 * 1024,
  );
  return Object.freeze({ bytes, value: parseRecord(bytes, "pair ownership"), sha256: sha256(bytes) });
}

async function prepareRoleOwnership(options: {
  binding: JourneyLivePairStackBinding;
  captureId: string;
  pairRoot: string;
  role: JourneyLivePairRole;
}) {
  const root = path.join(options.pairRoot, options.role);
  await mkdir(root, { mode: 0o700, recursive: false });
  const paths = expectedDirectoryPaths();
  for (const relativePath of paths.slice(1)) {
    await mkdir(path.join(root, ...relativePath.split("/")), {
      mode: 0o700,
      recursive: false,
    });
  }
  const directories = await Promise.all(paths.map((relativePath) => (
    directoryIdentity(
      relativePath === "." ? root : path.join(root, ...relativePath.split("/")),
      relativePath,
    )
  )));
  const bindingSha256 = journeyLivePairBindingSha256(options.binding);
  const receipt = Object.freeze({
    schemaVersion: 1 as const,
    kind: "clean-pay-authenticated-journey-live-pair-ownership" as const,
    suite: JOURNEY_LIVE_PAIR_SUITE,
    captureId: options.captureId,
    role: options.role,
    binding: options.binding,
    bindingSha256,
    directories: Object.freeze(directories),
  });
  const receiptBytes = jsonBytes(receipt);
  await writeCreateOnly(path.join(root, "capture-ownership.json"), receiptBytes);
  return Object.freeze({
    root,
    receipt,
    receiptBytes,
    receiptSha256: sha256(receiptBytes),
  }) satisfies JourneyLivePairOwnership;
}

async function readOwnership(identity: {
  captureId: string;
  role: JourneyLivePairRole;
  bindingSha256: string;
  ownershipSha256: string;
  root: string;
}) {
  const receiptBytes = await readBoundedRegularFile(
    path.join(identity.root, "capture-ownership.json"),
    1024 * 1024,
  );
  if (sha256(receiptBytes) !== identity.ownershipSha256) {
    throw new Error("Journey live-pair ownership digest changed.");
  }
  const value = parseRecord(receiptBytes, "ownership receipt");
  if (
    !hasExactKeys(value, [
      "binding", "bindingSha256", "captureId", "directories", "kind", "role",
      "schemaVersion", "suite",
    ])
    || value.schemaVersion !== 1
    || value.kind !== "clean-pay-authenticated-journey-live-pair-ownership"
    || value.suite !== JOURNEY_LIVE_PAIR_SUITE
    || value.captureId !== identity.captureId
    || value.role !== identity.role
    || value.bindingSha256 !== identity.bindingSha256
    || !Array.isArray(value.directories)
  ) {
    throw new Error("Journey live-pair ownership receipt is invalid.");
  }
  assertExactStackBinding(value.binding, identity.role);
  if (journeyLivePairBindingSha256(value.binding) !== identity.bindingSha256) {
    throw new Error("Journey live-pair stack binding changed.");
  }
  const expectedPaths = expectedDirectoryPaths();
  const directories = value.directories.map((entry, index) => {
    if (!isDirectoryIdentity(entry) || entry.path !== expectedPaths[index]) {
      throw new Error("Journey live-pair directory ownership ledger changed.");
    }
    return Object.freeze({ ...entry });
  });
  if (directories.length !== expectedPaths.length) {
    throw new Error("Journey live-pair directory ownership ledger is incomplete.");
  }
  const ownership = Object.freeze({
    root: identity.root,
    receipt: Object.freeze({
      schemaVersion: 1 as const,
      kind: "clean-pay-authenticated-journey-live-pair-ownership" as const,
      suite: JOURNEY_LIVE_PAIR_SUITE,
      captureId: identity.captureId,
      role: identity.role,
      binding: createJourneyLivePairStackBinding(value.binding),
      bindingSha256: identity.bindingSha256,
      directories: Object.freeze(directories),
    }),
    receiptBytes,
    receiptSha256: identity.ownershipSha256,
  }) satisfies JourneyLivePairOwnership;
  await assertOwnershipDirectories(identity.root, ownership.receipt.directories);
  return ownership;
}

async function writeOwnedArtifact(
  ownership: JourneyLivePairOwnership,
  relativePath: string,
  bytes: Uint8Array,
) {
  assertArtifactPath(relativePath);
  if (bytes.byteLength < 1 || bytes.byteLength > maximumArtifactBytes) {
    throw new Error("Journey live-pair artifact is outside its byte bound.");
  }
  await assertOwnershipDirectories(ownership.root, ownership.receipt.directories);
  const target = path.resolve(
    ownership.root,
    "artifacts",
    ...relativePath.split("/"),
  );
  assertWithin(path.join(ownership.root, "artifacts"), target, "artifact write");
  const parentRelative = path.relative(ownership.root, path.dirname(target))
    .split(path.sep).join("/");
  if (!ownership.receipt.directories.some((entry) => entry.path === parentRelative)) {
    throw new Error("Journey live-pair artifact parent is not verifier-owned.");
  }
  await writeCreateOnly(target, bytes);
  const written = await readBoundedRegularFile(target, maximumArtifactBytes);
  if (written.byteLength !== bytes.byteLength || sha256(written) !== sha256(bytes)) {
    throw new Error("Journey live-pair artifact changed during its create-only write.");
  }
}

async function assertExactRoleEvidence(ownership: JourneyLivePairOwnership) {
  let resetSequence = 0;
  let source: unknown;
  for (const project of JOURNEY_LIVE_PAIR_PROJECTS) {
    for (const [journey, labels] of Object.entries(JOURNEY_LIVE_PAIR_CASES)) {
      resetSequence += 1;
      const directory = `${project}/${journey}`;
      const journeyBytes = await readJourneyLivePairArtifact(
        ownership.root,
        `${directory}/journey.json`,
      );
      const harBytes = await readJourneyLivePairArtifact(
        ownership.root,
        `${directory}/network.har.json`,
      );
      const evidence = parseRecord(journeyBytes, "journey evidence");
      const har = assertSanitizedHarContract(JSON.parse(harBytes.toString("utf8")));
      if (
        evidence.schemaVersion !== 2
        || evidence.baselineCommit !== BEHAVIORAL_BASELINE_COMMIT
        || evidence.project !== project
        || evidence.journey !== journey
        || !Array.isArray(evidence.checkpoints)
        || canonicalJson(evidence.checkpoints.map((entry) => (
          isRecord(entry) ? entry.label : null
        ))) !== canonicalJson(labels)
      ) {
        throw new Error(`Journey live-pair evidence envelope is invalid for ${directory}.`);
      }
      const reset = isRecord(evidence.syntheticReset) && isRecord(evidence.syntheticReset.database)
        ? evidence.syntheticReset.database
        : null;
      if (reset?.resetSequence !== resetSequence) {
        throw new Error("Journey live-pair reset sequence is not exactly 1 through 18.");
      }
      assertSourceMatchesBinding(evidence.source, ownership.receipt.binding);
      assertSourceMatchesBinding(har.source, ownership.receipt.binding);
      source ??= evidence.source;
      if (
        canonicalJson(source) !== canonicalJson(evidence.source)
        || canonicalJson(evidence.source) !== canonicalJson(har.source)
      ) {
        throw new Error("Journey live-pair source provenance changed between cases.");
      }
      if (
        har.project !== project
        || har.journey !== journey
      ) {
        throw new Error(`Journey live-pair HAR identity is invalid for ${directory}.`);
      }
      for (const label of labels) {
        const screenshot = await readJourneyLivePairArtifact(
          ownership.root,
          `${directory}/screenshots/${label}.png`,
        );
        const matches = evidence.checkpoints.filter((entry) => (
          isRecord(entry) && entry.label === label
        ));
        const checkpoint = matches[0];
        if (
          matches.length !== 1
          || !isRecord(checkpoint)
          || !isRecord(checkpoint.screenshot)
          || checkpoint.screenshot.bytes !== screenshot.byteLength
          || checkpoint.screenshot.sha256 !== sha256(screenshot)
          || !isPng(screenshot)
        ) {
          throw new Error(`Journey live-pair PNG binding is invalid for ${directory}/${label}.`);
        }
      }
    }
  }
  return source;
}

function assertSourceMatchesBinding(value: unknown, binding: JourneyLivePairStackBinding) {
  if (!isRecord(value) || !isRecord(value.publicBuildContract) || !isRecord(value.fixtureContract)) {
    throw new Error("Journey live-pair source provenance is invalid.");
  }
  const expected = binding.source;
  if (
    value.revision !== expected.revision
    || value.imageDigest !== expected.imageDigest
    || value.imageTag !== expected.imageTag
    || value.migrationImageDigest !== expected.migrationImageDigest
    || value.migrationImageTag !== expected.migrationImageTag
    || value.publicBuildContract.version !== "1"
    || value.publicBuildContract.sha256 !== expected.publicBuildContractSha256
    || value.fixtureContract.version !== "journey-v5"
    || value.fixtureContract.sha256 !== expected.fixtureContractSha256
  ) {
    throw new Error("Journey live-pair source provenance is not bound to its owned stack.");
  }
}

async function readExactInventory(root: string) {
  const files = await listFiles(
    path.join(root, "artifacts"),
    JOURNEY_LIVE_PAIR_ARTIFACT_PATHS.length + 1,
  );
  if (canonicalJson(files) !== canonicalJson(JOURNEY_LIVE_PAIR_ARTIFACT_PATHS)) {
    throw new Error("Journey live-pair raw inventory is missing, extra, or renamed.");
  }
  return Promise.all(files.map(async (relativePath) => {
    const bytes = await readJourneyLivePairArtifact(root, relativePath);
    return Object.freeze({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }));
}

async function ensureOutputAncestors() {
  const repositoryRoot = path.resolve(process.cwd());
  await assertExactDirectory(repositoryRoot, "repository root");
  const testResultsRoot = path.join(repositoryRoot, "test-results");
  await ensureDirectory(testResultsRoot, "test-results root");
  await ensureDirectory(journeyLivePairOutputRoot, "journey live-pair output root");
}

async function ensureDirectory(target: string, label: string) {
  try {
    await mkdir(target, { mode: 0o700, recursive: false });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }
  await assertExactDirectory(target, label);
}

async function assertExactDirectory(target: string, label: string) {
  const details = await lstat(target);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Journey live-pair ${label} is not a regular directory.`);
  }
  if (await realpath(target) !== path.resolve(target)) {
    throw new Error(`Journey live-pair ${label} resolved through an unexpected path.`);
  }
}

async function directoryIdentity(target: string, relativePath: string) {
  const details = await lstat(target, { bigint: true });
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Journey live-pair owned path is not a regular directory.");
  }
  if (await realpath(target) !== path.resolve(target)) {
    throw new Error("Journey live-pair owned directory changed resolution.");
  }
  return Object.freeze({
    path: relativePath,
    device: details.dev.toString(10),
    inode: details.ino.toString(10),
  });
}

async function assertOwnershipDirectories(
  root: string,
  expected: readonly DirectoryIdentity[],
) {
  for (const identity of expected) {
    const target = identity.path === "."
      ? root
      : path.join(root, ...identity.path.split("/"));
    const current = await directoryIdentity(target, identity.path);
    if (current.device !== identity.device || current.inode !== identity.inode) {
      throw new Error("Journey live-pair owned directory identity changed.");
    }
  }
  const actual = await listDirectories(root);
  if (canonicalJson(actual) !== canonicalJson(expected.map(({ path: value }) => value))) {
    throw new Error("Journey live-pair owned directory inventory changed.");
  }
}

async function listDirectories(root: string) {
  const result = ["."];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        throw new Error("Journey live-pair evidence tree contains a symbolic link.");
      }
      if (!details.isDirectory()) continue;
      result.push(path.relative(root, target).split(path.sep).join("/"));
      await visit(target);
    }
  };
  await visit(root);
  return result.sort(directoryPathOrder);
}

async function listFiles(root: string, maximum: number) {
  await assertExactDirectory(root, "artifact root");
  const result: string[] = [];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        throw new Error("Journey live-pair raw evidence contains a symbolic link.");
      }
      if (details.isDirectory()) {
        await visit(target);
      } else if (details.isFile()) {
        result.push(path.relative(root, target).split(path.sep).join("/"));
        if (result.length > maximum) {
          throw new Error("Journey live-pair raw evidence contains extra files.");
        }
      } else {
        throw new Error("Journey live-pair raw evidence contains a non-regular entry.");
      }
    }
  };
  await visit(root);
  return result.sort();
}

async function readBoundedRegularFile(target: string, maximum: number) {
  const details = await lstat(target);
  if (
    !details.isFile()
    || details.isSymbolicLink()
    || details.size < 1
    || details.size > maximum
  ) {
    throw new Error("Journey live-pair evidence file is not a bounded regular file.");
  }
  const bytes = await readFile(target);
  if (bytes.byteLength !== details.size) {
    throw new Error("Journey live-pair evidence file changed while being read.");
  }
  return bytes;
}

async function writeCreateOnly(target: string, bytes: Uint8Array) {
  const parent = path.dirname(target);
  await assertExactDirectory(parent, "create-only parent");
  const handle = await open(target, "wx", 0o600);
  let failure: unknown;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    failure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    if (failure !== undefined) {
      throw new AggregateError([failure, error], "Journey live-pair write and close both failed.");
    }
    throw error;
  }
  if (failure !== undefined) throw failure;
}

function expectedDirectoryPaths() {
  const result = new Set([".", "artifacts"]);
  for (const artifact of JOURNEY_LIVE_PAIR_ARTIFACT_PATHS) {
    const segments = artifact.split("/").slice(0, -1);
    let current = "artifacts";
    for (const segment of segments) {
      current = `${current}/${segment}`;
      result.add(current);
    }
  }
  return [...result].sort(directoryPathOrder);
}

function expectedCheckpointLabels(project: string, journey: string) {
  if (!JOURNEY_LIVE_PAIR_PROJECTS.includes(project as JourneyLivePairProject)) {
    throw new Error("Journey live-pair project is outside the exact matrix.");
  }
  if (!Object.hasOwn(JOURNEY_LIVE_PAIR_CASES, journey)) {
    throw new Error("Journey live-pair case is outside the exact matrix.");
  }
  return JOURNEY_LIVE_PAIR_CASES[journey as JourneyLivePairCase];
}

function assertArtifactPath(value: string) {
  if (!JOURNEY_LIVE_PAIR_ARTIFACT_PATHS.includes(value)) {
    throw new Error("Journey live-pair artifact is outside the exact 141-file inventory.");
  }
}

function assertBindingPair(
  baseline: JourneyLivePairStackBinding,
  candidate: JourneyLivePairStackBinding,
) {
  if (
    baseline.source.revision !== BEHAVIORAL_BASELINE_COMMIT
    || candidate.source.revision === BEHAVIORAL_BASELINE_COMMIT
    || baseline.source.imageDigest === candidate.source.imageDigest
    || baseline.source.migrationImageDigest === candidate.source.migrationImageDigest
    || baseline.runtime.projectSha256 === candidate.runtime.projectSha256
    || baseline.runtime.generatedEnvironmentDirectorySha256
      === candidate.runtime.generatedEnvironmentDirectorySha256
    || baseline.runtime.runtimeAttestationSha256 === candidate.runtime.runtimeAttestationSha256
    || baseline.source.publicBuildContractSha256
      !== candidate.source.publicBuildContractSha256
    || baseline.source.fixtureContractSha256 !== candidate.source.fixtureContractSha256
    || baseline.source.fixtureContractSha256 !== currentJourneyFixtureContractSha256()
    || journeyLivePairBindingSha256(baseline) === journeyLivePairBindingSha256(candidate)
  ) {
    throw new Error("Journey live-pair baseline/candidate bindings are not exact and distinct.");
  }
}

function assertExactStackBinding(
  value: unknown,
  role: JourneyLivePairRole,
): asserts value is JourneyLivePairStackBinding {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ["role", "runtime", "schemaVersion", "source"])
    || value.schemaVersion !== 1
    || value.role !== role
    || !isRecord(value.source)
    || !hasExactKeys(value.source, [
      "fixtureContractSha256", "imageDigest", "imageTag", "migrationImageDigest",
      "migrationImageTag", "publicBuildContractSha256", "revision",
    ])
    || typeof value.source.revision !== "string"
    || !/^[a-f0-9]{40}$/.test(value.source.revision)
    || typeof value.source.imageDigest !== "string"
    || !imageDigestPattern.test(value.source.imageDigest)
    || typeof value.source.imageTag !== "string"
    || !imageTagPattern.test(value.source.imageTag)
    || typeof value.source.migrationImageDigest !== "string"
    || !imageDigestPattern.test(value.source.migrationImageDigest)
    || typeof value.source.migrationImageTag !== "string"
    || !imageTagPattern.test(value.source.migrationImageTag)
    || !isDigest(value.source.publicBuildContractSha256)
    || !isDigest(value.source.fixtureContractSha256)
    || !isRecord(value.runtime)
    || !hasExactKeys(value.runtime, [
      "generatedEnvironmentDirectorySha256", "launchReceiptSha256", "projectSha256",
      "runtimeAttestationSha256",
    ])
    || Object.values(value.runtime).some((entry) => !isDigest(entry))
  ) {
    throw new Error("Journey live-pair stack binding is invalid.");
  }
}

function isDirectoryIdentity(value: unknown): value is DirectoryIdentity {
  return isRecord(value)
    && hasExactKeys(value, ["device", "inode", "path"])
    && typeof value.path === "string"
    && (value.path === "." || value.path.startsWith("artifacts"))
    && typeof value.device === "string"
    && /^\d+$/.test(value.device)
    && typeof value.inode === "string"
    && /^\d+$/.test(value.inode);
}

function parseRecord(bytes: Uint8Array, label: string) {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new Error(`Journey live-pair ${label} is not valid JSON.`);
  }
  if (!isRecord(value)) throw new Error(`Journey live-pair ${label} is not an object.`);
  return value;
}

function exactEnvironment(value: unknown, pattern: RegExp, label: string) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`Journey live-pair ${label} is invalid.`);
  }
  return value;
}

function assertCaptureId(value: string) {
  if (!captureIdPattern.test(value)) {
    throw new Error("Journey live-pair capture ID is invalid.");
  }
}

function assertWithin(parent: string, child: string, label: string) {
  const relative = path.relative(parent, child);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Journey live-pair ${label} escaped its fixed test-results root.`);
  }
}

function directoryPathOrder(left: string, right: string) {
  const depth = left.split("/").length - right.split("/").length;
  return depth || left.localeCompare(right);
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && digestPattern.test(value);
}

function isPng(value: Uint8Array) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return value.byteLength > signature.byteLength
    && Buffer.from(value.subarray(0, signature.byteLength)).equals(signature);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  return canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value);
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
