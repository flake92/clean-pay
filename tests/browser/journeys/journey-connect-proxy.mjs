import net from "node:net";

import {
  JOURNEY_CONNECT_TARGET_PORT,
  JOURNEY_SYNTHETIC_HOSTNAMES,
} from "./journey-network-policy.mjs";

const MAX_CLIENT_CONNECTIONS = 64;
const MAX_HEADER_BYTES = 8_192;
const PREFACE_TIMEOUT_MS = 5_000;
const UPSTREAM_CONNECT_TIMEOUT_MS = 5_000;
const ESTABLISHED_IDLE_TIMEOUT_MS = 300_000;

const listenHost = exactValue(
  "CLEAN_PAY_BROWSER_CONNECT_PROXY_BIND",
  "127.0.0.1",
  /^127\.0\.0\.1$/,
);
const configuredListenPort = portValue(
  "CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT",
  "14444",
  { allowZero: true },
);
const targetHost = exactValue(
  "CLEAN_PAY_BROWSER_CONNECT_TARGET_HOST",
  undefined,
  /^127\.0\.0\.(?:[1-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
);
const targetPort = portValue(
  "CLEAN_PAY_BROWSER_CONNECT_TARGET_PORT",
  String(JOURNEY_CONNECT_TARGET_PORT),
  { allowTlsPort: true },
);
const allowedAuthorities = new Set(
  JOURNEY_SYNTHETIC_HOSTNAMES.map((hostname) => `${hostname}:${JOURNEY_CONNECT_TARGET_PORT}`),
);
const limits = Object.freeze({
  establishedIdleTimeoutMs: ESTABLISHED_IDLE_TIMEOUT_MS,
  maxClientConnections: MAX_CLIENT_CONNECTIONS,
  maxHeaderBytes: MAX_HEADER_BYTES,
  prefaceTimeoutMs: PREFACE_TIMEOUT_MS,
  upstreamConnectTimeoutMs: UPSTREAM_CONNECT_TIMEOUT_MS,
});
const counters = {
  accepted: 0,
  rejected: 0,
  upstreamAttempts: 0,
  upstreamConnected: 0,
  upstreamFailures: 0,
};
const activeClients = new Set();
const activeUpstreams = new Set();
let boundListen = `${listenHost}:${configuredListenPort}`;
let shutdownPromise;
let outcome = "clean";

const server = net.createServer({ allowHalfOpen: false }, (client) => {
  if (activeClients.size >= MAX_CLIENT_CONNECTIONS) {
    client.once("error", () => undefined);
    counters.rejected += 1;
    respond(client, 503, "Service Unavailable");
    return;
  }

  activeClients.add(client);
  client.setNoDelay(true);
  let decided = false;
  let preface = Buffer.alloc(0);
  let upstream;
  const prefaceTimer = setTimeout(() => deny(408, "Request Timeout"), PREFACE_TIMEOUT_MS);
  prefaceTimer.unref();

  const closeTunnel = () => {
    clearTimeout(prefaceTimer);
    activeClients.delete(client);
    if (upstream) activeUpstreams.delete(upstream);
    if (!client.destroyed) client.destroy();
    if (upstream && !upstream.destroyed) upstream.destroy();
  };
  const deny = (status, reason) => {
    if (decided) return;
    decided = true;
    clearTimeout(prefaceTimer);
    counters.rejected += 1;
    respond(client, status, reason);
  };
  const failUpstream = () => {
    if (!upstream || upstream.cleanPaySettled) return;
    upstream.cleanPaySettled = true;
    counters.upstreamFailures += 1;
    if (!client.destroyed) respond(client, 502, "Bad Gateway");
    closeTunnel();
  };
  const readPreface = (chunk) => {
    if (decided) return;
    preface = Buffer.concat([preface, chunk]);
    if (preface.byteLength > MAX_HEADER_BYTES) {
      deny(431, "Request Header Fields Too Large");
      return;
    }
    const boundary = preface.indexOf("\r\n\r\n");
    if (boundary < 0) return;
    decided = true;
    clearTimeout(prefaceTimer);
    client.off("data", readPreface);
    const header = preface.subarray(0, boundary).toString("latin1");
    const remainder = preface.subarray(boundary + 4);
    const lines = header.split("\r\n");
    const requestLine = lines.shift() ?? "";
    if (!requestLine.startsWith("CONNECT ")) {
      counters.rejected += 1;
      respond(client, 405, "Method Not Allowed");
      return;
    }
    const match = /^CONNECT ([a-z0-9.-]+):443 HTTP\/1\.1$/.exec(requestLine);
    const authority = match?.[1] ? `${match[1]}:${JOURNEY_CONNECT_TARGET_PORT}` : "";
    if (
      !match
      || !allowedAuthorities.has(authority)
      || !validHeaders(lines)
    ) {
      counters.rejected += 1;
      respond(client, 403, "Forbidden");
      return;
    }

    counters.upstreamAttempts += 1;
    upstream = net.createConnection({ host: targetHost, port: targetPort });
    activeUpstreams.add(upstream);
    upstream.setNoDelay(true);
    upstream.setTimeout(UPSTREAM_CONNECT_TIMEOUT_MS, failUpstream);
    upstream.once("error", failUpstream);
    upstream.once("close", closeTunnel);
    upstream.once("connect", () => {
      if (!upstream || upstream.cleanPaySettled) return;
      upstream.cleanPaySettled = true;
      counters.accepted += 1;
      counters.upstreamConnected += 1;
      client.setTimeout(ESTABLISHED_IDLE_TIMEOUT_MS, closeTunnel);
      upstream.setTimeout(ESTABLISHED_IDLE_TIMEOUT_MS, closeTunnel);
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (remainder.byteLength > 0) upstream.write(remainder);
      client.pipe(upstream);
      upstream.pipe(client);
    });
  };

  client.on("data", readPreface);
  client.once("error", closeTunnel);
  client.once("close", closeTunnel);
});

server.on("error", (error) => {
  reportFailure(error);
  void shutdown(1);
});
server.listen({
  backlog: MAX_CLIENT_CONNECTIONS,
  host: listenHost,
  port: configuredListenPort,
}, () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    reportFailure(new Error("invalid-listener-address"));
    void shutdown(1);
    return;
  }
  boundListen = `${listenHost}:${address.port}`;
  writeJson({
    status: "ready",
    listen: boundListen,
    target: `${targetHost}:${targetPort}`,
    allowedHostCount: JOURNEY_SYNTHETIC_HOSTNAMES.length,
    limits,
  });
});

let controlInput = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  controlInput += chunk;
  if (controlInput.length > 32) {
    reportFailure(new Error("invalid-control-input"));
    void shutdown(1);
    return;
  }
  const newline = controlInput.indexOf("\n");
  if (newline < 0) return;
  const command = controlInput.slice(0, newline).replace(/\r$/, "");
  controlInput = controlInput.slice(newline + 1);
  if (command === "stop" && controlInput.length === 0) {
    void shutdown(0);
  } else {
    reportFailure(new Error("invalid-control-command"));
    void shutdown(1);
  }
});
process.stdin.once("end", () => void shutdown(0));
process.stdin.resume();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => void shutdown(0));
}

function validHeaders(lines) {
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (
      separator <= 0
      || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(line.slice(0, separator))
      || !/^[\t\x20-\x7e]*$/.test(line.slice(separator + 1))
    ) {
      return false;
    }
    const name = line.slice(0, separator).toLowerCase();
    if (["content-length", "proxy-authorization", "transfer-encoding"].includes(name)) {
      return false;
    }
  }
  return true;
}

function respond(socket, status, reason) {
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

function shutdown(exitCode) {
  shutdownPromise ??= new Promise((resolve) => {
    if (exitCode !== 0) outcome = "failed";
    process.exitCode = exitCode;
    process.stdin.pause();
    process.stdin.removeAllListeners();
    for (const socket of activeClients) socket.destroy();
    for (const socket of activeUpstreams) socket.destroy();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      writeJson({
        status: "stopped",
        outcome,
        listen: boundListen,
        target: `${targetHost}:${targetPort}`,
        allowedHostCount: JOURNEY_SYNTHETIC_HOSTNAMES.length,
        counters: { ...counters },
      }, resolve);
    };
    const timer = setTimeout(finish, 1_000);
    timer.unref();
    if (server.listening) server.close(finish);
    else finish();
  });
  return shutdownPromise;
}

function reportFailure(error) {
  outcome = "failed";
  const code = typeof error?.code === "string"
    ? error.code
    : typeof error?.name === "string"
      ? error.name
      : "Error";
  process.stderr.write(`${JSON.stringify({ status: "error", code: code.slice(0, 80) })}\n`);
}

function writeJson(value, callback) {
  process.stdout.write(`${JSON.stringify(value)}\n`, callback);
}

function exactValue(name, fallback, pattern) {
  const value = process.env[name]?.trim() || fallback;
  if (!value || !pattern.test(value)) throw new Error(`${name} is required and invalid.`);
  return value;
}

function portValue(name, fallback, { allowTlsPort = false, allowZero = false } = {}) {
  const value = exactValue(name, fallback, /^\d{1,5}$/);
  const port = Number(value);
  if (
    String(port) !== value
    || port > 65_535
    || (port === 0 && !allowZero)
    || (port > 0 && port < 1_024 && !(allowTlsPort && port === JOURNEY_CONNECT_TARGET_PORT))
  ) {
    throw new Error(`${name} is outside the exact journey port policy.`);
  }
  return port;
}
