import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const zeroDowntime = readFileSync("deploy/prod/zero-downtime-app.sh", "utf8");
const rehearsal = readFileSync(
  "scripts/security/rehearse-zero-downtime-image-rollback.sh",
  "utf8",
);
const probeSource = extractProbeSource(zeroDowntime);
const posixShell = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/sh.exe", "C:/Program Files/Git/usr/bin/sh.exe"]
      .find((candidate) => existsSync(candidate))
  : "sh";
const readyChecks = {
  database: { status: "ok", latencyMs: 1 },
  redis: { status: "ok", latencyMs: 1 },
  remnashop: { status: "ok", latencyMs: 1 },
  telegramOidc: { status: "ok", latencyMs: 1 },
};

describe("zero-downtime sanitized readiness diagnostics", () => {
  it("reports ready only for the complete successful detailed contract", () => {
    const result = runProbe(`new Response(${JSON.stringify(JSON.stringify({
      status: "ok",
      checks: readyChecks,
      service: "clean-pay",
    }))},{status:200})`);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("ready\n");
  });

  it("projects only an allowlisted failing name and never its message", () => {
    const injected = "credential=must-never-appear";
    const result = runProbe(`new Response(${JSON.stringify(JSON.stringify({
      status: "degraded",
      checks: {
        ...readyChecks,
        telegramOidc: { status: "down", latencyMs: 1, message: injected },
      },
      unexpected: injected,
    }))},{status:503})`);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("not-ready:telegramOidc\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(injected);
  });

  it.each([
    ["malformed", "new Response('{',{status:503})", "invalid-response\n"],
    [
      "oversized",
      "new Response('x'.repeat(65537),{status:503})",
      "invalid-response\n",
    ],
    [
      "unknown check",
      `new Response(${JSON.stringify(JSON.stringify({
        status: "degraded",
        checks: { ...readyChecks, injected: { status: "down" } },
      }))},{status:503})`,
      "invalid-response\n",
    ],
    [
      "null checks projection",
      `new Response(${JSON.stringify(JSON.stringify({ status: "degraded", checks: null }))},{status:503})`,
      "invalid-response\n",
    ],
    [
      "missing checks projection",
      `new Response(${JSON.stringify(JSON.stringify({ status: "degraded" }))},{status:503})`,
      "invalid-response\n",
    ],
    [
      "invalid UTF-8",
      "new Response(new Uint8Array([0xc3,0x28]),{status:503})",
      "invalid-response\n",
    ],
  ])("fails closed for a %s response", (_label, responseExpression, expected) => {
    const result = runProbe(responseExpression);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(expected);
  });

  it("uses a fixed transport failure and an error-only redirect policy", () => {
    const injected = "https://user:password@example.test/private";
    const program = `globalThis.fetch=async()=>{throw new Error(${JSON.stringify(injected)})};\n${probeSource}`;
    const result = runNode(program);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("request-failed\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(injected);
    expect(probeSource).toContain("redirect:'error'");
    expect(probeSource).toContain("const maximumBytes=65536");
  });

  it("limits the JWKS override to the exact owned disposable provider contract", () => {
    expect(zeroDowntime).toContain("^clean-pay-zdt-[a-f0-9]{16}$");
    expect(zeroDowntime).toContain('"clean-pay-zdt-edge-${suffix}"');
    expect(zeroDowntime).toContain('"$expected_origin/api/v1/public"');
    expect(zeroDowntime).toContain(
      '"$expected_origin/.well-known/jwks.json"',
    );
    expect(rehearsal).toContain(
      'CLEAN_PAY_ZDT_CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL="http://$READINESS_PROVIDER_ALIAS:$READINESS_PROVIDER_PORT/.well-known/jwks.json"',
    );
  });

  it("executes the disposable JWKS guard before accepting an override", () => {
    expect(posixShell, "a POSIX shell is required for the production guard contract")
      .toBeDefined();
    const suffix = "0123456789abcdef";
    const expectedOrigin = `http://zdt-readiness-${suffix}:4190`;
    const valid = runJwksGuard({
      projectName: `clean-pay-zdt-${suffix}`,
      edgeNetwork: `clean-pay-zdt-edge-${suffix}`,
      jwksUrl: `${expectedOrigin}/.well-known/jwks.json`,
      remnashopBaseUrl: `${expectedOrigin}/api/v1/public`,
    });
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toBe("accepted\n");

    for (const invalid of [
      { projectName: `clean-pay-zdt-${suffix.slice(0, -1)}g` },
      { edgeNetwork: `clean-pay-zdt-edge-${suffix}-other` },
      { jwksUrl: `${expectedOrigin}/.well-known/jwks.json?probe=1` },
      { remnashopBaseUrl: "http://other-provider:4190/api/v1/public" },
    ]) {
      const result = runJwksGuard({
        projectName: `clean-pay-zdt-${suffix}`,
        edgeNetwork: `clean-pay-zdt-edge-${suffix}`,
        jwksUrl: `${expectedOrigin}/.well-known/jwks.json`,
        remnashopBaseUrl: `${expectedOrigin}/api/v1/public`,
        ...invalid,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
    }
  });
});

function runProbe(responseExpression: string) {
  return runNode(`globalThis.fetch=async()=>${responseExpression};\n${probeSource}`);
}

function runNode(program: string) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      READINESS_INTERNAL_SECRET: "synthetic-readiness-secret",
    },
    timeout: 5_000,
    windowsHide: true,
  });
}

function extractProbeSource(source: string) {
  const match = /if readiness_result=\$\(docker exec "\$CANARY_NAME" node -e "\n([\s\S]*?)\n    " 2>\/dev\/null\); then/u.exec(
    source,
  );
  if (!match?.[1]) throw new Error("zero-downtime readiness probe source is unavailable");
  return match[1];
}

function shellFunction(source: string, name: string) {
  const start = source.indexOf(`${name}() {`);
  if (start < 0) throw new Error(`${name} is unavailable`);
  const bodyStart = source.indexOf("\n", start) + 1;
  const nextFunction = source.slice(bodyStart).search(/^\w+\(\) \{/m);
  return nextFunction < 0
    ? source.slice(start)
    : source.slice(start, bodyStart + nextFunction);
}

function runJwksGuard({
  projectName,
  edgeNetwork,
  jwksUrl,
  remnashopBaseUrl,
}: {
  projectName: string;
  edgeNetwork: string;
  jwksUrl: string;
  remnashopBaseUrl: string;
}) {
  const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-zdt-jwks-guard-"));
  const envFile = path.join(directory, "synthetic.env");
  writeFileSync(envFile, `REMNASHOP_API_BASE_URL=${remnashopBaseUrl}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  const harness = `
set -eu
${shellFunction(zeroDowntime, "fail")}
${shellFunction(zeroDowntime, "env_file_value")}
${shellFunction(zeroDowntime, "env_value")}
${shellFunction(zeroDowntime, "validate_canary_readiness_telegram_oidc_jwks_url")}
ENV_FILE=$CLEAN_PAY_TEST_ENV_FILE
PROJECT_NAME=$CLEAN_PAY_TEST_PROJECT_NAME
EDGE_NETWORK=$CLEAN_PAY_TEST_EDGE_NETWORK
CANARY_READINESS_TELEGRAM_OIDC_JWKS_URL=$CLEAN_PAY_TEST_JWKS_URL
validate_canary_readiness_telegram_oidc_jwks_url
printf 'accepted\\n'
`;

  try {
    return spawnSync(posixShell!, ["-c", harness], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        NODE_ENV: "test",
        PATH: process.env.PATH ?? "",
        CLEAN_PAY_TEST_ENV_FILE: envFile,
        CLEAN_PAY_TEST_PROJECT_NAME: projectName,
        CLEAN_PAY_TEST_EDGE_NETWORK: edgeNetwork,
        CLEAN_PAY_TEST_JWKS_URL: jwksUrl,
      },
      timeout: 5_000,
      windowsHide: true,
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
