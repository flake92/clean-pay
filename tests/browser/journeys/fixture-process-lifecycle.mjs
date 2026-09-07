import { createServer } from "node:net";
import { performance } from "node:perf_hooks";

const observed = new WeakMap();
const safeCodes = new Set([
  "EADDRINUSE", "EADDRNOTAVAIL", "EACCES", "EPERM", "ENOENT", "EMFILE", "ENFILE",
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
  "ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_INVALID_ARG_VALUE",
  "ERR_INVALID_ARG_TYPE", "ABORT_ERR", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

/**
 * Keep EVERY reservation open until the complete set has been allocated.
 * Closing each socket inside the loop lets the OS give the next role the same
 * port. These ports are released before use: an unrelated process can still
 * claim them, which must fail with diagnostics rather than be retried silently.
 * @param {number} count
 * @param {{createServer?: typeof createServer}} options
 * @returns {Promise<number[]>}
 */
export async function allocateDistinctFixturePorts(count, options = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || count > 16) {
    throw new Error("Fixture port count must be an integer between 1 and 16.");
  }
  const servers = [];
  const ports = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = (options.createServer ?? createServer)();
      servers.push(server);
      await new Promise((resolve, reject) => {
        const failed = (error) => { server.off("listening", ready); reject(error); };
        const ready = () => { server.off("error", failed); resolve(); };
        server.once("error", failed);
        server.once("listening", ready);
        server.listen(0, "0.0.0.0");
      });
      const address = server.address();
      if (!address || typeof address === "string" || !Number.isInteger(address.port)
          || address.port < 1 || address.port > 65535 || ports.includes(address.port)) {
        throw new Error("Fixture port allocation did not return distinct TCP ports.");
      }
      ports.push(address.port);
    }
    return ports;
  } finally {
    await Promise.all(servers.map((server) => server.listening
      ? new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      : Promise.resolve()));
  }
}

/**
 * Drain output but retain only allowlisted error CODES, never raw stderr,
 * arguments, process environments, request bodies or credential values.
 * @param {import('node:child_process').ChildProcess} child
 * @param {string} label
 */
export function observeFixtureChild(child, label) {
  if (!/^[a-z][a-z0-9.-]{0,63}$/.test(label)) throw new Error("Invalid fixture label.");
  if (observed.has(child)) throw new Error("Fixture child is already observed.");
  const state = { label, closed: false, spawnFailed: false, errorCodes: new Set() };
  observed.set(child, state);
  // Never retain raw output in the evidence object. The small rolling window is
  // used solely to recognize codes split across writes, then discarded at close.
  let window = "";
  child.stdout?.resume();
  child.stderr?.on("data", (chunk) => {
    window = (window + chunk.toString("utf8")).slice(-2048);
    for (const token of window.match(/[A-Z][A-Z0-9_]+/g) ?? []) {
      if (safeCodes.has(token)) state.errorCodes.add(token);
    }
  });
  child.on("error", (error) => {
    state.spawnFailed = true;
    if (safeCodes.has(error.code)) state.errorCodes.add(error.code);
  });
  child.once("close", () => { state.closed = true; window = ""; });
  return child;
}

function childEvidence(child) {
  const state = observed.get(child);
  if (!state) throw new Error("Fixture child must be observed before waiting for readiness.");
  return {
    label: state.label,
    pid: Number.isSafeInteger(child.pid) ? child.pid : null,
    exitCode: child.exitCode,
    signal: child.signalCode,
    closed: state.closed,
    spawnFailed: state.spawnFailed,
    errorCodes: [...state.errorCodes].sort(),
  };
}

function hasStopped(child) {
  const state = observed.get(child);
  return state?.spawnFailed || state?.closed
    || child.exitCode !== null || child.signalCode !== null;
}

function transportCode(error) {
  for (const value of [error?.cause?.code, error?.code]) {
    if (safeCodes.has(value)) return value;
  }
  return ["AbortError", "TimeoutError"].includes(error?.name) ? "ABORT_ERR" : "UNKNOWN";
}

/**
 * Same 10-second readiness boundary as the original tests. Each HTTP attempt
 * is bounded and its body is cancelled. A dead child fails immediately with
 * sanitized diagnostics instead of spending the whole deadline polling it.
 * @param {string} value
 * @param {{children: import('node:child_process').ChildProcess[], timeoutMs?: number, attemptTimeoutMs?: number}} options
 */
export async function waitForFixtureOk(value, { children, timeoutMs = 10_000, attemptTimeoutMs = 500 }) {
  const url = new URL(value);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
      || url.username || url.password || url.search || url.hash
      || !["/__health", "/.well-known/jwks.json"].includes(url.pathname)) {
    throw new Error("Fixture readiness requires an exact loopback health endpoint.");
  }
  if (!Array.isArray(children) || children.length === 0) throw new Error("Fixture readiness requires owned children.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000
      || !Number.isInteger(attemptTimeoutMs) || attemptTimeoutMs < 1 || attemptTimeoutMs > timeoutMs) {
    throw new Error("Invalid bounded fixture readiness deadline.");
  }
  children.forEach(childEvidence);
  const started = performance.now();
  const deadline = started + timeoutMs;
  let attempts = 0;
  let lastHttpStatus = null;
  let lastTransportCode = null;
  const fail = (reason) => {
    const evidence = {
      status: "fixture_startup_failed", reason,
      endpoint: { port: Number(url.port), pathname: url.pathname },
      elapsedMs: Math.round(performance.now() - started), attempts,
      lastHttpStatus, lastTransportCode, children: children.map(childEvidence),
    };
    // Do not attach the original error: its message/stack may contain secrets.
    const error = new Error(`Fixture startup failed: ${JSON.stringify(evidence)}`);
    Object.assign(error, { evidence });
    return error;
  };
  while (performance.now() < deadline) {
    if (children.some(hasStopped)) throw fail("child-stopped");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(attemptTimeoutMs, deadline - performance.now())));
    let ok = false;
    try {
      attempts += 1;
      const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
      lastHttpStatus = response.status;
      lastTransportCode = null;
      ok = response.ok;
      await response.body?.cancel();
    } catch (error) {
      ok = false;
      lastTransportCode = transportCode(error);
    } finally {
      clearTimeout(timer);
    }
    if (children.some(hasStopped)) throw fail("child-stopped");
    if (ok) return;
    const remaining = deadline - performance.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(50, remaining)));
  }
  throw fail("deadline-exceeded");
}

function waitForClose(child, ms) {
  if (observed.get(child)?.closed) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); child.off("close", done); resolve(true); };
    const timer = setTimeout(() => { child.off("close", done); resolve(false); }, ms);
    child.once("close", done);
  });
}

/** Wait for actual process/stdio closure; leave no orphan or 2-second loser timer. */
export async function stopFixtureChild(child) {
  if (!observed.has(child)) throw new Error("Cannot stop an unobserved fixture child.");
  if (observed.get(child).closed) return;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  if (await waitForClose(child, 2_000)) return;
  child.kill("SIGKILL");
  if (!(await waitForClose(child, 2_000))) {
    throw new Error(`Fixture cleanup failed: ${JSON.stringify(childEvidence(child))}`);
  }
}
