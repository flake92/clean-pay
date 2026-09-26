import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

export const BEHAVIORAL_BASELINE_SOURCE = Object.freeze({
  archiveBytes: 7_587_840,
  archiveSha256: "6ccdccdd162ede951850759392a72376792988080307b4e29ae0cffef2397a03",
  commit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
  extractedAggregateSha256: "1745a78bfd75561381380888690c5ad59ef308f6911731bd23e05e499d6e43d8",
  extractedFileCount: 657,
  extractedTotalBytes: 6_993_136,
  tree: "6647fc51c61018ba46aae95da21e534434028fbe",
});

const execFileAsync = promisify(execFile);
const directoryPrefix = "clean-pay-behavioral-baseline-";
const receiptFilename = "receipt.json";
const archiveFilename = "behavioral-baseline.tar";
const sourceDirectoryName = "source";
const maximumArchiveBytes = 8 * 1024 * 1024;
const maximumExtractedBytes = 64 * 1024 * 1024;
const maximumExtractedFiles = 2_000;
const maximumReceiptBytes = 4_096;

export function assertBehavioralBaselineIdentity(commit, tree) {
  if (commit !== BEHAVIORAL_BASELINE_SOURCE.commit
    || tree !== BEHAVIORAL_BASELINE_SOURCE.tree) {
    throw new Error("Behavioral baseline Git identity is not the reviewed immutable source.");
  }
  return BEHAVIORAL_BASELINE_SOURCE;
}

export function assertBehavioralBaselineArchive(bytes) {
  if (!(bytes instanceof Uint8Array)
    || bytes.byteLength !== BEHAVIORAL_BASELINE_SOURCE.archiveBytes
    || sha256(bytes) !== BEHAVIORAL_BASELINE_SOURCE.archiveSha256) {
    throw new Error("Behavioral baseline archive does not match the reviewed immutable bytes.");
  }
  return BEHAVIORAL_BASELINE_SOURCE;
}

export async function materializeBehavioralBaselineSource({
  repositoryRoot,
  temporaryRoot = tmpdir(),
}) {
  exactKeys(arguments[0], ["repositoryRoot"], ["temporaryRoot"]);
  const repository = await exactDirectory(repositoryRoot, "repository root");
  const temporary = await exactDirectory(temporaryRoot, "temporary root");
  if (isSameOrDescendant(temporary, repository)
    || isSameOrDescendant(repository, temporary)
    || path.parse(temporary).root === temporary) {
    throw new Error("Behavioral baseline temporary root is not isolated from the repository.");
  }

  const revision = (await run("git", [
    "rev-parse",
    "--verify",
    `${BEHAVIORAL_BASELINE_SOURCE.commit}^{commit}`,
  ], repository)).trim();
  const tree = (await run("git", [
    "show",
    "-s",
    "--format=%T",
    BEHAVIORAL_BASELINE_SOURCE.commit,
  ], repository)).trim();
  assertBehavioralBaselineIdentity(revision, tree);

  const ownedRoot = await mkdtemp(path.join(temporary, directoryPrefix));
  const rootIdentity = await directoryIdentity(ownedRoot);
  const archivePath = path.join(ownedRoot, archiveFilename);
  const sourceDirectory = path.join(ownedRoot, sourceDirectoryName);
  let completed = false;
  let primaryError;
  try {
    await mkdir(sourceDirectory, { mode: 0o700 });
    await run("git", [
      "-c",
      "core.autocrlf=true",
      "archive",
      "--format=tar",
      `--output=${archivePath}`,
      BEHAVIORAL_BASELINE_SOURCE.commit,
    ], repository);
    const archive = await readBoundedRegularFile(archivePath, maximumArchiveBytes);
    assertBehavioralBaselineArchive(archive);
    await runWithInput("tar", ["-xf", "-", "-C", sourceDirectory], repository, archive);
    const extracted = await hashExtractedTree(sourceDirectory);
    if (extracted.aggregateSha256 !== BEHAVIORAL_BASELINE_SOURCE.extractedAggregateSha256
      || extracted.fileCount !== BEHAVIORAL_BASELINE_SOURCE.extractedFileCount
      || extracted.totalBytes !== BEHAVIORAL_BASELINE_SOURCE.extractedTotalBytes) {
      throw new Error("Behavioral baseline extraction does not match the reviewed source tree.");
    }
    for (const required of ["Dockerfile", "package.json", "package-lock.json", ".dockerignore"]) {
      if (!extracted.paths.includes(required)) {
        throw new Error("Behavioral baseline extraction is missing a required build input.");
      }
    }
    const sourceIdentity = await directoryIdentity(sourceDirectory);
    const receipt = Object.freeze({
      archive: Object.freeze({
        bytes: BEHAVIORAL_BASELINE_SOURCE.archiveBytes,
        sha256: BEHAVIORAL_BASELINE_SOURCE.archiveSha256,
      }),
      extracted: Object.freeze({
        aggregateSha256: BEHAVIORAL_BASELINE_SOURCE.extractedAggregateSha256,
        fileCount: BEHAVIORAL_BASELINE_SOURCE.extractedFileCount,
        totalBytes: BEHAVIORAL_BASELINE_SOURCE.extractedTotalBytes,
      }),
      ownership: Object.freeze({
        root: rootIdentity,
        source: sourceIdentity,
      }),
      schemaVersion: 1,
      source: Object.freeze({
        commit: BEHAVIORAL_BASELINE_SOURCE.commit,
        tree: BEHAVIORAL_BASELINE_SOURCE.tree,
      }),
      status: "immutable_behavioral_baseline_materialized",
    });
    const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    const receiptPath = path.join(ownedRoot, receiptFilename);
    const handle = await open(receiptPath, "wx", 0o600);
    try {
      await handle.writeFile(receiptBytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    completed = true;
    return Object.freeze({
      archivePath,
      receiptPath,
      receiptSha256: sha256(receiptBytes),
      root: ownedRoot,
      sourceDirectory,
    });
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    if (!completed) {
      try {
        await cleanupOwnedRoot({ ownedRoot, rootIdentity, temporary });
      } catch (cleanupError) {
        throw new AggregateError(
          [primaryError, cleanupError].filter(Boolean),
          "Behavioral baseline materialization and exact cleanup both failed.",
        );
      }
    }
  }
}

export async function cleanupBehavioralBaselineSource({
  expectedReceiptSha256,
  root,
  temporaryRoot = tmpdir(),
}) {
  exactKeys(arguments[0], ["expectedReceiptSha256", "root"], ["temporaryRoot"]);
  if (!/^[a-f0-9]{64}$/.test(expectedReceiptSha256)) {
    throw new Error("Behavioral baseline receipt capability is invalid.");
  }
  const temporary = await exactDirectory(temporaryRoot, "temporary root");
  const ownedRoot = exactOwnedRoot(root, temporary);
  const receiptPath = path.join(ownedRoot, receiptFilename);
  const receiptBytes = await readBoundedRegularFile(receiptPath, maximumReceiptBytes);
  if (sha256(receiptBytes) !== expectedReceiptSha256) {
    throw new Error("Behavioral baseline ownership receipt capability changed before cleanup.");
  }
  const receipt = parseReceipt(receiptBytes.toString("utf8"));
  const rootIdentity = await directoryIdentity(ownedRoot);
  if (JSON.stringify(rootIdentity) !== JSON.stringify(receipt.ownership.root)) {
    throw new Error("Behavioral baseline owned root identity changed before cleanup.");
  }
  const entries = (await readdir(ownedRoot)).sort();
  if (JSON.stringify(entries)
    !== JSON.stringify([archiveFilename, receiptFilename, sourceDirectoryName].sort())) {
    throw new Error("Behavioral baseline owned root contains unexpected entries.");
  }
  const archive = await readBoundedRegularFile(
    path.join(ownedRoot, archiveFilename),
    maximumArchiveBytes,
  );
  assertBehavioralBaselineArchive(archive);
  const sourceDirectory = path.join(ownedRoot, sourceDirectoryName);
  const sourceIdentity = await directoryIdentity(sourceDirectory);
  if (JSON.stringify(sourceIdentity) !== JSON.stringify(receipt.ownership.source)) {
    throw new Error("Behavioral baseline source identity changed before cleanup.");
  }
  const extracted = await hashExtractedTree(sourceDirectory);
  if (extracted.aggregateSha256 !== receipt.extracted.aggregateSha256
    || extracted.fileCount !== receipt.extracted.fileCount
    || extracted.totalBytes !== receipt.extracted.totalBytes) {
    throw new Error("Behavioral baseline extracted source changed before cleanup.");
  }
  await cleanupOwnedRoot({ ownedRoot, rootIdentity, temporary });
  return Object.freeze({ status: "immutable_behavioral_baseline_cleaned" });
}

async function cleanupOwnedRoot({ ownedRoot, rootIdentity, temporary }) {
  const target = exactOwnedRoot(ownedRoot, temporary);
  if (JSON.stringify(await directoryIdentity(target)) !== JSON.stringify(rootIdentity)) {
    throw new Error("Refusing cleanup of an unowned behavioral baseline path.");
  }
  await rm(target, { recursive: true, force: false, maxRetries: 0 });
}

async function hashExtractedTree(root) {
  const paths = [];
  const records = [];
  let totalBytes = 0;
  async function visit(directory, relativeDirectory = "") {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
        throw new Error("Behavioral baseline extraction contains an unsupported filesystem entry.");
      }
      const relative = relativeDirectory
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const target = path.join(directory, entry.name);
      const details = await lstat(target);
      if (details.isSymbolicLink()) {
        throw new Error("Behavioral baseline extraction contains a symbolic link.");
      }
      if (entry.isDirectory()) {
        await visit(target, relative);
        continue;
      }
      if (paths.length >= maximumExtractedFiles) {
        throw new Error("Behavioral baseline extraction exceeds the file-count bound.");
      }
      const bytes = await readFile(target);
      totalBytes += bytes.byteLength;
      if (totalBytes > maximumExtractedBytes) {
        throw new Error("Behavioral baseline extraction exceeds the byte bound.");
      }
      paths.push(relative);
      records.push(`${relative}\0${bytes.byteLength}\0${sha256(bytes)}\n`);
    }
  }
  await visit(root);
  return Object.freeze({
    aggregateSha256: sha256(records.join("")),
    fileCount: paths.length,
    paths: Object.freeze(paths),
    totalBytes,
  });
}

function parseReceipt(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Behavioral baseline ownership receipt is malformed.");
  }
  if (!exactObjectKeys(parsed, [
    "archive",
    "extracted",
    "ownership",
    "schemaVersion",
    "source",
    "status",
  ])
    || !exactObjectKeys(parsed?.archive, ["bytes", "sha256"])
    || !exactObjectKeys(parsed?.extracted, ["aggregateSha256", "fileCount", "totalBytes"])
    || !exactObjectKeys(parsed?.ownership, ["root", "source"])
    || !exactObjectKeys(parsed?.source, ["commit", "tree"])
    || parsed?.schemaVersion !== 1
    || parsed?.status !== "immutable_behavioral_baseline_materialized"
    || parsed?.source?.commit !== BEHAVIORAL_BASELINE_SOURCE.commit
    || parsed?.source?.tree !== BEHAVIORAL_BASELINE_SOURCE.tree
    || parsed?.archive?.bytes !== BEHAVIORAL_BASELINE_SOURCE.archiveBytes
    || parsed?.archive?.sha256 !== BEHAVIORAL_BASELINE_SOURCE.archiveSha256
    || !/^[a-f0-9]{64}$/.test(parsed?.extracted?.aggregateSha256 ?? "")
    || !Number.isInteger(parsed?.extracted?.fileCount)
    || parsed.extracted.fileCount < 1
    || !Number.isInteger(parsed?.extracted?.totalBytes)
    || parsed.extracted.totalBytes < 1
    || !exactIdentity(parsed?.ownership?.root)
    || !exactIdentity(parsed?.ownership?.source)) {
    throw new Error("Behavioral baseline ownership receipt does not match its exact contract.");
  }
  return parsed;
}

function exactIdentity(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === "device,inode"
    && /^\d+$/.test(value.device)
    && /^\d+$/.test(value.inode);
}

function exactObjectKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

async function readBoundedRegularFile(target, maximumBytes) {
  const handle = await open(target, "r");
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size < 1 || details.size > maximumBytes) {
      throw new Error("Behavioral baseline bounded file identity is invalid.");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== details.size || bytes.byteLength > maximumBytes) {
      throw new Error("Behavioral baseline bounded file changed while it was read.");
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function directoryIdentity(target) {
  const details = await lstat(target, { bigint: true });
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error("Behavioral baseline directory identity is invalid.");
  }
  return Object.freeze({ device: String(details.dev), inode: String(details.ino) });
}

async function exactDirectory(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.normalize(value) !== value) {
    throw new Error(`Behavioral baseline ${label} path is invalid.`);
  }
  const resolved = await realpath(value);
  const details = await lstat(resolved);
  if (!details.isDirectory() || details.isSymbolicLink()) {
    throw new Error(`Behavioral baseline ${label} is not an exact directory.`);
  }
  return resolved;
}

function exactOwnedRoot(value, temporary) {
  if (typeof value !== "string" || !path.isAbsolute(value)
    || path.normalize(value) !== value
    || path.dirname(value) !== temporary
    || !path.basename(value).startsWith(directoryPrefix)
    || !/^clean-pay-behavioral-baseline-[A-Za-z0-9_-]{6,64}$/.test(path.basename(value))) {
    throw new Error("Behavioral baseline owned root path is invalid.");
  }
  return value;
}

function isSameOrDescendant(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === ""
    || (relative !== ".."
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative));
}

async function run(command, args, cwd) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    throw new Error(`Behavioral baseline command failed: ${command}.`, { cause: error });
  }
}

function runWithInput(command, args, cwd, input) {
  if (!(input instanceof Uint8Array) || input.byteLength > maximumArchiveBytes) {
    throw new Error("Behavioral baseline command input is invalid.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    const maximumOutputBytes = 1024 * 1024;
    const collect = (chunks, chunk, currentBytes) => {
      const bytes = Buffer.from(chunk);
      if (currentBytes + bytes.byteLength > maximumOutputBytes) {
        overflow = true;
        child.kill();
        return currentBytes;
      }
      chunks.push(bytes);
      return currentBytes + bytes.byteLength;
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes = collect(stdout, chunk, stdoutBytes);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes = collect(stderr, chunk, stderrBytes);
    });
    child.once("error", (error) => reject(new Error(
      `Behavioral baseline command failed: ${command}.`,
      { cause: error },
    )));
    child.once("close", (code, signal) => {
      if (code !== 0 || signal !== null || overflow) {
        reject(new Error(`Behavioral baseline command failed: ${command}.`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.once("error", () => child.kill());
    child.stdin.end(input);
  });
}

function exactKeys(value, required, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Behavioral baseline options are invalid.");
  }
  const expected = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((name) => !Object.hasOwn(value, name))
    || keys.some((name) => !expected.has(name))) {
    throw new Error("Behavioral baseline options do not match the exact contract.");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function main() {
  const [mode, ...values] = process.argv.slice(2);
  const options = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || !value || options.has(name)) {
      throw new Error("Behavioral baseline CLI arguments are invalid.");
    }
    options.set(name, value);
  }
  if (mode === "materialize" && options.size === 2
    && options.has("--repository-root") && options.has("--temporary-root")) {
    const result = await materializeBehavioralBaselineSource({
      repositoryRoot: options.get("--repository-root"),
      temporaryRoot: options.get("--temporary-root"),
    });
    process.stdout.write(`${JSON.stringify({
      archiveFilename,
      receiptSha256: result.receiptSha256,
      ownedRootName: path.basename(result.root),
      sourceDirectoryName,
      status: "immutable_behavioral_baseline_materialized",
    })}\n`);
    return;
  }
  if (mode === "cleanup" && options.size === 3
    && options.has("--expected-receipt-sha256")
    && options.has("--root") && options.has("--temporary-root")) {
    const result = await cleanupBehavioralBaselineSource({
      expectedReceiptSha256: options.get("--expected-receipt-sha256"),
      root: options.get("--root"),
      temporaryRoot: options.get("--temporary-root"),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  throw new Error("usage: behavioral-baseline-source.mjs materialize|cleanup ...");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      errorClass: error?.constructor?.name ?? "Error",
      messageSha256: sha256(String(error?.message ?? "unknown")),
      status: "behavioral_baseline_source_failed",
    })}\n`);
    process.exitCode = 1;
  });
}
