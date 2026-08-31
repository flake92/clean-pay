import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";
import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";
import {
  cleanupGeneratedEnvironment,
  cleanupRetainedGeneratedEnvironment,
  prepareGeneratedEnvironmentDirectory,
  writeSanitizedJourneyContractEvidence,
} from "./journey-generated-environment-lifecycle.mjs";

const mode = process.argv[2] ?? "run";
if (!new Set(["run", "cleanup"]).has(mode) || process.argv.length > 3) {
  throw new Error("usage: run-production-image-journey.mjs [run|cleanup]");
}

const repositoryRoot = process.cwd();
const project = required(
  "CLEAN_PAY_BROWSER_COMPOSE_PROJECT",
  /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/,
);
const envDirectory = path.resolve(required("CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR", /.+/));
const journeyComposeFiles = [
  path.join(repositoryRoot, "deploy", "prod", "docker-compose.yml"),
  path.join(repositoryRoot, "tests", "browser", "journeys", "docker-compose.journey.yml"),
];
const publicCharacterizationComposeFiles = [
  ...journeyComposeFiles,
  path.join(
    repositoryRoot,
    "tests",
    "browser",
    "journeys",
    "docker-compose.public-characterization.yml",
  ),
];
const composeEnvironment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: project,
  CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE: digest(project).slice(0, 16),
  CLEAN_PAY_BROWSER_CADDYFILE: path.join(repositoryRoot, "tests", "browser", "journeys", "Caddyfile"),
  CLEAN_PAY_BROWSER_PROVIDER_MOCK_FILE: path.join(repositoryRoot, "tests", "browser", "journeys", "provider-mock.mjs"),
  CLEAN_PAY_BROWSER_OIDC_MOCK_FILE: path.join(repositoryRoot, "tests", "browser", "journeys", "oidc-mock.mjs"),
  CLEAN_PAY_BROWSER_DB_OBSERVER_FILE: path.join(repositoryRoot, "tests", "browser", "journeys", "db-observer.mjs"),
  CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_FILE: path.join(
    repositoryRoot,
    "tests",
    "browser",
    "journeys",
    "db-observer-provision.sh",
  ),
};

if (mode === "cleanup") {
  await cleanupOwnedProject();
  const generatedEnvironment = await cleanupRetainedEnvironmentIfPresent();
  process.stdout.write(`${JSON.stringify({
    status: "owned_project_cleaned",
    projectSha256: digest(project),
    generatedEnvironment,
  })}\n`);
  process.exit(0);
}

required("CLEAN_PAY_BROWSER_SOURCE_REVISION", /^[a-f0-9]{40}$/);
required("CLEAN_PAY_BROWSER_SOURCE_IMAGE_DIGEST", /^sha256:[a-f0-9]{64}$/);
required("CLEAN_PAY_BROWSER_SOURCE_IMAGE_TAG", /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/);
required("CLEAN_PAY_BROWSER_MIGRATION_IMAGE_DIGEST", /^sha256:[a-f0-9]{64}$/);
required("CLEAN_PAY_BROWSER_MIGRATION_IMAGE_TAG", /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,199}$/);

let generatedEnvironmentState;
let finalSummary;
try {
  generatedEnvironmentState = await prepareGeneratedEnvironmentDirectory({
    directory: envDirectory,
    project,
  });
  await assertProjectAbsent();
  await runPrivate(process.execPath, [
    path.join(repositoryRoot, "tests", "browser", "journeys", "prepare-synthetic-env.mjs"),
  ], { ...composeEnvironment, CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR: envDirectory });
  const envFile = path.join(envDirectory, ".env");
  const contract = JSON.parse(await readFile(
    path.join(envDirectory, "browser-journey-contract.json"),
    "utf8",
  ));
  const currentFixtureContractSha256 = await currentJourneyFixtureContractSha256Async();
  if (
    contract?.project !== project
    || contract?.fixtureContract?.domain !== "clean-pay-browser-journey-fixture-v5"
    || contract?.fixtureContract?.sha256 !== currentFixtureContractSha256
    || !/^[a-f0-9]{64}$/.test(contract?.publicBuildContract?.sha256 ?? "")
    || !/^127\.0\.0\.1:\d{4,5}$/.test(contract?.publications?.app ?? "")
    || !/^127\.0\.0\.1:\d{4,5}$/.test(contract?.publications?.providerControl ?? "")
    || !/^127\.0\.0\.1:\d{4,5}$/.test(contract?.publications?.connectProxy ?? "")
    || !/^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4]):443$/
      .test(contract?.publications?.browserTls ?? "")
  ) {
    throw new Error("Synthetic journey environment returned an invalid public contract.");
  }
  const { evidence: sanitizedContractEvidence } = await writeSanitizedJourneyContractEvidence({
    contract,
    repositoryRoot,
  });

  let completed = false;
  let connectProxy;
  let connectProxyCounters;
  try {
    await startOwnedProject(envFile, publicCharacterizationComposeFiles);
    const mainBrowserEnvironment = browserTestEnvironment({
      CLEAN_PAY_BROWSER_BASE_URL: `http://${contract.publications.app}`,
    });
    await runPlaywright("config/playwright.config.ts", mainBrowserEnvironment);

    // The authenticated journey has a deliberately different support/Chatwoot
    // fixture. Recreate every owned resource so its reset ledger still starts
    // from a pristine project and the public characterization cannot leak state.
    await cleanupOwnedProject();
    await assertProjectAbsent();

    await startOwnedProject(envFile, journeyComposeFiles);
    const [connectProxyHost, connectProxyPort] = contract.publications.connectProxy.split(":");
    const [browserTlsHost, browserTlsPort] = contract.publications.browserTls.split(":");
    connectProxy = await startConnectProxy({
      listenHost: connectProxyHost,
      listenPort: connectProxyPort,
      targetHost: process.env.CLEAN_PAY_BROWSER_CONNECT_TARGET_HOST?.trim() || browserTlsHost,
      targetPort: process.env.CLEAN_PAY_BROWSER_CONNECT_TARGET_PORT?.trim() || browserTlsPort,
    });
    const journeyBrowserEnvironment = browserTestEnvironment({
      CLEAN_PAY_BROWSER_BASE_URL: "https://pay.ci.clean-pay.dev",
      CLEAN_PAY_BROWSER_HOST_RESOLVER_IP: contract.publications.browserTls.slice(0, -4),
      CLEAN_PAY_BROWSER_CONNECT_PROXY: `http://${contract.publications.connectProxy}`,
      CLEAN_PAY_BROWSER_PROVIDER_CONTROL_URL: `http://${contract.publications.providerControl}/`,
      CLEAN_PAY_BROWSER_PUBLIC_BUILD_CONTRACT_SHA256: contract.publicBuildContract.sha256,
    });
    await runPlaywright(
      "tests/browser/journeys/playwright.config.ts",
      journeyBrowserEnvironment,
    );
    const runningConnectProxy = connectProxy;
    connectProxy = undefined;
    const connectProxySummary = await stopConnectProxy(runningConnectProxy);
    assertConnectProxyGate(connectProxySummary);
    connectProxyCounters = connectProxySummary.counters;
    await run(process.execPath, [
      path.join(repositoryRoot, "tests", "browser", "journeys", "finalize-journey-baseline.mjs"),
    ], journeyBrowserEnvironment);
    completed = true;
  } finally {
    try {
      if (connectProxy) await stopConnectProxy(connectProxy);
    } finally {
      await cleanupOwnedProject();
    }
  }

  if (!completed) throw new Error("Production-image journey did not complete.");
  finalSummary = {
    status: "production_image_journey_matched",
    projectSha256: sanitizedContractEvidence.projectSha256,
    publicBuildContractSha256: contract.publicBuildContract.sha256,
    fixtureContractSha256: contract.fixtureContract.sha256,
    connectProxyCounters,
    generatedEnvironment: "exact-files-removed",
  };
} finally {
  if (generatedEnvironmentState) {
    await cleanupGeneratedEnvironment(generatedEnvironmentState);
  }
}

process.stdout.write(`${JSON.stringify(finalSummary)}\n`);

function compose(args) {
  return run("docker", ["compose", "--project-name", project, ...args], composeEnvironment);
}

async function cleanupRetainedEnvironmentIfPresent() {
  try {
    return await cleanupRetainedGeneratedEnvironment({
      directory: envDirectory,
      project,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return Object.freeze({
        status: "generated_environment_not_present",
        projectSha256: digest(project),
        directoryRemoved: false,
      });
    }
    throw error;
  }
}

function composeFileArgs(files) {
  return files.flatMap((file) => ["--file", file]);
}

async function startOwnedProject(envFile, files) {
  await compose(["--env-file", envFile, ...composeFileArgs(files), "config", "--quiet"]);
  await compose([
    "--env-file", envFile,
    ...composeFileArgs(files),
    "up", "--detach", "--no-build", "--wait", "--wait-timeout", "240",
  ]);
  await assertOwnedResources();
}

async function assertProjectAbsent() {
  const resources = await ownedResources();
  if (resources.some((entry) => entry.ids.length > 0)) {
    throw new Error(`Refusing to reuse non-empty journey project ${project}.`);
  }
}

async function assertOwnedResources() {
  const resources = await ownedResources();
  const containers = resources.find((entry) => entry.kind === "container")?.ids ?? [];
  if (containers.length < 5) {
    throw new Error(`Journey project ${project} did not create its complete isolated stack.`);
  }
  for (const id of containers) {
    const inspected = (await output("docker", [
      "container", "inspect", "--format",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      id,
    ])).trim();
    if (inspected !== project) {
      throw new Error(`Container ${id.slice(0, 12)} is not owned by ${project}.`);
    }
  }
}

async function cleanupOwnedProject() {
  const resources = await ownedResources();
  if (!resources.some((entry) => entry.ids.length > 0)) return;
  await assertEveryResourceOwned(resources);
  const envFile = path.join(envDirectory, ".env");
  const args = [
    ...(await readable(envFile) ? ["--env-file", envFile] : []),
    ...composeFileArgs(publicCharacterizationComposeFiles),
    "down", "--volumes", "--timeout", "120",
  ];
  await compose(args);
  const remaining = await ownedResources();
  if (remaining.some((entry) => entry.ids.length > 0)) {
    throw new Error(`Owned journey project ${project} was not completely removed.`);
  }
}

async function assertEveryResourceOwned(resources) {
  for (const resource of resources) {
    for (const id of resource.ids) {
      const args = resource.kind === "container"
        ? ["container", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', id]
        : resource.kind === "network"
          ? ["network", "inspect", "--format", '{{index .Labels "com.docker.compose.project"}}', id]
          : ["volume", "inspect", "--format", '{{index .Labels "com.docker.compose.project"}}', id];
      if ((await output("docker", args)).trim() !== project) {
        throw new Error(`Refusing cleanup: ${resource.kind} ${id} is not owned by ${project}.`);
      }
    }
  }
}

async function ownedResources() {
  const filter = `label=com.docker.compose.project=${project}`;
  const values = await Promise.all([
    output("docker", ["ps", "--all", "--quiet", "--filter", filter]),
    output("docker", ["network", "ls", "--quiet", "--filter", filter]),
    output("docker", ["volume", "ls", "--quiet", "--filter", filter]),
  ]);
  return ["container", "network", "volume"].map((kind, index) => ({
    kind,
    ids: values[index].split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  }));
}

function output(command, args) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let settled = false;
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: composeEnvironment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      finish(() => reject(new Error("Read-only owned-resource query timed out.")));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes + chunkBytes > 1024 * 1024) {
        overflow = true;
        child.kill();
        return;
      }
      stdout += chunk;
      stdoutBytes += chunkBytes;
    });
    child.stderr.on("data", (chunk) => {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (stderrBytes + chunkBytes > 16 * 1024) {
        overflow = true;
        child.kill();
        return;
      }
      stderr += chunk;
      stderrBytes += chunkBytes;
    });
    child.once("error", () => finish(() => reject(new Error(
      "Read-only owned-resource query failed to start.",
    ))));
    child.once("exit", (code) => {
      if (code === 0 && !overflow) finish(() => resolve(stdout));
      else finish(() => reject(new Error(
        `Read-only owned-resource query failed (${code ?? "unknown"}:${digest(stderr)}).`,
      )));
    });
  });
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${code ?? signal ?? "unknown"}).`));
    });
  });
}

function runPrivate(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let stderrBytes = 0;
    let overflow = false;
    let settled = false;
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      finish(() => reject(new Error("Private synthetic environment generation timed out.")));
    }, 30_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (stderrBytes + chunkBytes > 16 * 1024) {
        overflow = true;
        child.kill();
        return;
      }
      stderr += chunk;
      stderrBytes += chunkBytes;
    });
    child.once("error", () => finish(() => reject(new Error(
      "Private synthetic environment generation failed to start.",
    ))));
    child.once("exit", (code) => {
      if (code === 0 && !overflow) finish(resolve);
      else finish(() => reject(new Error(
        `Private synthetic environment generation failed (${code ?? "unknown"}:${digest(stderr)}).`,
      )));
    });
  });
}

function browserTestEnvironment(overrides) {
  const environment = { ...composeEnvironment, ...overrides };
  delete environment.CLEAN_PAY_UPDATE_BASELINE;
  delete environment.CLEAN_PAY_UPDATE_JOURNEY_BASELINE;
  delete environment.CLEAN_PAY_BROWSER_JOURNEY_PROBE;
  delete environment.CLEAN_PAY_BROWSER_EXPECTED_CONSOLE_SHA256;
  // These inputs have already been materialized into the authoritative
  // synthetic contract. Do not leak them into contract tests that invoke the
  // generator again to verify its documented defaults.
  delete environment.CLEAN_PAY_BROWSER_APP_PORT;
  delete environment.CLEAN_PAY_BROWSER_PROVIDER_PORT;
  delete environment.CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT;
  delete environment.CLEAN_PAY_BROWSER_PROXY_BIND;
  delete environment.CLEAN_PAY_BROWSER_TURNSTILE_SITE_KEY;
  return environment;
}

function runPlaywright(config, environment) {
  return run(process.execPath, [
    path.join(repositoryRoot, "node_modules", "playwright", "cli.js"),
    "test",
    `--config=${config}`,
  ], environment);
}

function startConnectProxy({ listenHost, listenPort, targetHost, targetPort }) {
  if (
    listenHost !== "127.0.0.1"
    || !/^\d{4,5}$/.test(listenPort)
    || String(Number(listenPort)) !== listenPort
    || Number(listenPort) > 65_535
    || Number(listenPort) === 443
    || !/^127\.0\.0\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(targetHost)
    || !/^\d{2,5}$/.test(targetPort)
    || String(Number(targetPort)) !== targetPort
    || Number(targetPort) > 65_535
  ) {
    throw new Error("Journey CONNECT proxy contract is invalid.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(repositoryRoot, "tests", "browser", "journeys", "journey-connect-proxy.mjs"),
    ], {
      cwd: repositoryRoot,
      env: {
        ...composeEnvironment,
        CLEAN_PAY_BROWSER_CONNECT_PROXY_BIND: listenHost,
        CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT: listenPort,
        CLEAN_PAY_BROWSER_CONNECT_TARGET_HOST: targetHost,
        CLEAN_PAY_BROWSER_CONNECT_TARGET_PORT: targetPort,
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const expected = {
      listen: `${listenHost}:${listenPort}`,
      target: `${targetHost}:${targetPort}`,
    };
    let stdoutBuffer = "";
    let stderr = "";
    let ready = false;
    let startSettled = false;
    let stoppedSettled = false;
    let resolveStopped;
    let rejectStopped;
    const stopped = new Promise((stoppedResolve, stoppedReject) => {
      resolveStopped = stoppedResolve;
      rejectStopped = stoppedReject;
    });
    void stopped.catch(() => undefined);
    let resolveClosed;
    const closed = new Promise((closedResolve) => {
      resolveClosed = closedResolve;
    });
    const handle = {
      child,
      closed,
      expected,
      get stderr() { return stderr; },
      stopped,
    };
    const finishStart = (operation) => {
      if (startSettled) return;
      startSettled = true;
      clearTimeout(timer);
      operation();
    };
    const protocolFailure = (message) => {
      const error = new Error(message);
      if (!ready) finishStart(() => reject(error));
      if (!stoppedSettled) {
        stoppedSettled = true;
        rejectStopped(error);
      }
      if (child.exitCode === null && child.signalCode === null) child.kill();
    };
    const timer = setTimeout(() => {
      protocolFailure("Journey CONNECT proxy readiness timed out.");
    }, 10_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2_048) stderr += chunk.slice(0, 2_048 - stderr.length);
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      if (stdoutBuffer.length > 8_192) {
        protocolFailure("Journey CONNECT proxy output exceeded its bounded contract.");
        return;
      }
      let newline;
      while ((newline = stdoutBuffer.indexOf("\n")) >= 0) {
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          protocolFailure("Journey CONNECT proxy emitted invalid JSON.");
          return;
        }
        if (message?.status === "ready" && !ready) {
          if (!validConnectProxyReady(message, expected)) {
            protocolFailure("Journey CONNECT proxy readiness contract did not match.");
            return;
          }
          ready = true;
          finishStart(() => resolve(handle));
          continue;
        }
        if (message?.status === "stopped" && ready && !stoppedSettled) {
          stoppedSettled = true;
          resolveStopped(message);
          continue;
        }
        protocolFailure("Journey CONNECT proxy emitted an unexpected lifecycle message.");
        return;
      }
    });
    child.once("error", (error) => protocolFailure(
      `Journey CONNECT proxy process error: ${sanitize(error.message)}`,
    ));
    child.stdin.once("error", (error) => protocolFailure(
      `Journey CONNECT proxy control channel failed: ${sanitize(error.message)}`,
    ));
    child.once("close", (code, signal) => {
      resolveClosed({ code, signal });
      if (!ready) {
        finishStart(() => reject(new Error(
          `Journey CONNECT proxy exited before readiness (${code ?? signal ?? "unknown"}): ${sanitize(stderr)}`,
        )));
      }
      if (!stoppedSettled) {
        stoppedSettled = true;
        rejectStopped(new Error(
          `Journey CONNECT proxy exited without a stopped summary (${code ?? signal ?? "unknown"}): ${sanitize(stderr)}`,
        ));
      }
    });
  });
}

async function stopConnectProxy(handle) {
  if (!handle) throw new Error("Journey CONNECT proxy handle is missing.");
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.stdin.end("stop\n");
  }
  let timer;
  try {
    const [summary, closed] = await Promise.race([
      Promise.all([handle.stopped, handle.closed]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          "Journey CONNECT proxy shutdown timed out.",
        )), 5_000);
      }),
    ]);
    if (closed.code !== 0 || closed.signal !== null) {
      throw new Error(
        `Journey CONNECT proxy shutdown failed (${closed.code ?? closed.signal ?? "unknown"}): `
        + sanitize(handle.stderr),
      );
    }
    if (!validConnectProxyStopped(summary, handle.expected)) {
      throw new Error("Journey CONNECT proxy stopped summary did not match its exact contract.");
    }
    if (sanitize(handle.stderr)) {
      throw new Error(`Journey CONNECT proxy emitted unexpected diagnostics: ${sanitize(handle.stderr)}`);
    }
    return summary;
  } catch (error) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) handle.child.kill();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function validConnectProxyReady(value, expected) {
  return hasExactKeys(value, ["allowedHostCount", "limits", "listen", "status", "target"])
    && value.status === "ready"
    && value.listen === expected.listen
    && value.target === expected.target
    && value.allowedHostCount === JOURNEY_SYNTHETIC_HOSTNAMES.length
    && hasExactKeys(value.limits, [
      "establishedIdleTimeoutMs",
      "maxClientConnections",
      "maxHeaderBytes",
      "prefaceTimeoutMs",
      "upstreamConnectTimeoutMs",
    ])
    && Object.values(value.limits).every((entry) => Number.isSafeInteger(entry) && entry > 0);
}

function validConnectProxyStopped(value, expected) {
  return hasExactKeys(value, [
    "allowedHostCount",
    "counters",
    "listen",
    "outcome",
    "status",
    "target",
  ])
    && value.status === "stopped"
    && value.outcome === "clean"
    && value.listen === expected.listen
    && value.target === expected.target
    && value.allowedHostCount === JOURNEY_SYNTHETIC_HOSTNAMES.length
    && hasExactKeys(value.counters, [
      "accepted",
      "rejected",
      "upstreamAttempts",
      "upstreamConnected",
      "upstreamFailures",
    ])
    && Object.values(value.counters).every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function assertConnectProxyGate(summary) {
  const counters = summary.counters;
  if (
    counters.rejected !== 0
    || counters.upstreamFailures !== 0
    || counters.upstreamAttempts !== counters.upstreamConnected
    || counters.accepted !== counters.upstreamConnected
  ) {
    throw new Error(
      `Journey CONNECT proxy fail-closed gate rejected its sanitized counters: ${JSON.stringify(counters)}`,
    );
  }
}

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

async function readable(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

function sanitize(value) {
  return value.replace(/(password|secret|token|authorization)=[^\s]+/gi, "$1=<redacted>")
    .replace(/\s+/g, " ").trim().slice(0, 2_000);
}

function required(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`${name} is required and invalid.`);
  return value;
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
