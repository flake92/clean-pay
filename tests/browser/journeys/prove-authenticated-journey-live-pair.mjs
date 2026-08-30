import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

import { validateProductionImageAssetAttestation } from "../../../scripts/security/prove-served-cabinet-assets.mjs";
import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";
import { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";
import {
  journeyDockerCliEnvironment,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
} from "./journey-owned-stack-orchestrator.mjs";
import {
  assertJourneyStackContract,
  assertProviderOverlapImagePlatformParity,
} from "./provider-overlap-proof-contract.mjs";
import {
  UNVERIFIED_EMAIL_PROOF_FILENAME,
  assertUnverifiedEmailLoginProof,
} from "./unverified-email-login-proof-contract.mjs";

const repositoryRoot = path.resolve(process.cwd());
const localPlaywrightCli = path.join(repositoryRoot, "node_modules", "playwright", "cli.js");
const journeyConfig = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "playwright.config.ts",
);
const unverifiedEmailConfig = path.join(
  repositoryRoot,
  "tests",
  "browser",
  "journeys",
  "unverified-email-login.playwright.config.ts",
);
const connectProxyTerminationGraceMs = 2_000;
const connectProxyForceKillGraceMs = 2_000;
const connectProxyAbsenceGateMs = 2_000;
let captureId;

class AuthenticatedJourneyConnectStartError extends Error {
  constructor(message, cleanupHandle) {
    super(message);
    this.name = "AuthenticatedJourneyConnectStartError";
    Object.defineProperty(this, "cleanupHandle", {
      configurable: false,
      enumerable: false,
      value: cleanupHandle,
      writable: false,
    });
  }
}

try {
  const argumentsByName = parseArguments(process.argv.slice(2));
  captureId = requiredArgument(argumentsByName, "--capture-id", /^[a-f0-9]{16}$/);
  const unverifiedEmailProofOutput = await exactUnverifiedEmailProofOutput(
    requiredArgument(argumentsByName, "--candidate-unverified-email-proof-output", /.+/),
  );
  await assertRepositoryRoot();
  const [baselineInput, candidateInput, livePair] = await Promise.all([
    readStackInput(argumentsByName, "baseline"),
    readStackInput(argumentsByName, "candidate"),
    loadLivePairApi(),
  ]);
  assertDistinctStackInputs(baselineInput, candidateInput);

  const session = await withJourneyOwnedStackPair({
    baseline: ownedStackInput(baselineInput),
    candidate: ownedStackInput(candidateInput),
  }, async (owned) => {
    const baselineBinding = livePair.createJourneyLivePairStackBinding(stackBinding({
      input: baselineInput,
      owned: owned.baseline,
      launch: owned.launch,
      role: "baseline",
    }));
    const candidateBinding = livePair.createJourneyLivePairStackBinding(stackBinding({
      input: candidateInput,
      owned: owned.candidate,
      launch: owned.launch,
      role: "candidate",
    }));
    const evidence = await livePair.prepareJourneyLivePairEvidence({
      captureId,
      baseline: baselineBinding,
      candidate: candidateBinding,
    });
    const proxies = await startProxyPair(baselineInput, candidateInput);
    let proxySummaries;
    let captureFailure;
    let candidateUnverifiedEmail;
    try {
      const captureSettlements = await Promise.allSettled(
        ["baseline", "candidate"].map(async (role) => {
          const input = role === "baseline" ? baselineInput : candidateInput;
          const binding = role === "baseline" ? baselineBinding : candidateBinding;
          const ownership = evidence.roles[role];
          await runJourneyCapture({ input, binding, ownership, livePair });
        }),
      );
      const failures = captureSettlements
        .filter(({ status }) => status === "rejected")
        .map(({ reason }) => reason);
      if (failures.length > 0) {
        captureFailure = new AggregateError(
          failures,
          "Both authenticated live-pair browser captures must settle before cleanup.",
        );
      }
      if (!captureFailure) {
        try {
          candidateUnverifiedEmail = await runCandidateUnverifiedEmailRegression({
            binding: candidateBinding,
            input: candidateInput,
            output: unverifiedEmailProofOutput,
          });
        } catch (error) {
          captureFailure = error;
        }
      }
    } finally {
      const stopped = await Promise.allSettled([
        stopAndGateProxy(proxies.baseline),
        stopAndGateProxy(proxies.candidate),
      ]);
      const failures = stopped
        .filter(({ status }) => status === "rejected")
        .map(({ reason }) => reason);
      if (failures.length > 0) {
        captureFailure = captureFailure
          ? new AggregateError(
            [captureFailure, ...failures],
            "Authenticated capture and exact CONNECT cleanup both failed.",
          )
          : new AggregateError(failures, "Both authenticated CONNECT proxies must cleanly stop.");
      } else {
        proxySummaries = {
          baseline: stopped[0].value,
          candidate: stopped[1].value,
        };
      }
    }
    if (captureFailure) throw captureFailure;
    if (!proxySummaries) throw new Error("Authenticated CONNECT cleanup ledger is incomplete.");
    return Object.freeze({
      bindings: Object.freeze({ baseline: baselineBinding, candidate: candidateBinding }),
      evidence: Object.freeze({
        pairOwnershipSha256: evidence.pairReceiptSha256,
        baselineOwnershipSha256: evidence.roles.baseline.receiptSha256,
        candidateOwnershipSha256: evidence.roles.candidate.receiptSha256,
      }),
      proxySummaries: Object.freeze(proxySummaries),
      candidateUnverifiedEmail,
    });
  });

  const cleanup = Object.freeze({
    status: "authenticated-journey-live-pair-cleaned",
    stacks: Object.freeze(session.cleanup.stacks.map((entry) => Object.freeze({
      role: entry.role,
      status: entry.status,
      projectSha256: entry.projectSha256,
      generatedEnvironmentDirectorySha256: entry.generatedEnvironmentDirectorySha256,
    }))),
    connectProxies: Object.freeze((["baseline", "candidate"]).map((role) => Object.freeze({
      role,
      status: "stopped-and-verified-absent",
      summarySha256: sha256(JSON.stringify(session.value.proxySummaries[role])),
    }))),
  });
  const proof = await livePair.proveJourneyLivePair({
    captureId,
    pairOwnershipSha256: session.value.evidence.pairOwnershipSha256,
    baseline: {
      bindingSha256: livePair.journeyLivePairBindingSha256(
        session.value.bindings.baseline,
      ),
      ownershipSha256: session.value.evidence.baselineOwnershipSha256,
    },
    candidate: {
      bindingSha256: livePair.journeyLivePairBindingSha256(
        session.value.bindings.candidate,
      ),
      ownershipSha256: session.value.evidence.candidateOwnershipSha256,
    },
    cleanup,
  });
  process.stdout.write(`${JSON.stringify({
    status: "authenticated_journey_live_pair_proven",
    captureId,
    browserCasesPerRole: 18,
    checkpointPngsPerRole: 105,
    rawArtifactsPerRole: 141,
    candidateAuthorizedRegressionCases: 1,
    candidateUnverifiedEmailProofSha256:
      session.value.candidateUnverifiedEmail.proofSha256,
    proofSha256: proof.proofSha256,
    completionSha256: proof.completionSha256,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "authenticated_journey_live_pair_failed",
    ...createJourneySanitizedErrorEvidence(error),
  })}\n`);
  process.exitCode = 1;
}

async function runJourneyCapture({ input, binding, ownership, livePair }) {
  const [resolverIp] = input.contract.publications.browserTls.split(":");
  const environment = journeyDockerCliEnvironment();
  Object.assign(
    environment,
    livePair.authenticatedJourneyLivePairCaptureEnvironment(),
    livePair.journeyLivePairCaptureEnvironment({ captureId, ownership }),
    {
      CI: "1",
      NODE_ENV: "test",
      CLEAN_PAY_BROWSER_BASE_URL: "https://pay.ci.clean-pay.dev",
      CLEAN_PAY_BROWSER_CONNECT_PROXY: `http://${input.contract.publications.connectProxy}`,
      CLEAN_PAY_BROWSER_HOST_RESOLVER_IP: resolverIp,
      CLEAN_PAY_BROWSER_MIGRATION_IMAGE_DIGEST: binding.source.migrationImageDigest,
      CLEAN_PAY_BROWSER_MIGRATION_IMAGE_TAG: binding.source.migrationImageTag,
      CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE:
        livePair.journeyLivePairBindingSha256(binding).slice(0, 16),
      CLEAN_PAY_BROWSER_PROVIDER_CONTROL_URL:
        `http://${input.contract.publications.providerControl}/`,
      CLEAN_PAY_BROWSER_PUBLIC_BUILD_CONTRACT_SHA256:
        binding.source.publicBuildContractSha256,
      CLEAN_PAY_BROWSER_SOURCE_IMAGE_DIGEST: binding.source.imageDigest,
      CLEAN_PAY_BROWSER_SOURCE_IMAGE_TAG: binding.source.imageTag,
      CLEAN_PAY_BROWSER_SOURCE_REVISION: binding.source.revision,
    },
  );
  await boundedProcess(process.execPath, [
    localPlaywrightCli,
    "test",
    "--config",
    journeyConfig,
  ], environment, 1_800_000);
}

async function runCandidateUnverifiedEmailRegression({ binding, input, output }) {
  const [resolverIp] = input.contract.publications.browserTls.split(":");
  const environment = journeyDockerCliEnvironment();
  Object.assign(environment, {
    CI: "1",
    NODE_ENV: "test",
    CLEAN_PAY_BROWSER_BASE_URL: "https://pay.ci.clean-pay.dev",
    CLEAN_PAY_BROWSER_CONNECT_PROXY: `http://${input.contract.publications.connectProxy}`,
    CLEAN_PAY_BROWSER_HOST_RESOLVER_IP: resolverIp,
    CLEAN_PAY_BROWSER_MIGRATION_IMAGE_DIGEST: binding.source.migrationImageDigest,
    CLEAN_PAY_BROWSER_PLAYWRIGHT_OUTPUT_SCOPE: sha256(
      `${captureId}:candidate-unverified-email`,
    ).slice(0, 16),
    CLEAN_PAY_BROWSER_PROVIDER_CONTROL_URL:
      `http://${input.contract.publications.providerControl}/`,
    CLEAN_PAY_BROWSER_SOURCE_IMAGE_DIGEST: binding.source.imageDigest,
    CLEAN_PAY_BROWSER_SOURCE_REVISION: binding.source.revision,
    CLEAN_PAY_BROWSER_UNVERIFIED_EMAIL_PROOF_OUTPUT: output,
  });
  await boundedProcess(process.execPath, [
    localPlaywrightCli,
    "test",
    "--config",
    unverifiedEmailConfig,
  ], environment, 180_000);
  const document = assertUnverifiedEmailLoginProof(
    await readBoundedJson(output, 16_384, "candidate unverified e-mail proof"),
    {
      candidateApplicationImageDigest: binding.source.imageDigest,
      candidateMigrationImageDigest: binding.source.migrationImageDigest,
      candidateRevision: binding.source.revision,
    },
  );
  return Object.freeze({
    status: document.status,
    proofSha256: sha256(JSON.stringify(document)),
  });
}

async function startProxyPair(baselineInput, candidateInput) {
  const starts = await Promise.allSettled([
    Promise.resolve().then(() => startProxy(baselineInput)),
    Promise.resolve().then(() => startProxy(candidateInput)),
  ]);
  const handles = starts.flatMap((result) => (
    result.status === "fulfilled" ? [result.value] : []
  ));
  const failedStartHandles = starts.flatMap((result) => (
    result.status === "rejected"
      && result.reason instanceof AuthenticatedJourneyConnectStartError
      ? [result.reason.cleanupHandle]
      : []
  ));
  const failures = starts.flatMap((result) => (
    result.status === "rejected" ? [result.reason] : []
  ));
  if (failures.length > 0) {
    const cleanup = await Promise.allSettled([
      ...handles.map(stopFullJourneyConnectProxy),
      ...failedStartHandles.map(terminateFailedJourneyConnectProxy),
    ]);
    const cleanupFailures = cleanup.flatMap((result) => (
      result.status === "rejected" ? [result.reason] : []
    ));
    throw new AggregateError(
      [...failures, ...cleanupFailures],
      "Both authenticated CONNECT proxies must start or clean up exactly.",
    );
  }
  return Object.freeze({ baseline: handles[0], candidate: handles[1] });
}

function startProxy(input) {
  const [listenHost, listenPort] = input.contract.publications.connectProxy.split(":");
  const [targetHost, targetPort] = input.contract.publications.browserTls.split(":");
  return startFullJourneyConnectProxy({
    environment: journeyDockerCliEnvironment(),
    listenHost,
    listenPort,
    repositoryRoot,
    targetHost,
    targetPort,
  });
}

async function stopAndGateProxy(handle) {
  const summary = await stopFullJourneyConnectProxy(handle);
  const counters = summary.counters;
  if (
    counters.accepted < 1
    || counters.rejected !== 0
    || counters.upstreamFailures !== 0
    || counters.upstreamAttempts !== counters.upstreamConnected
    || counters.accepted !== counters.upstreamConnected
  ) {
    throw new Error("Authenticated CONNECT proxy counters are not clean.");
  }
  return Object.freeze(summary);
}

function startFullJourneyConnectProxy({
  environment,
  listenHost,
  listenPort,
  repositoryRoot: root,
  targetHost,
  targetPort,
}) {
  if (
    listenHost !== "127.0.0.1"
    || !/^\d{4,5}$/.test(listenPort)
    || String(Number(listenPort)) !== listenPort
    || Number(listenPort) > 65_535
    || Number(listenPort) === 443
    || !/^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(targetHost)
    || targetPort !== "443"
  ) {
    throw new Error("Authenticated journey CONNECT proxy coordinates are invalid.");
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      path.join(root, "tests/browser/journeys/journey-connect-proxy.mjs"),
    ], {
      cwd: root,
      env: {
        ...environment,
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
    const closed = new Promise((closedResolve) => { resolveClosed = closedResolve; });
    const handle = Object.freeze({
      child,
      closed,
      expected,
      stderr: () => stderr,
      stopped,
    });
    const finishStart = (operation) => {
      if (startSettled) return;
      startSettled = true;
      clearTimeout(readinessTimer);
      operation();
    };
    const protocolFailure = (message) => {
      const error = ready
        ? new Error(message)
        : new AuthenticatedJourneyConnectStartError(message, handle);
      if (!ready) finishStart(() => reject(error));
      if (!stoppedSettled) {
        stoppedSettled = true;
        rejectStopped(error);
      }
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    };
    const readinessTimer = setTimeout(
      () => protocolFailure("Authenticated journey CONNECT readiness timed out."),
      10_000,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2_048) stderr += chunk.slice(0, 2_048 - stderr.length);
    });
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      if (Buffer.byteLength(stdoutBuffer, "utf8") > 8_192) {
        protocolFailure("Authenticated journey CONNECT output exceeded its bound.");
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
          protocolFailure("Authenticated journey CONNECT emitted invalid JSON.");
          return;
        }
        if (message?.status === "ready" && !ready) {
          if (!validFullJourneyProxyReady(message, expected)) {
            protocolFailure("Authenticated journey CONNECT readiness contract changed.");
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
        protocolFailure("Authenticated journey CONNECT emitted an unexpected lifecycle event.");
        return;
      }
    });
    child.once("error", () => protocolFailure("Authenticated journey CONNECT process failed."));
    child.stdin.once("error", () => protocolFailure(
      "Authenticated journey CONNECT control channel failed.",
    ));
    child.once("close", (code, signal) => {
      resolveClosed({ code, signal });
      if (!ready) {
        finishStart(() => reject(new Error(
          "Authenticated journey CONNECT exited before readiness.",
        )));
      }
      if (!stoppedSettled) {
        stoppedSettled = true;
        rejectStopped(new Error(
          "Authenticated journey CONNECT exited without a stopped summary.",
        ));
      }
    });
  });
}

async function stopFullJourneyConnectProxy(handle) {
  if (!handle) throw new Error("Authenticated journey CONNECT handle is missing.");
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.stdin.end("stop\n");
  }
  let timer;
  try {
    const [summary, closed] = await Promise.race([
      Promise.all([handle.stopped, handle.closed]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Authenticated journey CONNECT shutdown timed out.")),
          5_000,
        );
      }),
    ]);
    if (
      closed.code !== 0
      || closed.signal !== null
      || !validFullJourneyProxyStopped(summary, handle.expected)
      || handle.stderr().trim()
    ) {
      throw new Error("Authenticated journey CONNECT clean shutdown was not proven.");
    }
    await assertFullJourneyConnectProxyListenerAbsent(handle.expected.listen);
    return summary;
  } catch (error) {
    try {
      await terminateFailedJourneyConnectProxy(handle);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Authenticated journey CONNECT failed and bounded process cleanup was not proven.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function terminateFailedJourneyConnectProxy(handle) {
  if (!handle?.child || !handle?.closed || !handle?.expected?.listen) {
    throw new Error("Authenticated journey CONNECT failure cleanup handle is invalid.");
  }
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.kill("SIGTERM");
  }
  let closed = await waitForConnectProxyClose(
    handle.closed,
    connectProxyTerminationGraceMs,
  );
  if (closed === null) {
    if (handle.child.exitCode === null && handle.child.signalCode === null) {
      handle.child.kill("SIGKILL");
    }
    closed = await waitForConnectProxyClose(
      handle.closed,
      connectProxyForceKillGraceMs,
    );
  }
  if (closed === null
    || handle.child.exitCode === null && handle.child.signalCode === null) {
    throw new Error("Authenticated journey CONNECT process survived bounded SIGTERM/SIGKILL.");
  }
  await assertFullJourneyConnectProxyListenerAbsent(handle.expected.listen);
  return closed;
}

async function waitForConnectProxyClose(closedPromise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      closedPromise,
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function assertFullJourneyConnectProxyListenerAbsent(listen) {
  const match = /^(127\.0\.0\.1):([1-9]\d{3,4})$/.exec(listen);
  if (!match || Number(match[2]) > 65_535) {
    throw new Error("Authenticated journey CONNECT absence coordinates are invalid.");
  }
  const host = match[1];
  const port = Number(match[2]);
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const closeAndFinish = (error) => {
      if (!probe.listening) {
        finish(error);
        return;
      }
      probe.close((closeError) => finish(error ?? closeError ?? undefined));
    };
    const timer = setTimeout(() => closeAndFinish(
      new Error("Authenticated journey CONNECT listener absence gate timed out."),
    ), connectProxyAbsenceGateMs);
    probe.once("error", (error) => finish(new Error(
      "Authenticated journey CONNECT listener remains after process cleanup.",
      { cause: error },
    )));
    probe.listen({ exclusive: true, host, port }, () => closeAndFinish());
  });
}

function validFullJourneyProxyReady(value, expected) {
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

function validFullJourneyProxyStopped(value, expected) {
  return hasExactKeys(value, [
    "allowedHostCount", "counters", "listen", "outcome", "status", "target",
  ])
    && value.status === "stopped"
    && value.outcome === "clean"
    && value.listen === expected.listen
    && value.target === expected.target
    && value.allowedHostCount === JOURNEY_SYNTHETIC_HOSTNAMES.length
    && hasExactKeys(value.counters, [
      "accepted", "rejected", "upstreamAttempts", "upstreamConnected", "upstreamFailures",
    ])
    && Object.values(value.counters).every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function stackBinding({ input, launch, owned, role }) {
  return {
    schemaVersion: 1,
    role,
    source: {
      revision: input.contract.revision,
      imageDigest: input.expectedAssetImageDigest,
      imageTag: input.contract.images.application,
      migrationImageDigest: input.expectedMigrationAssetImageDigest,
      migrationImageTag: input.contract.images.migration,
      publicBuildContractSha256: input.contract.publicBuildContract.sha256,
      fixtureContractSha256: input.contract.fixtureContract.sha256,
    },
    runtime: {
      projectSha256: sha256(input.contract.project),
      generatedEnvironmentDirectorySha256:
        owned.inputReceipt.generatedEnvironmentDirectorySha256,
      launchReceiptSha256: sha256(JSON.stringify(launch)),
      runtimeAttestationSha256: sha256(JSON.stringify(owned.runtime)),
    },
  };
}

async function loadLivePairApi() {
  const require = createRequire(path.join(repositoryRoot, "package.json"));
  const playwrightCommon = require(path.join(
    repositoryRoot,
    "node_modules",
    "playwright",
    "lib",
    "common",
    "index.js",
  ));
  const transform = playwrightCommon?.transform;
  if (!transform || typeof transform.requireOrImport !== "function"
    || typeof transform.setSingleTSConfig !== "function") {
    throw new Error("Pinned Playwright TypeScript loader is unavailable.");
  }
  transform.setSingleTSConfig(path.join(repositoryRoot, "tsconfig.json"));
  const [evidence, proof, mode] = await Promise.all([
    transform.requireOrImport(path.join(
      repositoryRoot,
      "tests/browser/journeys/journey-live-pair-evidence.ts",
    )),
    transform.requireOrImport(path.join(
      repositoryRoot,
      "tests/browser/journeys/journey-live-pair-proof.ts",
    )),
    transform.requireOrImport(path.join(
      repositoryRoot,
      "tests/browser/journeys/authenticated-journey-capture-mode.ts",
    )),
  ]);
  for (const [name, value] of Object.entries({
    authenticatedJourneyLivePairCaptureEnvironment:
      mode.authenticatedJourneyLivePairCaptureEnvironment,
    createJourneyLivePairStackBinding: evidence.createJourneyLivePairStackBinding,
    journeyLivePairBindingSha256: evidence.journeyLivePairBindingSha256,
    journeyLivePairCaptureEnvironment: evidence.journeyLivePairCaptureEnvironment,
    prepareJourneyLivePairEvidence: evidence.prepareJourneyLivePairEvidence,
    proveJourneyLivePair: proof.proveJourneyLivePair,
  })) {
    if (typeof value !== "function") {
      throw new Error(`Authenticated live-pair TypeScript API is missing ${name}.`);
    }
  }
  return Object.freeze({ ...evidence, ...proof, ...mode });
}

async function readStackInput(argumentsByName, role) {
  const contractPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-contract`, /.+/),
    `${role} contract`,
  );
  const contract = assertJourneyStackContract(
    await readBoundedJson(contractPath, 64 * 1024, `${role} contract`),
    role,
  );
  const expectedAssetImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-asset-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  const expectedMigrationAssetImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-migration-asset-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  const assetAttestationPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-asset-attestation`, /.+/),
    `${role} asset attestation`,
  );
  const assetDocument = await readBoundedJson(
    assetAttestationPath,
    32 * 1024 * 1024,
    `${role} asset attestation`,
  );
  const expectedPlatform = Object.freeze(parseAssetPlatform(assetDocument));
  const assetAttestation = validateProductionImageAssetAttestation(assetDocument, {
    fixtureContract: { version: "journey-v5", sha256: contract.fixtureContract.sha256 },
    imageDigest: expectedAssetImageDigest,
    platform: expectedPlatform,
    publicBuildContract: contract.publicBuildContract,
    revision: contract.revision,
  }, role);
  return Object.freeze({
    role,
    contract,
    contractPath,
    assetAttestationPath,
    expectedAssetImageDigest,
    expectedApplicationImageConfigDigest: assetAttestation.source.configDigest,
    expectedApplicationManifestDigest: assetAttestation.source.manifestDigest,
    expectedApplicationRepoDigests: Object.freeze([...new Set([
      assetAttestation.source.imageDigest,
      assetAttestation.source.manifestDigest,
    ])].sort()),
    expectedPlatform,
    expectedMigrationAssetImageDigest,
  });
}

function ownedStackInput(input) {
  return {
    repositoryRoot,
    contractPath: input.contractPath,
    contract: input.contract,
    expectedApplicationAssetImageDigest: input.expectedAssetImageDigest,
    expectedApplicationImageConfigDigest: input.expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest: input.expectedApplicationManifestDigest,
    expectedApplicationRepoDigests: input.expectedApplicationRepoDigests,
    expectedImagePlatform: input.expectedPlatform,
    expectedMigrationAssetImageDigest: input.expectedMigrationAssetImageDigest,
    runDocker: docker,
  };
}

function docker(
  args,
  maximumBytes = 64 * 1024,
  environment = journeyDockerCliEnvironment(),
  options = {},
) {
  return runJourneyDockerCommand(args, maximumBytes, environment, {
    repositoryRoot,
    ...options,
  });
}

function assertDistinctStackInputs(baseline, candidate) {
  assertProviderOverlapImagePlatformParity(baseline.expectedPlatform, candidate.expectedPlatform);
  const baselinePublications = Object.values(baseline.contract.publications);
  const candidatePublications = Object.values(candidate.contract.publications);
  if (
    baseline.contract.revision !== "f5cb6f543d85256e7733a1ade6a4f451d86cf378"
    || candidate.contract.revision === baseline.contract.revision
    || baseline.contract.project === candidate.contract.project
    || baseline.contractPath === candidate.contractPath
    || baseline.assetAttestationPath === candidate.assetAttestationPath
    || baseline.expectedAssetImageDigest === candidate.expectedAssetImageDigest
    || baseline.expectedApplicationImageConfigDigest
      === candidate.expectedApplicationImageConfigDigest
    || baseline.expectedMigrationAssetImageDigest === candidate.expectedMigrationAssetImageDigest
    || baselinePublications.some((publication) => candidatePublications.includes(publication))
  ) {
    throw new Error("Authenticated live-pair inputs must be f5/candidate isolated image stacks.");
  }
  if (
    JSON.stringify(baseline.contract.fixtureContract)
      !== JSON.stringify(candidate.contract.fixtureContract)
    || JSON.stringify(baseline.contract.publicBuildContract)
      !== JSON.stringify(candidate.contract.publicBuildContract)
  ) {
    throw new Error("Authenticated live-pair stacks must share exact fixture/build contracts.");
  }
}

function parseArguments(values) {
  if (values.length % 2 !== 0) {
    throw new Error("Authenticated live-pair proof requires exact flag/value pairs.");
  }
  const allowed = new Set([
    "--baseline-contract",
    "--baseline-asset-attestation",
    "--baseline-asset-image-digest",
    "--baseline-migration-asset-image-digest",
    "--candidate-contract",
    "--candidate-asset-attestation",
    "--candidate-asset-image-digest",
    "--candidate-migration-asset-image-digest",
    "--capture-id",
    "--candidate-unverified-email-proof-output",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || result.has(name) || !value || value.startsWith("--")) {
      throw new Error("Authenticated live-pair proof arguments do not match the exact contract.");
    }
    result.set(name, value);
  }
  if (result.size !== allowed.size) {
    throw new Error("Authenticated live-pair proof requires every exact input flag once.");
  }
  return result;
}

async function exactUnverifiedEmailProofOutput(rawPath) {
  if (!path.isAbsolute(rawPath)
    || path.basename(rawPath) !== UNVERIFIED_EMAIL_PROOF_FILENAME
    || path.dirname(rawPath) !== path.join(
      repositoryRoot,
      "test-results",
      "browser-live-pair-ci",
      captureId,
    )) {
    throw new Error("Candidate unverified e-mail proof output escaped its exact capture root.");
  }
  const parent = path.dirname(rawPath);
  const details = await lstat(parent);
  if (!details.isDirectory() || details.isSymbolicLink()
    || path.dirname(await realpath(parent))
      !== await realpath(path.join(repositoryRoot, "test-results", "browser-live-pair-ci"))) {
    throw new Error("Candidate unverified e-mail proof output parent is invalid.");
  }
  try {
    await lstat(rawPath);
    throw new Error("Candidate unverified e-mail proof output already exists.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return rawPath;
}

function requiredArgument(values, name, pattern) {
  const value = values.get(name);
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

async function assertRepositoryRoot() {
  const packageValue = await readBoundedJson(
    path.join(repositoryRoot, "package.json"),
    64 * 1024,
    "repository package",
  );
  const cli = await lstat(localPlaywrightCli);
  if (
    packageValue?.name !== "clean-pay"
    || packageValue?.private !== true
    || !cli.isFile()
    || cli.isSymbolicLink()
  ) {
    throw new Error("Authenticated live-pair proof requires the local Clean Pay toolchain.");
  }
}

async function exactExternalFile(rawPath, label) {
  if (!path.isAbsolute(rawPath)) throw new Error(`${label} path must be absolute.`);
  const requested = await lstat(rawPath);
  const resolved = await realpath(rawPath);
  if (isWithin(repositoryRoot, resolved)) {
    throw new Error(`${label} must stay outside the repository.`);
  }
  const details = await lstat(resolved);
  if (!details.isFile() || requested.isSymbolicLink()) {
    throw new Error(`${label} must be a regular external file.`);
  }
  return resolved;
}

async function readBoundedJson(target, maximumBytes, label) {
  const before = await stat(target);
  if (!before.isFile() || before.size < 1 || before.size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded file contract.`);
  }
  const bytes = await readFile(target);
  const after = await stat(target);
  if (
    bytes.byteLength !== before.size
    || after.size !== before.size
    || after.mtimeMs !== before.mtimeMs
  ) {
    throw new Error(`${label} changed while it was read.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseAssetPlatform(document) {
  const platform = document?.source?.platform;
  if (
    !platform
    || Object.keys(platform).sort().join(",") !== "architecture,os"
    || platform.os !== "linux"
    || !new Set(["amd64", "arm64"]).has(platform.architecture)
  ) {
    throw new Error("Authenticated live-pair asset platform is invalid.");
  }
  return { architecture: platform.architecture, os: platform.os };
}

function boundedProcess(command, args, environment, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdoutBytes = 0;
    let stderr = Buffer.alloc(0);
    let terminationReason = null;
    const timer = setTimeout(() => terminate("timeout"), timeoutMs);
    let forceTimer;
    const terminate = (reason) => {
      if (terminationReason !== null) return;
      terminationReason = reason;
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > 4 * 1024 * 1024) terminate("stdout-overflow");
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.byteLength >= 64 * 1024) return;
      stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(0, 64 * 1024);
    });
    child.once("error", () => terminate("spawn-error"));
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      clearTimeout(forceTimer);
      if (code === 0 && signal === null && terminationReason === null) {
        resolve();
      } else {
        reject(new Error(
          "Bounded authenticated journey capture failed "
          + `(${terminationReason ?? "exit"}:${code ?? signal ?? "unknown"}:${sha256(stderr)}).`,
        ));
      }
    });
  });
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
