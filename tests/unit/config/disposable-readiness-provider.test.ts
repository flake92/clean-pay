import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  request as httpRequest,
  type Server,
} from "node:http";
import { connect, createServer as createTcpServer, type AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  closeDisposableReadinessProvider,
  createDisposableReadinessProvider,
} from "../../../scripts/security/disposable-readiness-provider.mjs";

const syntheticServiceKey = "synthetic-disposable-readiness-key";
const expectedServiceKeySha256 = createHash("sha256")
  .update(syntheticServiceKey)
  .digest("hex");
const providerScriptPath = path.resolve(
  process.cwd(),
  "scripts/security/disposable-readiness-provider.mjs",
);
const authHeaders = Object.freeze({
  "content-type": "application/json",
  "x-remnashop-auth-service-key": syntheticServiceKey,
});

type ProviderResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};

describe("disposable readiness provider", () => {
  let server: Server;

  beforeEach(async () => {
    server = createDisposableReadinessProvider({ expectedServiceKeySha256 });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
  });

  afterEach(async () => {
    await closeDisposableReadinessProvider(server);
  });

  it("serves the exact readiness sequence and immutable counter projection", async () => {
    const health = await requestProvider(server, { path: "/healthz" });
    expect(health).toMatchObject({ status: 200, body: '{"status":"ok"}\n' });
    expect(health.headers).toMatchObject({
      "cache-control": "no-store",
      "content-type": "application/json",
    });

    const plans = await requestProvider(server, {
      path: "/api/v1/public/plans/public",
    });
    expect(plans).toMatchObject({ status: 200, body: '{"items":[]}\n' });

    const jwks = await requestProvider(server, { path: "/.well-known/jwks.json" });
    expect(jwks.status).toBe(200);
    expect(JSON.parse(jwks.body)).toEqual({
      keys: [{
        alg: "RS256",
        e: "AQAB",
        kid: "clean-pay-disposable-readiness-v1",
        kty: "RSA",
        n: expect.stringMatching(/^[A-Za-z0-9_-]{300,}$/),
        use: "sig",
      }],
    });

    const expectedStatuses = [422, 422, 422, 405];
    const paths = [
      "/api/v1/public/auth/email/start",
      "/api/v1/public/auth/identify",
      "/api/v1/public/auth/service-session",
      "/api/v1/public/auth/notification-preferences",
    ];
    const observedStatuses = [];
    for (const requestPath of paths) {
      const response = await requestProvider(server, {
        method: "POST",
        path: requestPath,
        headers: authHeaders,
        body: "{}",
      });
      observedStatuses.push(response.status);
    }
    expect(observedStatuses).toEqual(expectedStatuses);

    expect(await readCounters(server)).toEqual({
      plans: 1,
      emailStart: 1,
      identify: 1,
      serviceSession: 1,
      notificationPreferences: 1,
      jwks: 1,
    });
  });

  it.each([
    ["request body", { headers: { "content-length": "2" }, body: "{}" }],
    ["authorization", { headers: { authorization: "synthetic-unexpected-value" } }],
    ["cookie", { headers: { cookie: "synthetic-unexpected-value" } }],
    ["proxy authorization", {
      headers: { "proxy-authorization": "synthetic-unexpected-value" },
    }],
    ["API key", { headers: { "x-api-key": "synthetic-unexpected-value" } }],
    ["service key", {
      headers: { "x-remnashop-auth-service-key": syntheticServiceKey },
    }],
  ])("rejects a JWKS probe carrying an unexpected %s", async (_label, input) => {
    const response = await requestProvider(server, {
      path: "/.well-known/jwks.json",
      ...input,
    });

    expect(response.status).toBe("body" in input ? 400 : 403);
    expect(await readCounters(server)).toEqual(emptyCounters());
  });

  it.each([
    ["missing service key", { "content-type": "application/json" }, "{}"],
    ["wrong service key", {
      "content-type": "application/json",
      "x-remnashop-auth-service-key": "synthetic-wrong-key",
    }, "{}"],
    ["missing content type", {
      "x-remnashop-auth-service-key": syntheticServiceKey,
    }, "{}"],
    ["content type with parameters", {
      "content-type": "application/json; charset=utf-8",
      "x-remnashop-auth-service-key": syntheticServiceKey,
    }, "{}"],
    ["malformed JSON", authHeaders, "{"],
    ["unknown JSON field", authHeaders, '{"unexpected":true}'],
    ["empty body", authHeaders, ""],
  ])("rejects %s without recording a successful readiness call", async (_label, headers, body) => {
    const response = await requestProvider(server, {
      method: "POST",
      path: "/api/v1/public/auth/identify",
      headers,
      body,
    });

    expect(response).toMatchObject({ status: 403, body: '{"detail":"forbidden"}\n' });
    expect(await readCounters(server)).toEqual(emptyCounters());
  });

  it.each([
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-api-key",
  ])("rejects an auth probe carrying the unexpected %s header", async (header) => {
    const response = await requestProvider(server, {
      method: "POST",
      path: "/api/v1/public/auth/identify",
      headers: { ...authHeaders, [header]: "synthetic-unexpected-value" },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(await readCounters(server)).toEqual(emptyCounters());
  });

  it.each([
    "authorization",
    "cookie",
    "proxy-authorization",
    "x-api-key",
    "x-remnashop-auth-service-key",
  ])("rejects a plans probe carrying the credential header %s", async (header) => {
    const response = await requestProvider(server, {
      path: "/api/v1/public/plans/public",
      headers: { [header]: "synthetic-unexpected-value" },
    });

    expect(response.status).toBe(403);
    expect(await readCounters(server)).toEqual(emptyCounters());
  });

  it("rejects an oversized body without retaining or counting it", async () => {
    const response = await requestProvider(server, {
      method: "POST",
      path: "/api/v1/public/auth/identify",
      headers: authHeaders,
      body: Buffer.alloc(1025, 0x20),
    });

    expect(response).toMatchObject({
      status: 413,
      body: '{"detail":"payload too large"}\n',
    });
    expect(await readCounters(server)).toEqual(emptyCounters());
  });

  it.each([
    ["unknown path", { path: "/api/v1/public/unknown" }, 404],
    ["query-bearing known path", { path: "/api/v1/public/plans/public?probe=1" }, 404],
    ["query-bearing JWKS path", { path: "/.well-known/jwks.json?probe=1" }, 404],
    ["wrong method", { method: "PATCH", path: "/api/v1/public/plans/public" }, 404],
    ["wrong JWKS method", { method: "POST", path: "/.well-known/jwks.json" }, 404],
    ["body on health probe", { path: "/healthz", body: "{}" }, 400],
    ["body on counter probe", { path: "/contract", body: "{}" }, 400],
  ])("fails closed for an %s", async (_label, input, status) => {
    const response = await requestProvider(server, input);

    expect(response.status).toBe(status);
    expect(await readCounters(server)).toEqual(emptyCounters());
  });

  it("requires the exact lowercase SHA-256 environment projection", () => {
    for (const value of [undefined, "", "0".repeat(63), "A".repeat(64)]) {
      expect(() => createDisposableReadinessProvider({
        expectedServiceKeySha256: value,
      })).toThrow("invalid disposable readiness provider key contract");
    }
  });

  it("bounds shutdown when a client leaves a request incomplete", async () => {
    const address = exactAddress(server);
    const requestObserved = once(server, "request");
    const socket = connect(address.port, "127.0.0.1");
    socket.on("error", () => {});
    await once(socket, "connect");
    socket.write([
      "POST /api/v1/public/auth/identify HTTP/1.1",
      `Host: 127.0.0.1:${address.port}`,
      "Content-Type: application/json",
      `X-Remnashop-Auth-Service-Key: ${syntheticServiceKey}`,
      "Content-Length: 2",
      "",
      "{",
    ].join("\r\n"));
    await requestObserved;

    const startedAt = Date.now();
    await expect(closeDisposableReadinessProvider(server, 25))
      .rejects.toThrow("shutdown exceeded its deadline");
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    socket.destroy();
  });
});

describe("disposable readiness provider module loading", () => {
  it("publishes one fixed ready marker after the CLI listener is bound", async () => {
    const reservation = createTcpServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const reservedAddress = reservation.address();
    if (reservedAddress === null || typeof reservedAddress === "string") {
      throw new Error("disposable readiness provider test did not reserve a TCP port");
    }
    const port = reservedAddress.port;
    await new Promise<void>((resolve, reject) => {
      reservation.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });

    const child = spawn(process.execPath, [providerScriptPath, String(port)], {
      env: {
        CLEAN_PAY_SYNTHETIC_PROVIDER_KEY_SHA256: expectedServiceKeySha256,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"] as const,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    let exit: [number | null, NodeJS.Signals | null] | undefined;
    try {
      const [marker] = await once(child.stdout, "data", {
        signal: AbortSignal.timeout(5_000),
      });
      expect(Buffer.from(marker).toString("utf8"))
        .toBe("clean-pay-disposable-readiness-provider-ready-v1\n");

      const response = await fetch(`http://127.0.0.1:${port}/healthz`, {
        signal: AbortSignal.timeout(2_000),
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.text()).toBe('{"status":"ok"}\n');
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null && child.signalCode === null) {
        exit = await once(child, "exit", {
          signal: AbortSignal.timeout(5_000),
        }) as [number | null, NodeJS.Signals | null];
      } else {
        exit = [child.exitCode, child.signalCode];
      }
    }
    expect(exit).toEqual(process.platform === "win32"
      ? [null, "SIGTERM"]
      : [0, null]);
    expect(stdout).toBe("clean-pay-disposable-readiness-provider-ready-v1\n");
    expect(stderr).toBe("");
  });

  it("does not publish the ready marker when the CLI port is occupied", async () => {
    const blocker = createTcpServer();
    blocker.listen(0, "0.0.0.0");
    await once(blocker, "listening");
    const address = blocker.address();
    if (address === null || typeof address === "string") {
      throw new Error("disposable readiness provider test did not bind its blocker");
    }
    const child = spawn(process.execPath, [providerScriptPath, String(address.port)], {
      env: {
        CLEAN_PAY_SYNTHETIC_PROVIDER_KEY_SHA256: expectedServiceKeySha256,
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"] as const,
      windowsHide: true,
    });
    const exitPromise = once(child, "exit", {
      signal: AbortSignal.timeout(5_000),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    try {
      const exit = await exitPromise;
      expect(exit).toEqual([1, null]);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await new Promise<void>((resolve, reject) => {
        blocker.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("is import-safe and does not install process lifecycle handlers", () => {
    const moduleUrl = pathToFileURL(providerScriptPath).href;
    const program = `
      const before = {
        sigint: process.listenerCount("SIGINT"),
        sigterm: process.listenerCount("SIGTERM"),
        exitCode: process.exitCode ?? null,
      };
      const imported = await import(${JSON.stringify(moduleUrl)});
      const after = {
        sigint: process.listenerCount("SIGINT"),
        sigterm: process.listenerCount("SIGTERM"),
        exitCode: process.exitCode ?? null,
      };
      process.stdout.write(JSON.stringify({
        before,
        after,
        hasFactory: typeof imported.createDisposableReadinessProvider === "function",
        hasShutdown: typeof imported.closeDisposableReadinessProvider === "function",
      }));
    `;

    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(JSON.parse(output)).toEqual({
      before: { sigint: 0, sigterm: 0, exitCode: null },
      after: { sigint: 0, sigterm: 0, exitCode: null },
      hasFactory: true,
      hasShutdown: true,
    });
  });
});

async function requestProvider(
  server: Server,
  input: {
    method?: string;
    path: string;
    headers?: Readonly<Record<string, string>>;
    body?: string | Buffer;
  },
): Promise<ProviderResponse> {
  const address = exactAddress(server);
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      method: input.method ?? "GET",
      path: input.path,
      headers: input.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer) => {
        bytes += chunk.byteLength;
        if (bytes > 16 * 1024) response.destroy(new Error("oversized test response"));
        else chunks.push(chunk);
      });
      response.once("error", reject);
      response.once("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    request.setTimeout(2_000, () => request.destroy(new Error("provider test timed out")));
    request.once("error", reject);
    if (input.body !== undefined) request.write(input.body);
    request.end();
  });
}

async function readCounters(server: Server) {
  const response = await requestProvider(server, { path: "/contract" });
  expect(response.status).toBe(200);
  return JSON.parse(response.body);
}

function exactAddress(server: Server): AddressInfo {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("disposable readiness provider did not bind a TCP address");
  }
  return address;
}

function emptyCounters() {
  return {
    plans: 0,
    emailStart: 0,
    identify: 0,
    serviceSession: 0,
    notificationPreferences: 0,
    jwks: 0,
  };
}
