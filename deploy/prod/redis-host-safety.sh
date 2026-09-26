#!/usr/bin/env sh

# Read the kernel setting from a container created by the selected Docker
# daemon. This works with remote contexts and Docker Desktop, where the Docker
# host is not the machine running this script.
probe_redis_host_memory_policy() {
  REDIS_HOST_MEMORY_POLICY_FAILURE=''

  if ! redis_overcommit_value=$(
    docker run --rm \
      --read-only \
      --network none \
      --cap-drop ALL \
      --security-opt no-new-privileges \
      --entrypoint cat \
      redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf \
      /proc/sys/vm/overcommit_memory
  ); then
    REDIS_HOST_MEMORY_POLICY_FAILURE='Could not read vm.overcommit_memory from the Docker daemon host.'
    return 1
  fi

  redis_overcommit_value=$(printf '%s' "$redis_overcommit_value" | tr -d '[:space:]')
  if [ "$redis_overcommit_value" != 1 ]; then
    REDIS_HOST_MEMORY_POLICY_FAILURE="Redis requires vm.overcommit_memory=1 on the Docker daemon host (found '${redis_overcommit_value:-empty}'). Apply 'sysctl -w vm.overcommit_memory=1' there and persist it in /etc/sysctl.d before deployment."
    return 1
  fi
}

# The probe is sourced by both operator entrypoints; keep the message in the
# parent shell without making it part of a child process environment.
redis_host_memory_policy_failure() {
  printf '%s' "$REDIS_HOST_MEMORY_POLICY_FAILURE"
}
