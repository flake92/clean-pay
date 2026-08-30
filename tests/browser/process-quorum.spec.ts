import { createHash } from "node:crypto";

import type {
  BrowserContext,
  Page,
  Request as PlaywrightRequest,
} from "@playwright/test";

import {
  characterizationContextOptions,
  closeOwnedResources,
  expect,
  test,
} from "./fixtures";
import {
  installCharacterizationReplayGuard,
  permitsCharacterizationReplayRequest,
} from "./characterization-replay-policy";
import {
  PairedPngQuorumError,
  requireExactProcessBytesAgreement,
  selectIndependentProcessCharacterizationPairQuorum,
  selectIndependentProcessCharacterizationQuorum,
} from "./process-quorum";

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function sample(screenshot: Uint8Array, route = "/login") {
  return {
    screenshot,
    manifest: Buffer.from(`${JSON.stringify({
      route: { final: route },
      screenshot: {
        width: 1,
        height: 1,
        sha256: sha256(screenshot),
      },
    }, null, 2)}\n`),
  };
}

function identity(value: Uint8Array) {
  return Buffer.from(value);
}

test.describe("independent Chromium process quorum", () => {
  test("replays only local GETs and the exact credential-free Turnstile stub", () => {
    const applicationOrigin = "http://127.0.0.1:4000";
    const local = {
      applicationOrigin,
      headers: {},
      method: "GET",
      resourceType: "document",
      url: `${applicationOrigin}/login`,
    };
    const turnstile = {
      applicationOrigin,
      headers: {},
      method: "GET",
      resourceType: "script",
      url: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    };
    expect(permitsCharacterizationReplayRequest(local)).toBe(true);
    expect(permitsCharacterizationReplayRequest(turnstile)).toBe(true);
    for (const nearMiss of [
      { ...local, method: "POST" },
      { ...local, headers: { "next-action": "opaque" } },
      { ...local, url: "http://user:password@127.0.0.1:4000/login" },
      { ...turnstile, resourceType: "fetch" },
      { ...turnstile, headers: { authorization: "credential" } },
      { ...turnstile, headers: { "x-api-key": "credential" } },
      { ...turnstile, url: `${turnstile.url}&near_miss=1` },
      { ...turnstile, url: "https://provider.invalid/resource.js" },
      { ...turnstile, url: "not a url" },
    ]) {
      expect(permitsCharacterizationReplayRequest(nearMiss)).toBe(false);
    }
  });

  test("selects only an exact full-PNG majority", () => {
    const stable = Buffer.from([137, 80, 78, 71, 1]);
    const cornerRasterVariant = Buffer.from([137, 80, 78, 71, 2]);
    const result = selectIndependentProcessCharacterizationQuorum([
      sample(stable),
      sample(cornerRasterVariant),
      sample(stable),
    ], identity);

    expect(result.selectedScreenshot).toEqual(stable);
    expect(result.selectedProcessIndex).toBe(0);
    expect(result.selectedProcessIndexes).toEqual([0, 2]);
    expect(result.processes.map((entry) => entry.rawPngSha256)).toEqual([
      sha256(stable),
      sha256(cornerRasterVariant),
      sha256(stable),
    ]);
  });

  test("selects one exact repeated role tuple without masking a genuine A/B raster diff", () => {
    const baseline = Buffer.from([137, 80, 78, 71, 1]);
    const candidate = Buffer.from([137, 80, 78, 71, 2]);
    const dissentBaseline = Buffer.from([137, 80, 78, 71, 3]);
    const dissentCandidate = Buffer.from([137, 80, 78, 71, 4]);
    const result = selectIndependentProcessCharacterizationPairQuorum([
      { baseline: sample(baseline), candidate: sample(candidate) },
      { baseline: sample(baseline), candidate: sample(candidate) },
      { baseline: sample(dissentBaseline), candidate: sample(dissentCandidate) },
    ], identity);

    expect(result.selectedProcessIndex).toBe(0);
    expect(result.selectedProcessIndexes).toEqual([0, 1]);
    expect(result.baseline.selectedProcessIndex).toBe(result.candidate.selectedProcessIndex);
    expect(result.baseline.selectedScreenshot).toEqual(baseline);
    expect(result.candidate.selectedScreenshot).toEqual(candidate);
    expect(result.baseline.selectedScreenshot).not.toEqual(result.candidate.selectedScreenshot);
  });

  test("fails closed when separate role majorities have no repeated exact pair tuple", () => {
    const first = Buffer.from([137, 80, 78, 71, 1]);
    const second = Buffer.from([137, 80, 78, 71, 2]);
    expect(() => selectIndependentProcessCharacterizationPairQuorum([
      { baseline: sample(first), candidate: sample(first) },
      { baseline: sample(first), candidate: sample(second) },
      { baseline: sample(second), candidate: sample(first) },
    ], identity)).toThrow(/no exact byte-identical paired PNG quorum/);
  });

  test("brands absent paired PNG quorum with six immutable records and three tuple digests", () => {
    const first = Buffer.from([137, 80, 78, 71, 1]);
    const second = Buffer.from([137, 80, 78, 71, 2, 0]);
    let observed: unknown;
    try {
      selectIndependentProcessCharacterizationPairQuorum([
        { baseline: sample(first), candidate: sample(first) },
        { baseline: sample(first), candidate: sample(second) },
        { baseline: sample(second), candidate: sample(first) },
      ], identity);
    } catch (error) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(PairedPngQuorumError);
    const branded = observed as PairedPngQuorumError;
    expect(branded.records).toHaveLength(6);
    expect(branded.records.map(({ processIndex, role }) => ({ processIndex, role }))).toEqual([
      { processIndex: 0, role: "baseline" },
      { processIndex: 0, role: "candidate" },
      { processIndex: 1, role: "baseline" },
      { processIndex: 1, role: "candidate" },
      { processIndex: 2, role: "baseline" },
      { processIndex: 2, role: "candidate" },
    ]);
    expect(branded.records.map(({ bytes }) => bytes)).toEqual([5, 5, 5, 6, 6, 5]);
    expect(branded.records.every(({ sha256: digest }) => /^[a-f0-9]{64}$/.test(digest)))
      .toBe(true);
    expect(branded.tupleDigests).toHaveLength(3);
    expect(branded.tupleDigests.map(({ processIndex }) => processIndex)).toEqual([0, 1, 2]);
    expect(branded.tupleDigests.every(({ sha256: digest }) => /^[a-f0-9]{64}$/.test(digest)))
      .toBe(true);
    expect(new Set(branded.tupleDigests.map(({ sha256: digest }) => digest)).size).toBe(3);
    expect(Object.isFrozen(branded)).toBe(true);
    expect(Object.isFrozen(branded.records)).toBe(true);
    expect(Object.isFrozen(branded.tupleDigests)).toBe(true);
    expect(branded.records.every(Object.isFrozen)).toBe(true);
    expect(branded.tupleDigests.every(Object.isFrozen)).toBe(true);
  });

  test("fails paired selection on role evidence drift, bad attestation, or wrong count", () => {
    const stable = Buffer.from([137, 80, 78, 71]);
    expect(() => selectIndependentProcessCharacterizationPairQuorum([
      { baseline: sample(stable), candidate: sample(stable) },
      { baseline: sample(stable), candidate: sample(stable, "/register") },
      { baseline: sample(stable), candidate: sample(stable) },
    ], identity)).toThrow(/candidate projected non-PNG characterization manifests disagree/);

    const invalid = sample(stable);
    invalid.manifest = sample(Buffer.from([1, 2, 3])).manifest;
    expect(() => selectIndependentProcessCharacterizationPairQuorum([
      { baseline: invalid, candidate: sample(stable) },
      { baseline: sample(stable), candidate: sample(stable) },
      { baseline: sample(stable), candidate: sample(stable) },
    ], identity)).toThrow(/does not self-attest/);

    expect(() => selectIndependentProcessCharacterizationPairQuorum([
      { baseline: sample(stable), candidate: sample(stable) },
      { baseline: sample(stable), candidate: sample(stable) },
    ], identity)).toThrow(/exactly 3 independent Chromium process pairs/);
  });

  test("fails when projected non-PNG evidence disagrees", () => {
    const stable = Buffer.from([137, 80, 78, 71]);
    expect(() => selectIndependentProcessCharacterizationQuorum([
      sample(stable),
      sample(stable, "/register"),
      sample(stable),
    ], identity)).toThrow(/non-PNG characterization manifests disagree/);
  });

  test("fails when raw manifest PNG attestation or process count is invalid", () => {
    const stable = Buffer.from([137, 80, 78, 71]);
    const invalid = sample(stable);
    invalid.manifest = sample(Buffer.from([1, 2, 3])).manifest;
    expect(() => selectIndependentProcessCharacterizationQuorum([
      invalid,
      sample(stable),
      sample(stable),
    ], identity)).toThrow(/does not self-attest/);
    expect(() => requireExactProcessBytesAgreement(
      [Buffer.from("same"), Buffer.from("same")],
      "console sidecars",
    )).toThrow(/exactly 3 independent process values/);
  });

  test("pins the complete anonymous browser context policy", ({}, testInfo) => {
    const configured = testInfo.project.use as Record<string, unknown>;
    expect(characterizationContextOptions(configured)).toEqual({
      acceptDownloads: true,
      baseURL: configured.baseURL,
      bypassCSP: false,
      colorScheme: "light",
      deviceScaleFactor: 1,
      hasTouch: configured.hasTouch,
      ignoreHTTPSErrors: false,
      isMobile: configured.isMobile,
      javaScriptEnabled: true,
      locale: "ru-RU",
      offline: false,
      reducedMotion: "reduce",
      serviceWorkers: "allow",
      timezoneId: "Europe/Moscow",
      viewport: configured.viewport,
    });

    expect(() => characterizationContextOptions({
      ...configured,
      storageState: "credential-bearing-state.json",
    })).toThrow(/keys do not match/);
    expect(() => characterizationContextOptions({
      ...configured,
      contextOptions: {
        ...(configured.contextOptions as Record<string, unknown>),
        extraHTTPHeaders: { authorization: "secret" },
      },
    })).toThrow(/contextOptions keys do not match/);
    expect(() => characterizationContextOptions({
      ...configured,
      viewport: {
        ...(configured.viewport as Record<string, unknown>),
        screen: { width: 390, height: 844 },
      },
    })).toThrow(/viewport keys do not match/);
    expect(() => characterizationContextOptions({
      ...configured,
      launchOptions: {
        ...(configured.launchOptions as Record<string, unknown>),
        channel: "chrome",
      },
    })).toThrow(/launchOptions keys do not match/);
  });

  test("attempts every owned close and surfaces rejection plus timeout", async () => {
    const attempts: number[] = [];
    await expect(closeOwnedResources({
      close: async (_resource, index) => {
        attempts.push(index);
        if (index === 0) throw new Error("close rejected");
        if (index === 1) await new Promise<never>(() => {});
      },
      label: "test resource",
      resources: ["first", "second", "third"],
      timeoutMs: 10,
    })).rejects.toThrow(/2 of 3 owned test resource/);
    expect(attempts.sort()).toEqual([0, 1, 2]);
  });

  test("seals late HTTP and denies popup, worker, and WebSocket transports", async () => {
    const harness = replayGuardHarness();
    const guard = await installCharacterizationReplayGuard({
      applicationOrigin: "http://127.0.0.1:4000",
      context: harness.context,
    });
    guard.bindPrimaryPage(harness.primaryPage);

    const popupRequest = harness.request({ page: harness.extraPage, url: "/popup" });
    harness.emit("request", popupRequest);
    await harness.route(popupRequest);
    harness.emit("requestfailed", popupRequest);
    const serviceWorkerRequest = harness.request({
      serviceWorker: {},
      url: "/service-worker-owned",
    });
    harness.emit("request", serviceWorkerRequest);
    await harness.route(serviceWorkerRequest);
    harness.emit("requestfailed", serviceWorkerRequest);
    harness.emit("serviceworker", {});
    harness.emit("page", harness.extraPage);
    await harness.websocket();

    await guard.drain({ quietMs: 10, timeoutMs: 50 });
    guard.seal();

    const lateRequest = harness.request();
    harness.emit("request", lateRequest);
    await harness.route(lateRequest);
    harness.emit("requestfailed", lateRequest);
    guard.markContextClosed();

    expect(harness.aborted).toBe(3);
    expect(harness.closedExtraPages).toBe(1);
    expect(harness.closedWebSockets).toBe(1);
    expect(harness.connectedWebSockets).toBe(0);
    expect(guard.evidence()).toMatchObject({
      phase: "closed",
      serviceWorkerRequestCount: 1,
      serviceWorkerCount: 1,
      extraPageCount: 1,
      websocketCount: 1,
      blockedRequestCount: 3,
      activeRequestCount: 0,
    });
    expect(() => guard.assertNoViolations()).toThrow(/transport violation/);
    guard.detach();
  });
});

function replayGuardHarness() {
  const listeners = new Map<string, Set<(...args: never[]) => unknown>>();
  let routeHandler: ((route: {
    abort: () => Promise<void>;
    fallback: () => Promise<void>;
    request: () => PlaywrightRequest;
  }) => Promise<void>) | null = null;
  let websocketHandler: ((websocket: {
    close: () => Promise<void>;
    connectToServer: () => void;
  }) => Promise<void>) | null = null;
  let aborted = 0;
  let closedExtraPages = 0;
  let closedWebSockets = 0;
  let connectedWebSockets = 0;
  const context = {
    on(event: string, handler: (...args: never[]) => unknown) {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(handler);
      listeners.set(event, eventListeners);
    },
    off(event: string, handler: (...args: never[]) => unknown) {
      listeners.get(event)?.delete(handler);
    },
    async route(_pattern: unknown, handler: typeof routeHandler) {
      routeHandler = handler;
    },
    async routeWebSocket(_pattern: unknown, handler: typeof websocketHandler) {
      websocketHandler = handler;
    },
  } as unknown as BrowserContext;
  const primaryPage = {
    context: () => context,
  } as unknown as Page;
  const extraPage = {
    context: () => context,
    async close() {
      closedExtraPages += 1;
    },
  } as unknown as Page;
  return {
    context,
    primaryPage,
    extraPage,
    get aborted() { return aborted; },
    get closedExtraPages() { return closedExtraPages; },
    get closedWebSockets() { return closedWebSockets; },
    get connectedWebSockets() { return connectedWebSockets; },
    emit(event: string, value: unknown) {
      for (const handler of listeners.get(event) ?? []) {
        handler(value as never);
      }
    },
    request(options: {
      page?: Page;
      serviceWorker?: object | null;
      url?: string;
    } = {}) {
      return {
        frame: () => ({ page: () => options.page ?? primaryPage }),
        headers: () => ({}),
        method: () => "GET",
        resourceType: () => "fetch",
        serviceWorker: () => options.serviceWorker ?? null,
        url: () => new URL(
          options.url ?? "/late",
          "http://127.0.0.1:4000",
        ).href,
      } as unknown as PlaywrightRequest;
    },
    async route(request: PlaywrightRequest) {
      if (!routeHandler) throw new Error("HTTP route was not installed.");
      await routeHandler({
        abort: async () => { aborted += 1; },
        fallback: async () => {},
        request: () => request,
      });
    },
    async websocket() {
      if (!websocketHandler) throw new Error("WebSocket route was not installed.");
      await websocketHandler({
        close: async () => { closedWebSockets += 1; },
        connectToServer: () => { connectedWebSockets += 1; },
      });
    },
  };
}
