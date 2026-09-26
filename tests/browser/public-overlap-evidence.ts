import { createHash } from "node:crypto";
import { constants as fsConstants, type BigIntStats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import path from "node:path";

import {
  PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS as runtimeOwnershipDirectoryPaths,
  derivePublicOverlapOwnershipDirectoryPaths,
} from "./public-overlap-directory-policy.mjs";

export const PUBLIC_OVERLAP_SUITE = "public-characterization-v1";
export const PUBLIC_OVERLAP_PROJECTS = Object.freeze([
  "chromium-390x844",
  "chromium-768x1024",
  "chromium-1440x900",
] as const);
export const PUBLIC_OVERLAP_ROUTES = Object.freeze([
  {
    id: "login",
    requestPath: "/login?redirect_to=%2Ftariffs%3Fsource%3Dcharacterization#auth-entry",
    kind: "public",
  },
  {
    id: "register",
    requestPath: "/register?redirect_to=%2Ftariffs%3Fsource%3Dcharacterization#registration-entry",
    kind: "public",
  },
  {
    id: "tariffs",
    requestPath: "/tariffs?source=characterization#plans",
    kind: "public",
  },
  {
    id: "support",
    requestPath: "/support?source=characterization#support",
    kind: "public",
  },
  {
    id: "install",
    requestPath: "/install?source=characterization#install",
    kind: "public",
  },
  {
    id: "offline",
    requestPath: "/offline?source=characterization#offline",
    kind: "public",
  },
  {
    id: "protected-cabinet",
    requestPath: "/cabinet?view=subscriptions#active",
    kind: "protected-redirect",
  },
  {
    id: "protected-profile",
    requestPath: "/profile?panel=security#passkeys",
    kind: "protected-redirect",
  },
  {
    id: "protected-referral",
    requestPath: "/referral?source=characterization#program",
    kind: "protected-redirect",
  },
  {
    id: "protected-extend",
    requestPath: "/extend?subscription_id=00000000-0000-4000-8000-000000000001#offer",
    kind: "protected-redirect",
  },
  {
    id: "protected-link-account",
    requestPath: "/link-account?provider=telegram#confirm",
    kind: "protected-redirect",
  },
  {
    id: "protected-verify-email",
    requestPath: "/verify-email?redirect_to=%2Fcabinet#status",
    kind: "protected-redirect",
  },
  {
    id: "protected-passkey-setup",
    requestPath: "/passkey/setup?redirect_to=%2Fcabinet#setup",
    kind: "protected-redirect",
  },
  {
    id: "protected-payment",
    requestPath: "/payment?payment_id=00000000-0000-4000-8000-000000000002#status",
    kind: "protected-redirect",
  },
] as const);
export const PUBLIC_OVERLAP_ARTIFACT_NAMES = Object.freeze([
  "characterization.json",
  "console.json",
  "viewport.png",
] as const);
const PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS =
  runtimeOwnershipDirectoryPaths as readonly string[];

export type PublicOverlapRole = "baseline" | "candidate";
export type PublicOverlapRoute = (typeof PUBLIC_OVERLAP_ROUTES)[number];
export type ExactEphemeralCapturePolicy = Readonly<{
  artifactPaths: readonly string[];
  caseCount: number;
  maximumArtifactBytes: number;
  suite: string;
}>;

export type ExactCaptureReceipt = Readonly<{
  schemaVersion: 1;
  kind: "clean-pay-ephemeral-browser-capture";
  suite: string;
  captureId: string;
  role: PublicOverlapRole;
  applicationOrigin: string;
  caseCount: number;
  artifactCount: number;
  bindingSha256: string;
  inventorySha256: string;
  inventory: ReadonlyArray<Readonly<{
    path: string;
    bytes: number;
    sha256: string;
  }>>;
}>;

export type PreparedCaptureOwnership = Readonly<{
  root: string;
  receipt: Readonly<{
    schemaVersion: 1;
    kind: "clean-pay-ephemeral-browser-capture-ownership";
    suite: string;
    captureId: string;
    role: PublicOverlapRole;
    bindingSha256: string;
    directories: ReadonlyArray<Readonly<{
      path: string;
      device: string;
      inode: string;
    }>>;
  }>;
  receiptBytes: Buffer;
  receiptSha256: string;
}>;

const captureIdPattern = /^[a-f0-9]{16}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const safeSegmentPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
export const publicOverlapOutputRoot = path.resolve(
  process.cwd(),
  "test-results",
  "browser-public-overlap",
);

export const PUBLIC_OVERLAP_CAPTURE_POLICY = createExactEphemeralCapturePolicy({
  artifactPaths: PUBLIC_OVERLAP_PROJECTS.flatMap((project) => (
    PUBLIC_OVERLAP_ROUTES.flatMap((route) => (
      PUBLIC_OVERLAP_ARTIFACT_NAMES.map((artifact) => `${project}/${route.id}/${artifact}`)
    ))
  )),
  caseCount: PUBLIC_OVERLAP_PROJECTS.length * PUBLIC_OVERLAP_ROUTES.length,
  maximumArtifactBytes: 4 * 1024 * 1024,
  suite: PUBLIC_OVERLAP_SUITE,
});
if (JSON.stringify(derivePublicOverlapOwnershipDirectoryPaths(
  PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths,
)) !== JSON.stringify(PUBLIC_OVERLAP_OWNERSHIP_DIRECTORY_PATHS)) {
  throw new Error("Public overlap ownership policy differs from its canonical directory ledger.");
}

export function createExactEphemeralCapturePolicy(input: {
  artifactPaths: readonly string[];
  caseCount: number;
  maximumArtifactBytes: number;
  suite: string;
}): ExactEphemeralCapturePolicy {
  if (
    !safeSegmentPattern.test(input.suite)
    || !Number.isSafeInteger(input.caseCount)
    || input.caseCount < 1
    || !Number.isSafeInteger(input.maximumArtifactBytes)
    || input.maximumArtifactBytes < 1
    || input.maximumArtifactBytes > 32 * 1024 * 1024
    || !Array.isArray(input.artifactPaths)
    || input.artifactPaths.length < input.caseCount
  ) {
    throw new Error("Ephemeral browser capture policy is invalid.");
  }
  const artifactPaths = [...input.artifactPaths].sort();
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw new Error("Ephemeral browser capture artifact paths must be unique.");
  }
  for (const artifactPath of artifactPaths) assertSafeRelativeArtifactPath(artifactPath);
  derivePublicOverlapOwnershipDirectoryPaths(artifactPaths);
  return Object.freeze({
    artifactPaths: Object.freeze(artifactPaths),
    caseCount: input.caseCount,
    maximumArtifactBytes: input.maximumArtifactBytes,
    suite: input.suite,
  });
}

export function requirePublicOverlapEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const captureId = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID,
    captureIdPattern,
    "capture ID",
  );
  const role = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_ROLE,
    /^(?:baseline|candidate)$/,
    "role",
  ) as PublicOverlapRole;
  const applicationOrigin = assertExactLoopbackApplicationOrigin(
    environment.CLEAN_PAY_BROWSER_BASE_URL,
    "application origin",
  );
  const bindingSha256 = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_BINDING_SHA256,
    digestPattern,
    "stack binding digest",
  );
  const ownershipSha256 = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_OWNERSHIP_SHA256,
    digestPattern,
    "ownership digest",
  );
  return Object.freeze({
    applicationOrigin,
    bindingSha256,
    captureId,
    ownershipSha256,
    role,
    root: resolveExactCaptureRoot(captureId, role),
  });
}

export function requirePublicOverlapPairEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const captureId = exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_CAPTURE_ID,
    captureIdPattern,
    "capture ID",
  );
  exactEnvironmentValue(
    environment.CLEAN_PAY_PUBLIC_OVERLAP_ROLE,
    /^pair$/,
    "paired capture role",
  );
  const roles = Object.freeze({
    baseline: pairedRoleEnvironment(environment, captureId, "baseline"),
    candidate: pairedRoleEnvironment(environment, captureId, "candidate"),
  });
  if (
    roles.baseline.applicationOrigin === roles.candidate.applicationOrigin
    || roles.baseline.bindingSha256 === roles.candidate.bindingSha256
    || roles.baseline.ownershipSha256 === roles.candidate.ownershipSha256
    || roles.baseline.root === roles.candidate.root
  ) {
    throw new Error("Public overlap paired capture roles must be distinct.");
  }
  return Object.freeze({ captureId, role: "pair" as const, roles });
}

function pairedRoleEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  captureId: string,
  role: PublicOverlapRole,
) {
  const prefix = role === "baseline" ? "BASELINE" : "CANDIDATE";
  const applicationOrigin = assertExactLoopbackApplicationOrigin(
    environment[`CLEAN_PAY_PUBLIC_OVERLAP_${prefix}_ORIGIN`],
    `${role} application origin`,
  );
  const bindingSha256 = exactEnvironmentValue(
    environment[`CLEAN_PAY_PUBLIC_OVERLAP_${prefix}_BINDING_SHA256`],
    digestPattern,
    `${role} stack binding digest`,
  );
  const ownershipSha256 = exactEnvironmentValue(
    environment[`CLEAN_PAY_PUBLIC_OVERLAP_${prefix}_OWNERSHIP_SHA256`],
    digestPattern,
    `${role} ownership digest`,
  );
  return Object.freeze({
    applicationOrigin,
    bindingSha256,
    captureId,
    ownershipSha256,
    role,
    root: resolveExactCaptureRoot(captureId, role),
  });
}

export async function prepareExactCapturePair(options: {
  baselineBindingSha256: string;
  candidateBindingSha256: string;
  captureId: string;
  policy?: ExactEphemeralCapturePolicy;
}) {
  const policy = options.policy ?? PUBLIC_OVERLAP_CAPTURE_POLICY;
  if (!captureIdPattern.test(options.captureId)) {
    throw new Error("Public overlap capture identity is invalid.");
  }
  const bindings = {
    baseline: exactDigest(options.baselineBindingSha256, "baseline binding digest"),
    candidate: exactDigest(options.candidateBindingSha256, "candidate binding digest"),
  } as const;
  if (bindings.baseline === bindings.candidate) {
    throw new Error("Public overlap stack binding digests must be distinct.");
  }
  await ensureFixedOutputAncestors();
  const pairRoot = resolveExactPairRoot(options.captureId);
  let pairIdentity: Awaited<ReturnType<typeof exactDirectoryIdentity>> | undefined;
  try {
    await mkdir(pairRoot, { mode: 0o700, recursive: false });
    pairIdentity = await exactDirectoryIdentity(pairRoot, ".");
    const roles: PreparedCaptureOwnership[] = [];
    for (const role of ["baseline", "candidate"] as const) {
      roles.push(await prepareRoleOwnership({
        bindingSha256: bindings[role],
        captureId: options.captureId,
        pairRoot,
        policy,
        role,
      }));
    }
    const pairReceipt = Object.freeze({
      schemaVersion: 1,
      kind: "clean-pay-ephemeral-browser-pair-ownership",
      suite: policy.suite,
      captureId: options.captureId,
      pairDirectory: pairIdentity,
      roles: Object.freeze(roles.map((role) => Object.freeze({
        role: role.receipt.role,
        ownershipSha256: role.receiptSha256,
      }))),
    });
    const pairReceiptBytes = Buffer.from(`${JSON.stringify(pairReceipt, null, 2)}\n`, "utf8");
    await writeCreateOnlyFile(path.join(pairRoot, "pair-ownership.json"), pairReceiptBytes);
    return Object.freeze({
      pairReceipt,
      pairReceiptBytes,
      pairReceiptSha256: sha256(pairReceiptBytes),
      roles: Object.freeze({ baseline: roles[0], candidate: roles[1] }),
      root: pairRoot,
    });
  } catch (error) {
    if (pairIdentity === undefined) throw error;
    try {
      await assertExactDirectoryIdentity(pairRoot, pairIdentity);
      await rm(pairRoot, { force: false, recursive: true });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Public overlap ownership preparation and exact cleanup both failed.",
      );
    }
    throw error;
  }
}

export async function readPreparedCaptureOwnership(options: {
  bindingSha256: string;
  captureId: string;
  ownershipSha256: string;
  policy?: ExactEphemeralCapturePolicy;
  role: PublicOverlapRole;
}) {
  const policy = options.policy ?? PUBLIC_OVERLAP_CAPTURE_POLICY;
  const root = resolveExactCaptureRoot(options.captureId, options.role);
  const receiptBytes = await readBoundedRegularFile(
    path.join(root, "capture-ownership.json"),
    512 * 1024,
  );
  const receiptSha256 = sha256(receiptBytes);
  if (receiptSha256 !== exactDigest(options.ownershipSha256, "expected ownership digest")) {
    throw new Error("Public overlap ownership receipt digest is invalid.");
  }
  let value: unknown;
  try {
    value = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("Public overlap ownership receipt is not valid JSON.");
  }
  const receipt = assertExactOwnershipReceipt(value, {
    bindingSha256: options.bindingSha256,
    captureId: options.captureId,
    policy,
    role: options.role,
  });
  const pairReceiptBytes = await readBoundedRegularFile(
    path.join(resolveExactPairRoot(options.captureId), "pair-ownership.json"),
    64 * 1024,
  );
  let pairValue: unknown;
  try {
    pairValue = JSON.parse(pairReceiptBytes.toString("utf8"));
  } catch {
    throw new Error("Public overlap pair ownership receipt is not valid JSON.");
  }
  if (
    !isRecord(pairValue)
    || pairValue.schemaVersion !== 1
    || pairValue.kind !== "clean-pay-ephemeral-browser-pair-ownership"
    || pairValue.suite !== policy.suite
    || pairValue.captureId !== options.captureId
    || !isDirectoryIdentity(pairValue.pairDirectory)
    || !Array.isArray(pairValue.roles)
    || pairValue.roles.length !== 2
    || !pairValue.roles.some((entry) => (
      isRecord(entry)
      && entry.role === options.role
      && entry.ownershipSha256 === receiptSha256
    ))
  ) {
    throw new Error("Public overlap role ownership is not bound to its pair receipt.");
  }
  for (const [index, role] of (["baseline", "candidate"] as const).entries()) {
    const ledger = pairValue.roles[index];
    if (
      !isRecord(ledger)
      || JSON.stringify(Object.keys(ledger).sort()) !== JSON.stringify([
        "ownershipSha256", "role",
      ])
      || ledger.role !== role
      || typeof ledger.ownershipSha256 !== "string"
      || !digestPattern.test(ledger.ownershipSha256)
    ) {
      throw new Error("Public overlap pair ownership role ledger is invalid.");
    }
  }
  await assertExactDirectoryIdentity(
    resolveExactPairRoot(options.captureId),
    pairValue.pairDirectory,
  );
  await assertOwnershipDirectories(root, receipt.directories);
  return Object.freeze({ root, receipt, receiptBytes, receiptSha256 });
}

export async function cleanupPreparedCapturePair(options: {
  captureId: string;
  pairReceiptSha256: string;
  policy?: ExactEphemeralCapturePolicy;
}) {
  const policy = options.policy ?? PUBLIC_OVERLAP_CAPTURE_POLICY;
  const root = resolveExactPairRoot(options.captureId);
  const receiptBytes = await readBoundedRegularFile(
    path.join(root, "pair-ownership.json"),
    64 * 1024,
  );
  if (sha256(receiptBytes) !== exactDigest(options.pairReceiptSha256, "pair ownership digest")) {
    throw new Error("Public overlap pair ownership receipt digest is invalid.");
  }
  let value: unknown;
  try {
    value = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("Public overlap pair ownership receipt is not valid JSON.");
  }
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.kind !== "clean-pay-ephemeral-browser-pair-ownership"
    || value.suite !== policy.suite
    || value.captureId !== options.captureId
    || !isDirectoryIdentity(value.pairDirectory)
    || !Array.isArray(value.roles)
    || value.roles.length !== 2
  ) {
    throw new Error("Public overlap pair ownership receipt shape is invalid.");
  }
  for (const [index, role] of (["baseline", "candidate"] as const).entries()) {
    const ledger = value.roles[index];
    if (
      !isRecord(ledger)
      || JSON.stringify(Object.keys(ledger).sort()) !== JSON.stringify([
        "ownershipSha256", "role",
      ])
      || ledger.role !== role
      || typeof ledger.ownershipSha256 !== "string"
      || !digestPattern.test(ledger.ownershipSha256)
    ) {
      throw new Error("Public overlap pair ownership role ledger is invalid.");
    }
    const roleReceiptBytes = await readBoundedRegularFile(
      path.join(root, role, "capture-ownership.json"),
      512 * 1024,
    );
    if (sha256(roleReceiptBytes) !== ledger.ownershipSha256) {
      throw new Error("Public overlap cleanup role ownership digest is invalid.");
    }
    let roleReceipt: unknown;
    try {
      roleReceipt = JSON.parse(roleReceiptBytes.toString("utf8"));
    } catch {
      throw new Error("Public overlap cleanup role ownership is not valid JSON.");
    }
    if (!isRecord(roleReceipt) || typeof roleReceipt.bindingSha256 !== "string") {
      throw new Error("Public overlap cleanup role ownership shape is invalid.");
    }
    await readPreparedCaptureOwnership({
      bindingSha256: roleReceipt.bindingSha256,
      captureId: options.captureId,
      ownershipSha256: ledger.ownershipSha256,
      policy,
      role,
    });
  }
  await assertExactOwnedPairFiles(root, policy);
  await assertExactDirectoryIdentity(root, value.pairDirectory);
  await rm(root, { force: false, recursive: true });
}

export function assertExactLoopbackApplicationOrigin(value: unknown, label: string) {
  if (typeof value !== "string" || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value)) {
    throw new Error(`Public overlap ${label} is not an exact loopback HTTP origin.`);
  }
  const parsed = new URL(value);
  if (
    parsed.origin !== value
    || parsed.hostname !== "127.0.0.1"
    || Number(parsed.port) > 65_535
    || parsed.pathname !== "/"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
  ) {
    throw new Error(`Public overlap ${label} is not an exact loopback HTTP origin.`);
  }
  return value;
}

export function resolveExactCaptureRoot(captureId: string, role: PublicOverlapRole) {
  if (!captureIdPattern.test(captureId) || !/^(?:baseline|candidate)$/.test(role)) {
    throw new Error("Public overlap capture identity is invalid.");
  }
  const target = path.resolve(publicOverlapOutputRoot, captureId, role);
  assertWithin(publicOverlapOutputRoot, target, "capture root");
  return target;
}

export function resolveExactPairRoot(captureId: string) {
  if (!captureIdPattern.test(captureId)) {
    throw new Error("Public overlap capture identity is invalid.");
  }
  const target = path.resolve(publicOverlapOutputRoot, captureId);
  assertWithin(publicOverlapOutputRoot, target, "pair root");
  return target;
}

export async function writeImmutableCaptureArtifact(options: {
  bytes: Uint8Array;
  ownership: PreparedCaptureOwnership;
  policy?: ExactEphemeralCapturePolicy;
  relativePath: string;
  root: string;
}) {
  const { bytes, ownership, relativePath, root } = options;
  const policy = options.policy ?? PUBLIC_OVERLAP_CAPTURE_POLICY;
  assertSafeRelativeArtifactPath(relativePath);
  if (!policy.artifactPaths.includes(relativePath)) {
    throw new Error("Public overlap artifact is outside the exact inventory.");
  }
  if (bytes.byteLength < 1 || bytes.byteLength > policy.maximumArtifactBytes) {
    throw new Error("Public overlap artifact size is outside the bounded contract.");
  }
  if (
    ownership.root !== root
    || ownership.receipt.suite !== policy.suite
    || sha256(ownership.receiptBytes) !== ownership.receiptSha256
  ) {
    throw new Error("Public overlap artifact writer ownership is invalid.");
  }
  const target = path.resolve(root, "artifacts", relativePath);
  assertWithin(path.resolve(root, "artifacts"), target, "artifact");
  await assertOwnershipDirectories(root, ownership.receipt.directories);
  const targetParentRelative = path.relative(root, path.dirname(target)).split(path.sep).join("/");
  if (!ownership.receipt.directories.some((entry) => entry.path === targetParentRelative)) {
    throw new Error("Public overlap artifact parent is outside verifier-owned directories.");
  }
  const handle = await open(target, "wx", 0o600);
  let primaryFailure: unknown;
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    primaryFailure = error;
  }
  try {
    await handle.close();
  } catch (error) {
    if (primaryFailure !== undefined) {
      throw new AggregateError(
        [primaryFailure, error],
        "Immutable public overlap artifact write and close both failed.",
      );
    }
    throw error;
  }
  if (primaryFailure !== undefined) throw primaryFailure;
  await assertOwnershipDirectories(root, ownership.receipt.directories);
  const written = await readBoundedRegularFile(target, policy.maximumArtifactBytes);
  if (written.byteLength !== bytes.byteLength || sha256(written) !== sha256(bytes)) {
    throw new Error("Public overlap artifact changed during its create-only write.");
  }
}

export async function sealExactCapture(options: {
  applicationOrigin: string;
  bindingSha256: string;
  captureId: string;
  ownershipSha256: string;
  policy?: ExactEphemeralCapturePolicy;
  role: PublicOverlapRole;
}) {
  const policy = options.policy ?? PUBLIC_OVERLAP_CAPTURE_POLICY;
  const ownership = await readPreparedCaptureOwnership({
    bindingSha256: options.bindingSha256,
    captureId: options.captureId,
    ownershipSha256: options.ownershipSha256,
    policy,
    role: options.role,
  });
  const root = ownership.root;
  const inventory = await readExactArtifactInventory(root, policy);
  const inventoryBytes = Buffer.from(`${JSON.stringify(inventory)}\n`, "utf8");
  const receipt: ExactCaptureReceipt = Object.freeze({
    schemaVersion: 1,
    kind: "clean-pay-ephemeral-browser-capture",
    suite: policy.suite,
    captureId: options.captureId,
    role: options.role,
    applicationOrigin: assertExactLoopbackApplicationOrigin(
      options.applicationOrigin,
      "receipt application origin",
    ),
    caseCount: policy.caseCount,
    artifactCount: inventory.length,
    bindingSha256: exactDigest(options.bindingSha256, "receipt binding digest"),
    inventorySha256: sha256(inventoryBytes),
    inventory: Object.freeze(inventory),
  });
  const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeCreateOnlyFile(path.join(root, "capture-receipt.json"), bytes);
  await assertOwnershipDirectories(root, ownership.receipt.directories);
  return Object.freeze({ bytes, receipt });
}

export async function readAndValidateExactCapture(options: {
  bindingSha256: string;
  captureId: string;
  ownershipSha256: string;
  policy?: ExactEphemeralCapturePolicy;
  role: PublicOverlapRole;
}) {
  const policy = options.policy ?? PUBLIC_OVERLAP_CAPTURE_POLICY;
  const ownership = await readPreparedCaptureOwnership({
    bindingSha256: options.bindingSha256,
    captureId: options.captureId,
    ownershipSha256: options.ownershipSha256,
    policy,
    role: options.role,
  });
  const root = ownership.root;
  const receiptPath = path.join(root, "capture-receipt.json");
  const receiptBytes = await readBoundedRegularFile(receiptPath, 512 * 1024);
  let parsed: unknown;
  try {
    parsed = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    throw new Error("Public overlap capture receipt is not valid JSON.");
  }
  const receipt = assertExactCaptureReceipt(parsed, policy, options);
  const currentInventory = await readExactArtifactInventory(root, policy);
  if (JSON.stringify(currentInventory) !== JSON.stringify(receipt.inventory)) {
    throw new Error("Public overlap capture inventory changed after sealing.");
  }
  const inventorySha256 = sha256(Buffer.from(`${JSON.stringify(currentInventory)}\n`, "utf8"));
  if (inventorySha256 !== receipt.inventorySha256) {
    throw new Error("Public overlap capture inventory digest is invalid.");
  }
  await assertOwnershipDirectories(root, ownership.receipt.directories);
  return Object.freeze({ ownership, receipt, receiptBytes, root });
}

export async function readExactCaptureArtifact(
  root: string,
  relativePath: string,
  maximumBytes = PUBLIC_OVERLAP_CAPTURE_POLICY.maximumArtifactBytes,
) {
  assertSafeRelativeArtifactPath(relativePath);
  const target = path.resolve(root, "artifacts", relativePath);
  assertWithin(path.resolve(root, "artifacts"), target, "artifact read");
  return readBoundedRegularFile(target, maximumBytes);
}

export async function readExactPairEvidenceFile(
  captureId: string,
  name: "pair-receipt.json" | "proof.json",
  maximumBytes = 512 * 1024,
) {
  const root = resolveExactPairRoot(captureId);
  await assertRegularExactDirectory(root, "pair evidence root");
  return readBoundedRegularFile(path.join(root, name), maximumBytes);
}

export async function writeCreateOnlyFile(target: string, bytes: Uint8Array) {
  const parent = path.dirname(target);
  const parentDetails = await lstat(parent);
  if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink()) {
    throw new Error("Create-only evidence parent is not a regular directory.");
  }
  if (await realpath(parent) !== path.resolve(parent)) {
    throw new Error("Create-only evidence parent resolved through an unexpected path.");
  }
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
      throw new AggregateError([failure, error], "Create-only evidence write and close failed.");
    }
    throw error;
  }
  if (failure !== undefined) throw failure;
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function prepareRoleOwnership(options: {
  bindingSha256: string;
  captureId: string;
  pairRoot: string;
  policy: ExactEphemeralCapturePolicy;
  role: PublicOverlapRole;
}): Promise<PreparedCaptureOwnership> {
  const root = path.join(options.pairRoot, options.role);
  await mkdir(root, { mode: 0o700, recursive: false });
  const directoryPaths = expectedOwnershipDirectoryPaths(options.policy);
  for (const relativePath of directoryPaths.slice(1)) {
    await mkdir(path.join(root, ...relativePath.split("/")), {
      mode: 0o700,
      recursive: false,
    });
  }
  const directories = await Promise.all(directoryPaths.map((relativePath) => (
    exactDirectoryIdentity(
      relativePath === "." ? root : path.join(root, ...relativePath.split("/")),
      relativePath,
    )
  )));
  const receipt = Object.freeze({
    schemaVersion: 1 as const,
    kind: "clean-pay-ephemeral-browser-capture-ownership" as const,
    suite: options.policy.suite,
    captureId: options.captureId,
    role: options.role,
    bindingSha256: options.bindingSha256,
    directories: Object.freeze(directories),
  });
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeCreateOnlyFile(path.join(root, "capture-ownership.json"), receiptBytes);
  return Object.freeze({
    root,
    receipt,
    receiptBytes,
    receiptSha256: sha256(receiptBytes),
  });
}

async function ensureFixedOutputAncestors() {
  const repositoryRoot = path.resolve(process.cwd());
  await assertRegularExactDirectory(repositoryRoot, "repository root");
  const testResultsRoot = path.join(repositoryRoot, "test-results");
  await ensureExactDirectory(testResultsRoot, "test-results root");
  await ensureExactDirectory(publicOverlapOutputRoot, "public overlap output root");
}

async function ensureExactDirectory(target: string, label: string) {
  try {
    await mkdir(target, { mode: 0o700, recursive: false });
  } catch (error) {
    if (!isNodeError(error) || error.code !== "EEXIST") throw error;
  }
  await assertRegularExactDirectory(target, label);
}

async function assertRegularExactDirectory(target: string, label: string) {
  const details = await lstat(target);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Public overlap ${label} is not a regular directory.`);
  }
  if (await realpath(target) !== path.resolve(target)) {
    throw new Error(`Public overlap ${label} resolved through an unexpected path.`);
  }
}

function expectedOwnershipDirectoryPaths(policy: ExactEphemeralCapturePolicy) {
  return derivePublicOverlapOwnershipDirectoryPaths(policy.artifactPaths);
}

async function exactDirectoryIdentity(target: string, relativePath: string) {
  const details = await lstat(target, { bigint: true });
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Public overlap verifier-owned path is not a regular directory.");
  }
  if (await realpath(target) !== path.resolve(target)) {
    throw new Error("Public overlap verifier-owned directory changed resolution.");
  }
  return Object.freeze({
    path: relativePath,
    device: details.dev.toString(10),
    inode: details.ino.toString(10),
  });
}

async function assertExactDirectoryIdentity(
  target: string,
  expected: { path: string; device: string; inode: string },
) {
  const current = await exactDirectoryIdentity(target, expected.path);
  if (current.device !== expected.device || current.inode !== expected.inode) {
    throw new Error("Public overlap verifier-owned directory identity changed.");
  }
}

async function assertOwnershipDirectories(
  root: string,
  directories: ReadonlyArray<{ path: string; device: string; inode: string }>,
) {
  for (const identity of directories) {
    const target = identity.path === "."
      ? root
      : path.join(root, ...identity.path.split("/"));
    await assertExactDirectoryIdentity(target, identity);
  }
  const actualDirectories = await listDirectoryPathsRecursively(root);
  const expectedDirectories = directories.map(({ path: relativePath }) => relativePath);
  if (JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectories)) {
    throw new Error("Public overlap verifier-owned directory inventory changed.");
  }
}

async function assertExactOwnedPairFiles(root: string, policy: ExactEphemeralCapturePolicy) {
  const maximumFiles = policy.artifactPaths.length * 2 + 7;
  const files = await listRegularFilesRecursively(root, maximumFiles);
  const allowed = new Set([
    "pair-ownership.json",
    "pair-receipt.json",
    "baseline/capture-ownership.json",
    "baseline/capture-receipt.json",
    "candidate/capture-ownership.json",
    "candidate/capture-receipt.json",
    ...(["baseline", "candidate"] as const).flatMap((role) => (
      policy.artifactPaths.map((artifactPath) => `${role}/artifacts/${artifactPath}`)
    )),
  ]);
  if (
    !files.includes("pair-ownership.json")
    || !files.includes("baseline/capture-ownership.json")
    || !files.includes("candidate/capture-ownership.json")
    || files.some((file) => !allowed.has(file))
  ) {
    throw new Error("Public overlap cleanup file inventory is not verifier-owned.");
  }
}

async function listDirectoryPathsRecursively(root: string) {
  const result = ["."];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        throw new Error("Public overlap verifier-owned tree contains a symbolic link.");
      }
      if (!details.isDirectory()) continue;
      result.push(path.relative(root, target).split(path.sep).join("/"));
      await visit(target);
    }
  };
  await visit(root);
  return result.sort((left, right) => {
    const depth = left.split("/").length - right.split("/").length;
    return depth || left.localeCompare(right);
  });
}

function assertExactOwnershipReceipt(
  value: unknown,
  expected: {
    bindingSha256: string;
    captureId: string;
    policy: ExactEphemeralCapturePolicy;
    role: PublicOverlapRole;
  },
) {
  if (
    !isRecord(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
      "bindingSha256",
      "captureId",
      "directories",
      "kind",
      "role",
      "schemaVersion",
      "suite",
    ])
    || value.schemaVersion !== 1
    || value.kind !== "clean-pay-ephemeral-browser-capture-ownership"
    || value.suite !== expected.policy.suite
    || value.captureId !== expected.captureId
    || value.role !== expected.role
    || value.bindingSha256 !== exactDigest(expected.bindingSha256, "ownership binding digest")
    || !Array.isArray(value.directories)
  ) {
    throw new Error("Public overlap ownership receipt shape is invalid.");
  }
  const expectedPaths = expectedOwnershipDirectoryPaths(expected.policy);
  const directories = value.directories.map((entry, index) => {
    if (!isDirectoryIdentity(entry) || entry.path !== expectedPaths[index]) {
      throw new Error("Public overlap ownership directory ledger is invalid.");
    }
    return Object.freeze({
      path: entry.path,
      device: entry.device,
      inode: entry.inode,
    });
  });
  if (directories.length !== expectedPaths.length) {
    throw new Error("Public overlap ownership directory ledger is incomplete.");
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    kind: "clean-pay-ephemeral-browser-capture-ownership" as const,
    suite: value.suite as string,
    captureId: value.captureId as string,
    role: value.role as PublicOverlapRole,
    bindingSha256: value.bindingSha256 as string,
    directories: Object.freeze(directories),
  });
}

function isDirectoryIdentity(value: unknown): value is {
  path: string;
  device: string;
  inode: string;
} {
  return isRecord(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["device", "inode", "path"])
    && typeof value.path === "string"
    && (value.path === "." || value.path.startsWith("artifacts"))
    && typeof value.device === "string"
    && /^\d+$/.test(value.device)
    && typeof value.inode === "string"
    && /^\d+$/.test(value.inode);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && "code" in value;
}

async function readExactArtifactInventory(root: string, policy: ExactEphemeralCapturePolicy) {
  const artifactsRoot = path.join(root, "artifacts");
  const actualPaths = await listRegularFilesRecursively(artifactsRoot, policy.artifactPaths.length);
  if (JSON.stringify(actualPaths) !== JSON.stringify(policy.artifactPaths)) {
    throw new Error("Ephemeral browser capture inventory is incomplete or contains extra artifacts.");
  }
  return Promise.all(actualPaths.map(async (relativePath) => {
    const bytes = await readBoundedRegularFile(
      path.join(artifactsRoot, relativePath),
      policy.maximumArtifactBytes,
    );
    return Object.freeze({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }));
}

async function listRegularFilesRecursively(root: string, maximumFiles: number) {
  const rootDetails = await lstat(root);
  if (!rootDetails.isDirectory() || rootDetails.isSymbolicLink()) {
    throw new Error("Ephemeral browser capture artifact root is not a regular directory.");
  }
  const result: string[] = [];
  const visit = async (directory: string) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!safeSegmentPattern.test(entry.name) && !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(entry.name)) {
        throw new Error("Ephemeral browser capture contains an unsafe path segment.");
      }
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        throw new Error("Ephemeral browser capture must not contain symbolic links.");
      }
      if (details.isDirectory()) {
        await visit(target);
      } else if (details.isFile()) {
        result.push(path.relative(root, target).split(path.sep).join("/"));
        if (result.length > maximumFiles) {
          throw new Error("Ephemeral browser capture contains too many artifacts.");
        }
      } else {
        throw new Error("Ephemeral browser capture contains a non-regular entry.");
      }
    }
  };
  await visit(root);
  return result.sort();
}

async function readBoundedRegularFile(target: string, maximumBytes: number) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error("Ephemeral browser capture file limit is invalid.");
  }
  const expectedParent = path.resolve(path.dirname(target));
  const [before, parentResolved] = await Promise.all([
    lstat(target, { bigint: true }),
    realpath(expectedParent),
  ]);
  if (!before.isFile() || before.isSymbolicLink()
    || before.size < 1n || before.size > BigInt(maximumBytes)
    || parentResolved !== expectedParent) {
    throw new Error("Ephemeral browser capture file is not a bounded regular file.");
  }
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(target, fsConstants.O_RDONLY | noFollow);
  let afterHandle: BigIntStats = before;
  let bytes = Buffer.alloc(0);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameRegularFileIdentity(before, opened)) {
      throw new Error("Ephemeral browser capture file identity changed before it was read.");
    }
    const buffer = Buffer.allocUnsafe(Number(opened.size) + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.byteLength - offset,
        offset,
      );
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    bytes = buffer.subarray(0, offset);
    afterHandle = await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
  const [afterPath, afterParentResolved] = await Promise.all([
    lstat(target, { bigint: true }),
    realpath(expectedParent),
  ]);
  if (!sameRegularFileIdentity(before, afterHandle)
    || !sameRegularFileIdentity(before, afterPath)
    || afterPath.isSymbolicLink()
    || afterParentResolved !== expectedParent
    || BigInt(bytes.byteLength) !== before.size) {
    throw new Error("Ephemeral browser capture file changed while being read.");
  }
  return Buffer.from(bytes);
}

function sameRegularFileIdentity(left: BigIntStats, right: BigIntStats) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.ctimeNs === right.ctimeNs
    && left.mtimeNs === right.mtimeNs
    && left.size === right.size;
}

function assertExactCaptureReceipt(
  value: unknown,
  policy: ExactEphemeralCapturePolicy,
  identity: { captureId: string; role: PublicOverlapRole },
) {
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([
    "applicationOrigin",
    "artifactCount",
    "bindingSha256",
    "captureId",
    "caseCount",
    "inventory",
    "inventorySha256",
    "kind",
    "role",
    "schemaVersion",
    "suite",
  ])) {
    throw new Error("Public overlap capture receipt shape is invalid.");
  }
  if (
    value.schemaVersion !== 1
    || value.kind !== "clean-pay-ephemeral-browser-capture"
    || value.suite !== policy.suite
    || value.captureId !== identity.captureId
    || value.role !== identity.role
    || value.caseCount !== policy.caseCount
    || value.artifactCount !== policy.artifactPaths.length
    || !Array.isArray(value.inventory)
    || value.inventory.length !== policy.artifactPaths.length
  ) {
    throw new Error("Public overlap capture receipt identity is invalid.");
  }
  assertExactLoopbackApplicationOrigin(value.applicationOrigin, "receipt application origin");
  exactDigest(value.bindingSha256, "receipt binding digest");
  exactDigest(value.inventorySha256, "receipt inventory digest");
  const inventory = value.inventory.map((entry, index) => {
    if (!isRecord(entry) || JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([
      "bytes", "path", "sha256",
    ])) {
      throw new Error("Public overlap receipt inventory entry shape is invalid.");
    }
    if (
      entry.path !== policy.artifactPaths[index]
      || !Number.isSafeInteger(entry.bytes)
      || Number(entry.bytes) < 1
      || Number(entry.bytes) > policy.maximumArtifactBytes
    ) {
      throw new Error("Public overlap receipt inventory entry is invalid.");
    }
    return Object.freeze({
      path: entry.path,
      bytes: Number(entry.bytes),
      sha256: exactDigest(entry.sha256, "receipt artifact digest"),
    });
  });
  return Object.freeze({
    ...value,
    applicationOrigin: value.applicationOrigin as string,
    artifactCount: value.artifactCount as number,
    bindingSha256: value.bindingSha256 as string,
    captureId: value.captureId as string,
    caseCount: value.caseCount as number,
    inventory: Object.freeze(inventory),
    inventorySha256: value.inventorySha256 as string,
    kind: value.kind as "clean-pay-ephemeral-browser-capture",
    role: value.role as PublicOverlapRole,
    schemaVersion: value.schemaVersion as 1,
    suite: value.suite as string,
  }) satisfies ExactCaptureReceipt;
}

function assertSafeRelativeArtifactPath(value: string) {
  if (
    typeof value !== "string"
    || value.includes("\\")
    || path.posix.isAbsolute(value)
    || value.split("/").length < 2
    || value.split("/").some((segment) => (
      segment === "."
      || segment === ".."
      || !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(segment)
    ))
  ) {
    throw new Error("Ephemeral browser capture artifact path is unsafe.");
  }
}

function exactEnvironmentValue(value: unknown, pattern: RegExp, label: string) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`Public overlap ${label} is invalid.`);
  }
  return value;
}

function exactDigest(value: unknown, label: string) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`Public overlap ${label} is invalid.`);
  }
  return value;
}

function assertWithin(parent: string, child: string, label: string) {
  const relative = path.relative(parent, child);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`Public overlap ${label} escaped its fixed test-results root.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
