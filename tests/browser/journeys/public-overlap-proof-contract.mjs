import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export const PUBLIC_OVERLAP_PROOF_KIND =
  "clean-pay-live-public-characterization-overlap-proof";
export const PUBLIC_OVERLAP_PROOF_SCHEMA_VERSION = 1;

const captureIdPattern = /^[a-f0-9]{16}$/;
const digestPattern = /^[a-f0-9]{64}$/;

export function createPublicOverlapStackBinding({ role, inputReceipt, runtime, launch }) {
  exactKeys(arguments[0], ["inputReceipt", "launch", "role", "runtime"]);
  if (role !== "baseline" && role !== "candidate") fail("Public overlap role is invalid.");
  for (const [label, value] of Object.entries({ inputReceipt, runtime, launch })) {
    if (!isRecord(value)) fail(`Public overlap ${label} binding source is invalid.`);
  }
  return sha256(Buffer.from(`${JSON.stringify({
    schemaVersion: 1,
    kind: "clean-pay-public-overlap-owned-stack-binding",
    role,
    inputReceipt,
    runtime,
    launch,
  })}\n`, "utf8"));
}

export function resolvePublicOverlapPairRoot(repositoryRoot, captureId) {
  if (!path.isAbsolute(repositoryRoot) || !captureIdPattern.test(captureId)) {
    fail("Public overlap proof root input is invalid.");
  }
  const parent = path.resolve(repositoryRoot, "test-results", "browser-public-overlap");
  const target = path.resolve(parent, captureId);
  assertWithin(parent, target, "pair root");
  return target;
}

export function resolvePublicOverlapProofPath(repositoryRoot, captureId) {
  return path.join(resolvePublicOverlapPairRoot(repositoryRoot, captureId), "proof.json");
}

export async function readPublicOverlapOwnership(options) {
  exactKeys(options, [
    "baselineBindingSha256",
    "candidateBindingSha256",
    "captureId",
    "repositoryRoot",
  ]);
  const root = resolvePublicOverlapPairRoot(options.repositoryRoot, options.captureId);
  const pairBytes = await readBoundedRegularFile(
    path.join(root, "pair-ownership.json"),
    64 * 1024,
  );
  const pair = parseJson(pairBytes, "public overlap pair ownership");
  exactKeys(pair, [
    "captureId",
    "kind",
    "pairDirectory",
    "roles",
    "schemaVersion",
    "suite",
  ]);
  equal(pair.schemaVersion, 1, "pair ownership schemaVersion");
  equal(pair.kind, "clean-pay-ephemeral-browser-pair-ownership", "pair ownership kind");
  equal(pair.suite, "public-characterization-v1", "pair ownership suite");
  equal(pair.captureId, options.captureId, "pair ownership captureId");
  assertDirectoryIdentity(pair.pairDirectory, ".", "pair ownership directory");
  await assertCurrentDirectoryIdentity(root, pair.pairDirectory);
  if (!Array.isArray(pair.roles) || pair.roles.length !== 2) {
    fail("Public overlap pair ownership roles are invalid.");
  }
  const roles = {};
  for (const [index, role] of ["baseline", "candidate"].entries()) {
    const ledger = record(pair.roles[index], `${role} pair ownership ledger`);
    exactKeys(ledger, ["ownershipSha256", "role"]);
    equal(ledger.role, role, `${role} pair ownership role`);
    digest(ledger.ownershipSha256, `${role} pair ownership digest`);
    const roleRoot = path.join(root, role);
    const roleBytes = await readBoundedRegularFile(
      path.join(roleRoot, "capture-ownership.json"),
      512 * 1024,
    );
    equal(sha256(roleBytes), ledger.ownershipSha256, `${role} ownership file digest`);
    const receipt = parseJson(roleBytes, `${role} ownership receipt`);
    exactKeys(receipt, [
      "bindingSha256",
      "captureId",
      "directories",
      "kind",
      "role",
      "schemaVersion",
      "suite",
    ]);
    equal(receipt.schemaVersion, 1, `${role} ownership schemaVersion`);
    equal(
      receipt.kind,
      "clean-pay-ephemeral-browser-capture-ownership",
      `${role} ownership kind`,
    );
    equal(receipt.suite, "public-characterization-v1", `${role} ownership suite`);
    equal(receipt.captureId, options.captureId, `${role} ownership captureId`);
    equal(receipt.role, role, `${role} ownership role`);
    equal(
      receipt.bindingSha256,
      options[`${role}BindingSha256`],
      `${role} owned-stack binding digest`,
    );
    if (!Array.isArray(receipt.directories) || receipt.directories.length !== 46) {
      fail(`${role} ownership directory ledger is invalid.`);
    }
    const paths = receipt.directories.map((identity, directoryIndex) => {
      const relativePath = assertDirectoryIdentity(
        identity,
        undefined,
        `${role} ownership directory ${directoryIndex}`,
      );
      const target = relativePath === "."
        ? roleRoot
        : path.join(roleRoot, ...relativePath.split("/"));
      return assertCurrentDirectoryIdentity(target, identity).then(() => relativePath);
    });
    const resolvedPaths = await Promise.all(paths);
    if (new Set(resolvedPaths).size !== resolvedPaths.length
      || resolvedPaths[0] !== "." || resolvedPaths[1] !== "artifacts") {
      fail(`${role} ownership directory ledger is not exact.`);
    }
    roles[role] = Object.freeze({
      bindingSha256: receipt.bindingSha256,
      ownershipSha256: ledger.ownershipSha256,
    });
  }
  return Object.freeze({
    pairOwnershipSha256: sha256(pairBytes),
    roles: Object.freeze(roles),
    root,
  });
}

export function assertPublicOverlapPairReceipt(value, expected) {
  exactKeys(expected, [
    "baselineBindingSha256",
    "baselineOrigin",
    "baselineOwnershipSha256",
    "candidateBindingSha256",
    "candidateOrigin",
    "candidateOwnershipSha256",
    "captureId",
  ]);
  const receipt = record(value, "public overlap pair receipt");
  exactKeys(receipt, [
    "artifactCountPerSide",
    "baseline",
    "candidate",
    "captureId",
    "caseCount",
    "comparisonSha256",
    "kind",
    "schemaVersion",
    "status",
    "suite",
  ]);
  equal(receipt.schemaVersion, 1, "public overlap pair receipt schemaVersion");
  equal(receipt.kind, "clean-pay-public-characterization-overlap-proof", "pair receipt kind");
  equal(receipt.suite, "public-characterization-v1", "pair receipt suite");
  equal(receipt.captureId, expected.captureId, "pair receipt captureId");
  equal(
    receipt.status,
    "baseline-candidate-public-characterization-equal",
    "pair receipt status",
  );
  equal(receipt.caseCount, 42, "pair receipt case count");
  equal(receipt.artifactCountPerSide, 126, "pair receipt artifact count");
  digest(receipt.comparisonSha256, "pair comparison digest");
  for (const role of ["baseline", "candidate"]) {
    const side = record(receipt[role], `${role} pair receipt`);
    exactKeys(side, [
      "applicationOrigin",
      "bindingSha256",
      "inventorySha256",
      "ownershipSha256",
      "receiptSha256",
    ]);
    equal(side.applicationOrigin, expected[`${role}Origin`], `${role} pair origin`);
    assertLoopbackOrigin(side.applicationOrigin, `${role} pair origin`);
    equal(
      side.bindingSha256,
      expected[`${role}BindingSha256`],
      `${role} pair binding digest`,
    );
    equal(
      side.ownershipSha256,
      expected[`${role}OwnershipSha256`],
      `${role} pair ownership digest`,
    );
    digest(side.inventorySha256, `${role} pair inventory digest`);
    digest(side.receiptSha256, `${role} pair receipt digest`);
  }
  if (receipt.baseline.applicationOrigin === receipt.candidate.applicationOrigin) {
    fail("Public overlap pair origins must be distinct.");
  }
  return receipt;
}

export async function readPublicOverlapPairReceipt(options) {
  exactKeys(options, ["expected", "repositoryRoot"]);
  const root = resolvePublicOverlapPairRoot(
    options.repositoryRoot,
    options.expected.captureId,
  );
  const bytes = await readBoundedRegularFile(path.join(root, "pair-receipt.json"), 512 * 1024);
  const receipt = assertPublicOverlapPairReceipt(
    parseJson(bytes, "public overlap pair receipt"),
    options.expected,
  );
  return Object.freeze({ bytes, receipt, sha256: sha256(bytes) });
}

export function createPublicOverlapProof(options) {
  exactKeys(options, [
    "baselineBindingSha256",
    "candidateBindingSha256",
    "captureId",
    "cleanup",
    "launch",
    "pairReceiptSha256",
  ]);
  const cleanup = record(options.cleanup, "public overlap cleanup receipt");
  const launch = record(options.launch, "public overlap launch receipt");
  return Object.freeze({
    schemaVersion: PUBLIC_OVERLAP_PROOF_SCHEMA_VERSION,
    kind: PUBLIC_OVERLAP_PROOF_KIND,
    captureId: stringMatch(options.captureId, captureIdPattern, "proof captureId"),
    status: "live-public-characterization-overlap-proven-after-exact-cleanup",
    caseCount: 42,
    artifactCountPerSide: 126,
    baselineBindingSha256: digest(
      options.baselineBindingSha256,
      "proof baseline binding digest",
    ),
    candidateBindingSha256: digest(
      options.candidateBindingSha256,
      "proof candidate binding digest",
    ),
    pairReceiptSha256: digest(options.pairReceiptSha256, "proof pair receipt digest"),
    launchReceiptSha256: sha256(Buffer.from(`${JSON.stringify(launch)}\n`, "utf8")),
    cleanupReceiptSha256: sha256(Buffer.from(`${JSON.stringify(cleanup)}\n`, "utf8")),
  });
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readBoundedRegularFile(target, maximumBytes) {
  const details = await lstat(target, { bigint: true });
  if (!details.isFile() || details.isSymbolicLink()
    || details.size < 1n || details.size > BigInt(maximumBytes)) {
    fail("Public overlap evidence is not a bounded regular file.");
  }
  if (await realpath(path.dirname(target)) !== path.resolve(path.dirname(target))) {
    fail("Public overlap evidence parent resolved through an unexpected path.");
  }
  const bytes = await readFile(target);
  if (BigInt(bytes.byteLength) !== details.size) {
    fail("Public overlap evidence changed while being read.");
  }
  return bytes;
}

async function assertCurrentDirectoryIdentity(target, expected) {
  const details = await lstat(target, { bigint: true });
  if (!details.isDirectory() || details.isSymbolicLink()
    || details.dev.toString(10) !== expected.device
    || details.ino.toString(10) !== expected.inode
    || await realpath(target) !== path.resolve(target)) {
    fail("Public overlap verifier-owned directory identity changed.");
  }
}

function assertDirectoryIdentity(value, expectedPath, label) {
  const identity = record(value, label);
  exactKeys(identity, ["device", "inode", "path"]);
  if ((expectedPath !== undefined && identity.path !== expectedPath)
    || (identity.path !== "." && !/^artifacts(?:\/[a-z0-9][a-z0-9.-]{0,79})*$/.test(identity.path))
    || typeof identity.device !== "string" || !/^\d+$/.test(identity.device)
    || typeof identity.inode !== "string" || !/^\d+$/.test(identity.inode)) {
    fail(`${label} is invalid.`);
  }
  return identity.path;
}

function assertLoopbackOrigin(value, label) {
  stringMatch(value, /^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/, label);
  const parsed = new URL(value);
  if (parsed.origin !== value || Number(parsed.port) > 65_535 || parsed.pathname !== "/") {
    fail(`${label} is invalid.`);
  }
}

function parseJson(bytes, label) {
  try {
    return record(JSON.parse(bytes.toString("utf8")), label);
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function digest(value, label) {
  return stringMatch(value, digestPattern, label);
}

function record(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object.`);
  return value;
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(record(value, "contract value")).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    fail("Public overlap contract shape is invalid.");
  }
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} is invalid.`);
}

function stringMatch(value, pattern, label) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function assertWithin(parent, child, label) {
  const relative = path.relative(parent, child);
  if (!relative || path.isAbsolute(relative)
    || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    fail(`Public overlap ${label} escaped its fixed output root.`);
  }
}

function fail(message) {
  throw new Error(message);
}
