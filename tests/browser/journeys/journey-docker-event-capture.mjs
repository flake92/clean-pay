import { spawn } from "node:child_process";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { types } from "node:util";

import { JOURNEY_COMPOSE_SERVICE_NAMES } from "./journey-compose-runtime-attestation.mjs";

const dockerEventCaptureMaximumBytes = 64 * 1024;
const dockerEventCaptureLifecycleBounds = Object.freeze({
  completionTimeoutMs: 10_000,
  killCloseTimeoutMs: 4_000,
  shutdownTimeoutMs: 5_000,
  terminationGraceMs: 1_000,
});

function startJourneyDockerEventCapture({
  environment,
  lifecycleNotBefore,
  lifecycleBounds: requestedLifecycleBounds = dockerEventCaptureLifecycleBounds,
  project,
  repositoryRoot,
  spawnProcess = spawn,
  verifyProcessTerminated = verifyJourneyProcessTerminated,
}) {
  exactOptionalKeys(arguments[0], [
    "environment", "lifecycleNotBefore", "project", "repositoryRoot",
  ], ["lifecycleBounds", "spawnProcess", "verifyProcessTerminated"]);
  assertDockerEventCaptureInput({
    environment,
    lifecycleBounds: requestedLifecycleBounds,
    lifecycleNotBefore,
    project,
    repositoryRoot,
    spawnProcess,
    verifyProcessTerminated,
  });
  const format = "{{.TimeNano}}|{{.Action}}|{{.Actor.ID}}|"
    + "{{index .Actor.Attributes \"com.docker.compose.service\"}}|"
    + "{{with index .Actor.Attributes \"io.clean-pay.event-barrier\"}}"
    + "{{.}}{{else}}-{{end}}";
  const args = [
    "events",
    "--since", lifecycleNotBefore,
    "--filter", "type=container",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", "event=create",
    "--filter", "event=start",
    "--filter", "event=die",
    "--filter", "event=restart",
    "--format", format,
  ];
  const child = spawnProcess("docker", args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  if (child === null || typeof child !== "object" || types.isProxy(child)
    || !child.stdout || typeof child.stdout !== "object" || types.isProxy(child.stdout)
    || !child.stderr || typeof child.stderr !== "object" || types.isProxy(child.stderr)
    || typeof child.kill !== "function") {
    throw new Error("Journey Docker event capture did not expose exact process streams.");
  }
  const lifecycleBounds = Object.freeze({ ...requestedLifecycleBounds });
  const lines = [];
  const observedBarriers = new Map();
  const barrierWaiters = new Map();
  let buffer = "";
  let bytes = 0;
  let stderr = "";
  let stderrBytes = 0;
  let failure;
  let stopStarted = false;
  let stopPromise;
  let terminationProven = false;
  let closedSummary;
  let resolveClosed;
  const closed = new Promise((resolve) => { resolveClosed = resolve; });
  const acceptedStopSignals = [];
  const stopSignalLedger = Object.freeze({
    record: (signal) => {
      const expected = acceptedStopSignals.length === 0
        ? "SIGTERM"
        : acceptedStopSignals.length === 1 && acceptedStopSignals[0] === "SIGTERM"
          ? "SIGKILL"
          : undefined;
      if (signal !== expected) fail("Journey Docker event capture stop signal ledger is invalid.");
      acceptedStopSignals.push(signal);
    },
    snapshot: () => Object.freeze([...acceptedStopSignals]),
  });

  const rejectBarrierWaiters = (error) => {
    for (const waiters of barrierWaiters.values()) {
      for (const waiter of waiters) waiter.reject(error);
    }
    barrierWaiters.clear();
  };
  const protocolFailure = (message) => {
    failure ??= new Error(message);
    rejectBarrierWaiters(failure);
    if (!stopStarted && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
    }
  };
  const observeLine = (line) => {
    const match = /^(?<timeNano>[1-9]\d{15,24})\|(?<action>create|start|die|restart)\|(?<id>[a-f0-9]{64})\|(?<service>[a-z0-9][a-z0-9-]{0,63})\|(?<barrier>-|[a-f0-9]{32})$/.exec(line);
    if (!match || (!JOURNEY_COMPOSE_SERVICE_NAMES.includes(match.groups.service)
      && match.groups.service !== "journey-event-barrier")
      || (match.groups.service === "journey-event-barrier")
        !== (match.groups.barrier !== "-")) {
      protocolFailure("Journey Docker event capture emitted an invalid or unbound record.");
      return;
    }
    lines.push(line);
    if (match.groups.barrier === "-") return;
    if (match.groups.action !== "create" || observedBarriers.has(match.groups.barrier)) {
      protocolFailure("Journey Docker event capture barrier was repeated or invalid.");
      return;
    }
    const receipt = Object.freeze({
      containerId: match.groups.id,
      timeNano: match.groups.timeNano,
    });
    observedBarriers.set(match.groups.barrier, receipt);
    const waiters = barrierWaiters.get(match.groups.barrier) ?? [];
    barrierWaiters.delete(match.groups.barrier);
    for (const waiter of waiters) waiter.resolve(receipt);
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (bytes + chunkBytes > dockerEventCaptureMaximumBytes) {
      protocolFailure("Journey Docker event capture exceeded its bounded output contract.");
      return;
    }
    bytes += chunkBytes;
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) {
        protocolFailure("Journey Docker event capture emitted an empty record.");
      } else {
        observeLine(line);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    const remaining = 2_048 - stderrBytes;
    if (remaining <= 0) return;
    const bounded = Buffer.from(chunk, "utf8").subarray(0, remaining);
    stderr += bounded.toString("utf8");
    stderrBytes += bounded.byteLength;
  });
  child.stdout.on("error", () => protocolFailure("Journey Docker event capture stdout failed."));
  child.stderr.on("error", () => protocolFailure("Journey Docker event capture stderr failed."));
  child.once("error", () => protocolFailure("Journey Docker event capture process failed."));
  child.once("close", (code, signal) => {
    if (buffer.length > 0) {
      if (buffer.endsWith("\r")) buffer = buffer.slice(0, -1);
      if (buffer.length === 0) {
        protocolFailure("Journey Docker event capture emitted an empty final record.");
      } else {
        observeLine(buffer);
      }
    }
    buffer = "";
    closedSummary = Object.freeze({ code, signal });
    terminationProven = true;
    resolveClosed(closedSummary);
    if (!stopStarted) {
      protocolFailure("Journey Docker event capture closed before exact sealing.");
    }
  });

  const handle = Object.freeze({
    child,
    closed,
    lifecycleBounds,
    output: () => lines.join("\n"),
    project,
    stderr: () => stderr,
    stderrBytes: () => stderrBytes,
    stopSignalLedger,
    stop: () => {
      if (stopPromise !== undefined) return stopPromise;
      stopPromise = stopJourneyDockerEventCapture(handle);
      stopPromise.then(
        () => undefined,
        () => { stopPromise = undefined; },
      );
      return stopPromise;
    },
    terminationProven: () => terminationProven,
    verifyProcessTerminated,
    waitForBarrier: (nonce) => {
      if (!/^[a-f0-9]{32}$/.test(nonce)) {
        return Promise.reject(new Error("Journey Docker event capture barrier nonce is invalid."));
      }
      if (failure) return Promise.reject(failure);
      if (observedBarriers.has(nonce)) return Promise.resolve(observedBarriers.get(nonce));
      return new Promise((resolve, reject) => {
        let waiter;
        const timer = setTimeout(() => {
          const current = barrierWaiters.get(nonce) ?? [];
          barrierWaiters.set(nonce, current.filter((entry) => entry !== waiter));
          reject(new Error("Journey Docker event capture barrier timed out."));
        }, lifecycleBounds.completionTimeoutMs);
        waiter = {
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
        };
        const current = barrierWaiters.get(nonce) ?? [];
        current.push(waiter);
        barrierWaiters.set(nonce, current);
      });
    },
    beginStop: () => {
      if (!stopStarted) {
        stopStarted = true;
        rejectBarrierWaiters(new Error("Journey Docker event capture stopped before a barrier."));
      }
      return { closedSummary };
    },
    markTerminationProven: () => { terminationProven = true; },
    failure: () => failure,
  });
  return handle;
}

export function createJourneyDockerEventCaptureOwner(input) {
  const capture = startJourneyDockerEventCapture(input);
  return Object.freeze({
    stop: capture.stop,
    terminationProven: capture.terminationProven,
    waitForBarrier: capture.waitForBarrier,
  });
}

async function stopJourneyDockerEventCapture(handle) {
  if (!handle || typeof handle !== "object" || typeof handle.beginStop !== "function") {
    fail("Journey Docker event capture handle is invalid.");
  }
  const initial = handle.beginStop();
  const termination = initial.closedSummary === undefined
    ? await terminateDockerEventCaptureChildAndAwaitClose(
      handle.child,
      handle.closed,
      handle.lifecycleBounds,
      handle.stopSignalLedger,
      handle.verifyProcessTerminated,
    )
    : Object.freeze({
      acceptedSignals: handle.stopSignalLedger.snapshot(),
      closedSummary: initial.closedSummary,
    });
  const { acceptedSignals, closedSummary: closed } = termination;
  handle.markTerminationProven();
  if (handle.failure()) throw handle.failure();
  if (handle.stderrBytes() !== 0) {
    fail("Journey Docker event capture emitted unexpected diagnostics.");
  }
  if (closed?.status === "os-pid-absence-proven-without-close") {
    fail("Journey Docker event capture output was not sealed through stdio close.");
  }
  const exactSignals = (...signals) => signals.length === acceptedSignals.length
    && signals.every((signal, index) => acceptedSignals[index] === signal);
  const exactSigtermStop = exactSignals("SIGTERM") && (
    (closed?.code === null && closed?.signal === "SIGTERM")
    || (closed?.code === 0 && closed?.signal === null)
    || (closed?.code === 128 + 15 && closed?.signal === null)
  );
  const exactSigkillStop = exactSignals("SIGTERM", "SIGKILL")
    && closed?.code === null && closed?.signal === "SIGKILL";
  if (!(exactSigtermStop || exactSigkillStop)) {
    fail("Journey Docker event capture did not close through its exact stop contract.");
  }
  return handle.output();
}

async function terminateDockerEventCaptureChildAndAwaitClose(
  child,
  closed,
  lifecycleBounds,
  stopSignalLedger,
  verifyProcessTerminated,
) {
  const requestSignal = (signal) => {
    const acceptedSignals = stopSignalLedger.snapshot();
    const expected = acceptedSignals.length === 0
      ? "SIGTERM"
      : acceptedSignals.length === 1 && acceptedSignals[0] === "SIGTERM"
        ? "SIGKILL"
        : undefined;
    if (signal === expected
      && child.exitCode === null && child.signalCode === null
      && child.kill(signal) === true) {
      stopSignalLedger.record(signal);
    }
  };
  const result = (closedSummary) => Object.freeze({
    acceptedSignals: stopSignalLedger.snapshot(),
    closedSummary,
  });
  requestSignal("SIGTERM");
  const graceful = await Promise.race([
    closed,
    boundedDelay(lifecycleBounds.terminationGraceMs, "grace-expired"),
  ]);
  if (graceful !== "grace-expired") return result(graceful);
  requestSignal("SIGKILL");
  const deadline = performance.now() + lifecycleBounds.shutdownTimeoutMs;
  while (performance.now() < deadline) {
    const remaining = Math.max(1, Math.floor(deadline - performance.now()));
    const closeOrPoll = await Promise.race([
      closed,
      boundedDelay(Math.min(lifecycleBounds.killCloseTimeoutMs, remaining), "poll"),
    ]);
    if (closeOrPoll !== "poll") return result(closeOrPoll);
    let absent = false;
    try {
      absent = await Promise.race([
        Promise.resolve(verifyProcessTerminated(child.pid)),
        boundedDelay(Math.max(1, Math.floor(deadline - performance.now())), false),
      ]);
    } catch {
      absent = false;
    }
    if (absent === true) {
      return result(Object.freeze({
        code: null,
        signal: "SIGKILL",
        status: "os-pid-absence-proven-without-close",
      }));
    }
    requestSignal("SIGKILL");
  }
  fail("Journey Docker event capture termination was not proven before its deadline.");
}

function boundedDelay(milliseconds, value) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds, value));
}

function assertDockerEventCaptureInput({
  environment,
  lifecycleBounds,
  lifecycleNotBefore,
  project,
  repositoryRoot,
  spawnProcess,
  verifyProcessTerminated,
}) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)
    || typeof spawnProcess !== "function" || typeof verifyProcessTerminated !== "function"
    || !path.isAbsolute(repositoryRoot)
    || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project ?? "")
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(lifecycleNotBefore ?? "")
    || !lifecycleBounds || typeof lifecycleBounds !== "object" || Array.isArray(lifecycleBounds)
    || JSON.stringify(Object.keys(lifecycleBounds).sort())
      !== JSON.stringify(Object.keys(dockerEventCaptureLifecycleBounds).sort())) {
    fail("Journey Docker event capture input is invalid.");
  }
  for (const [name, maximum] of Object.entries(dockerEventCaptureLifecycleBounds)) {
    const value = lifecycleBounds[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      fail("Journey Docker event capture lifecycle bounds are invalid.");
    }
  }
}

function exactOptionalKeys(value, requiredKeys, optionalKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || requiredKeys.some((name) => !Object.hasOwn(value, name))
    || Object.keys(value).some((name) => (
      !requiredKeys.includes(name) && !optionalKeys.includes(name)
    ))) {
    fail("Journey Docker event capture input keys are not exact.");
  }
}

async function verifyJourneyProcessTerminated(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function fail(message) {
  throw new Error(message);
}
