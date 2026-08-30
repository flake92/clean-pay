import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

const authPaths = new Set([
  "/api/v1/public/auth/email/start",
  "/api/v1/public/auth/identify",
  "/api/v1/public/auth/service-session",
]);
const notificationPath = "/api/v1/public/auth/notification-preferences";
const plansPath = "/api/v1/public/plans/public";
const maximumBodyBytes = 1024;
const forbiddenCredentialHeaders = Object.freeze([
  "authorization",
  "cookie",
  "proxy-authorization",
  "x-api-key",
]);

export function createDisposableReadinessProvider(options) {
  const expectedHash = exactExpectedHash(options?.expectedServiceKeySha256);
  const counters = Object.seal({
    plans: 0,
    emailStart: 0,
    identify: 0,
    serviceSession: 0,
    notificationPreferences: 0,
  });

  return createServer((request, response) => {
    let bodyBytes = 0;
    const chunks = [];
    let rejectedAsOversized = false;

    request.on("data", (chunk) => {
      if (rejectedAsOversized) return;
      bodyBytes += chunk.byteLength;
      if (bodyBytes > maximumBodyBytes) {
        rejectedAsOversized = true;
        chunks.length = 0;
        send(response, 413, '{"detail":"payload too large"}\n');
        return;
      }
      chunks.push(chunk);
    });
    request.once("error", () => {
      if (!response.destroyed) response.destroy();
    });
    request.once("end", () => {
      if (rejectedAsOversized) return;

      const method = request.method ?? "";
      const requestPath = request.url ?? "";
      const serviceKey = request.headers["x-remnashop-auth-service-key"];
      const hasForbiddenCredential = forbiddenCredentialHeaders.some(
        (name) => request.headers[name] !== undefined,
      );
      const acceptsServiceKey = authPaths.has(requestPath) || requestPath === notificationPath;
      if (hasForbiddenCredential || (!acceptsServiceKey && serviceKey !== undefined)) {
        send(response, 403, '{"detail":"forbidden"}\n');
        return;
      }

      if (method === "GET" && requestPath === "/healthz") {
        if (bodyBytes !== 0) {
          send(response, 400, '{"detail":"invalid body"}\n');
          return;
        }
        send(response, 200, '{"status":"ok"}\n');
        return;
      }
      if (method === "GET" && requestPath === "/contract") {
        if (bodyBytes !== 0) {
          send(response, 400, '{"detail":"invalid body"}\n');
          return;
        }
        send(response, 200, `${JSON.stringify(counters)}\n`);
        return;
      }
      if (method === "GET" && requestPath === plansPath) {
        if (bodyBytes !== 0) {
          send(response, 400, '{"detail":"invalid body"}\n');
          return;
        }
        counters.plans += 1;
        send(response, 200, '{"items":[]}\n');
        return;
      }
      if (method === "POST" && acceptsServiceKey) {
        const contentType = request.headers["content-type"];
        const body = Buffer.concat(chunks).toString("utf8");
        if (typeof serviceKey !== "string"
          || contentType !== "application/json"
          || body !== "{}") {
          send(response, 403, '{"detail":"forbidden"}\n');
          return;
        }
        const observedHash = createHash("sha256").update(serviceKey).digest();
        if (!timingSafeEqual(observedHash, expectedHash)) {
          send(response, 403, '{"detail":"forbidden"}\n');
          return;
        }
        if (requestPath === notificationPath) counters.notificationPreferences += 1;
        else if (requestPath.endsWith("/email/start")) counters.emailStart += 1;
        else if (requestPath.endsWith("/identify")) counters.identify += 1;
        else counters.serviceSession += 1;
        send(
          response,
          requestPath === notificationPath ? 405 : 422,
          requestPath === notificationPath
            ? '{"detail":"method not allowed"}\n'
            : '{"detail":"validation error"}\n',
        );
        return;
      }
      send(response, 404, '{"detail":"not found"}\n');
    });
  });
}

export function closeDisposableReadinessProvider(server, timeoutMs = 5_000) {
  if (!server?.listening) return Promise.resolve();
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    return Promise.reject(new Error("invalid disposable readiness provider shutdown timeout"));
  }

  return new Promise((resolve, reject) => {
    let forced = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      forced = true;
      server.closeAllConnections();
      finish(new Error("disposable readiness provider shutdown exceeded its deadline"));
    }, timeoutMs);
    timer.unref();
    server.close((error) => {
      finish(error ?? (forced
        ? new Error("disposable readiness provider shutdown exceeded its deadline")
        : undefined));
    });
  });
}

function exactExpectedHash(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("invalid disposable readiness provider key contract");
  }
  return Buffer.from(value, "hex");
}

function exactPort(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{3,4}$/.test(value)) {
    throw new Error("invalid disposable readiness provider port");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new Error("invalid disposable readiness provider port");
  }
  return port;
}

function runCli() {
  const port = exactPort(process.argv[2]);
  const server = createDisposableReadinessProvider({
    expectedServiceKeySha256: process.env.CLEAN_PAY_SYNTHETIC_PROVIDER_KEY_SHA256,
  });
  server.listen(port, "0.0.0.0");
  server.on("error", () => { process.exitCode = 1; });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    closeDisposableReadinessProvider(server).then(
      () => { process.exitCode = 0; },
      () => { process.exitCode = 1; },
    );
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function send(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
  });
  response.end(body);
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url) runCli();
