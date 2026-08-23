export const REDIS_OVERCOMMIT_ERROR =
  "Redis requires vm.overcommit_memory=1. Apply 'sysctl -w vm.overcommit_memory=1' "
  + "and persist it in /etc/sysctl.d before deployment.";

export function assertRedisOvercommitValue(value) {
  if (String(value).trim() !== "1") {
    throw new Error(REDIS_OVERCOMMIT_ERROR);
  }
}
