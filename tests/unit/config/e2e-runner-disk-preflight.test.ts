import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const rootDir = path.resolve(import.meta.dirname, "../../..");
const runner = path.join(rootDir, "scripts", "e2e-devcontainer.mjs");
const impossibleRequiredBytes = "9223372036854775807";

describe("devcontainer E2E host disk preflight", () => {
  it("allows an outer Windows runner with sufficient host space", () => {
    const result = runPreflight({ requiredBytes: "1" });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("fails before Docker with exact sanitized filesystem evidence", () => {
    const result = runPreflight({ requiredBytes: impossibleRequiredBytes });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");

    const expectedPath = escapeRegExp(JSON.stringify(rootDir));
    const match = new RegExp(
      "^E2E host disk preflight failed: " +
      `path=${expectedPath} fsType=0x[0-9a-f]+ ` +
      "blockSizeBytes=([1-9][0-9]*) availableBlocks=([0-9]+) " +
      `freeBytes=([0-9]+) requiredBytes=${impossibleRequiredBytes}\\.$`,
      "u",
    ).exec(result.stderr.trim());

    expect(match).not.toBeNull();
    const [, blockSize, availableBlocks, freeBytes] = match!;
    expect(BigInt(freeBytes)).toBe(BigInt(blockSize) * BigInt(availableBlocks));
    expect(BigInt(freeBytes)).toBeLessThan(BigInt(impossibleRequiredBytes));
  });

  it("skips the host check for the recursive inner runner", () => {
    const result = runPreflight({
      location: "inner",
      requiredBytes: impossibleRequiredBytes,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("does not impose the host reserve on CI", () => {
    const result = runPreflight({
      ci: "true",
      requiredBytes: impossibleRequiredBytes,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});

function runPreflight({
  ci,
  location = "host",
  requiredBytes,
}: Readonly<{
  ci?: string;
  location?: "host" | "inner";
  requiredBytes: string;
}>) {
  const env: NodeJS.ProcessEnv = {
    CLEAN_PAY_DEVCONTAINER_PROJECT: "disk-preflight-test",
    CLEAN_PAY_INTERNAL_E2E_DISK_PREFLIGHT_ONLY: "1",
    CLEAN_PAY_INTERNAL_E2E_HOST_PLATFORM: "win32",
    CLEAN_PAY_INTERNAL_E2E_MIN_FREE_BYTES: requiredBytes,
    CLEAN_PAY_INTERNAL_E2E_RUNNER_LOCATION: location,
    NODE_ENV: "test",
  };

  for (const name of [
    "ComSpec",
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "WINDIR",
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  if (ci !== undefined) env.CI = ci;

  return spawnSync(process.execPath, [runner], {
    cwd: rootDir,
    encoding: "utf8",
    env,
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
