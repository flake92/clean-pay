import { createServer, request as httpRequest } from "node:http";
import {
  lstat,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const routes = new Set(["primary", "canary"]);
const expectedRouteSequence = Object.freeze([
  "primary",
  "canary",
  "primary",
  "canary",
  "primary",
]);
const minimumPrimarySuccesses = expectedRouteSequence
  .filter((route) => route === "primary").length;
const minimumCanarySuccesses = expectedRouteSequence
  .filter((route) => route === "canary").length;
const livenessPath = "/api/health/liveness";
const probeIntervalMs = 100;
const requestTimeoutMs = 5_000;
const switchTimeoutMs = 20_000;
const maximumResponseBytes = 64 * 1024;

async function main(argv) {
  const [command, ...args] = argv;
  if (command === "initialize" && args.length === 2) {
    await initializeRoute(args[0], args[1]);
    return;
  }
  if (command === "serve" && args.length === 10) {
    await serveContinuityProxy({
      routePath: args[0],
      readyPath: args[1],
      statusPath: args[2],
      resultPath: args[3],
      bindAddress: exactBindAddress(args[4]),
      proxyPort: exactPort(args[5], "proxy"),
      primaryHost: exactHost(args[6], "primary"),
      primaryPort: exactPort(args[7], "primary"),
      canaryHost: exactHost(args[8], "canary"),
      canaryPort: exactPort(args[9], "canary"),
    });
    return;
  }
  if (command === "switch" && args.length === 3) {
    await switchRoute(args[0], args[1], args[2]);
    return;
  }
  if (command === "checkpoint" && args.length === 3) {
    await writeCheckpoint(args[0], args[1], args[2]);
    return;
  }
  if (command === "prove-progress" && args.length === 3) {
    await proveCheckpointProgress(args[0], args[1], args[2]);
    return;
  }
  if (command === "verify" && args.length === 1) {
    await verifyResult(args[0]);
    return;
  }
  throw new Error("invalid disposable traffic continuity command");
}

async function initializeRoute(routePath, route) {
  exactRoute(route);
  await assertCreateTarget(routePath, "route");
  await writeCreateOnly(routePath, `${route}\n`);
}

async function switchRoute(routePath, statusPath, route) {
  exactRoute(route);
  await assertPrivateRegularFile(routePath, "route");
  await assertAbsoluteTarget(statusPath, "status");
  const previous = await readOptionalStatus(statusPath);
  const previousTotal = previous?.totalSuccesses ?? 0;
  await writeReplace(routePath, `${route}\n`);

  const deadline = Date.now() + switchTimeoutMs;
  while (Date.now() < deadline) {
    const status = await readOptionalStatus(statusPath);
    if (status?.status === "failed" || (status?.failureCount ?? 0) !== 0) {
      throw new Error("disposable traffic continuity failed during a route switch");
    }
    if (status?.lastRoute === route && status.totalSuccesses > previousTotal) {
      return;
    }
    await delay(50);
  }
  throw new Error("disposable traffic route switch was not observed in time");
}

async function serveContinuityProxy(input) {
  await assertPrivateRegularFile(input.routePath, "route");
  await Promise.all([
    assertCreateTarget(input.readyPath, "ready"),
    assertCreateTarget(input.statusPath, "status"),
    assertCreateTarget(input.resultPath, "result"),
  ]);
  if (`${input.primaryHost}:${input.primaryPort}` === `${input.canaryHost}:${input.canaryPort}`) {
    throw new Error("disposable traffic upstreams must be distinct");
  }

  let stopRequested = false;
  let failureCount = 0;
  let totalSuccesses = 0;
  let primarySuccesses = 0;
  let canarySuccesses = 0;
  const observedRouteSequence = [];
  const requestStop = () => { stopRequested = true; };
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);

  const server = createServer(async (incoming, outgoing) => {
    if (incoming.method !== "GET" || incoming.url !== livenessPath) {
      incoming.resume();
      outgoing.writeHead(404, { "content-type": "text/plain" });
      outgoing.end("not found\n");
      return;
    }
    try {
      const route = await readRoute(input.routePath);
      const upstreamHost = route === "primary" ? input.primaryHost : input.canaryHost;
      const upstreamPort = route === "primary" ? input.primaryPort : input.canaryPort;
      await requestUpstream(upstreamHost, upstreamPort);
      outgoing.writeHead(200, {
        "cache-control": "no-store",
        "content-type": "text/plain",
        "x-clean-pay-disposable-route": route,
      });
      outgoing.end("checked\n");
    } catch {
      outgoing.writeHead(502, { "content-type": "text/plain" });
      outgoing.end("unavailable\n");
    }
  });

  try {
    await listen(server, input.proxyPort, input.bindAddress);
    await writeCreateOnly(input.readyPath, '{"schemaVersion":1,"status":"ready"}\n');

    while (!stopRequested && failureCount === 0) {
      try {
        const route = await probeProxy(input.proxyPort);
        totalSuccesses += 1;
        if (route === "primary") primarySuccesses += 1;
        else canarySuccesses += 1;
        if (observedRouteSequence.at(-1) !== route) observedRouteSequence.push(route);
        await writeStatus(input.statusPath, {
          schemaVersion: 1,
          status: "running",
          totalSuccesses,
          primarySuccesses,
          canarySuccesses,
          failureCount,
          lastRoute: route,
          observedRouteSequence,
        });
      } catch {
        failureCount += 1;
        await writeStatus(input.statusPath, {
          schemaVersion: 1,
          status: "failed",
          totalSuccesses,
          primarySuccesses,
          canarySuccesses,
          failureCount,
          lastRoute: observedRouteSequence.at(-1) ?? null,
          observedRouteSequence,
        });
      }
      if (!stopRequested && failureCount === 0) await delay(probeIntervalMs);
    }
  } finally {
    await closeServer(server);
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
  }

  const passed = failureCount === 0
    && totalSuccesses === primarySuccesses + canarySuccesses
    && totalSuccesses >= expectedRouteSequence.length
    && primarySuccesses >= minimumPrimarySuccesses
    && canarySuccesses >= minimumCanarySuccesses
    && exactSequence(observedRouteSequence);
  await writeCreateOnly(input.resultPath, `${JSON.stringify({
    schemaVersion: 1,
    status: passed ? "passed" : "failed",
    totalSuccesses,
    primarySuccesses,
    canarySuccesses,
    failureCount,
    observedRouteSequence,
  }, null, 2)}\n`);
  if (!passed) throw new Error("disposable traffic continuity invariant failed");
}

async function verifyResult(resultPath) {
  await assertPrivateRegularFile(resultPath, "result");
  validateContinuityResult(await readFile(resultPath, "utf8"));
}

export function validateContinuityResult(value) {
  if (typeof value !== "string" || Buffer.byteLength(value) > 16 * 1024) {
    throw new Error("disposable traffic continuity result did not prove the rollout");
  }
  const result = parseResult(value);
  if (result.status !== "passed"
    || result.failureCount !== 0
    || result.totalSuccesses !== result.primarySuccesses + result.canarySuccesses
    || result.totalSuccesses < expectedRouteSequence.length
    || result.primarySuccesses < minimumPrimarySuccesses
    || result.canarySuccesses < minimumCanarySuccesses
    || !exactSequence(result.observedRouteSequence)) {
    throw new Error("disposable traffic continuity result did not prove the rollout");
  }
  return Object.freeze({
    ...result,
    observedRouteSequence: Object.freeze([...result.observedRouteSequence]),
  });
}

function requestUpstream(host, port) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host,
      port,
      method: "GET",
      path: livenessPath,
      headers: { accept: "application/json", connection: "close" },
    }, (response) => {
      let bytes = 0;
      const chunks = [];
      response.on("data", (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > maximumResponseBytes) response.destroy(new Error("oversized response"));
        else chunks.push(chunk);
      });
      response.once("end", () => {
        try {
          if (response.statusCode !== 200) throw new Error("liveness status is not ok");
          decodeLivenessBody(Buffer.concat(chunks));
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      response.once("error", reject);
    });
    request.setTimeout(requestTimeoutMs, () => request.destroy(new Error("upstream timeout")));
    request.once("error", reject);
    request.end();
  });
}

function probeProxy(port) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port,
      method: "GET",
      path: livenessPath,
      headers: { accept: "text/plain", connection: "close" },
    }, (response) => {
      const route = response.headers["x-clean-pay-disposable-route"];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.byteLength;
        if (bytes > 1024) response.destroy(new Error("oversized proxy response"));
      });
      response.once("end", () => {
        if (response.statusCode !== 200 || (route !== "primary" && route !== "canary")) {
          reject(new Error("disposable proxy liveness failed"));
          return;
        }
        resolve(route);
      });
      response.once("error", reject);
    });
    request.setTimeout(requestTimeoutMs, () => request.destroy(new Error("proxy timeout")));
    request.once("error", reject);
    request.end();
  });
}

function listen(server, port, bindAddress) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bindAddress, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function readRoute(routePath) {
  await assertPrivateRegularFile(routePath, "route");
  const route = (await readFile(routePath, "utf8")).trim();
  exactRoute(route);
  return route;
}

async function writeCheckpoint(statusPath, route, checkpointPath) {
  exactRoute(route);
  const status = await readOptionalStatus(statusPath);
  if (status === null
    || status.status !== "running"
    || status.failureCount !== 0
    || status.lastRoute !== route) {
    throw new Error("disposable traffic checkpoint status is invalid");
  }
  await assertCreateTarget(checkpointPath, "checkpoint");
  await writeCreateOnly(checkpointPath, `${JSON.stringify({
    schemaVersion: 1,
    route,
    totalSuccesses: status.totalSuccesses,
    primarySuccesses: status.primarySuccesses,
    canarySuccesses: status.canarySuccesses,
    failureCount: status.failureCount,
  })}\n`);
}

async function proveCheckpointProgress(beforePath, afterPath, route) {
  exactRoute(route);
  await Promise.all([
    assertPrivateRegularFile(beforePath, "before checkpoint"),
    assertPrivateRegularFile(afterPath, "after checkpoint"),
  ]);
  const before = parseCheckpoint(await readFile(beforePath, "utf8"));
  const after = parseCheckpoint(await readFile(afterPath, "utf8"));
  assertCheckpointProgress(before, after, route);
}

async function readOptionalStatus(statusPath) {
  try {
    await assertPrivateRegularFile(statusPath, "status");
    return parseStatus(await readFile(statusPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeStatus(statusPath, value) {
  parseStatus(JSON.stringify(value));
  await writeReplace(statusPath, `${JSON.stringify(value)}\n`, { allowMissing: true });
}

async function writeCreateOnly(target, value) {
  let handle;
  let identity;
  try {
    handle = await open(target, "wx", 0o600);
    identity = await handle.stat({ bigint: true });
    await handle.writeFile(value, { encoding: "utf8" });
    await handle.sync();
    const after = await handle.stat({ bigint: true });
    if (!sameIdentity(identity, after) || !after.isFile() || (after.mode & 0o077n) !== 0n) {
      throw new Error("disposable traffic create-only output identity changed");
    }
    await handle.close();
    handle = undefined;
    await assertPrivateRegularFile(target, "created output");
    const published = await lstat(target, { bigint: true });
    if (!sameIdentity(identity, published)) {
      throw new Error("disposable traffic create-only path identity changed");
    }
    return identity;
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {});
    if (identity !== undefined) await removeOwnedFile(target, identity);
    throw error;
  }
}

async function writeReplace(target, value, options = {}) {
  if (!options.allowMissing) await assertPrivateRegularFile(target, "replace target");
  else {
    await assertAbsoluteTarget(target, "replace target");
    try {
      await assertPrivateRegularFile(target, "replace target");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  const temporary = `${target}.replace-${process.pid}`;
  await assertCreateTarget(temporary, "replace temporary");
  let identity;
  let published = false;
  try {
    identity = await writeCreateOnly(temporary, value);
    await rename(temporary, target);
    published = true;
    await assertPrivateRegularFile(target, "replaced output");
  } catch (error) {
    if (identity !== undefined) {
      await removeOwnedFile(published ? target : temporary, identity);
    }
    throw error;
  }
}

async function removeOwnedFile(target, identity) {
  let current;
  try {
    current = await lstat(target, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (!sameIdentity(identity, current)) {
    throw new Error("disposable traffic refused to remove an unowned file");
  }
  await rm(target);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertCreateTarget(target, label) {
  await assertAbsoluteTarget(target, label);
  try {
    await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`disposable traffic ${label} target already exists`);
}

async function assertAbsoluteTarget(target, label) {
  if (typeof target !== "string" || !path.isAbsolute(target) || path.resolve(target) !== target) {
    throw new Error(`disposable traffic ${label} path is invalid`);
  }
  const parent = await lstat(path.dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) !== 0) {
    throw new Error(`disposable traffic ${label} parent is not private`);
  }
}

async function assertPrivateRegularFile(target, label) {
  await assertAbsoluteTarget(target, label);
  const metadata = await lstat(target);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`disposable traffic ${label} is not a private regular file`);
  }
}

function parseStatus(value) {
  const parsed = parseExactJson(value, [
    "schemaVersion",
    "status",
    "totalSuccesses",
    "primarySuccesses",
    "canarySuccesses",
    "failureCount",
    "lastRoute",
    "observedRouteSequence",
  ]);
  if (parsed.schemaVersion !== 1
    || (parsed.status !== "running" && parsed.status !== "failed")
    || (parsed.lastRoute !== null && !routes.has(parsed.lastRoute))) {
    throw new Error("disposable traffic status header is invalid");
  }
  exactCounters(parsed);
  return parsed;
}

function parseResult(value) {
  const parsed = parseExactJson(value, [
    "schemaVersion",
    "status",
    "totalSuccesses",
    "primarySuccesses",
    "canarySuccesses",
    "failureCount",
    "observedRouteSequence",
  ]);
  if (parsed.schemaVersion !== 1 || (parsed.status !== "passed" && parsed.status !== "failed")) {
    throw new Error("disposable traffic result header is invalid");
  }
  exactCounters(parsed);
  return parsed;
}

function parseCheckpoint(value) {
  const parsed = parseExactJson(value, [
    "schemaVersion",
    "route",
    "totalSuccesses",
    "primarySuccesses",
    "canarySuccesses",
    "failureCount",
  ]);
  if (parsed.schemaVersion !== 1 || !routes.has(parsed.route)) {
    throw new Error("disposable traffic checkpoint header is invalid");
  }
  exactCounters({ ...parsed, observedRouteSequence: [] });
  return parsed;
}

export function assertCheckpointProgress(before, after, route) {
  exactRoute(route);
  const expectedKey = route === "primary" ? "primarySuccesses" : "canarySuccesses";
  const otherKey = route === "primary" ? "canarySuccesses" : "primarySuccesses";
  if (before.route !== route
    || after.route !== route
    || before.failureCount !== 0
    || after.failureCount !== 0
    || after[expectedKey] <= before[expectedKey]
    || after[otherKey] !== before[otherKey]
    || after.totalSuccesses <= before.totalSuccesses
    || after.totalSuccesses - before.totalSuccesses
      !== after[expectedKey] - before[expectedKey]) {
    throw new Error("disposable traffic phase made no exclusive route progress");
  }
}

function exactCounters(value) {
  for (const key of [
    "totalSuccesses",
    "primarySuccesses",
    "canarySuccesses",
    "failureCount",
  ]) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1_000_000) {
      throw new Error("disposable traffic counter is invalid");
    }
  }
  if (!Array.isArray(value.observedRouteSequence)
    || value.observedRouteSequence.length > expectedRouteSequence.length
    || value.observedRouteSequence.some((route) => !routes.has(route))) {
    throw new Error("disposable traffic route sequence is invalid");
  }
}

function parseExactJson(value, keys) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("disposable traffic JSON is invalid");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype
    || Object.getOwnPropertySymbols(parsed).length !== 0
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error("disposable traffic JSON fields are invalid");
  }
  return parsed;
}

function exactRoute(route) {
  if (!routes.has(route)) throw new Error("disposable traffic route is invalid");
  return route;
}

function exactSequence(value) {
  return JSON.stringify(value) === JSON.stringify(expectedRouteSequence);
}

function exactPort(value, label) {
  if (!/^[1-9][0-9]{3,4}$/.test(value)) {
    throw new Error(`disposable traffic ${label} port is invalid`);
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error(`disposable traffic ${label} port is invalid`);
  }
  return port;
}

export function decodeLivenessBody(value) {
  if (!(value instanceof Uint8Array) || value.byteLength < 1
    || value.byteLength > maximumResponseBytes) {
    throw new Error("disposable traffic liveness body is invalid");
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(value).toString("utf8"));
  } catch {
    throw new Error("disposable traffic liveness JSON is invalid");
  }
  const expectedKeys = ["service", "status", "version"];
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || Object.getPrototypeOf(parsed) !== Object.prototype
    || Object.getOwnPropertySymbols(parsed).length !== 0
    || JSON.stringify(Object.keys(parsed).sort()) !== JSON.stringify(expectedKeys)
    || parsed.status !== "ok"
    || parsed.service !== "clean-pay"
    || typeof parsed.version !== "string"
    || parsed.version.length < 1
    || parsed.version.length > 80) {
    throw new Error("disposable traffic liveness payload is invalid");
  }
  return Object.freeze({ status: "ok", service: "clean-pay" });
}

function exactBindAddress(value) {
  if (value !== "127.0.0.1" && value !== "0.0.0.0") {
    throw new Error("disposable traffic bind address is invalid");
  }
  return value;
}

function exactHost(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
    throw new Error(`disposable traffic ${label} host is invalid`);
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2)).catch(() => {
    process.stderr.write("Disposable traffic continuity proof failed.\n");
    process.exitCode = 1;
  });
}
