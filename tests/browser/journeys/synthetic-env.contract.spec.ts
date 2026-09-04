import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

import { expect, test } from "@playwright/test";

import { assertSyntheticCaddyRouteOrder } from "./caddy-route-policy";
import { currentJourneyFixtureContractSha256 } from "./journey-fixture-contract";

const script = path.resolve(__dirname, "prepare-synthetic-env.mjs");
const revision = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";

test("keeps synthetic role allowlists byte-for-byte aligned with production role policy", () => {
  const journeyModule = pathToFileURL(path.resolve(
    __dirname,
    "journey-synthetic-environment-contract.mjs",
  )).href;
  const productionModule = pathToFileURL(path.resolve(
    __dirname,
    "../../../deploy/prod/role-env.mjs",
  )).href;
  const result = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { JOURNEY_PRODUCTION_ROLE_ENVIRONMENT_NAMES as journey } from ${JSON.stringify(journeyModule)};`
      + `import { PRODUCTION_ROLE_ENVIRONMENT_NAMES as production } from ${JSON.stringify(productionModule)};`
      + "if (JSON.stringify(journey) !== JSON.stringify(production)) process.exit(1);",
  ], { encoding: "utf8", env: { ...process.env, NO_COLOR: "1" } });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("");
});

test("materializes two deterministic self-contained role environments", async () => {
  const first = await mkdtemp(path.join(tmpdir(), "clean-pay-browser-env-first-"));
  const second = await mkdtemp(path.join(tmpdir(), "clean-pay-browser-env-second-"));
  try {
    const firstResult = runGenerator(first);
    const secondResult = runGenerator(second);
    expect(firstResult.status, firstResult.stderr).toBe(0);
    expect(secondResult.status, secondResult.stderr).toBe(0);
    expect(JSON.parse(firstResult.stdout)).toMatchObject({
      status: "prepared",
      fixtureContractSha256: currentJourneyFixtureContractSha256(),
      publicBuildContractSha256: "5dc1c21d1db2b433736d50c008065d9dfa3adc1ff338fb403569913881b80673",
      roleFileCount: 7,
    });
    const firstFiles = await readFiles(first);
    const secondFiles = await readFiles(second);
    expect(normalizeOutputPaths(secondFiles, second)).toEqual(normalizeOutputPaths(firstFiles, first));
    expect([...firstFiles.keys()].sort()).toEqual([
      ".env",
      ".env.app",
      ".env.browser-observer",
      ".env.browser-observer-provision",
      ".env.hold-operator",
      ".env.migration",
      ".env.postgres",
      ".env.provision",
      ".env.reconciliation",
      ".env.retention",
      "browser-journey-contract.json",
    ]);
    const all = [...firstFiles.values()].join("\n");
    expect(all).not.toContain("change-me");
    expect(all).not.toContain("Тестовое развертывание");
    expect(all).toContain("TELEGRAM_OIDC_TOKEN_ENDPOINT=https://oauth.telegram.org/token");
    expect(all).toContain("TURNSTILE_VERIFY_URL=https://challenges.cloudflare.com/turnstile/v0/siteverify");
    const observer = firstFiles.get(".env.browser-observer") ?? "";
    const observerProvision = firstFiles.get(".env.browser-observer-provision") ?? "";
    expect(assignmentNames(observer)).toEqual(["DATABASE_URL"]);
    expect(new URL(assignmentValue(observer, "DATABASE_URL")).username)
      .toBe("clean_pay_browser_observer");
    expect(assignmentNames(observerProvision)).toEqual([
      "CLEAN_PAY_BROWSER_DB_OBSERVER_PASSWORD",
      "CLEAN_PAY_BROWSER_DB_OBSERVER_USER",
      "CLEAN_PAY_BROWSER_DB_SCOPE",
      "PGDATABASE",
      "PGHOST",
      "PGPASSWORD",
      "PGPORT",
      "PGUSER",
    ]);
    expect(JSON.parse(firstFiles.get("browser-journey-contract.json") ?? "null")).toMatchObject({
      fixtureContract: {
        domain: "clean-pay-browser-journey-fixture-v5",
        sha256: currentJourneyFixtureContractSha256(),
      },
      images: {
        application: "clean-pay:synthetic-app",
        migration: "clean-pay:synthetic-migration",
      },
      publications: {
        app: "127.0.0.1:4100",
        browserTls: "127.0.0.2:443",
        connectProxy: "127.0.0.1:14444",
        providerControl: "127.0.0.1:13100",
      },
    });
    const caddySource = await readFile(path.resolve(__dirname, "Caddyfile"), "utf8");
    const providerSource = await readFile(
      path.resolve(__dirname, "provider-mock.mjs"),
      "utf8",
    );
    const identityConfirmationDelayMs = Number(
      /\}\), ([0-9_]+)\);\n    \}\);\n    send\(\{ event: "loaded" \}\);/
        .exec(caddySource)?.[1].replaceAll("_", ""),
    );
    const ownershipFallbackDelayMs = Number(
      /CLEAN_PAY_BROWSER_CHATWOOT_CONTACT_RESPONSE_DELAY_MS",\n  ([0-9_]+),/
        .exec(providerSource)?.[1].replaceAll("_", ""),
    );
    const preCabinetOwnershipFallbackDelayMs = Number(
      /CLEAN_PAY_BROWSER_CHATWOOT_PRE_CABINET_CONTACT_RESPONSE_DELAY_MS",\n  ([0-9_]+),/
        .exec(providerSource)?.[1].replaceAll("_", ""),
    );
    expect({
      identityConfirmationDelayMs,
      ownershipFallbackDelayMs,
      preCabinetOwnershipFallbackDelayMs,
    }).toEqual({
      identityConfirmationDelayMs: 1_200,
      ownershipFallbackDelayMs: 75,
      preCabinetOwnershipFallbackDelayMs: 1_800,
    });
    expect(ownershipFallbackDelayMs).toBeLessThan(identityConfirmationDelayMs);
    expect(preCabinetOwnershipFallbackDelayMs).toBeGreaterThan(identityConfirmationDelayMs);
    expect(ownershipFallbackDelayMs).toBeLessThan(3_000);
    expect(providerSource).toContain(
      'const chatwootPhaseScenario = "chatwoot-phase-stability-v1";',
    );
    expect(assertSyntheticCaddyRouteOrder(caddySource)).toEqual({
      chatwootIdentityDelivery: {
        aboutBlankLoadDeliveryBlocked: true,
        boundaryObservation: "retry-aware-trusted-loaded",
        confirmation: "matching-current-frame-delivery",
        identityDeliverySignal: "trusted-widget-loaded-message",
        readinessSignal: "sdk-ready-before-iframe",
        source: "current-configured-iframe-content-window",
        targetOrigin: "https://chatwoot.browser.clean-pay.dev",
      },
    });
    for (const nearMiss of [
      caddySource.replace("    reverse_proxy @verify browser-provider-mock:3100", ""),
      caddySource.replace("    respond 404", "    respond 404\n    respond 404"),
      caddySource.replace(
        "    reverse_proxy @contact browser-provider-mock:3100",
        "    reverse_proxy @contact browser-provider-mock:3000",
      ),
      caddySource.replace("  route {", "  handle {"),
      caddySource.replace(
        "    reverse_proxy @verify browser-provider-mock:3100",
        "    respond 404\n    reverse_proxy @verify browser-provider-mock:3100",
      ),
      caddySource.replace(
        "          if (!pendingIdentity || !target || readyFrameWindow !== target) return;",
        "          if (!pendingIdentity || !target) return;",
      ),
      caddySource.replace(
        "        addEventListener(\"message\", (event) => {",
        "        frame.addEventListener(\"load\", deliverIdentity);\n        addEventListener(\"message\", (event) => {",
      ),
      caddySource.replace(
        "          if (event.origin !== config.baseUrl || !target || event.source !== target || typeof event.data !== \"string\") return;",
        "          if (event.source !== target || typeof event.data !== \"string\") return;",
      ),
      caddySource.replace(
        "              const becameReady = readyFrameWindow !== target;\n              readyFrameWindow = target;\n              if (inFlightIdentity?.frameWindow !== target) inFlightIdentity = null;\n              const observeAfterIdentityRetry = window.cleanPayChatwootPendingIdentity?.phase === \"waiting_for_frame\";\n              deliverIdentity();",
        "              const becameReady = readyFrameWindow !== target;\n              const observeAfterIdentityRetry = window.cleanPayChatwootPendingIdentity?.phase === \"waiting_for_frame\";\n              deliverIdentity();\n              readyFrameWindow = target;\n              if (inFlightIdentity?.frameWindow !== target) inFlightIdentity = null;",
      ),
      caddySource
        .replace("        document.body.appendChild(frame);\n        const api = {", "        const api = {")
        .replace(
          "        addEventListener(\"message\", (event) => {",
          "        document.body.appendChild(frame);\n        addEventListener(\"message\", (event) => {",
      ),
      caddySource.replace(
        "            pendingIdentity = { deliveryId: ++nextDeliveryId, identifier };\n            document.cookie = \"cw_conversation=\"",
        "            deliverIdentity();\n            pendingIdentity = { deliveryId: ++nextDeliveryId, identifier };\n            document.cookie = \"cw_conversation=\"",
      ),
      caddySource.replace(
        "          const current = document.getElementById(\"chatwoot_live_chat_widget\");",
        "          const current = frame;",
      ),
      caddySource.replace(
        "          const delivery = pendingIdentity;\n          pendingIdentity = null;\n          inFlightIdentity = { deliveryId: delivery.deliveryId, frameWindow: target };",
        "          const delivery = pendingIdentity;\n          inFlightIdentity = { deliveryId: delivery.deliveryId, frameWindow: target };\n          pendingIdentity = null;",
      ),
      caddySource.replace(
        "        data: { deliveryId, widgetAuthToken: \"synthetic-widget-auth\" },",
        "        data: { widgetAuthToken: \"synthetic-widget-auth\" },",
      ),
      caddySource.replace(
        "              && message.data?.deliveryId === inFlightIdentity.deliveryId) {",
        "              && Number.isSafeInteger(message.data?.deliveryId)) {",
      ),
      caddySource.replace(
        "              inFlightIdentity = null;\n              calls.push({ method: \"identity.confirmed\" });",
        "              calls.push({ method: \"identity.confirmed\" });\n              inFlightIdentity = null;",
      ),
      caddySource.replace(
        "              const observeAfterIdentityRetry = window.cleanPayChatwootPendingIdentity?.phase === \"waiting_for_frame\";",
        "              const observeAfterIdentityRetry = true;",
      ),
      caddySource.replace(
        "                if (announcedFrameWindow !== target && currentFrameWindow() === target) {",
        "                if (announcedFrameWindow !== target) {",
      ),
      caddySource.replace(
        "              if (observeAfterIdentityRetry) queueMicrotask(announceFrameLoaded);\n              else announceFrameLoaded();",
        "              queueMicrotask(announceFrameLoaded);",
      ),
      caddySource.replace(
        "          hasLoaded: !preownedConversation,",
        "          hasLoaded: true,",
      ),
      caddySource.replace(
        "        queueMicrotask(() => window.dispatchEvent(new CustomEvent(\"chatwoot:ready\")));",
        "        queueMicrotask(() => undefined);",
      ),
      caddySource.replace(
        "            pendingIdentity = null;\n            inFlightIdentity = null;\n            api.resetTriggered = true;",
        "            api.resetTriggered = true;",
      ),
    ]) {
      expect(() => assertSyntheticCaddyRouteOrder(nearMiss)).toThrow();
    }
    await assertConnectProxyContract();
  } finally {
    await Promise.all([
      rm(first, { recursive: true, force: true }),
      rm(second, { recursive: true, force: true }),
    ]);
  }
});

test("refuses external env sources and leaves no role files", async () => {
  const destination = await mkdtemp(path.join(tmpdir(), "clean-pay-browser-env-reject-"));
  try {
    const result = runGenerator(destination, { CLEAN_PAY_BROWSER_SYNTHETIC_ENV_SOURCE: "C:\\outside.env" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("refuses external env sources");
    expect(await readdir(destination)).toEqual([]);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

async function assertConnectProxyContract() {
  const upstreamSockets = new Set<net.Socket>();
  let upstreamConnections = 0;
  let upstreamBytes = Buffer.alloc(0);
  const upstream = net.createServer((socket) => {
    upstreamConnections += 1;
    upstreamSockets.add(socket);
    socket.once("close", () => upstreamSockets.delete(socket));
    socket.on("data", (chunk) => {
      upstreamBytes = Buffer.concat([upstreamBytes, chunk]);
      socket.write(chunk);
    });
  });
  await listen(upstream);
  const upstreamAddress = upstream.address();
  if (!upstreamAddress || typeof upstreamAddress === "string") {
    throw new Error("CONNECT proxy contract upstream did not bind IPv4.");
  }

  const child = spawn(process.execPath, [
    path.resolve(__dirname, "journey-connect-proxy.mjs"),
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLEAN_PAY_BROWSER_CONNECT_PROXY_BIND: "127.0.0.1",
      CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT: "0",
      CLEAN_PAY_BROWSER_CONNECT_TARGET_HOST: "127.0.0.1",
      CLEAN_PAY_BROWSER_CONNECT_TARGET_PORT: String(upstreamAddress.port),
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const childClosed = once(child, "close");
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const iterator = lines[Symbol.asyncIterator]();
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    if (stderr.length < 2_048) stderr += chunk.slice(0, 2_048 - stderr.length);
  });
  child.stdin.once("error", () => undefined);

  try {
    const ready = await nextJsonLine(iterator);
    expect(ready).toMatchObject({
      status: "ready",
      target: `127.0.0.1:${upstreamAddress.port}`,
      allowedHostCount: 8,
      limits: {
        maxClientConnections: 64,
        maxHeaderBytes: 8_192,
        prefaceTimeoutMs: 5_000,
        upstreamConnectTimeoutMs: 5_000,
      },
    });
    if (!isRecord(ready) || typeof ready.listen !== "string") {
      throw new Error("CONNECT proxy readiness did not contain its loopback listener.");
    }
    expect(ready.listen).toMatch(/^127\.0\.0\.1:\d{4,5}$/);
    const proxyPort = Number(ready.listen.slice(ready.listen.lastIndexOf(":") + 1));
    expect(Number.isSafeInteger(proxyPort) && proxyPort >= 1_024 && proxyPort <= 65_535)
      .toBe(true);

    const pipelined = Buffer.from("synthetic-connect-pipelined-bytes", "utf8");
    const allowedResponse = await proxyExchange(
      proxyPort,
      Buffer.concat([
        Buffer.from(
          "CONNECT pay.ci.clean-pay.dev:443 HTTP/1.1\r\n"
          + "Host: pay.ci.clean-pay.dev:443\r\n\r\n",
          "latin1",
        ),
        pipelined,
      ]),
      pipelined,
    );
    expect(allowedResponse.subarray(0, allowedResponse.indexOf("\r\n\r\n") + 4).toString("latin1"))
      .toBe("HTTP/1.1 200 Connection Established\r\n\r\n");
    expect(allowedResponse.subarray(-pipelined.byteLength)).toEqual(pipelined);
    expect(upstreamConnections).toBe(1);
    expect(upstreamBytes).toEqual(pipelined);

    const rejected = [
      {
        status: 405,
        request: "GET https://pay.ci.clean-pay.dev/ HTTP/1.1\r\n"
          + "Host: pay.ci.clean-pay.dev\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT pay.ci.clean-pay.dev:443 HTTP/1.1\r\n"
          + "Host: pay.ci.clean-pay.dev:443\r\n"
          + "Proxy-Authorization: Basic synthetic\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT 127.0.0.2:443 HTTP/1.1\r\nHost: 127.0.0.2:443\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT pay.ci.clean-pay.dev.:443 HTTP/1.1\r\n"
          + "Host: pay.ci.clean-pay.dev.:443\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT pay.ci.clean-pay.dev:444 HTTP/1.1\r\n"
          + "Host: pay.ci.clean-pay.dev:444\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT PAY.CI.CLEAN-PAY.DEV:443 HTTP/1.1\r\n"
          + "Host: PAY.CI.CLEAN-PAY.DEV:443\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT pay.ci.clean-pay.dev.evil.invalid:443 HTTP/1.1\r\n"
          + "Host: pay.ci.clean-pay.dev.evil.invalid:443\r\n\r\n",
      },
      {
        status: 403,
        request: "CONNECT pay.ci.clean-pay.dev:443 HTTP/1.0\r\n"
          + "Host: pay.ci.clean-pay.dev:443\r\n\r\n",
      },
      {
        status: 431,
        request: "CONNECT pay.ci.clean-pay.dev:443 HTTP/1.1\r\nX-Bounded: "
          + "x".repeat(8_192)
          + "\r\n\r\n",
      },
    ];
    for (const nearMiss of rejected) {
      const response = await proxyExchange(
        proxyPort,
        Buffer.from(nearMiss.request, "latin1"),
      );
      expect(response.toString("latin1")).toMatch(
        new RegExp(`^HTTP/1\\.1 ${nearMiss.status} `),
      );
    }
    expect(upstreamConnections).toBe(1);

    child.stdin.end("stop\n");
    const stopped = await nextJsonLine(iterator);
    expect(stopped).toEqual({
      status: "stopped",
      outcome: "clean",
      listen: ready.listen,
      target: `127.0.0.1:${upstreamAddress.port}`,
      allowedHostCount: 8,
      counters: {
        accepted: 1,
        rejected: rejected.length,
        upstreamAttempts: 1,
        upstreamConnected: 1,
        upstreamFailures: 0,
      },
    });
    const [code, signal] = await childClosed;
    expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: "" });
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) {
      if (!child.stdin.destroyed) child.stdin.end("stop\n");
      await Promise.race([
        childClosed,
        new Promise((resolve) => setTimeout(resolve, 1_000)),
      ]);
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    for (const socket of upstreamSockets) socket.destroy();
    await close(upstream);
  }
}

function listen(server: net.Server) {
  return new Promise<void>((resolve, reject) => {
    const failed = (error: Error) => reject(error);
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", failed);
      resolve();
    });
  });
}

function close(server: net.Server) {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function nextJsonLine(iterator: AsyncIterator<string>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    iterator.next().then((result) => {
      if (result.done) throw new Error("CONNECT proxy closed its structured output early.");
      return JSON.parse(result.value) as unknown;
    }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        "CONNECT proxy structured output timed out.",
      )), 5_000);
    }),
  ]).finally(() => clearTimeout(timer));
}

function proxyExchange(port: number, request: Buffer, expectedEcho?: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let response = Buffer.alloc(0);
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      operation();
    };
    socket.setTimeout(5_000, () => finish(() => reject(new Error(
      "CONNECT proxy exchange timed out.",
    ))));
    socket.once("connect", () => socket.write(request));
    socket.on("data", (chunk) => {
      response = Buffer.concat([response, chunk]);
      if (expectedEcho && response.subarray(-expectedEcho.byteLength).equals(expectedEcho)) {
        finish(() => resolve(response));
      }
    });
    socket.once("end", () => {
      if (!expectedEcho) finish(() => resolve(response));
    });
    socket.once("error", (error) => finish(() => reject(error)));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function runGenerator(destination: string, extra: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR: destination,
      CLEAN_PAY_BROWSER_COMPOSE_PROJECT: "clean-pay-browser-journey-contract-test",
      CLEAN_PAY_BROWSER_APP_IMAGE: "clean-pay:synthetic-app",
      CLEAN_PAY_BROWSER_MIGRATION_IMAGE: "clean-pay:synthetic-migration",
      CLEAN_PAY_BROWSER_SOURCE_REVISION: revision,
      ...extra,
    },
  });
}

async function readFiles(directory: string) {
  const result = new Map<string, string>();
  for (const name of (await readdir(directory)).sort()) {
    result.set(name, await readFile(path.join(directory, name), "utf8"));
  }
  return result;
}

function normalizeOutputPaths(files: Map<string, string>, directory: string) {
  const normalized = new Map(files);
  const authoritativePath = path.join(path.resolve(directory), ".env");
  const expectedPaths = new Map([
    ["CLEAN_PAY_APP_ENV_FILE", `${authoritativePath}.app`],
    ["CLEAN_PAY_BROWSER_DB_OBSERVER_ENV_FILE", `${authoritativePath}.browser-observer`],
    [
      "CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_ENV_FILE",
      `${authoritativePath}.browser-observer-provision`,
    ],
    ["CLEAN_PAY_HOLD_OPERATOR_ENV_FILE", `${authoritativePath}.hold-operator`],
    ["CLEAN_PAY_MIGRATION_ENV_FILE", `${authoritativePath}.migration`],
    ["CLEAN_PAY_POSTGRES_ENV_FILE", `${authoritativePath}.postgres`],
    ["CLEAN_PAY_PROVISION_ENV_FILE", `${authoritativePath}.provision`],
    ["CLEAN_PAY_RECONCILIATION_ENV_FILE", `${authoritativePath}.reconciliation`],
    ["CLEAN_PAY_RETENTION_ENV_FILE", `${authoritativePath}.retention`],
  ]);
  const source = normalized.get(".env");
  if (!source) throw new Error("Synthetic environment did not contain .env.");
  const seen = new Set<string>();
  normalized.set(".env", source.split("\n").map((line) => {
    const separator = line.indexOf("=");
    const name = separator === -1 ? line : line.slice(0, separator);
    const expected = expectedPaths.get(name);
    if (expected === undefined) return line;
    const actual = line.slice(separator + 1);
    expect(actual, `${name} must name its exact generated role file`).toBe(expected);
    seen.add(name);
    return `${name}=<OUTPUT_DIR>/${path.basename(expected)}`;
  }).join("\n"));
  expect([...seen].sort()).toEqual([...expectedPaths.keys()].sort());
  return normalized;
}

function assignmentNames(contents: string) {
  return contents.trim().split("\n").map((line) => line.slice(0, line.indexOf("="))).sort();
}

function assignmentValue(contents: string, name: string) {
  const prefix = `${name}=`;
  const line = contents.split("\n").find((candidate) => candidate.startsWith(prefix));
  if (!line) throw new Error(`Missing synthetic assignment ${name}.`);
  return line.slice(prefix.length);
}
