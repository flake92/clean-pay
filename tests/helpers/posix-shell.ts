import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

import { expect } from "vitest";

// Shared harness for tests that execute the production shell scripts.  Keep the
// platform handling here: per-file copies drifted apart (one test forgot to
// convert a Windows path and failed only outside Linux).

/**
 * POSIX shell for shell-integration tests: `sh` on Linux and macOS, the Git for
 * Windows `sh.exe` on Windows, or `undefined` when none is installed (callers
 * skip with `it.skipIf(!posixShell)`).
 */
export const posixShell: string | undefined = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/sh.exe", "C:/Program Files/Git/usr/bin/sh.exe"]
      .find((candidate) => existsSync(candidate))
  : "sh";

/**
 * Per-test timeout for shell integration.  Every Git sh process on Windows
 * starts through MSYS and is an order of magnitude slower than on Linux, and a
 * single test can spawn dozens of them under a fully parallel suite.
 */
export const shellIntegrationTimeout = process.platform === "win32" ? 120_000 : 15_000;

/**
 * Converts a native path to the form the POSIX shell sees (`C:\x` → `/c/x` on
 * Windows; unchanged elsewhere).  Scripts validate absolute paths with `/*`.
 */
export function shellPath(value: string) {
  if (process.platform !== "win32" || !posixShell) return value;
  const converted = spawnSync(
    posixShell,
    ["-c", 'cygpath -u -- "$VALUE"'],
    {
      encoding: "utf8",
      env: { ...process.env, VALUE: value },
    },
  );
  expect(converted.status, converted.stderr).toBe(0);
  return converted.stdout.trim();
}

/** Extracts one top-level `name() {` shell function up to the next one. */
export function shellFunctionFrom(source: string, name: string) {
  const start = source.indexOf(`${name}() {`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("\n", start) + 1;
  const nextFunction = source.slice(bodyStart).search(/^\w+\(\) \{/m);
  return nextFunction < 0
    ? source.slice(start)
    : source.slice(start, bodyStart + nextFunction);
}
