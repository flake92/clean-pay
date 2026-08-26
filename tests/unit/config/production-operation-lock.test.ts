import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  acquireProductionOperationLock,
  exitCodeAfterProductionOperationLockRelease,
  releaseProductionOperationLock,
} from "../../../deploy/prod/production-operation-lock.mjs";

const temporaryDirectories: string[] = [];
const posixShell = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/sh.exe", "C:/Program Files/Git/usr/bin/sh.exe"]
      .find((candidate) => existsSync(candidate))
  : "sh";
const shellIntegrationTimeout = process.platform === "win32" ? 45_000 : 15_000;

function shellFunctionFrom(source: string, name: string) {
  const start = source.indexOf(`${name}() {`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("\n", start) + 1;
  const nextFunction = source.slice(bodyStart).search(/^\w+\(\) \{/m);
  return nextFunction < 0
    ? source.slice(start)
    : source.slice(start, bodyStart + nextFunction);
}

function operationLockPath() {
  const directory = mkdtempSync(join(tmpdir(), "clean-pay-operation-lock-"));
  temporaryDirectories.push(directory);
  if (process.platform !== "win32") chmodSync(directory, 0o700);
  return join(directory, ".production-operation.lock");
}

function releasePersistedOperationLock(path: string) {
  const payload = JSON.parse(readFileSync(path, "utf8")) as { token?: string };
  expect(payload.token).toMatch(/^[0-9a-f]{64}$/);
  releaseProductionOperationLock(path, payload.token!);
}

function runShellEntrypointCleanup(
  entrypoint: "deploy" | "start",
  mode: "success" | "error" | "term",
  releaseStatus: 0 | 1,
) {
  const source = readFileSync(entrypoint === "deploy" ? "deploy.sh" : "start.sh", "utf8");
  const cleanupName = entrypoint === "deploy"
    ? "cleanup_deploy_state"
    : "cleanup_start_state";
  const releaseStub = entrypoint === "deploy"
    ? 'operation_lock_command() { return "$RELEASE_STATUS"; }'
    : 'node() { return "$RELEASE_STATUS"; }';
  const harness = `
set -eu
operation_lock_token='owner-token'
secret_input_stty=''
verified_image_output=''
verified_image_dir=''
CLEAN_PAY_VERIFIED_APP_IMAGE=''
CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=''
OPERATION_LOCK_SCRIPT=/synthetic/production-operation-lock.mjs
OPERATION_LOCK_PATH=/synthetic/.production-operation.lock
restore_secret_input_terminal() { :; }
cleanup_verified_images() { :; }
${releaseStub}
${shellFunctionFrom(source, "release_production_operation_lock")}
${shellFunctionFrom(source, cleanupName)}
trap ${cleanupName} 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
case "$MODE" in
  success) : ;;
  error) exit 17 ;;
  term) kill -TERM "$$" ;;
esac
`;
  return spawnSync(posixShell!, ["-c", harness], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      MODE: mode,
      RELEASE_STATUS: String(releaseStatus),
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("production operation mutual exclusion", () => {
  it("rejects a concurrent operation and never auto-removes an existing lock", () => {
    const path = operationLockPath();
    const token = acquireProductionOperationLock(path, "migrate");
    const payload = JSON.parse(readFileSync(path, "utf8")) as {
      helperPid?: number;
      operation?: string;
      ownerPid?: number;
      pid?: number;
    };

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(payload).toMatchObject({
      helperPid: process.pid,
      operation: "migrate",
      ownerPid: process.pid,
      pid: process.pid,
    });
    expect(() => acquireProductionOperationLock(path, "restart"))
      .toThrow("another production operation is active");
    expect(existsSync(path)).toBe(true);

    releaseProductionOperationLock(path, token);
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a non-owner release without deleting the lock", () => {
    const path = operationLockPath();
    const token = acquireProductionOperationLock(path, "install");

    expect(() => releaseProductionOperationLock(path, "0".repeat(64)))
      .toThrow("ownership token does not match");
    expect(existsSync(path)).toBe(true);

    releaseProductionOperationLock(path, token);
  });

  it("validates explicit owner PIDs and releases legacy token-only metadata", () => {
    const invalidPath = operationLockPath();
    for (const invalidPid of [0, -1, 1.5, 0x1_0000_0000, Number.NaN]) {
      expect(() => acquireProductionOperationLock(
        invalidPath,
        "restart",
        invalidPid,
      )).toThrow("production operation owner PID is invalid");
      expect(existsSync(invalidPath)).toBe(false);
    }

    const script = resolve("deploy/prod/production-operation-lock.mjs");
    for (const invalidPid of ["0", "01", "-1", "1.5", "4294967296"]) {
      const invalidCli = spawnSync(
        process.execPath,
        [script, "acquire", invalidPath, "restart", invalidPid],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(invalidCli.status).not.toBe(0);
      expect(invalidCli.stderr).toContain("production operation owner PID is invalid");
      expect(existsSync(invalidPath)).toBe(false);
    }

    const legacyPath = operationLockPath();
    const legacyToken = "a".repeat(64);
    writeFileSync(legacyPath, `${JSON.stringify({
      operation: "install",
      pid: 123,
      startedAt: "2026-08-26T00:00:00.000Z",
      token: legacyToken,
    })}\n`, { encoding: "utf8", mode: 0o600 });
    if (process.platform !== "win32") chmodSync(legacyPath, 0o600);
    expect(() => releaseProductionOperationLock(legacyPath, legacyToken)).not.toThrow();
    expect(existsSync(legacyPath)).toBe(false);
  });

  it("promotes only a successful owner-release failure to a nonzero exit", () => {
    expect(exitCodeAfterProductionOperationLockRelease(0, true)).toBe(0);
    expect(exitCodeAfterProductionOperationLockRelease(0, false)).toBe(1);
    expect(exitCodeAfterProductionOperationLockRelease(17, false)).toBe(17);
    expect(exitCodeAfterProductionOperationLockRelease(143, false)).toBe(143);

    const helperUrl = pathToFileURL(
      resolve("deploy/prod/production-operation-lock.mjs"),
    ).href;
    const harness = `
import { exitCodeAfterProductionOperationLockRelease } from ${JSON.stringify(helperUrl)};
const originalExitCode = Number(process.env.ORIGINAL_EXIT_CODE);
const releaseSucceeded = process.env.RELEASE_SUCCEEDED === "true";
process.once("exit", (exitCode) => {
  const finalExitCode = exitCodeAfterProductionOperationLockRelease(
    exitCode,
    releaseSucceeded,
  );
  if (finalExitCode !== exitCode) process.exitCode = finalExitCode;
});
process.exit(originalExitCode);
`;
    for (const [originalExitCode, releaseSucceeded, expectedExitCode] of [
      [0, true, 0],
      [0, false, 1],
      [17, false, 17],
      [143, false, 143],
    ] as const) {
      const child = spawnSync(process.execPath, ["--input-type=module", "-e", harness], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ORIGINAL_EXIT_CODE: String(originalExitCode),
          RELEASE_SUCCEEDED: String(releaseSucceeded),
        },
      });
      expect(child.status, child.stderr).toBe(expectedExitCode);
    }
  });

  it.skipIf(!posixShell)(
    "propagates deploy and start release failures without masking prior status",
    () => {
      for (const entrypoint of ["deploy", "start"] as const) {
        expect(runShellEntrypointCleanup(entrypoint, "success", 0).status).toBe(0);
        for (const [mode, expectedStatus] of [
          ["success", 1],
          ["error", 17],
          ["term", 143],
        ] as const) {
          const result = runShellEntrypointCleanup(entrypoint, mode, 1);
          expect(result.status, `${entrypoint}/${mode}: ${result.stderr}`)
            .toBe(expectedStatus);
          expect(result.stderr).toContain("production operation lock release failed");
        }
      }
    },
    shellIntegrationTimeout,
  );

  it("shares one guarded lock path across every production role-env materializer", () => {
    const deploy = readFileSync("deploy.sh", "utf8");
    const start = readFileSync("start.sh", "utf8");
    const prod = readFileSync("deploy/prod/prod.mjs", "utf8");
    const zeroDowntime = readFileSync("deploy/prod/zero-downtime-app.sh", "utf8");

    for (const source of [deploy, start]) {
      expect(source).toContain("deploy/prod/.production-operation.lock");
      expect(source).toContain("production-operation-lock.mjs");
      expect(source).toContain("trap cleanup_");
      expect(source).not.toMatch(/(?:mv|rename)\s+-?f?\s*[^\n]*\.env/);
      expect(source).toContain('"$operation_name" "$$"');
    }
    expect(deploy).toMatch(
      /setup\|configure\|config\|init\|compose\|check\|build\|migrate\|resolve-rolled-back\|install\|up\|restart\|down\)[\s\S]{0,100}acquire_production_operation_lock/,
    );
    expect(start).toMatch(
      /start\|up\|stop\|down\|restart\|build\)[\s\S]{0,100}acquire_production_operation_lock/,
    );
    expect(prod).toContain('./production-operation-lock.mjs');
    expect(prod).toContain('path.join(prodDir, ".production-operation.lock")');
    expect(prod).toContain(
      'new Set(["build", "up", "down", "logs", "ps", "verify"])',
    );
    expect(prod).toContain('new Set(["logs", "ps", "verify"])');
    expect(prod.indexOf("acquireOwnedProductionOperationLock(command)")).toBeLessThan(
      prod.indexOf("requireEnvFile();\nvalidateProductionEnvFile();"),
    );
    expect(prod.indexOf("validateProductionEnvFile();")).toBeLessThan(
      prod.indexOf("observationalCommands.has(command)"),
    );
    expect(prod.indexOf("observationalCommands.has(command)")).toBeLessThan(
      prod.indexOf("switch (command)"),
    );
    expect(prod).toContain("exitCodeAfterProductionOperationLockRelease");
    expect(prod).toContain("`prod-${operation}`,\n      process.pid,");
    expect(deploy).toContain(
      '"$lock_mode" deploy/prod/.production-operation.lock "$@"',
    );
    expect(prod).toContain('process.once("exit"');
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      expect(prod).toContain(`process.once("${signal}"`);
    }
    expect(zeroDowntime).toContain("deploy/prod/.production-operation.lock");
    expect(zeroDowntime).toContain("production-operation-lock.mjs");
    expect(zeroDowntime).toContain('"$operation_name" "$$"');
    expect(zeroDowntime).toMatch(
      /stage\|verify\|promote\|rollback\|remove\|status\)[\s\S]{0,120}acquire_production_operation_lock/,
    );
    expect(zeroDowntime.indexOf('acquire_production_operation_lock "zero-downtime-$COMMAND"'))
      .toBeLessThan(zeroDowntime.lastIndexOf("require_tools_and_environment"));
    expect(zeroDowntime).toContain("release_production_operation_lock");
    expect(zeroDowntime).toContain("trap on_exit 0");
    expect(deploy).toContain("credential-file-guard.mjs env-set");
    expect(start).toContain("$CREDENTIAL_FILE_GUARD_SCRIPT\" env-set");
  });

  it.skipIf(!posixShell)(
    "interoperates with Node owners and releases the zero-downtime token on failures and signals",
    () => {
      const source = readFileSync("deploy/prod/zero-downtime-app.sh", "utf8");
      const path = operationLockPath();
      const harness = `
set -eu
lock_held=0
operation_lock_token=''
verified_image_dir=''
verified_image_output=''
state_temp=''
rollback_compose_on_failure=0
cleanup_canary_on_failure=0
CANARY_NAME=''
LOCK_DIR="\${OPERATION_LOCK_PATH}.private"
${shellFunctionFrom(source, "fail")}
${shellFunctionFrom(source, "release_lock")}
${shellFunctionFrom(source, "acquire_production_operation_lock")}
${shellFunctionFrom(source, "release_production_operation_lock")}
${shellFunctionFrom(source, "cleanup_private_files")}
${shellFunctionFrom(source, "on_exit")}
trap on_exit 0
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
acquire_production_operation_lock zero-downtime-stage
case "$MODE" in
  contend)
    if node "$OPERATION_LOCK_SCRIPT" acquire "$OPERATION_LOCK_PATH" prod-up; then
      fail "a second production owner unexpectedly acquired the lock"
    fi
    [ -f "$OPERATION_LOCK_PATH" ]
    ;;
  fail) exit 17 ;;
  term) kill -TERM "$$" ;;
  release-fail-success)
    operation_lock_token='0000000000000000000000000000000000000000000000000000000000000000'
    ;;
  release-fail-error)
    operation_lock_token='0000000000000000000000000000000000000000000000000000000000000000'
    exit 17
    ;;
  release-fail-term)
    operation_lock_token='0000000000000000000000000000000000000000000000000000000000000000'
    kill -TERM "$$"
    ;;
  private-release-fail-success)
    mkdir "$LOCK_DIR"
    : > "$LOCK_DIR/blocker"
    lock_held=1
    ;;
  private-release-fail-error)
    mkdir "$LOCK_DIR"
    : > "$LOCK_DIR/blocker"
    lock_held=1
    exit 17
    ;;
  private-release-fail-term)
    mkdir "$LOCK_DIR"
    : > "$LOCK_DIR/blocker"
    lock_held=1
    kill -TERM "$$"
    ;;
  metadata)
    metadata=$(node -e '
      const { readFileSync } = require("node:fs");
      const payload = JSON.parse(readFileSync(process.argv[1], "utf8"));
      process.stdout.write(
        String(payload.ownerPid) + " " + String(payload.helperPid) + " " + String(payload.pid),
      );
    ' "$OPERATION_LOCK_PATH")
    set -- $metadata
    [ "$1" = "$$" ]
    [ "$3" = "$$" ]
    case "$2" in ''|*[!0-9]*) exit 88 ;; esac
    kill -0 "$1"
    printf 'owner=%s helper=%s shell=%s\n' "$1" "$2" "$$"
    ;;
  *) fail "unknown harness mode" ;;
esac
`;
      const environment = (mode: string): NodeJS.ProcessEnv => ({
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        MODE: mode,
        OPERATION_LOCK_PATH: path.replaceAll("\\", "/"),
        OPERATION_LOCK_SCRIPT: resolve("deploy/prod/production-operation-lock.mjs")
          .replaceAll("\\", "/"),
      });

      const deployToken = acquireProductionOperationLock(path, "restart");
      const rejected = spawnSync(posixShell!, ["-c", harness], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment("contend"),
      });
      expect(rejected.status).not.toBe(0);
      expect(rejected.stderr).toContain("another production operation is active");
      expect(existsSync(path)).toBe(true);
      releaseProductionOperationLock(path, deployToken);

      const contended = spawnSync(posixShell!, ["-c", harness], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment("contend"),
      });
      expect(contended.status, contended.stderr).toBe(0);
      expect(contended.stderr).toContain("another production operation is active");
      expect(existsSync(path)).toBe(false);

      const metadata = spawnSync(posixShell!, ["-c", harness], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: environment("metadata"),
      });
      expect(metadata.status, metadata.stderr).toBe(0);
      expect(metadata.stdout).toMatch(/owner=[0-9]+ helper=[0-9]+ shell=[0-9]+/);
      expect(existsSync(path)).toBe(false);

      for (const mode of ["fail", "term"]) {
        const interrupted = spawnSync(posixShell!, ["-c", harness], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: environment(mode),
        });
        expect(interrupted.status, `${mode}: ${interrupted.stderr}`).not.toBe(0);
        expect(existsSync(path), mode).toBe(false);
      }

      for (const [mode, expectedStatus] of [
        ["release-fail-success", 1],
        ["release-fail-error", 17],
        ["release-fail-term", 143],
      ] as const) {
        const releaseFailed = spawnSync(posixShell!, ["-c", harness], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: environment(mode),
        });
        expect(releaseFailed.status, `${mode}: ${releaseFailed.stderr}`)
          .toBe(expectedStatus);
        expect(releaseFailed.stderr).toContain(
          "production operation lock release failed",
        );
        expect(existsSync(path), mode).toBe(true);
        releasePersistedOperationLock(path);
      }

      for (const [mode, expectedStatus] of [
        ["private-release-fail-success", 1],
        ["private-release-fail-error", 17],
        ["private-release-fail-term", 143],
      ] as const) {
        const privateReleaseFailed = spawnSync(posixShell!, ["-c", harness], {
          cwd: process.cwd(),
          encoding: "utf8",
          env: environment(mode),
        });
        expect(
          privateReleaseFailed.status,
          `${mode}: ${privateReleaseFailed.stderr}`,
        ).toBe(expectedStatus);
        expect(privateReleaseFailed.stderr).toContain(
          "could not remove exact lock directory",
        );
        expect(existsSync(path)).toBe(false);
        const privateLockPath = `${path}.private`;
        expect(existsSync(privateLockPath)).toBe(true);
        rmSync(privateLockPath, { force: true, recursive: true });
      }
    },
    shellIntegrationTimeout,
  );
});
