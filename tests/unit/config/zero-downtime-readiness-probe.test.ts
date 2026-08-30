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
const providerProbeSource = extractProviderProbeSource(zeroDowntime);
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

  it("proves the complete disposable provider contract from inside the canary", () => {
    const result = runProviderProbe(`
      const statuses=[200,422,422,422,405,200];
      const paths=['/api/v1/public/plans/public','/api/v1/public/auth/email/start',
        '/api/v1/public/auth/identify','/api/v1/public/auth/service-session',
        '/api/v1/public/auth/notification-preferences','/.well-known/jwks.json'];
      let index=0;
      globalThis.fetch=async(input,init)=>{
        const url=new URL(String(input));
        if(url.pathname!==paths[index]||init.redirect!=='error'||init.cache!=='no-store'
          ||!(init.signal instanceof AbortSignal))throw new Error('invalid probe contract');
        if(index===0||index===5){
          if(init.method!==undefined||init.body!==undefined||init.headers!==undefined)
            throw new Error('public probe carried credentials');
        }else if(init.method!=='POST'||init.body!=='{}'
          ||init.headers?.['content-type']!=='application/json'
          ||init.headers?.['x-remnashop-auth-service-key']!==process.env.REMNASHOP_AUTH_SERVICE_KEY){
          throw new Error('credential probe contract changed');
        }
        const body=index===5?JSON.stringify({keys:[{}]}):'';
        return new Response(body,{status:statuses[index++]});
      };
    `);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("provider-contract-ok\n");
    expect(providerProbeSource).toContain("AbortSignal.timeout(5000)");
    expect(providerProbeSource).toContain("redirect:'error'");
    expect(providerProbeSource).toContain("const maximumJwksBytes=1048576");
  });

  it.each([
    ["plans", [503], "provider-plans-contract\n"],
    ["email start", [200, 401], "provider-email-start-contract\n"],
    ["identify", [200, 422, 401], "provider-identify-contract\n"],
    ["service session", [200, 422, 422, 401], "provider-service-session-contract\n"],
    ["notification preferences", [200, 422, 422, 422, 404], "provider-notification-contract\n"],
    ["JWKS", [200, 422, 422, 422, 405, 503], "provider-jwks-contract\n"],
  ])("projects only the fixed %s failure", (_label, statuses, expected) => {
    const result = runProviderProbe(`
      const statuses=${JSON.stringify(statuses)};
      let index=0;
      globalThis.fetch=async()=>new Response('',{status:statuses[index++]});
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(expected);
  });

  it.each([
    ["malformed", "new Response('{',{status:200})"],
    ["empty keys", `new Response(${JSON.stringify(JSON.stringify({ keys: [] }))},{status:200})`],
    ["oversized", "new Response('x'.repeat(1048577),{status:200})"],
  ])("rejects a %s JWKS body with one fixed result", (_label, responseExpression) => {
    const result = runProviderProbe(`
      const statuses=[200,422,422,422,405];
      let index=0;
      globalThis.fetch=async()=>index<statuses.length
        ?new Response('',{status:statuses[index++]})
        :${responseExpression};
    `);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("provider-jwks-contract\n");
  });

  it("fails closed without disclosing a provider transport error", () => {
    const injected = "https://credential:secret@provider.invalid/private";
    const result = runProviderProbe(
      `globalThis.fetch=async()=>{throw new Error(${JSON.stringify(injected)})};`,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("provider-transport-failed\n");
    expect(`${result.stdout}${result.stderr}`).not.toContain(injected);
  });

  it.each([
    ["credentialed override", "http://user:secret@zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json", undefined],
    ["override query", "http://zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json?probe=1", undefined],
    ["override fragment", "http://zdt-readiness-0123456789abcdef:4190/.well-known/jwks.json#probe", undefined],
    ["wrong port", "http://zdt-readiness-0123456789abcdef:4191/.well-known/jwks.json", undefined],
    ["wrong resource", "http://zdt-readiness-0123456789abcdeg:4190/.well-known/jwks.json", undefined],
    ["different Remnashop origin", undefined, "http://other-provider:4190/api/v1/public"],
  ])("rejects a %s before issuing a request", (_label, override, base) => {
    const result = runProviderProbe(
      "globalThis.fetch=async()=>{throw new Error('fetch must not run')};",
      {
        ...(override ? { CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL: override } : {}),
        ...(base ? { REMNASHOP_API_BASE_URL: base } : {}),
      },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("provider-env-mismatch\n");
  });

  it("rejects a missing provider key before issuing a request", () => {
    const result = runProviderProbe(
      "globalThis.fetch=async()=>{throw new Error('fetch must not run')};",
      { REMNASHOP_AUTH_SERVICE_KEY: "" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("provider-key-missing\n");
  });

  it("runs the sanitized diagnostic only after a disposable provider readiness failure", () => {
    const call = "diagnose_disposable_canary_provider";
    const loopEnd = zeroDowntime.indexOf('fail "canary did not become ready within 180 seconds');
    const diagnosticCall = zeroDowntime.lastIndexOf(call, loopEnd);
    expect(diagnosticCall).toBeGreaterThan(zeroDowntime.indexOf("while [ \"$attempt\" -lt 90 ]"));
    expect(zeroDowntime.slice(diagnosticCall - 160, diagnosticCall)).toContain(
      "not-ready:remnashop|not-ready:telegramOidc",
    );
    expect(shellFunction(zeroDowntime, call)).toContain(
      '[ "$DISPOSABLE_CANARY_PROVIDER_VALIDATED" = true ] || return 0',
    );
    expect(shellFunction(zeroDowntime, call)).toContain("provider-probe-invalid");
    expect(shellFunction(zeroDowntime, call)).toContain(
      "timeout --signal=TERM --kill-after=2s 8s",
    );

    const timedOut = runProviderDiagnosticTimeoutHarness();
    expect(timedOut.status, timedOut.stderr).toBe(0);
    expect(timedOut.stdout).toBe("");
    expect(timedOut.stderr).toBe("provider-probe-failed\n");
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

    const currentOrigin = `http://zdt-readiness-${suffix}:4191`;
    const current = runJwksGuard({
      projectName: `clean-pay-zdt-${suffix}`,
      edgeNetwork: `clean-pay-zdt-edge-${suffix}`,
      jwksUrl: `${currentOrigin}/.well-known/jwks.json`,
      remnashopBaseUrl: `${currentOrigin}/api/v1/public`,
    });
    expect(current.status, current.stderr).toBe(0);
    expect(current.stdout).toBe("accepted\n");
    expect(rehearsal).toContain("readonly READINESS_PROVIDER_PORT=4191");

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

function runNode(
  program: string,
  extraEnv: Record<string, string | undefined> = {},
) {
  return spawnSync(process.execPath, ["--input-type=module", "--eval", program], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      READINESS_INTERNAL_SECRET: "synthetic-readiness-secret",
      ...extraEnv,
    },
    timeout: 5_000,
    windowsHide: true,
  });
}

function runProviderProbe(
  setup: string,
  overrides: Record<string, string | undefined> = {},
) {
  const origin = "http://zdt-readiness-0123456789abcdef:4190";
  return runNode(`${setup}\n${providerProbeSource}`, {
    CLEAN_PAY_READINESS_TELEGRAM_OIDC_JWKS_URL: `${origin}/.well-known/jwks.json`,
    REMNASHOP_API_BASE_URL: `${origin}/api/v1/public`,
    REMNASHOP_AUTH_SERVICE_KEY: "synthetic-provider-key-1234567890",
    ...overrides,
  });
}

function extractProbeSource(source: string) {
  const match = /if readiness_result=\$\(docker exec "\$CANARY_NAME" node -e "\n([\s\S]*?)\n    " 2>\/dev\/null\); then/u.exec(
    source,
  );
  if (!match?.[1]) throw new Error("zero-downtime readiness probe source is unavailable");
  return match[1];
}

function extractProviderProbeSource(source: string) {
  const match = /docker exec "\$CANARY_NAME" node -e "\n([\s\S]*?)\n  " 2>\/dev\/null\); then/u.exec(
    shellFunction(source, "diagnose_disposable_canary_provider"),
  );
  if (!match?.[1]) throw new Error("disposable provider probe source is unavailable");
  return match[1];
}

function runProviderDiagnosticTimeoutHarness() {
  const harness = `
set -eu
${shellFunction(zeroDowntime, "diagnose_disposable_canary_provider")}
timeout() { return 124; }
DISPOSABLE_CANARY_PROVIDER_VALIDATED=true
CANARY_NAME=synthetic-canary
diagnose_disposable_canary_provider
`;
  return spawnSync(posixShell!, ["-c", harness], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: process.env.PATH ?? "" },
    timeout: 5_000,
    windowsHide: true,
  });
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
DISPOSABLE_CANARY_PROVIDER_VALIDATED=false
validate_canary_readiness_telegram_oidc_jwks_url
[ "$DISPOSABLE_CANARY_PROVIDER_VALIDATED" = true ]
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
