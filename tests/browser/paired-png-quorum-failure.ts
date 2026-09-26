import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  MAXIMUM_PAIRED_PNG_QUORUM_BYTES,
  PairedPngQuorumError,
  createPairedPngQuorumDigestEvidence,
  type IndependentProcessCharacterizationPair,
} from "./process-quorum";
import {
  PUBLIC_OVERLAP_PROJECTS,
  PUBLIC_OVERLAP_ROUTES,
  type PublicOverlapRoute,
  sha256,
} from "./public-overlap-evidence";

export const PAIRED_PNG_QUORUM_FAILURE_DIRECTORY = "paired-png-quorum-failure";
export const PAIRED_PNG_QUORUM_FAILURE_EVIDENCE_FILENAME = "evidence.json";

type PersistPairedPngQuorumFailureOptions = Readonly<{
  error: PairedPngQuorumError;
  outputRoot: string;
  pairs: readonly IndependentProcessCharacterizationPair[];
  project: string;
  route: PublicOverlapRoute;
}>;

export async function persistPairedPngQuorumFailureEvidence(
  options: PersistPairedPngQuorumFailureOptions,
) {
  const { error, outputRoot, pairs, project, route } = options;
  if (!(error instanceof PairedPngQuorumError)) {
    throw new Error("Paired PNG quorum diagnostics require the exact branded error.");
  }
  if (!path.isAbsolute(outputRoot)
    || path.resolve(outputRoot) !== outputRoot
    || path.basename(outputRoot) !== PAIRED_PNG_QUORUM_FAILURE_DIRECTORY) {
    throw new Error("Paired PNG quorum diagnostic output root is invalid.");
  }
  if (!PUBLIC_OVERLAP_PROJECTS.includes(
    project as (typeof PUBLIC_OVERLAP_PROJECTS)[number],
  ) || !PUBLIC_OVERLAP_ROUTES.some((expected) => (
    expected.id === route.id
    && expected.kind === route.kind
    && expected.requestPath === route.requestPath
  ))) {
    throw new Error("Paired PNG quorum diagnostic case is outside the exact allowlist.");
  }
  const recomputed = createPairedPngQuorumDigestEvidence(pairs);
  if (JSON.stringify(recomputed.records) !== JSON.stringify(error.records)
    || JSON.stringify(recomputed.tupleDigests) !== JSON.stringify(error.tupleDigests)) {
    throw new Error("Paired PNG quorum diagnostic digests differ from the branded error.");
  }

  const pngs = recomputed.records.map((record) => {
    const screenshot = pairs[record.processIndex]?.[record.role]?.screenshot;
    if (!(screenshot instanceof Uint8Array)) {
      throw new Error("Paired PNG quorum diagnostic screenshot is missing.");
    }
    assertExactBoundedPng(screenshot);
    const filename = `process-${record.processIndex + 1}.${record.role}.png`;
    return Object.freeze({
      bytes: Buffer.from(screenshot),
      filename,
      record: Object.freeze({ ...record, filename }),
    });
  });
  if (pngs.length !== 6 || new Set(pngs.map(({ filename }) => filename)).size !== 6) {
    throw new Error("Paired PNG quorum diagnostic file inventory is incomplete.");
  }

  const evidence = Object.freeze({
    schemaVersion: 1,
    status: "public_overlap_paired_png_quorum_absent",
    case: Object.freeze({ project, route: route.id }),
    records: Object.freeze(pngs.map(({ record }) => record)),
    tupleDigests: error.tupleDigests,
  });
  const evidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  if (evidenceBytes.byteLength < 1 || evidenceBytes.byteLength > 16 * 1024) {
    throw new Error("Paired PNG quorum diagnostic evidence exceeds its bounded policy.");
  }

  const parent = path.dirname(outputRoot);
  const parentDetails = await lstat(parent);
  if (!parentDetails.isDirectory() || parentDetails.isSymbolicLink()) {
    throw new Error("Paired PNG quorum diagnostic parent is invalid.");
  }
  try {
    await mkdir(outputRoot, { mode: 0o700, recursive: false });
  } catch (error_) {
    if (isNodeError(error_) && error_.code === "EEXIST") {
      throw new Error("Paired PNG quorum diagnostic output already exists.");
    }
    throw error_;
  }
  const outputDetails = await lstat(outputRoot);
  if (!outputDetails.isDirectory() || outputDetails.isSymbolicLink()) {
    throw new Error("Paired PNG quorum diagnostic output is not a regular directory.");
  }

  for (const png of pngs) {
    await writeCreateOnlyBoundedFile(
      path.join(outputRoot, png.filename),
      png.bytes,
      MAXIMUM_PAIRED_PNG_QUORUM_BYTES,
    );
  }
  await writeCreateOnlyBoundedFile(
    path.join(outputRoot, PAIRED_PNG_QUORUM_FAILURE_EVIDENCE_FILENAME),
    evidenceBytes,
    16 * 1024,
  );
  const expectedFiles = [
    PAIRED_PNG_QUORUM_FAILURE_EVIDENCE_FILENAME,
    ...pngs.map(({ filename }) => filename),
  ].sort();
  if (JSON.stringify((await readdir(outputRoot)).sort()) !== JSON.stringify(expectedFiles)) {
    throw new Error("Paired PNG quorum diagnostic output inventory changed after sealing.");
  }
  return evidence;
}

async function writeCreateOnlyBoundedFile(target: string, bytes: Buffer, maximumBytes: number) {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new Error("Paired PNG quorum diagnostic file exceeds its bounded policy.");
  }
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  const details = await lstat(target);
  const observed = await readFile(target);
  if (!details.isFile()
    || details.isSymbolicLink()
    || details.size !== bytes.byteLength
    || !observed.equals(bytes)
    || sha256(observed) !== sha256(bytes)) {
    throw new Error("Paired PNG quorum diagnostic file changed after create-only write.");
  }
}

function assertExactBoundedPng(value: Uint8Array) {
  const png = Buffer.from(value);
  if (png.byteLength < 45
    || png.byteLength > MAXIMUM_PAIRED_PNG_QUORUM_BYTES
    || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Paired PNG quorum diagnostic screenshot is not a bounded PNG.");
  }
  let offset = 8;
  let firstChunk = true;
  let sawImageData = false;
  let sawTerminalChunk = false;
  while (offset < png.byteLength) {
    if (offset + 12 > png.byteLength) {
      throw new Error("Paired PNG quorum diagnostic PNG chunk is truncated.");
    }
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const nextOffset = offset + 12 + length;
    if (!/^[A-Za-z]{4}$/.test(type) || nextOffset > png.byteLength) {
      throw new Error("Paired PNG quorum diagnostic PNG chunk is invalid.");
    }
    if (firstChunk) {
      if (type !== "IHDR" || length !== 13) {
        throw new Error("Paired PNG quorum diagnostic PNG has no exact IHDR.");
      }
      const width = png.readUInt32BE(offset + 8);
      const height = png.readUInt32BE(offset + 12);
      if (width < 1 || height < 1 || width > 4_096 || height > 4_096) {
        throw new Error("Paired PNG quorum diagnostic PNG dimensions are invalid.");
      }
      firstChunk = false;
    }
    if (type === "IDAT") sawImageData = true;
    if (type === "IEND") {
      if (length !== 0 || nextOffset !== png.byteLength) {
        throw new Error("Paired PNG quorum diagnostic PNG terminal chunk is invalid.");
      }
      sawTerminalChunk = true;
    }
    offset = nextOffset;
  }
  if (firstChunk || !sawImageData || !sawTerminalChunk) {
    throw new Error("Paired PNG quorum diagnostic screenshot is incomplete.");
  }
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}
