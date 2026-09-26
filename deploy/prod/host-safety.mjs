export const REDIS_OVERCOMMIT_ERROR =
  "Redis requires vm.overcommit_memory=1 on the Docker daemon host. Apply "
  + "'sysctl -w vm.overcommit_memory=1' there and persist it in /etc/sysctl.d "
  + "before deployment.";

export const REDIS_OVERCOMMIT_INSPECTION_ERROR =
  "Could not read vm.overcommit_memory from the Docker daemon host.";

export function redisOvercommitProbeArgs() {
  return [
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
    "redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf",
    "/proc/sys/vm/overcommit_memory",
  ];
}

export function assertRedisOvercommitValue(value) {
  if (String(value).trim() !== "1") {
    throw new Error(REDIS_OVERCOMMIT_ERROR);
  }
}

export function assertRedisOvercommitProbeResult(result) {
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || String(result.stderr || "").trim();
    throw new Error(
      detail
        ? `${REDIS_OVERCOMMIT_INSPECTION_ERROR} ${detail}`
        : REDIS_OVERCOMMIT_INSPECTION_ERROR,
    );
  }

  assertRedisOvercommitValue(result.stdout);
}
