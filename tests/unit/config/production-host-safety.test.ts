import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  assertRedisOvercommitProbeResult,
  redisOvercommitProbeArgs,
} from "../../../deploy/prod/host-safety.mjs";

const deploy = readFileSync("deploy.sh", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const nodeDeploy = readFileSync("deploy/prod/prod.mjs", "utf8");
const shellProbe = readFileSync("deploy/prod/redis-host-safety.sh", "utf8");

function posixShell() {
  const pathShell = spawnSync("sh", ["-c", ":"], {
    encoding: "utf8",
    shell: false,
    stdio: "ignore",
  });
  if (!pathShell.error && pathShell.status === 0) return "sh";

  const candidates = process.platform === "win32"
    ? [
        "C:\\Program Files\\Git\\bin\\sh.exe",
        "C:\\Program Files\\Git\\usr\\bin\\sh.exe",
      ]
    : ["/bin/sh", "/usr/bin/sh"];

  return candidates.find((candidate) => existsSync(candidate));
}

function runShellProbe(mockDocker: string) {
  const shell = posixShell();
  if (!shell) throw new Error("A POSIX shell is required to test deployment scripts");

  return spawnSync(shell, [
    "-c",
    `. ./deploy/prod/redis-host-safety.sh
docker() { ${mockDocker}; }
if probe_redis_host_memory_policy; then
  printf 'accepted\\n'
else
  printf 'rejected: %s\\n' "$REDIS_HOST_MEMORY_POLICY_FAILURE"
fi`,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
  });
}

function shellFunction(source: string, name: string) {
  const start = source.indexOf(`${name}() {`);
  const end = start < 0 ? -1 : source.indexOf("\n}", start);

  return start < 0 || end < 0 ? "" : source.slice(start, end + 2);
}

function shellCaseBranch(source: string, name: string) {
  const start = source.indexOf(`  ${name})`);
  const end = start < 0 ? -1 : source.indexOf(";;", start);

  return start < 0 || end < 0 ? "" : source.slice(start, end + 2);
}

function expectBefore(source: string, before: string, after: string, context: string) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  expect(beforeIndex, `${context}: ${before}`).toBeGreaterThan(-1);
  expect(afterIndex, `${context}: ${after}`).toBeGreaterThan(-1);
  expect(beforeIndex, context).toBeLessThan(afterIndex);
}

describe("production host safety", () => {
  it("reads overcommit from an isolated container on the selected Docker daemon", () => {
    expect(redisOvercommitProbeArgs()).toEqual([
      "run",
      "--rm",
      "--read-only",
      "--network",
      "none",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--entrypoint",
      "cat",
      "redis:7-alpine",
      "/proc/sys/vm/overcommit_memory",
    ]);

    expect(shellProbe).toContain("docker run --rm");
    for (const option of [
      "--read-only",
      "--network none",
      "--cap-drop ALL",
      "--security-opt no-new-privileges",
      "--entrypoint cat",
      "redis:7-alpine",
      "/proc/sys/vm/overcommit_memory",
    ]) {
      expect(shellProbe, option).toContain(option);
    }
    expect(shellProbe).not.toMatch(/\[\s+-r\s+[^\n]*overcommit_memory/);
    expect(nodeDeploy).toContain('spawnSync("docker", redisOvercommitProbeArgs()');
  });

  it("checks the Docker host before every supported Redis start path", () => {
    for (const [file, source, functionName] of [
      ["deploy.sh", deploy, "prepare_compose"],
      ["start.sh", rootStart, "start"],
    ] as const) {
      const body = shellFunction(source, functionName);
      expect(body, `${file}: ${functionName}`).not.toBe("");
      expectBefore(
        body,
        "ensure_redis_host_memory_policy",
        "ensure_network",
        `${file}: ${functionName}`,
      );
    }

    expect(shellFunction(deploy, "ensure_redis_host_memory_policy")).toContain(
      'probe_redis_host_memory_policy || die "$REDIS_HOST_MEMORY_POLICY_FAILURE"',
    );
    expect(shellFunction(rootStart, "ensure_redis_host_memory_policy")).toContain(
      'probe_redis_host_memory_policy || fail "$REDIS_HOST_MEMORY_POLICY_FAILURE"',
    );

    const rootStartBody = shellFunction(rootStart, "start");
    expectBefore(
      rootStartBody,
      "ensure_redis_host_memory_policy",
      "compose up",
      "start.sh: start",
    );

    const installServices = shellFunction(deploy, "install_services");
    expect(installServices, "deploy.sh: install_services").toContain("compose up");
    for (const functionName of ["up", "setup"]) {
      expectBefore(
        shellFunction(deploy, functionName),
        "prepare_compose",
        "install_services",
        `deploy.sh: ${functionName}`,
      );
    }

    const restart = shellCaseBranch(deploy, "restart");
    expect(restart, "deploy.sh: restart").not.toBe("");
    expectBefore(
      restart,
      "ensure_redis_host_memory_policy",
      "compose restart",
      "deploy.sh: restart",
    );

    const nodeUp = nodeDeploy.slice(nodeDeploy.indexOf('case "up"'));
    expectBefore(
      nodeUp,
      "assertRedisHostMemoryPolicy();",
      "ensureEdgeNetwork();",
      "deploy/prod/prod.mjs: up",
    );
    expectBefore(
      nodeUp,
      "assertRedisHostMemoryPolicy();",
      "runDocker(composeArgs(\"up\"",
      "deploy/prod/prod.mjs: up",
    );
  });

  it("accepts a safe Docker-host value", () => {
    expect(() => assertRedisOvercommitProbeResult({
      status: 0,
      stdout: "1\n",
      stderr: "",
    })).not.toThrow();

    const shellResult = runShellProbe("printf '1\\n'");
    expect(shellResult.status).toBe(0);
    expect(shellResult.stdout).toBe("accepted\n");
  });

  it("rejects unsafe values and failed Docker-host inspection", () => {
    for (const unsafeValue of ["0\n", "2\n", "", "invalid\n"]) {
      expect(() => assertRedisOvercommitProbeResult({
        status: 0,
        stdout: unsafeValue,
        stderr: "",
      }), unsafeValue).toThrow(
        "Redis requires vm.overcommit_memory=1 on the Docker daemon host",
      );
    }

    expect(() => assertRedisOvercommitProbeResult({
      status: 125,
      stdout: "",
      stderr: "Cannot connect to the Docker daemon",
    })).toThrow(
      "Could not read vm.overcommit_memory from the Docker daemon host. "
      + "Cannot connect to the Docker daemon",
    );

    const unsafeShellResult = runShellProbe("printf '0\\n'");
    expect(unsafeShellResult.status).toBe(0);
    expect(unsafeShellResult.stdout).toContain(
      "rejected: Redis requires vm.overcommit_memory=1 on the Docker daemon host",
    );

    const failedShellResult = runShellProbe("return 125");
    expect(failedShellResult.status).toBe(0);
    expect(failedShellResult.stdout).toBe(
      "rejected: Could not read vm.overcommit_memory from the Docker daemon host.\n",
    );
  });
});
