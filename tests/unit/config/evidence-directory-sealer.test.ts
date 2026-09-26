import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertEvidenceInventoryBounds,
  EVIDENCE_DIRECTORY_LIMITS,
  sealEvidenceDirectory,
} from "../../../scripts/security/seal-evidence-directory.mjs";

const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    const expectedPrefix = path.join(tmpdir(), "clean-pay-evidence-sealer-");
    if (!path.resolve(root).startsWith(path.resolve(expectedPrefix))) {
      throw new Error("refusing to clean an unexpected test path");
    }
    await rm(root, { recursive: true, force: true });
  }
});

describe("sanitized evidence directory sealer", () => {
  it("records deterministic ordinal-relative hashes including an empty regular file", async () => {
    const { evidenceRoot } = await temporaryEvidenceRoot();
    await mkdir(path.join(evidenceRoot, "nested"));
    await mkdir(path.join(evidenceRoot, "seal"));
    await writeFile(path.join(evidenceRoot, "z-empty.log"), "");
    await writeFile(path.join(evidenceRoot, "nested", "A.txt"), "alpha\n");
    await writeFile(path.join(evidenceRoot, "a.json"), "{}\n");
    const manifestPath = path.join(evidenceRoot, "seal", "manifest.json");

    const result = await sealEvidenceDirectory(evidenceRoot, manifestPath);
    const serialized = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(serialized) as typeof result;

    expect(manifest).toEqual(result);
    expect(manifest.files.map(({ ordinal, path: relativePath, bytes }) => ({
      ordinal,
      path: relativePath,
      bytes,
    }))).toEqual([
      { ordinal: 1, path: "a.json", bytes: 3 },
      { ordinal: 2, path: "nested/A.txt", bytes: 6 },
      { ordinal: 3, path: "z-empty.log", bytes: 0 },
    ]);
    expect(manifest.files[2]?.sha256).toBe(sha256(""));
    expect(manifest.aggregateSha256).toBe(independentAggregate(manifest.files));
    expect(manifest.aggregateSha256).toBe(
      "c0f0d5c722ca7835993f4715c65552e6b229549db4b33cd5e6d5dcd63442b53a",
    );
    expect(manifest.fileCount).toBe(3);
    expect(manifest.totalBytes).toBe(9);
    expect(serialized).not.toContain(evidenceRoot);
    expect(serialized).not.toContain("alpha");
    if (process.platform !== "win32") {
      expect((await lstat(manifestPath)).mode & 0o077).toBe(0);
    }
  });

  it("refuses a pre-existing manifest without changing it", async () => {
    const { evidenceRoot } = await temporaryEvidenceRoot();
    await writeFile(path.join(evidenceRoot, "artifact.txt"), "evidence");
    const manifestPath = path.join(evidenceRoot, "manifest.json");
    await writeFile(manifestPath, "caller-owned\n");

    await expect(sealEvidenceDirectory(evidenceRoot, manifestPath))
      .rejects.toThrow("Manifest output already exists");
    expect(await readFile(manifestPath, "utf8")).toBe("caller-owned\n");
  });

  it("rejects relative paths, path escape and control-character manifest names", async () => {
    const { sandbox, evidenceRoot } = await temporaryEvidenceRoot();
    await writeFile(path.join(evidenceRoot, "artifact.txt"), "evidence");

    await expect(sealEvidenceDirectory("relative/evidence", path.join(evidenceRoot, "m.json")))
      .rejects.toThrow("Evidence root must be an explicit absolute path");
    await expect(sealEvidenceDirectory(evidenceRoot, "relative/manifest.json"))
      .rejects.toThrow("Manifest path must be an explicit absolute path");
    await expect(sealEvidenceDirectory(evidenceRoot, path.join(sandbox, "escaped.json")))
      .rejects.toThrow("strictly within the evidence root");
    await expect(sealEvidenceDirectory(evidenceRoot, path.join(evidenceRoot, "bad\nname.json")))
      .rejects.toThrow("without control characters");
  });

  it("rejects the repository/workspace root and its ancestors before enumeration", async () => {
    const workspaceRoot = process.cwd();
    await expect(sealEvidenceDirectory(
      workspaceRoot,
      path.join(workspaceRoot, "never-create-evidence-manifest.json"),
    )).rejects.toThrow("repository/workspace root or its ancestor");
    await expect(sealEvidenceDirectory(
      path.dirname(workspaceRoot),
      path.join(path.dirname(workspaceRoot), "never-create-evidence-manifest.json"),
    )).rejects.toThrow("repository/workspace root or its ancestor");
  });

  it("rejects symbolic links instead of following them", async () => {
    const { sandbox, evidenceRoot } = await temporaryEvidenceRoot();
    const outside = path.join(sandbox, "outside");
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.txt"), "not evidence");
    await symlink(
      outside,
      path.join(evidenceRoot, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(sealEvidenceDirectory(
      evidenceRoot,
      path.join(evidenceRoot, "manifest.json"),
    )).rejects.toThrow("contains a symbolic link");
  });

  it("rejects an empty directory and an unexpected root type", async () => {
    const { sandbox, evidenceRoot } = await temporaryEvidenceRoot();
    await expect(sealEvidenceDirectory(
      evidenceRoot,
      path.join(evidenceRoot, "manifest.json"),
    )).rejects.toThrow("contains no files");

    const regularFile = path.join(sandbox, "not-a-directory");
    await writeFile(regularFile, "evidence");
    await expect(sealEvidenceDirectory(
      regularFile,
      path.join(regularFile, "manifest.json"),
    )).rejects.toThrow("must be a non-symlink directory");
  });

  it("fails closed when a file is modified during its bounded read", async () => {
    const { evidenceRoot } = await temporaryEvidenceRoot();
    const artifact = path.join(evidenceRoot, "changing.bin");
    await writeFile(artifact, Buffer.alloc(128 * 1024, 0x41));
    let changed = false;

    await expect(sealEvidenceDirectory(
      evidenceRoot,
      path.join(evidenceRoot, "manifest.json"),
      {
        onReadProgress: async ({ chunkIndex }: { chunkIndex: number }) => {
          if (chunkIndex === 1 && !changed) {
            changed = true;
            await writeFile(artifact, Buffer.alloc(128 * 1024, 0x42));
          }
        },
      },
    )).rejects.toThrow(/changed while it was read|changed size while it was read/u);
    expect(changed).toBe(true);
  });

  it("enforces fixed file-count, per-file and aggregate-byte limits", () => {
    expect(() => assertEvidenceInventoryBounds(
      Array.from({ length: EVIDENCE_DIRECTORY_LIMITS.maxFiles + 1 }, () => 0),
    )).toThrow("file-count limit");
    expect(() => assertEvidenceInventoryBounds([
      EVIDENCE_DIRECTORY_LIMITS.maxFileBytes + 1,
    ])).toThrow("per-file byte limit");
    expect(() => assertEvidenceInventoryBounds([
      EVIDENCE_DIRECTORY_LIMITS.maxFileBytes,
      EVIDENCE_DIRECTORY_LIMITS.maxFileBytes,
      1,
    ])).toThrow("aggregate byte limit");
  });

  it("keeps CLI output sanitized and does not expose absolute paths on failure", async () => {
    const { evidenceRoot } = await temporaryEvidenceRoot();
    await writeFile(path.join(evidenceRoot, "artifact.txt"), "evidence");
    const manifestPath = path.join(evidenceRoot, "manifest.json");
    await writeFile(manifestPath, "caller-owned\n");

    const result = await runCli([
      "--evidence-root",
      evidenceRoot,
      "--manifest",
      manifestPath,
    ]);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Manifest output already exists");
    expect(result.stderr).not.toContain(evidenceRoot);
    expect(await readFile(manifestPath, "utf8")).toBe("caller-owned\n");
  });

  it("runs as an exact import-safe CLI and reports only a relative manifest path", async () => {
    const { evidenceRoot } = await temporaryEvidenceRoot();
    await writeFile(path.join(evidenceRoot, "artifact.txt"), "evidence");
    const manifestPath = path.join(evidenceRoot, "manifest.json");

    const result = await runCli([
      "--manifest",
      manifestPath,
      "--evidence-root",
      evidenceRoot,
    ]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain(evidenceRoot);
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: "sealed",
      manifest: "manifest.json",
      fileCount: 1,
      totalBytes: 8,
    });
    expect(JSON.parse(await readFile(manifestPath, "utf8"))).toMatchObject({
      fileCount: 1,
      totalBytes: 8,
    });
  });
});

async function temporaryEvidenceRoot() {
  const sandbox = await mkdtemp(path.join(tmpdir(), "clean-pay-evidence-sealer-"));
  temporaryRoots.push(sandbox);
  const evidenceRoot = path.join(sandbox, "evidence");
  await mkdir(evidenceRoot);
  return { evidenceRoot, sandbox };
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function independentAggregate(files: Array<{ path: string; bytes: number; sha256: string }>) {
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path, "utf8");
    hash.update(Buffer.from([0]));
    hash.update(String(file.bytes), "ascii");
    hash.update(Buffer.from([0]));
    hash.update(file.sha256, "ascii");
    hash.update("\n", "ascii");
  }
  return hash.digest("hex");
}

async function runCli(argumentsList: string[]) {
  const { spawn } = await import("node:child_process");
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, [
      "scripts/security/seal-evidence-directory.mjs",
      ...argumentsList,
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
