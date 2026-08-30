import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

const postgresImage = "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73";
const redisImage = "redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf";
const cleanupFailureMarker = "data-service sandbox exact cleanup was not proven";

function runSandbox(mode: "combined-failure" | "down-failure" | "owned-remnant") {
  const harness = `#!/usr/bin/env bash
set -eu
mode=\${2:?sandbox mode is required}
timeout() {
  while (( \$# > 0 )); do
    case "\$1" in
      --signal=*|--kill-after=*) shift ;;
      [0-9]*s) shift; break ;;
      *) break ;;
    esac
  done
  "\$@"
}
docker() {
if [[ \${1:-} == compose ]]; then
  command_line=" $* "
  if [[ $command_line == *" config --images postgres redis "* ]]; then
    printf '%s\\n%s\\n' '${postgresImage}' '${redisImage}'
    return 0
  fi
  if [[ $command_line == *" up --detach --wait --wait-timeout 120 --pull never postgres redis "* ]]; then
    [[ $mode == combined-failure ]] && return 23
    return 0
  fi
  if [[ $command_line == *" ps --quiet postgres "* ]]; then
    printf '%064d\\n' 0
    return 0
  fi
  if [[ $command_line == *" ps --quiet redis "* ]]; then
    printf '%064d\\n' 1
    return 0
  fi
  if [[ $command_line == *" down --volumes --remove-orphans "* ]]; then
    [[ $mode == down-failure || $mode == combined-failure ]] && return 41
    return 0
  fi
  return 0
fi
if [[ \${1:-} == image && \${2:-} == inspect ]]; then
  return 0
fi
if [[ \${1:-} == ps ]]; then
  [[ $mode == owned-remnant ]] && printf '%064d\\n' 2
  return 0
fi
if [[ \${1:-} == network && \${2:-} == ls ]]; then
  return 0
fi
if [[ \${1:-} == volume && \${2:-} == ls ]]; then
  return 0
fi
if [[ \${1:-} == inspect ]]; then
  format=\${3:-}
  container=\${4:-}
  case "$format" in
    '{{.Config.User}}')
      [[ $container == "$(printf '%064d' 0)" ]] && printf '70:70\\n' || printf '999:1000\\n'
      ;;
    '{{.HostConfig.ReadonlyRootfs}}') printf 'true\\n' ;;
    '{{json .HostConfig.CapDrop}}') printf '["ALL"]\\n' ;;
    '{{json .HostConfig.SecurityOpt}}') printf '["no-new-privileges:true"]\\n' ;;
    '{{json .HostConfig.Tmpfs}}') printf '{"/tmp":"rw","/var/run/postgresql":"rw"}\\n' ;;
    '{{.State.Health.Status}}') printf 'healthy\\n' ;;
    *) printf 'true\\n' ;;
  esac
  return 0
fi
if [[ \${1:-} == exec ]]; then
  return 0
fi
return 64
}
source "\${1:?sandbox script path is required}"
`;

  return spawnSync(
    "bash",
    ["-s", "--", "scripts/security/verify-data-service-sandbox.sh", mode],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      input: harness,
      timeout: 30_000,
    },
  );
}

describe("data-service sandbox exact cleanup", () => {
  it("fails a successful verification when Compose down fails", () => {
    const result = runSandbox("down-failure");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(cleanupFailureMarker);
  });

  it("fails a successful verification when an owned resource remains", () => {
    const result = runSandbox("owned-remnant");

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(cleanupFailureMarker);
  });

  it("preserves the primary status and reports a simultaneous cleanup failure", () => {
    const result = runSandbox("combined-failure");

    expect(result.status).toBe(23);
    expect(result.stderr).toContain(cleanupFailureMarker);
  });
});
