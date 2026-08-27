import { spawn } from "node:child_process";
import path from "node:path";

import { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";

const maximumOutputBytes = 8_192;
const defaultLifecycleBounds = Object.freeze({
  killCloseTimeoutMs: 4_000,
  readinessTimeoutMs: 10_000,
  shutdownTimeoutMs: 5_000,
  terminationGraceMs: 1_000,
});

/**
 * @param {{
 *   environment?: Record<string, string | undefined>,
 *   lifecycleBounds?: {
 *     killCloseTimeoutMs: number,
 *     readinessTimeoutMs: number,
 *     shutdownTimeoutMs: number,
 *     terminationGraceMs: number,
 *   },
 *   listenHost: string,
 *   listenPort: string,
 *   repositoryRoot?: string,
 *   spawnProcess?: (...args: any[]) => any,
 *   targetHost: string,
 *   targetPort: string,
 *   verifyProcessTerminated?: (pid: number | undefined) => Promise<boolean>,
 * }} input
 * @returns {Promise<any>}
 */
export function startJourneyConnectProxy({
  environment = process.env,
  lifecycleBounds = defaultLifecycleBounds,
  listenHost,
  listenPort,
  repositoryRoot = process.cwd(),
  spawnProcess = spawn,
  targetHost,
  targetPort,
  verifyProcessTerminated = verifyJourneyProcessTerminated,
}) {
  assertProxyCoordinates({ listenHost, listenPort, targetHost, targetPort });
  assertLifecycleBounds(lifecycleBounds);
  if (typeof spawnProcess !== "function" || typeof verifyProcessTerminated !== "function") {
    throw new Error("Journey CONNECT proxy process factory is invalid.");
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(process.execPath, [
      path.join(repositoryRoot, "tests", "browser", "journeys", "journey-connect-proxy.mjs"),
    ], {
      cwd: repositoryRoot,
      env: {
        ...environment,
        CLEAN_PAY_BROWSER_CONNECT_AUTHORITY_LEDGER: "1",
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
    let ready = false;
    let startSettled = false;
    let stderr = "";
    let stdoutBuffer = "";
    let stdoutBytes = 0;
    let stoppedSettled = false;
    let pendingStartError;
    let terminationPromise;
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
      lifecycleBounds: Object.freeze({ ...lifecycleBounds }),
      stopped,
      stderr: () => stderr,
      verifyProcessTerminated,
    };
    const finishStart = (operation) => {
      if (startSettled) return;
      startSettled = true;
      clearTimeout(readinessTimer);
      operation();
    };
    const protocolFailure = (message) => {
      const error = new Error(message);
      if (!ready) pendingStartError ??= error;
      if (!stoppedSettled) {
        stoppedSettled = true;
        rejectStopped(error);
      }
      terminationPromise ??= terminateProxyChildAndAwaitClose(
        child,
        closed,
        lifecycleBounds,
        verifyProcessTerminated,
      )
        .then(() => {
          if (!ready) finishStart(() => reject(pendingStartError ?? error));
        })
        .catch((terminationError) => {
          if (!ready) {
            finishStart(() => reject(new AggregateError(
              [pendingStartError ?? error, terminationError],
              "Journey CONNECT proxy readiness failure cleanup did not close.",
            )));
          }
        });
    };
    const readinessTimer = setTimeout(
      () => protocolFailure("Journey CONNECT proxy readiness timed out."),
      lifecycleBounds.readinessTimeoutMs,
    );
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 2_048) stderr += chunk.slice(0, 2_048 - stderr.length);
    });
    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      stdoutBuffer += chunk;
      if (stdoutBytes > maximumOutputBytes) {
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
          if (!validReady(message, expected)) {
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
    child.once("error", () => protocolFailure("Journey CONNECT proxy process failed."));
    child.stdin.once("error", () => protocolFailure("Journey CONNECT proxy control channel failed."));
    child.once("close", (code, signal) => {
      resolveClosed({ code, signal });
      if (!ready) {
        finishStart(() => reject(
          pendingStartError ?? new Error("Journey CONNECT proxy exited before readiness."),
        ));
      }
      if (!stoppedSettled) {
        stoppedSettled = true;
        rejectStopped(new Error("Journey CONNECT proxy exited without a stopped summary."));
      }
    });
  });
}

export async function stopJourneyConnectProxy(handle) {
  if (!handle) throw new Error("Journey CONNECT proxy handle is missing.");
  if (handle.child.exitCode === null && handle.child.signalCode === null) {
    handle.child.stdin.end("stop\n");
  }
  let timer;
  try {
    const [summary, closed] = await Promise.race([
      Promise.all([handle.stopped, handle.closed]),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Journey CONNECT proxy shutdown timed out.")),
          handle.lifecycleBounds.shutdownTimeoutMs,
        );
      }),
    ]);
    if (closed.code !== 0 || closed.signal !== null) {
      throw new Error("Journey CONNECT proxy shutdown failed.");
    }
    if (!validStopped(summary, handle.expected)) {
      throw new Error("Journey CONNECT proxy stopped summary did not match its exact contract.");
    }
    if (handle.stderr().trim()) {
      throw new Error("Journey CONNECT proxy emitted unexpected diagnostics.");
    }
    return summary;
  } catch (error) {
    try {
      await terminateProxyChildAndAwaitClose(
        handle.child,
        handle.closed,
        handle.lifecycleBounds,
        handle.verifyProcessTerminated,
      );
    } catch (terminationError) {
      throw new AggregateError(
        [error, terminationError],
        "Journey CONNECT proxy shutdown and bounded termination both failed.",
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function terminateProxyChildAndAwaitClose(
  child,
  closed,
  lifecycleBounds,
  verifyProcessTerminated,
) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  let escalationTimer;
  let closeVerificationTimer;
  let finished = false;
  let resolveVerifiedAbsence;
  const verifiedAbsence = new Promise((resolve) => {
    resolveVerifiedAbsence = resolve;
  });
  const verifyClosedAfterKill = async () => {
    if (finished) return;
    let absent = false;
    try {
      absent = await verifyProcessTerminated(child.pid);
    } catch {
      absent = false;
    }
    if (finished) return;
    if (absent === true) {
      resolveVerifiedAbsence(Object.freeze({
        code: null,
        signal: "SIGKILL",
        status: "os-pid-absence-proven-without-close",
      }));
      return;
    }
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    closeVerificationTimer = setTimeout(
      verifyClosedAfterKill,
      lifecycleBounds.killCloseTimeoutMs,
    );
  };
  try {
    escalationTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      closeVerificationTimer = setTimeout(
        verifyClosedAfterKill,
        lifecycleBounds.killCloseTimeoutMs,
      );
    }, lifecycleBounds.terminationGraceMs);
    // Cleanup may resume only after Node reports `close` or the OS proves that
    // the exact child PID is absent. A still-live/unverifiable child deliberately
    // remains fail-stop while bounded checks and SIGKILL retries continue.
    return await Promise.race([closed, verifiedAbsence]);
  } finally {
    finished = true;
    clearTimeout(escalationTimer);
    clearTimeout(closeVerificationTimer);
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

function assertLifecycleBounds(value) {
  if (!exactKeys(value, [
    "killCloseTimeoutMs", "readinessTimeoutMs", "shutdownTimeoutMs", "terminationGraceMs",
  ])) {
    throw new Error("Journey CONNECT proxy lifecycle bounds are invalid.");
  }
  for (const [name, maximum] of Object.entries({
    killCloseTimeoutMs: 4_000,
    readinessTimeoutMs: 10_000,
    shutdownTimeoutMs: 5_000,
    terminationGraceMs: 1_000,
  })) {
    const duration = value[name];
    if (!Number.isSafeInteger(duration) || duration < 1 || duration > maximum) {
      throw new Error("Journey CONNECT proxy lifecycle bounds are invalid.");
    }
  }
}

export function assertJourneyConnectProxyGate(summary, expected) {
  if (!exactKeys(expected, ["accepted", "authorityLedger", "listen", "target"])
    || !Number.isSafeInteger(expected.accepted) || expected.accepted < 1 || expected.accepted > 16
    || !validAuthorityLedger(expected.authorityLedger, expected.accepted)
    || !validStopped(summary, expected)) {
    throw new Error("Journey CONNECT proxy summary is invalid.");
  }
  const counters = summary.counters;
  if (
    counters.accepted !== expected.accepted
    || counters.rejected !== 0
    || counters.upstreamFailures !== 0
    || counters.upstreamAttempts !== counters.upstreamConnected
    || counters.accepted !== counters.upstreamConnected
    || JSON.stringify(summary.authorityLedger) !== JSON.stringify(expected.authorityLedger)
  ) {
    throw new Error("Journey CONNECT proxy counters rejected the fail-closed evidence gate.");
  }
  return Object.freeze({
    authorityLedger: Object.freeze([...summary.authorityLedger]),
    counters: Object.freeze({ ...counters }),
  });
}

function assertProxyCoordinates({ listenHost, listenPort, targetHost, targetPort }) {
  if (
    listenHost !== "127.0.0.1"
    || !/^\d{4,5}$/.test(listenPort)
    || String(Number(listenPort)) !== listenPort
    || Number(listenPort) > 65_535
    || Number(listenPort) === 443
    || !/^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/.test(targetHost)
    || targetPort !== "443"
  ) {
    throw new Error("Journey CONNECT proxy coordinates are invalid.");
  }
}

function validReady(value, expected) {
  return exactKeys(value, ["allowedHostCount", "limits", "listen", "status", "target"])
    && value.status === "ready"
    && value.listen === expected.listen
    && value.target === expected.target
    && value.allowedHostCount === JOURNEY_SYNTHETIC_HOSTNAMES.length
    && exactKeys(value.limits, [
      "establishedIdleTimeoutMs",
      "maxClientConnections",
      "maxHeaderBytes",
      "prefaceTimeoutMs",
      "upstreamConnectTimeoutMs",
    ])
    && Object.values(value.limits).every((entry) => Number.isSafeInteger(entry) && entry > 0);
}

function validStopped(value, expected) {
  return exactKeys(value, [
    "allowedHostCount",
    "authorityLedger",
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
    && validAuthorityLedger(value.authorityLedger, value.counters?.accepted)
    && exactKeys(value.counters, [
      "accepted",
      "rejected",
      "upstreamAttempts",
      "upstreamConnected",
      "upstreamFailures",
    ])
    && Object.values(value.counters).every((entry) => Number.isSafeInteger(entry) && entry >= 0);
}

function validAuthorityLedger(value, expectedLength) {
  if (!Array.isArray(value) || value.length !== expectedLength
    || value.length < 1 || value.length > 16
    || value.some((authority) => typeof authority !== "string"
      || !JOURNEY_SYNTHETIC_HOSTNAMES.some((hostname) => authority === `${hostname}:443`))) {
    return false;
  }
  return JSON.stringify([...value].sort()) === JSON.stringify(value);
}

function exactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
