import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
} from "node:fs/promises";
import path from "node:path";

export const BEHAVIORAL_BASELINE_COMMIT =
  "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
export const FORENSIC_BASELINE_ID = BEHAVIORAL_BASELINE_COMMIT;
export const PARALLEL_BASELINE_ID =
  `${BEHAVIORAL_BASELINE_COMMIT}-deterministic-v1`;
export const SERIAL_BASELINE_ID =
  `${BEHAVIORAL_BASELINE_COMMIT}-deterministic-v2`;
export const SOFTWARE_BASELINE_ID =
  `${BEHAVIORAL_BASELINE_COMMIT}-deterministic-v3`;
export const DETERMINISTIC_V4_BASELINE_ID =
  `${BEHAVIORAL_BASELINE_COMMIT}-deterministic-v4`;
export const CANONICAL_BASELINE_ID =
  `${BEHAVIORAL_BASELINE_COMMIT}-deterministic-v5`;

const browserTestsDirectory = path.resolve(process.cwd(), "tests", "browser");
export const browserBaselineRoot = path.join(
  browserTestsDirectory,
  "baselines",
  CANONICAL_BASELINE_ID,
);
export const browserForensicBaselineRoot = path.join(
  browserTestsDirectory,
  "baselines",
  FORENSIC_BASELINE_ID,
);
export const browserSerialBaselineRoot = path.join(
  browserTestsDirectory,
  "baselines",
  SERIAL_BASELINE_ID,
);
export const browserSoftwareBaselineRoot = path.join(
  browserTestsDirectory,
  "baselines",
  SOFTWARE_BASELINE_ID,
);
export const browserDeterministicV4BaselineRoot = path.join(
  browserTestsDirectory,
  "baselines",
  DETERMINISTIC_V4_BASELINE_ID,
);
export const browserParallelBaselineRoot = path.join(
  browserTestsDirectory,
  "baselines",
  PARALLEL_BASELINE_ID,
);

export type ArtifactReconciliation = "created" | "matched";

export class MissingBaselineError extends Error {
  constructor(readonly baselineFile: string) {
    super(
      `Missing immutable browser baseline: ${baselineFile}. `
      + `Generate it only from ${BEHAVIORAL_BASELINE_COMMIT} with `
      + "CLEAN_PAY_UPDATE_BASELINE=1.",
    );
    this.name = "MissingBaselineError";
  }
}

export class BaselineMismatchError extends Error {
  constructor(
    readonly baselineFile: string,
    readonly expectedDigest: string,
    readonly actualDigest: string,
  ) {
    super(
      `Immutable browser baseline mismatch for ${baselineFile}: `
      + `expected ${expectedDigest}, received ${actualDigest}. `
      + "The existing baseline was not changed.",
    );
    this.name = "BaselineMismatchError";
  }
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function baselineUpdateRequested(
  environment?: { CLEAN_PAY_UPDATE_BASELINE?: string },
) {
  const value = environment === undefined
    ? process.env.CLEAN_PAY_UPDATE_BASELINE
    : environment.CLEAN_PAY_UPDATE_BASELINE;
  return value === "1";
}

export function readCurrentCommit(repositoryRoot = process.cwd()) {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export function assertBaselineWriteAuthorized(currentCommit: string) {
  if (currentCommit !== BEHAVIORAL_BASELINE_COMMIT) {
    throw new Error(
      "Browser baseline creation is permitted only at commit "
      + `${BEHAVIORAL_BASELINE_COMMIT}; current commit is ${currentCommit || "unknown"}.`,
    );
  }
}

/**
 * Creates a file once. An identical second call is a read-only no-op; a call
 * with different bytes fails and leaves the existing file untouched.
 */
export async function createImmutableArtifact(
  destination: string,
  contents: Uint8Array,
): Promise<"created" | "unchanged"> {
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    const handle = await open(destination, "wx");
    try {
      await handle.writeFile(contents);
    } finally {
      await handle.close();
    }
    return "created";
  } catch (error) {
    if (!isAlreadyExistsError(error)) throw error;
  }

  const existing = await readFile(destination);
  if (!existing.equals(Buffer.from(contents))) {
    throw new BaselineMismatchError(
      destination,
      sha256(existing),
      sha256(contents),
    );
  }

  return "unchanged";
}

export async function reconcileBaselineArtifact(options: {
  baselineFile: string;
  actual: Uint8Array;
  repositoryRoot?: string;
  update?: boolean;
}): Promise<ArtifactReconciliation> {
  const update = options.update ?? baselineUpdateRequested();

  if (update) {
    assertBaselineWriteAuthorized(
      readCurrentCommit(options.repositoryRoot ?? process.cwd()),
    );
    await createImmutableArtifact(options.baselineFile, options.actual);
    return "created";
  }

  let expected: Buffer;
  try {
    expected = await readFile(options.baselineFile);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new MissingBaselineError(options.baselineFile);
    }
    throw error;
  }

  if (!expected.equals(Buffer.from(options.actual))) {
    throw new BaselineMismatchError(
      options.baselineFile,
      sha256(expected),
      sha256(options.actual),
    );
  }

  return "matched";
}

/**
 * Stores the unmodified JSON evidence, while comparing a deterministic
 * projection of existing and actual bytes. Existing files are never updated.
 */
export async function reconcileProjectedJsonBaselineArtifact(options: {
  baselineFile: string;
  actual: Uint8Array;
  project: (value: Uint8Array) => Uint8Array;
  projectPair?: (
    expected: Uint8Array,
    actual: Uint8Array,
  ) => { expected: Uint8Array; actual: Uint8Array };
  repositoryRoot?: string;
  update?: boolean;
}): Promise<ArtifactReconciliation> {
  const update = options.update ?? baselineUpdateRequested();
  let expected: Buffer;
  try {
    expected = await readFile(options.baselineFile);
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    if (!update) throw new MissingBaselineError(options.baselineFile);
    assertBaselineWriteAuthorized(
      readCurrentCommit(options.repositoryRoot ?? process.cwd()),
    );
    const result = await createImmutableArtifact(options.baselineFile, options.actual);
    return result === "created" ? "created" : "matched";
  }

  if (update) {
    assertBaselineWriteAuthorized(
      readCurrentCommit(options.repositoryRoot ?? process.cwd()),
    );
  }
  const projectedPair = options.projectPair?.(expected, options.actual);
  const projectedExpected = projectedPair?.expected ?? options.project(expected);
  const projectedActual = projectedPair?.actual ?? options.project(options.actual);
  if (!Buffer.from(projectedExpected).equals(Buffer.from(projectedActual))) {
    throw new BaselineMismatchError(
      options.baselineFile,
      sha256(projectedExpected),
      sha256(projectedActual),
    );
  }
  return "matched";
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
