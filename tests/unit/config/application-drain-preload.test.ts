import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const fixturePath = resolve("tests/fixtures/application-drain-server.mjs");
const preloadPath = resolve("deploy/prod/application-drain-preload.cjs")
  .replaceAll("\\", "/");
const children = new Set<ChildProcess>();

type FixtureMessage = Readonly<Record<string, unknown>> & {
  event: string;
};

afterEach(async () => {
  const running = [...children].filter((child) =>
    child.exitCode === null && child.signalCode === null
  );
  for (const child of running) child.kill();
  await Promise.all(running.map((child) => once(child, "close").catch(() => [])));
  children.clear();
});

describe("production application drain preload", () => {
  it("drains an admitted body, rejects later requests, then returns lifecycle to the framework", async () => {
    const fixture = startFixture("request", 2_000);
    const ready = await fixture.message("ready");
    expect(ready.inheritedNodeOptions).toBe("--trace-warnings");
    expect(ready.internalNodeOptionsPresent).toBe(false);
    const port = Number(ready.port);
    const request = openPartialRequest(port, 32 * 1024);

    await fixture.message("admitted");
    fixture.child.send("signal");
    await fixture.message("signalled");

    const rejected = await fetch(`http://127.0.0.1:${port}/after-signal`);
    expect(rejected.status).toBe(503);
    expect(await rejected.text()).toBe("Service Unavailable");

    request.finish();
    const response = await request.response;
    expect(response).toMatch(/^HTTP\/1\.1 200 OK\r\n/u);
    expect(response.endsWith("\r\n\r\naccepted:32768")).toBe(true);

    const result = await fixture.closed;
    expect(result).toEqual({ code: 0, signal: null });
    expect(fixture.output).toContain("event=application_drain_started");
    expect(fixture.output).toContain("event=application_http_drain_completed");
    expect(fixture.output).toContain("external_close=true");
    expect(fixture.output).toContain("event=fixture_framework_cleanup_completed error=false");
    expect(fixture.output).toContain("event=application_drain_completed");
    expect(fixture.output).toContain("exit_code=0");
  });

  it("fails closed at the bounded deadline when an admitted handler never settles", async () => {
    const fixture = startFixture("request", 100);
    const ready = await fixture.message("ready");
    const hanging = fetch(`http://127.0.0.1:${Number(ready.port)}/hang`)
      .catch(() => undefined);

    await fixture.message("admitted");
    fixture.child.send("signal");
    await fixture.message("signalled");
    fixture.child.send("signal");

    const result = await fixture.closed;
    await hanging;
    expect(result).toEqual({ code: 1, signal: null });
    expect(fixture.output).toContain("event=application_drain_timeout");
    expect(fixture.output).toContain("active_requests=1");
    expect(fixture.output).toContain("duplicate_signals=1");
    expect(fixture.output).not.toContain("trace-warnings --require");
  });

  it("exits cleanly when termination arrives before the framework owns a server", async () => {
    const fixture = startFixture("early-signal", 2_000);
    const result = await fixture.closed;

    expect(result).toEqual({ code: 143, signal: null });
    expect(fixture.output).toContain("event=application_drain_started active_requests=0 server_count=0");
    expect(fixture.output).toContain("event=application_http_drain_completed external_close=false");
    expect(fixture.output).toContain("event=application_drain_completed");
    expect(fixture.output).toContain("exit_code=143");
  });

  it("packages the preload explicitly without replacing operator Node diagnostics", () => {
    const dockerignore = readFileSync(".dockerignore", "utf8");
    const dockerfile = readFileSync("Dockerfile", "utf8");
    const gracefulProbe = readFileSync(
      "scripts/security/verify-app-graceful-request.mjs",
      "utf8",
    );
    const start = readFileSync("deploy/prod/start.sh", "utf8");

    expect(dockerignore).toContain("!deploy/prod/application-drain-preload.cjs");
    expect(dockerfile).toContain(
      "COPY --chown=cleanpay:nodejs deploy/prod/application-drain-preload.cjs ./deploy/prod/application-drain-preload.cjs",
    );
    expect(start).toContain("${NODE_OPTIONS:+${NODE_OPTIONS} }--require=./deploy/prod/application-drain-preload.cjs");
    expect(start).not.toContain("NEXT_MANUAL_SIG_HANDLE");
    expect(start).toContain("exec node server.js");
    expect(gracefulProbe).toContain('"--since"');
    expect(gracefulProbe).toContain('"--tail"');
    expect(gracefulProbe).toContain("active_requests=[1-9]\\d*");
    expect(gracefulProbe).toContain("status === 503 || status >= 500");
  });
});

function startFixture(mode: string, timeoutMs: number) {
  const child = spawn(process.execPath, [fixturePath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLEAN_PAY_INHERITED_NODE_OPTIONS: "--trace-warnings",
      CLEAN_PAY_TEST_APPLICATION_DRAIN_MODE: mode,
      CLEAN_PAY_TEST_APPLICATION_DRAIN_TIMEOUT_MS: String(timeoutMs),
      NODE_ENV: "test",
      NODE_OPTIONS: `--trace-warnings --require=${preloadPath}`,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  children.add(child);

  let output = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    output += chunk;
  });

  const messages: FixtureMessage[] = [];
  const waiters = new Map<string, Array<(message: FixtureMessage) => void>>();
  child.on("message", (value) => {
    if (!isFixtureMessage(value)) return;
    const waiter = waiters.get(value.event)?.shift();
    if (waiter) waiter(value);
    else messages.push(value);
  });

  return {
    child,
    closed: new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveClosed, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          children.delete(child);
          resolveClosed({ code, signal });
        });
      },
    ),
    message(event: string) {
      const existingIndex = messages.findIndex((message) => message.event === event);
      if (existingIndex >= 0) return Promise.resolve(messages.splice(existingIndex, 1)[0]!);
      return new Promise<FixtureMessage>((resolveMessage) => {
        const pending = waiters.get(event) ?? [];
        pending.push(resolveMessage);
        waiters.set(event, pending);
      });
    },
    get output() {
      return output;
    },
  };
}

function openPartialRequest(port: number, bodyBytes: number) {
  const body = Buffer.alloc(bodyBytes, "x");
  const firstChunkBytes = 16;
  const chunks: Buffer[] = [];
  const socket = connect({ host: "127.0.0.1", port });
  const response = new Promise<string>((resolveResponse, reject) => {
    socket.once("connect", () => {
      socket.write([
        "POST /slow HTTP/1.1",
        `Host: 127.0.0.1:${port}`,
        "Content-Type: application/x-www-form-urlencoded",
        `Content-Length: ${body.byteLength}`,
        "Connection: close",
        "",
        "",
      ].join("\r\n"));
      socket.write(body.subarray(0, firstChunkBytes));
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("error", reject);
    socket.once("close", (hadError) => {
      if (!hadError) resolveResponse(Buffer.concat(chunks).toString("utf8"));
    });
  });

  return {
    finish() {
      socket.end(body.subarray(firstChunkBytes));
    },
    response,
  };
}

function isFixtureMessage(value: unknown): value is FixtureMessage {
  return typeof value === "object"
    && value !== null
    && typeof (value as { event?: unknown }).event === "string";
}
