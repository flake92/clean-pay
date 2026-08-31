import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import {
  BEHAVIORAL_BASELINE_COMMIT,
  BaselineMismatchError,
  assertBaselineWriteAuthorized,
  baselineUpdateRequested,
  createImmutableArtifact,
  reconcileProjectedJsonBaselineArtifact,
} from "./baseline-policy";
import {
  assertStaticCspSidecarContract,
  configuredExpectedConsoleFingerprints,
} from "./console-policy";
import { normalizeStaticRouteCspConsole } from "./csp-console-normalizer";
import { projectCharacterizationManifestForComparison } from "./comparison-projection";
import {
  isExactDeterministicTurnstileTransport,
  recordNetwork,
  type NetworkManifestEntry,
} from "./network-recorder";
import { canonicalizeUrl } from "./redaction";
import {
  TURNSTILE_SCRIPT_URL,
  TURNSTILE_STUB_CONTRACT,
  TURNSTILE_STUB_SOURCE,
} from "./turnstile-stub";
import {
  captureInterleavedPairTerminalScreenshots,
  createSerializedPairCaptureTaskLifecycle,
  createSerializedPairTerminalScreenshotCapture,
  selectByteIdenticalMajority,
  selectByteIdenticalTerminalScreenshot,
} from "./screenshot-majority";
import { DETERMINISTIC_CHROMIUM_LAUNCH_ARGS } from "./render-policy";
import {
  JOURNEY_SYNTHETIC_HOSTNAMES,
  JOURNEY_SYNTHETIC_TLS_POLICY,
  journeyProvenanceLaunchArgs,
} from "./journeys/journey-browser-policy";
import {
  browserProvenanceCorrectionEvidence,
  PROVENANCE_CORRECTION_FILE,
} from "./baseline-provenance";

test.describe("immutable browser baseline policy", () => {
  test("waits for a delayed application font request to finish", async ({ page }) => {
    const origin = "http://font-recorder.test";
    const fontPath = "/_next/static/media/delayed-font.abcdefgh.woff2";
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === fontPath) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        await route.fulfill({
          body: Buffer.from([0, 1, 2, 3]),
          contentType: "font/woff2",
          status: 200,
        });
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>font recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, { fontTerminalTimeoutMs: 1_000 });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const requestStarted = page.waitForRequest((request) => (
      new URL(request.url()).pathname === fontPath
    ));
    await page.evaluate((url) => {
      const face = new FontFace("RecorderDelayed", `url(${url})`);
      document.fonts.add(face);
      void face.load().catch(() => {});
    }, `${origin}${fontPath}`);
    await requestStarted;

    const entries = await recorder.finish();
    const font = entries.find((entry) => requestUrlPathname(entry) === fontPath);
    expect(font?.response?.status).toBe(200);
    expect(font?.failure).toBeNull();
  });

  test("records a delayed application font failure as terminal", async ({ page }) => {
    const origin = "http://font-failure.test";
    const fontPath = "/_next/static/media/failed-font.abcdefgh.woff2";
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === fontPath) {
        await new Promise((resolve) => setTimeout(resolve, 75));
        await route.abort("failed");
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>font recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, { fontTerminalTimeoutMs: 1_000 });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const requestStarted = page.waitForRequest((request) => (
      new URL(request.url()).pathname === fontPath
    ));
    await page.evaluate((url) => {
      const face = new FontFace("RecorderFailed", `url(${url})`);
      document.fonts.add(face);
      void face.load().catch(() => {});
    }, `${origin}${fontPath}`);
    await requestStarted;

    const entries = await recorder.finish();
    const font = entries.find((entry) => requestUrlPathname(entry) === fontPath);
    expect(font?.response).toBeNull();
    expect(font?.failure?.errorText.bytes).toBeGreaterThan(0);
  });

  test("fails closed when an application font request never becomes terminal", async ({ page }) => {
    const origin = "http://font-timeout.test";
    const fontPath = "/_next/static/media/pending-font.abcdefgh.woff2";
    let releaseRoute!: () => void;
    const routeBlocked = new Promise<void>((resolve) => { releaseRoute = resolve; });
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === fontPath) {
        await routeBlocked;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>font recorder</title>", contentType: "text/html" });
    });
    try {
      const recorder = recordNetwork(page, origin, { fontTerminalTimeoutMs: 50 });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const requestStarted = page.waitForRequest((request) => (
        new URL(request.url()).pathname === fontPath
      ));
      await page.evaluate((url) => {
        const face = new FontFace("RecorderPending", `url(${url})`);
        document.fonts.add(face);
        void face.load().catch(() => {});
      }, `${origin}${fontPath}`);
      await requestStarted;

      await expect(recorder.finish()).rejects.toThrow(
        "application font request(s) to reach a terminal state",
      );
    } finally {
      releaseRoute();
      await page.waitForTimeout(25);
    }
  });

  test("does not wait for an external font transport", async ({ page }) => {
    const origin = "http://font-external.test";
    const externalOrigin = "http://external-font.test";
    const fontPath = "/_next/static/media/external-font.abcdefgh.woff2";
    let releaseRoute!: () => void;
    const routeBlocked = new Promise<void>((resolve) => { releaseRoute = resolve; });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === externalOrigin && url.pathname === fontPath) {
        await routeBlocked;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>font recorder</title>", contentType: "text/html" });
    });
    try {
      const recorder = recordNetwork(page, origin, { fontTerminalTimeoutMs: 50 });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const requestStarted = page.waitForRequest((request) => (
        new URL(request.url()).origin === externalOrigin
        && new URL(request.url()).pathname === fontPath
      ));
      await page.evaluate((url) => {
        const face = new FontFace("RecorderExternal", `url(${url})`);
        document.fonts.add(face);
        void face.load().catch(() => {});
      }, `${externalOrigin}${fontPath}`);
      await requestStarted;

      const entries = await recorder.finish();
      expect(entries.some((entry) => (
        entry.scope === "external" && entry.resourceType === "font"
      ))).toBe(true);
    } finally {
      releaseRoute();
      await page.waitForTimeout(25);
    }
  });

  test("waits for an already-started application Server Action to finish", async ({ page }) => {
    const origin = "http://server-action-finish.test";
    let releaseAction!: () => void;
    const actionBlocked = new Promise<void>((resolve) => { releaseAction = resolve; });
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === "/action") {
        await actionBlocked;
        await route.fulfill({ body: "action-result", status: 200 });
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>action recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, {
      serverActionTerminalTimeoutMs: 1_000,
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const requestStarted = page.waitForRequest((request) => (
      request.method() === "POST" && new URL(request.url()).pathname === "/action"
    ));
    await page.evaluate(() => {
      void fetch("/action", {
        method: "POST",
        headers: { "next-action": "synthetic-action" },
        body: "synthetic-payload",
      });
    });
    await requestStarted;

    let terminalObserved = false;
    const waiting = recorder.awaitStartedServerActions().then(() => {
      terminalObserved = true;
    });
    await page.waitForTimeout(25);
    expect(terminalObserved).toBe(false);
    releaseAction();
    await waiting;

    const entries = await recorder.finish();
    const action = entries.find((entry) => requestUrlPathname(entry) === "/action");
    expect(action?.serverAction.present).toBe(true);
    expect(action?.response?.status).toBe(200);
    expect(action?.failure).toBeNull();
  });

  test("records a failed application Server Action as terminal", async ({ page }) => {
    const origin = "http://server-action-failure.test";
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === "/action") {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await route.abort("failed");
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>action recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, {
      serverActionTerminalTimeoutMs: 1_000,
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const requestStarted = page.waitForRequest((request) => (
      request.method() === "POST" && new URL(request.url()).pathname === "/action"
    ));
    await page.evaluate(() => {
      void fetch("/action", {
        method: "POST",
        headers: { "next-action": "synthetic-action" },
        body: "synthetic-payload",
      }).catch(() => {});
    });
    await requestStarted;
    await recorder.awaitStartedServerActions();

    const entries = await recorder.finish();
    const action = entries.find((entry) => requestUrlPathname(entry) === "/action");
    expect(action?.response).toBeNull();
    expect(action?.failure?.errorText.bytes).toBeGreaterThan(0);
  });

  test("fails closed when an application Server Action never becomes terminal", async ({ page }) => {
    const origin = "http://server-action-timeout.test";
    let releaseAction!: () => void;
    const actionBlocked = new Promise<void>((resolve) => { releaseAction = resolve; });
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === "/action") {
        await actionBlocked;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>action recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, {
      serverActionTerminalTimeoutMs: 50,
    });
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const requestStarted = page.waitForRequest((request) => (
        request.method() === "POST" && new URL(request.url()).pathname === "/action"
      ));
      await page.evaluate(() => {
        void fetch("/action", {
          method: "POST",
          headers: { "next-action": "synthetic-action" },
          body: "synthetic-payload",
        }).catch(() => {});
      });
      await requestStarted;

      await expect(recorder.awaitStartedServerActions()).rejects.toThrow(
        "application Server Action request(s) to reach a terminal state",
      );
    } finally {
      releaseAction();
      await page.waitForTimeout(25);
      await recorder.finish();
    }
  });

  test("does not await ordinary or external POST transports", async ({ page }) => {
    const origin = "http://server-action-scope.test";
    const externalOrigin = "http://server-action-external.test";
    let releaseBlocked!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseBlocked = resolve; });
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === externalOrigin && request.method() === "OPTIONS") {
        await route.fulfill({
          status: 204,
          headers: {
            "access-control-allow-headers": "next-action",
            "access-control-allow-methods": "POST",
            "access-control-allow-origin": origin,
          },
        });
        return;
      }
      if (url.pathname === "/ordinary" || url.origin === externalOrigin) {
        await blocked;
        await route.abort("failed");
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>action recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, {
      serverActionTerminalTimeoutMs: 50,
    });
    try {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const ordinaryStarted = page.waitForRequest((request) => (
        request.method() === "POST" && new URL(request.url()).pathname === "/ordinary"
      ));
      await page.evaluate(() => {
        void fetch("/ordinary", { method: "POST", body: "ordinary" }).catch(() => {});
      });
      await ordinaryStarted;
      const ordinaryGeneration = await recorder.awaitStartedServerActions();
      expect(recorder.isServerActionGenerationCurrent(ordinaryGeneration)).toBe(true);

      const externalStarted = page.waitForRequest((request) => (
        request.method() === "POST" && new URL(request.url()).origin
          === "http://server-action-external.test"
      ));
      await page.evaluate((externalUrl) => {
        void fetch(externalUrl, {
          method: "POST",
          headers: { "next-action": "synthetic-action" },
          body: "external",
        }).catch(() => {});
      }, `${externalOrigin}/action`);
      await externalStarted;
      const externalGeneration = await recorder.awaitStartedServerActions();
      expect(recorder.isServerActionGenerationCurrent(externalGeneration)).toBe(true);
    } finally {
      releaseBlocked();
      await page.waitForTimeout(25);
      await recorder.finish();
    }
  });

  test("awaits only Server Actions started before the checkpoint snapshot", async ({ page }) => {
    const origin = "http://server-action-snapshot.test";
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const secondBlocked = new Promise<void>((resolve) => { releaseSecond = resolve; });
    await page.route(`${origin}/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/first" || pathname === "/second") {
        await (pathname === "/first" ? firstBlocked : secondBlocked);
        await route.fulfill({ body: pathname, status: 200 });
        return;
      }
      await route.fulfill({ body: "<!doctype html><title>action recorder</title>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, {
      serverActionTerminalTimeoutMs: 1_000,
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const firstStarted = page.waitForRequest((request) => (
      new URL(request.url()).pathname === "/first"
    ));
    await page.evaluate(() => {
      void fetch("/first", {
        method: "POST",
        headers: { "next-action": "first-action" },
        body: "first",
      });
    });
    await firstStarted;
    const checkpointWait = recorder.awaitStartedServerActions();

    const secondStarted = page.waitForRequest((request) => (
      new URL(request.url()).pathname === "/second"
    ));
    await page.evaluate(() => {
      void fetch("/second", {
        method: "POST",
        headers: { "next-action": "second-action" },
        body: "second",
      }).then(async (response) => {
        document.body.dataset.serverActionResult = await response.text();
      });
    });
    await secondStarted;
    releaseFirst();
    const checkpointGeneration = await checkpointWait;
    expect(recorder.isServerActionGenerationCurrent(checkpointGeneration)).toBe(false);
    releaseSecond();
    await page.waitForFunction(() => document.body.dataset.serverActionResult === "/second");
    const entries = await recorder.finish();
    expect(entries.filter((entry) => entry.serverAction.present)).toHaveLength(2);
  });

  test("tracks a redirect descendant of a started Server Action", async ({ page }) => {
    let releaseDescendant!: () => void;
    const descendantBlocked = new Promise<void>((resolve) => { releaseDescendant = resolve; });
    const server = createServer(async (request, response) => {
      if (request.url === "/action") {
        response.writeHead(307, { location: "/redirected-action" });
        response.end();
        return;
      }
      if (request.url === "/redirected-action") {
        await descendantBlocked;
        response.writeHead(200, { "content-type": "text/plain" });
        response.end("redirected-result");
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><title>action recorder</title>");
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Loopback server did not bind.");
      const origin = `http://127.0.0.1:${address.port}`;
      const recorder = recordNetwork(page, origin, {
        serverActionTerminalTimeoutMs: 1_000,
      });
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      const generationBeforeAction = await recorder.awaitStartedServerActions();
      const descendantStarted = page.waitForRequest((request) => (
        new URL(request.url()).pathname === "/redirected-action"
      ));
      await page.evaluate(() => {
        void fetch("/action", {
          method: "POST",
          headers: { "next-action": "redirect-action" },
          body: "redirect-payload",
        });
      });
      await descendantStarted;
      expect(recorder.isServerActionGenerationCurrent(generationBeforeAction)).toBe(false);

      let finishObserved = false;
      const finishing = recorder.finish().then((entries) => {
        finishObserved = true;
        return entries;
      });
      await page.waitForTimeout(25);
      expect(finishObserved).toBe(false);
      releaseDescendant();
      const entries = await finishing;
      const initial = entries.find((entry) => requestUrlPathname(entry) === "/action");
      const descendant = entries.find((entry) => (
        requestUrlPathname(entry) === "/redirected-action"
      ));
      expect(initial?.response?.status).toBe(307);
      expect(descendant?.response?.status).toBe(200);
      expect(descendant?.redirectedFrom).toBe(initial?.index);
    } finally {
      releaseDescendant();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("retries a checkpoint changed by a newly started Server Action", async ({ page }) => {
    const origin = "http://server-action-recapture.test";
    let releaseAction!: () => void;
    const actionBlocked = new Promise<void>((resolve) => { releaseAction = resolve; });
    await page.route(`${origin}/**`, async (route) => {
      if (new URL(route.request().url()).pathname === "/action") {
        await actionBlocked;
        await route.fulfill({ body: "terminal-ui", status: 200 });
        return;
      }
      await route.fulfill({ body: "<!doctype html><body>initial-ui</body>", contentType: "text/html" });
    });
    const recorder = recordNetwork(page, origin, {
      serverActionTerminalTimeoutMs: 1_000,
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    let captureAttempts = 0;
    const captured = await recorder.captureStableServerActionCheckpoint(async () => {
      captureAttempts += 1;
      if (captureAttempts === 1) {
        const actionStarted = page.waitForRequest((request) => (
          new URL(request.url()).pathname === "/action"
        ));
        await page.evaluate(() => {
          void fetch("/action", {
            method: "POST",
            headers: { "next-action": "recapture-action" },
            body: "recapture-payload",
          }).then(async (response) => {
            document.body.textContent = await response.text();
          });
        });
        await actionStarted;
        releaseAction();
        await page.waitForFunction(() => document.body.textContent === "terminal-ui");
      }
      return page.textContent("body");
    });

    expect(captureAttempts).toBe(2);
    expect(captured).toBe("terminal-ui");
    const entries = await recorder.finish();
    expect(entries.filter((entry) => entry.serverAction.present)).toHaveLength(1);
  });

  test("refuses to overwrite an existing baseline artifact", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "clean-pay-browser-baseline-"),
    );
    const destination = path.join(temporaryDirectory, "viewport.png");
    const original = Buffer.from("immutable-baseline");

    try {
      await expect(createImmutableArtifact(destination, original))
        .resolves.toBe("created");
      await expect(createImmutableArtifact(destination, Buffer.from("candidate")))
        .rejects.toBeInstanceOf(BaselineMismatchError);
      await expect(readFile(destination)).resolves.toEqual(original);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("compares a projection without rewriting raw JSON evidence", async () => {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), "clean-pay-browser-projection-"),
    );
    const destination = path.join(temporaryDirectory, "characterization.json");
    const original = Buffer.from(`${JSON.stringify({
      route: { final: "/login" },
      consolePolicy: { observedExpected: [] },
      network: {
        requests: [requestRecord("prefetch", 0, true)],
        serverActions: [],
      },
    })}\n`);
    const originalObject = JSON.parse(original.toString("utf8")) as {
      network: { requests: Array<ReturnType<typeof requestRecord>> };
    };
    const withAutomaticPrefetch = Buffer.from(`${JSON.stringify(originalObject)}\n`);
    const withoutAutomaticPrefetch = Buffer.from(`${JSON.stringify({
      ...originalObject,
      network: { requests: [], serverActions: [] },
    })}\n`);

    try {
      await createImmutableArtifact(destination, withAutomaticPrefetch);
      await expect(reconcileProjectedJsonBaselineArtifact({
        baselineFile: destination,
        actual: withoutAutomaticPrefetch,
        project: projectBytes,
        update: false,
      })).resolves.toBe("matched");
      await expect(readFile(destination)).resolves.toEqual(withAutomaticPrefetch);

      const stableChange = Buffer.from(withoutAutomaticPrefetch.toString("utf8").replace(
        '"/login"',
        '"/register"',
      ));
      await expect(reconcileProjectedJsonBaselineArtifact({
        baselineFile: destination,
        actual: stableChange,
        project: projectBytes,
        update: false,
      })).rejects.toBeInstanceOf(BaselineMismatchError);
      await expect(readFile(destination)).resolves.toEqual(withAutomaticPrefetch);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  test("permits baseline writes only for the pinned baseline commit", () => {
    expect(() => assertBaselineWriteAuthorized(BEHAVIORAL_BASELINE_COMMIT))
      .not.toThrow();
    expect(() => assertBaselineWriteAuthorized("0".repeat(40)))
      .toThrow(/permitted only at commit/);
  });

  test("does not infer update mode from any value except explicit 1", () => {
    expect(baselineUpdateRequested({ CLEAN_PAY_UPDATE_BASELINE: "1" }))
      .toBe(true);
    expect(baselineUpdateRequested({ CLEAN_PAY_UPDATE_BASELINE: "true" }))
      .toBe(false);
    expect(baselineUpdateRequested({})).toBe(false);
  });

  test("keeps the console allowlist exact and deny-by-default", () => {
    const first = "error:a" + "0".repeat(63);
    const second = "warning:b" + "1".repeat(63);
    expect(configuredExpectedConsoleFingerprints("")).toEqual([]);
    expect(configuredExpectedConsoleFingerprints(`${second},${first}`))
      .toEqual([first, second]);
    expect(() => configuredExpectedConsoleFingerprints("error:not-a-digest"))
      .toThrow(/64-character-sha256/);
    expect(() => configuredExpectedConsoleFingerprints(`${first},${first}`))
      .toThrow(/duplicates/);
  });

  test("normalizes only the exact static-route Chromium CSP grammar", () => {
    const applicationOrigin = "https://clean-pay.invalid";
    const policy = "script-src 'self' 'nonce-" + "a".repeat(32)
      + "' 'strict-dynamic' https://challenges.cloudflare.com https://telegram.org";
    const journeyPolicy = `${policy} https://chatwoot.browser.clean-pay.dev`;
    const loadMessage = "Loading the script '"
      + `${applicationOrigin}/_next/static/chunks/abc-123.js`
      + `' violates the following Content Security Policy directive: "${policy}". `
      + "Note that 'strict-dynamic' is present, so host-based allowlisting is disabled. "
      + "Note that 'script-src-elem' was not explicitly set, so 'script-src' is used "
      + "as a fallback. The action has been blocked.";
    const inlineMessage = "Executing inline script violates the following Content Security "
      + `Policy directive '${policy}'. Either the 'unsafe-inline' keyword, a hash (`
      + `'sha256-${"A".repeat(43)}='), or a nonce ('nonce-...') is required to enable `
      + "inline execution. The action has been blocked.";

    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/install?source=test`,
      type: "error",
      text: loadMessage,
    })).toMatchObject({ kind: "blocked-static-chunk" });
    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/offline`,
      type: "error",
      text: inlineMessage,
    })).toMatchObject({ kind: "blocked-inline-script" });
    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/install`,
      type: "error",
      text: loadMessage.replace(policy, journeyPolicy),
    })).toMatchObject({
      directive: {
        sources: expect.arrayContaining(["https://chatwoot.browser.clean-pay.dev"]),
      },
    });
    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/login`,
      type: "error",
      text: loadMessage,
    })).toBeNull();
    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/install`,
      type: "error",
      text: loadMessage.replace("abc-123.js", "../escape.js"),
    })).toBeNull();
    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/install`,
      type: "warning",
      text: loadMessage,
    })).toBeNull();
    expect(normalizeStaticRouteCspConsole({
      applicationOrigin,
      pageUrl: `${applicationOrigin}/install`,
      type: "error",
      text: loadMessage.replace(policy, `${policy} https://chatwoot.invalid`),
    })).toBeNull();
  });

  test("retains external records and projects only exact automatic prefetch", () => {
    const manifest = comparisonManifest();
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;

    expect(projected.network.requests.map((request) => request.url)).toEqual([
      "document",
      "external",
      "kept-action",
    ]);
    expect(projected.network.requests.map((request) => request.index)).toEqual([0, 1, 2]);
    expect(projected.network.serverActions[0]?.requestIndex).toBe(2);
    expect(projected.consolePolicy.observedExpected)
      .toEqual(manifest.consolePolicy.observedExpected);
    expect(projected.route).toEqual(manifest.route);
    expect(projected.browserState).toEqual(manifest.browserState);
  });

  test("projects only exact side-effect-free journey readiness ledger entries", () => {
    const mutation = readinessLedgerEntry({
      effect: "purchase_initialized",
      method: "POST",
      pathname: "/api/v1/public/subscription/purchase",
      sequence: 7,
    });
    const manifest = {
      providerEffects: {
        entries: [
          readinessLedgerEntry({ sequence: 5 }),
          readinessLedgerEntry({
            body_bytes: 2,
            body_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
            effect: "probe_contract",
            method: "POST",
            pathname: "/api/v1/public/auth/identify",
            sequence: 6,
          }),
          mutation,
        ],
      },
    };

    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.providerEffects.entries).toEqual([
      { ...mutation, sequence: 1 },
    ]);
  });

  test("projects repeated exact enriched readiness cycles and nothing adjacent", () => {
    const cycle = enrichedReadinessCycle();
    const mutation = enrichedReadinessLedgerEntry({
      effect: "purchase_initialized",
      method: "POST",
      pathname: "/api/v1/public/subscription/purchase",
      sequence: 1,
    });
    const secondCycleOrder = [0, 3, 1, 2, 4, 5, 6];
    const repeated = [
      mutation,
      ...cycle.map((entry) => ({ ...entry, sequence: Number(entry.sequence) + 1 })),
      ...secondCycleOrder.map((cycleIndex, index) => ({
        ...cycle[cycleIndex]!,
        sequence: index + 9,
      })),
      { ...mutation, sequence: 16 },
    ];

    expect(projectCharacterizationManifestForComparison({
      providerEffects: { entries: repeated },
    })).toEqual({ providerEffects: { entries: [
      mutation,
      { ...mutation, sequence: 2 },
    ] } });
  });

  test("canonicalizes only an exact adjacent concurrent cabinet read pair", () => {
    const mutation = enrichedReadinessLedgerEntry({
      effect: "purchase_initialized",
      method: "POST",
      pathname: "/api/v1/public/subscription/purchase",
      sequence: 1,
    });
    const devices = cabinetReadLedgerEntry("devices", 2);
    const offers = cabinetReadLedgerEntry("offers", 3);
    const manifest = journeyProviderLedgerManifest([mutation, devices, offers]);
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.providerEffects.entries).toEqual([
      mutation,
      { ...offers, sequence: 2 },
      { ...devices, sequence: 3 },
    ]);
  });

  test("keeps concurrent cabinet read near misses in observed order", () => {
    const mutations: Array<(entries: Array<Record<string, unknown>>) => void> = [
      (entries) => { entries[0]!.sequence = 8; },
      (entries) => { entries[0]!.body_contract = {}; },
      (entries) => { entries[0]!.credential_contract = {
        authorization_scheme: null,
        cookie_names: ["refresh_token"],
        header_names: [],
      }; },
      (entries) => { entries[0]!.effect = "read_offers"; },
      (entries) => { entries[0]!.unexpected = true; },
    ];
    for (const mutate of mutations) {
      const entries: Array<Record<string, unknown>> = [
        cabinetReadLedgerEntry("devices", 1),
        cabinetReadLedgerEntry("offers", 2),
      ];
      mutate(entries);
      const projected = projectCharacterizationManifestForComparison(
        journeyProviderLedgerManifest(entries),
      ) as { providerEffects: { entries: Array<Record<string, unknown>> } };
      expect(projected.providerEffects.entries.map((entry) => entry.pathname))
        .toEqual([
          "/api/v1/public/subscription/devices",
          "/api/v1/public/subscription/offers",
        ]);
    }

    const outsideJourney = projectCharacterizationManifestForComparison({
      providerEffects: { entries: [
        cabinetReadLedgerEntry("devices", 1),
        cabinetReadLedgerEntry("offers", 2),
      ] },
    }) as { providerEffects: { entries: Array<Record<string, unknown>> } };
    expect(outsideJourney.providerEffects.entries.map((entry) => entry.pathname))
      .toEqual([
        "/api/v1/public/subscription/devices",
        "/api/v1/public/subscription/offers",
      ]);
  });

  test("keeps enriched readiness contract near misses fail-closed", () => {
    const nearMisses = [
      enrichedReadinessLedgerEntry(),
      enrichedReadinessLedgerEntry({ body_contract: { encoding: "json", value: {} } }),
      enrichedReadinessLedgerEntry({ idempotency_key_contract: {} }),
      enrichedReadinessLedgerEntry({
        credential_contract: {
          authorization_scheme: null,
          cookie_names: [],
          header_names: ["authorization"],
        },
      }),
      enrichedReadinessLedgerEntry({
        body_bytes: 2,
        body_contract: { encoding: "json", value: { unexpected: true } },
        body_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        credential_contract: {
          authorization_scheme: null,
          cookie_names: [],
          header_names: ["x-remnashop-auth-service-key"],
        },
        effect: "probe_contract",
        method: "POST",
        pathname: "/api/v1/public/auth/identify",
      }),
      enrichedReadinessLedgerEntry({
        effect: "jwks_read",
        pathname: "/.well-known/jwks.json?unexpected=1",
        service: "telegram-oidc",
      }),
      enrichedReadinessLedgerEntry({
        effect: "jwks_read",
        pathname: "/.well-known/jwks.json",
        service: "telegram-oidc",
      }),
      enrichedReadinessLedgerEntry({
        body_bytes: 2,
        body_contract: { encoding: "json", value: {} },
        body_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        credential_contract: {
          authorization_scheme: null,
          cookie_names: [],
          header_names: ["x-remnashop-auth-service-key"],
        },
        effect: "probe_contract",
        method: "POST",
        pathname: "/api/v1/public/auth/identify",
      }),
    ];

    for (const entry of nearMisses) {
      expect(projectCharacterizationManifestForComparison({
        providerEffects: { entries: [entry] },
      })).toEqual({ providerEffects: { entries: [entry] } });
    }
  });

  test("keeps an exact enriched readiness tail or corrupted full cycle", () => {
    const cycle = enrichedReadinessCycle();
    const tailWithoutHead = cycle.slice(2).map((entry, index) => ({
      ...entry,
      sequence: index + 1,
    }));
    const corruptedCycle = cycle.map((entry) => ({ ...entry }));
    corruptedCycle[1] = {
      ...corruptedCycle[1]!,
      effect: "unexpected_read_metadata",
    };

    for (const entries of [tailWithoutHead, corruptedCycle]) {
      expect(projectCharacterizationManifestForComparison({
        providerEffects: { entries },
      })).toEqual({ providerEffects: { entries } });
    }
  });

  test("projects only validated journey source identity while pinning contracts", () => {
    const baseline = { source: journeySourceProvenance("a", "b", "baseline:tag") };
    const candidate = { source: journeySourceProvenance("c", "d", "candidate:tag") };
    expect(projectCharacterizationManifestForComparison(candidate))
      .toEqual(projectCharacterizationManifestForComparison(baseline));

    const invalidDigest = { source: journeySourceProvenance("c", "d", "candidate:tag") };
    invalidDigest.source.imageDigest = "sha256:not-a-digest";
    expect(projectCharacterizationManifestForComparison(invalidDigest))
      .not.toEqual(projectCharacterizationManifestForComparison(baseline));

    const invalidMigrationDigest = {
      source: journeySourceProvenance("c", "d", "candidate:tag"),
    };
    invalidMigrationDigest.source.migrationImageDigest = "sha256:not-a-digest";
    expect(projectCharacterizationManifestForComparison(invalidMigrationDigest))
      .not.toEqual(projectCharacterizationManifestForComparison(baseline));

    const contractMismatch = { source: journeySourceProvenance("c", "d", "candidate:tag") };
    contractMismatch.source.publicBuildContract.sha256 = "9".repeat(64);
    expect(projectCharacterizationManifestForComparison(contractMismatch))
      .not.toEqual(projectCharacterizationManifestForComparison(baseline));
  });

  test("keeps every journey readiness-ledger near miss fail-closed", () => {
    const mutations: Array<(entry: ReturnType<typeof readinessLedgerEntry>) => void> = [
      (entry) => { entry.service = "other"; },
      (entry) => { entry.method = "POST"; },
      (entry) => { entry.pathname += "?unexpected=1"; },
      (entry) => { entry.query_keys = ["unexpected"]; },
      (entry) => { entry.body_bytes = 1; },
      (entry) => { entry.body_sha256 = "0".repeat(64); },
      (entry) => { entry.idempotency_key_present = true; },
      (entry) => { entry.idempotency_key_sha256 = "1".repeat(64); },
      (entry) => { entry.effect = "purchase_initialized"; },
    ];
    for (const mutate of mutations) {
      const entry = readinessLedgerEntry({ sequence: 9 });
      mutate(entry);
      const manifest = { providerEffects: { entries: [entry] } };
      expect(projectCharacterizationManifestForComparison(manifest))
        .toEqual({ providerEffects: { entries: [{ ...entry, sequence: 1 }] } });
    }
  });

  test("does not project automatic-prefetch near misses", () => {
    const mutations: Array<(request: ReturnType<typeof requestRecord>) => void> = [
      (request) => { request.method = "POST"; },
      (request) => { request.navigation = true; },
      (request) => { request.resourceType = "document"; },
      (request) => { request.scope = "External"; },
      (request) => { request.serverAction = { present: true, identifier: null }; },
      (request) => { request.requestHeaders.pop(); },
      (request) => {
        const header = request.requestHeaders[0];
        if (header) header.value.sha256 = "0".repeat(64);
      },
    ];

    for (const mutate of mutations) {
      const request = requestRecord("near-miss", 0, true);
      mutate(request);
      const manifest = {
        network: { requests: [request], serverActions: [] },
      };
      const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
      expect(projected.network.requests, JSON.stringify(request)).toHaveLength(1);
    }
  });

  test("projects only exact static-PWA CSP chunk transport races", () => {
    const exact = staticCspChunkRequest(0);
    const manifest = staticPwaManifest("/install", exact);
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.network.requests).toEqual([]);

    const completed = staticCspChunkRequest(0);
    completed.failure = null;
    completed.response = { status: 200 };
    const completedProjection = projectCharacterizationManifestForComparison(
      staticPwaManifest("/offline", completed),
    ) as typeof manifest;
    expect(completedProjection.network.requests).toEqual([]);
  });

  test("keeps every static-PWA CSP chunk near miss", () => {
    const mutations: Array<{
      route?: string;
      mutate: (request: ReturnType<typeof staticCspChunkRequest>) => void;
    }> = [
      { route: "/login", mutate() {} },
      { mutate(request) { request.method = "POST"; } },
      { mutate(request) { request.navigation = true; } },
      { mutate(request) { request.resourceType = "stylesheet"; } },
      { mutate(request) { request.url.pathname = "/_next/static/chunks/app.css"; } },
      { mutate(request) { request.url.pathname = "/_next/static/chunks/nested/app.js"; } },
      { mutate(request) { request.serverAction = { present: true, identifier: null }; } },
      { mutate(request) { request.requestHeaders.push({ name: "rsc", value: null }); } },
      { mutate(request) { request.requestHeaders.push({ name: "next-router-prefetch", value: null }); } },
      { mutate(request) { request.failure!.errorText.sha256 = "0".repeat(64); } },
      { mutate(request) { request.failure = null; request.response = { status: 404 }; } },
      { mutate(request) { request.postData = { bytes: 0, sha256: "0".repeat(64) }; } },
    ];

    for (const { route = "/install", mutate } of mutations) {
      const request = staticCspChunkRequest(0);
      mutate(request);
      const manifest = staticPwaManifest(route, request);
      const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
      expect(projected.network.requests, `${route}: ${JSON.stringify(request)}`)
        .toHaveLength(1);
    }
  });

  test("requires the exact static CSP sidecar count and order", () => {
    const exact = [
      ...Array.from({ length: 12 }, (_, order) => ({
        kind: "blocked-static-chunk",
        order,
      })),
      ...Array.from({ length: 2 }, (_, offset) => ({
        kind: "blocked-inline-script",
        order: offset + 12,
      })),
    ];
    expect(() => assertStaticCspSidecarContract("/install", exact)).not.toThrow();
    expect(() => assertStaticCspSidecarContract("/offline", exact.slice(0, -1)))
      .toThrow(/exactly 12 blocked chunks/);
    const wrongOrder = exact.map((entry) => ({ ...entry }));
    wrongOrder[0]!.order = 1;
    expect(() => assertStaticCspSidecarContract("/install", wrongOrder))
      .toThrow(/capture order/);
    expect(() => assertStaticCspSidecarContract("/login", [exact[0]!]))
      .toThrow(/Unexpected static CSP evidence/);
  });

  test("sorts only successful exact font-resource positions", () => {
    const first = fontRequest("z-icons.woff2", 0);
    const middle = requestRecord("api", 1);
    const second = fontRequest("a-text.woff2", 2);
    const manifest = {
      network: { requests: [first, middle, second], serverActions: [] },
    };
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.network.requests.map((request) => request.url)).toEqual([
      second.url,
      middle.url,
      first.url,
    ]);
    expect(projected.network.requests.map((request) => request.index)).toEqual([0, 1, 2]);
  });

  test("sorts repeated fonts only when same-path requests are identical except index", () => {
    const firstIcon = fontRequest("z-icons.woff2", 0);
    const middle = requestRecord("api", 1);
    const secondIcon = fontRequest("z-icons.woff2", 2);
    const firstText = fontRequest("a-text.woff2", 3);
    const secondText = fontRequest("a-text.woff2", 4);
    const manifest = {
      network: {
        requests: [firstIcon, middle, secondIcon, firstText, secondText],
        serverActions: [],
      },
    };
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.network.requests.map(requestUrlPathname)).toEqual([
      requestUrlPathname(firstText),
      requestUrlPathname(middle),
      requestUrlPathname(secondText),
      requestUrlPathname(firstIcon),
      requestUrlPathname(secondIcon),
    ]);

    const conflictingDuplicate = structuredClone(manifest);
    const conflictingFont = conflictingDuplicate.network.requests[2] as ReturnType<
      typeof fontRequest
    >;
    conflictingFont.requestHeaders.push({
      name: "x-font-variant",
      value: "different",
    });
    const retained = projectCharacterizationManifestForComparison(
      conflictingDuplicate,
    ) as typeof manifest;
    expect(retained.network.requests.map(requestUrlPathname)).toEqual([
      requestUrlPathname(firstIcon),
      requestUrlPathname(middle),
      requestUrlPathname(secondIcon),
      requestUrlPathname(firstText),
      requestUrlPathname(secondText),
    ]);
  });

  test("keeps every font-order near miss in capture order", () => {
    const mutations: Array<(request: ReturnType<typeof fontRequest>) => void> = [
      (request) => { request.method = "POST"; },
      (request) => { request.url.origin = "<external-origin:0123456789abcdef>"; },
      (request) => { request.navigation = true; },
      (request) => { request.serverAction = { present: true, identifier: null }; },
      (request) => { request.requestHeaders.push({ name: "rsc", value: null }); },
      (request) => { request.requestHeaders.push({ name: "authorization", value: null }); },
      (request) => { request.redirectedFrom = 0; },
      (request) => { request.failure = netErrAborted(); },
      (request) => { request.response = { status: 404 }; },
      (request) => { request.url.pathname = "/_next/static/media/font.woff"; },
      (request) => { request.url.pathname = "/assets/font.woff2"; },
      (request) => { request.url.query.push({ key: "v", value: "1" }); },
    ];

    for (const mutate of mutations) {
      const first = fontRequest("z-icons.woff2", 0);
      const second = fontRequest("a-text.woff2", 1);
      mutate(first);
      mutate(second);
      const expectedPaths = [first.url.pathname, second.url.pathname];
      const manifest = {
        network: { requests: [first, second], serverActions: [] },
      };
      const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
      expect(projected.network.requests.map((request) => request.url.pathname))
        .toEqual(expectedPaths);
    }
  });

  test("normalizes only an exact response-backed resource abort", () => {
    const exact = requestRecord("chunk", 0);
    exact.response = { status: 200 };
    exact.failure = netErrAborted();
    const normalized = projectCharacterizationManifestForComparison({
      network: { requests: [exact], serverActions: [] },
    }) as { network: { requests: Array<typeof exact> } };
    expect(normalized.network.requests[0]?.failure).toBeNull();

    const nearMisses = [
      { response: null },
      { method: "POST" },
      { navigation: true },
      { resourceType: "document" },
      { serverAction: { present: true, identifier: null } },
      { failure: { errorText: { bytes: 15, sha256: netErrAborted().errorText.sha256 } } },
      { failure: { ...netErrAborted(), extra: true } },
    ];
    for (const changes of nearMisses) {
      const request = Object.assign(requestRecord("near-miss", 0), {
        response: { status: 200 },
        failure: netErrAborted(),
      }, changes);
      const projected = projectCharacterizationManifestForComparison({
        network: { requests: [request], serverActions: [] },
      }) as { network: { requests: Array<Record<string, unknown>> } };
      expect(projected.network.requests[0]?.failure, JSON.stringify(changes))
        .not.toBeNull();
    }
  });

  test("keeps external-console and unsafe-index near misses fail-closed", () => {
    const manifest = comparisonManifest();
    manifest.consolePolicy.observedExpected[0]!.location.url.origin =
      "<external-origin:not-a-digest>";
    manifest.network.requests[0]!.index = 99;
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.consolePolicy.observedExpected).toHaveLength(2);
    expect(projected.network.requests).toHaveLength(manifest.network.requests.length);
  });

  test("retains exact Turnstile and arbitrary external request count and order", () => {
    const exactTurnstile = externalTurnstileRequest(1);
    const arbitrary = {
      ...externalTurnstileRequest(2),
      url: canonicalizeUrl("https://widgets.example.invalid/sdk.js", "https://app.test"),
    };
    const manifest = {
      network: {
        requests: [requestRecord("document", 0), exactTurnstile, arbitrary],
        serverActions: [],
      },
    };
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.network.requests).toHaveLength(3);
    expect(projected.network.requests.map((request) => request.index)).toEqual([0, 1, 2]);
    expect(projected.network.requests[1]).toEqual(exactTurnstile);
    expect(projected.network.requests[2]).toEqual(arbitrary);
  });

  test("redacts route-fulfillment timing only for the exact Turnstile request", () => {
    const applicationOrigin = "https://app.test";
    const exact = externalTurnstileRequest(0);
    expect(isExactDeterministicTurnstileTransport(
      exact,
      applicationOrigin,
      TURNSTILE_SCRIPT_URL,
    )).toBe(true);

    const nearMisses: Array<{ entry: NetworkManifestEntry; rawUrl: string }> = [
      { entry: { ...exact, method: "POST" }, rawUrl: TURNSTILE_SCRIPT_URL },
      { entry: { ...exact, resourceType: "fetch" }, rawUrl: TURNSTILE_SCRIPT_URL },
      { entry: { ...exact, navigation: true }, rawUrl: TURNSTILE_SCRIPT_URL },
      { entry: { ...exact, scope: "application" }, rawUrl: TURNSTILE_SCRIPT_URL },
      {
        entry: { ...exact, serverAction: { present: true, identifier: null } },
        rawUrl: TURNSTILE_SCRIPT_URL,
      },
      {
        entry: { ...exact, postData: { bytes: 1, sha256: "0".repeat(64) } },
        rawUrl: TURNSTILE_SCRIPT_URL,
      },
      { entry: { ...exact, redirectedFrom: 0 }, rawUrl: TURNSTILE_SCRIPT_URL },
      { entry: { ...exact, externalTransport: null }, rawUrl: TURNSTILE_SCRIPT_URL },
      {
        entry: exact,
        rawUrl: "https://challenges.cloudflare.com/turnstile/v0/api.js?render=managed",
      },
      {
        entry: {
          ...exact,
          url: canonicalizeUrl("https://widgets.example.invalid/sdk.js", applicationOrigin),
        },
        rawUrl: "https://widgets.example.invalid/sdk.js",
      },
    ];
    for (const nearMiss of nearMisses) {
      expect(
        isExactDeterministicTurnstileTransport(
          nearMiss.entry,
          applicationOrigin,
          nearMiss.rawUrl,
        ),
        JSON.stringify(nearMiss),
      ).toBe(false);
    }
  });

  test("projects only successful hashed static paths and payload-derived headers", () => {
    const script = hashedStaticRequest(
      "/_next/static/chunks/3_pz_xyhj63hd.js",
      "script",
      0,
    );
    const font = hashedStaticRequest(
      "/_next/static/media/Inter-roman.var.3k898k3j8e4kz.woff2",
      "font",
      1,
    );
    const manifest = {
      dom: {
        type: "element",
        attributes: [],
        children: [{
          type: "element",
          attributes: [
            { name: "href", value: "/_next/static/chunks/3_pz_xyhj63hd.js" },
            { name: "data-source", value: "/_next/static/chunks/3_pz_xyhj63hd.js" },
          ],
          children: [],
        }],
      },
      network: { requests: [script, font], serverActions: [] },
    };
    const projected = projectCharacterizationManifestForComparison(manifest) as typeof manifest;
    expect(projected.network.requests[0]?.url.pathname)
      .toBe("/_next/static/chunks/<compiled-content-hash>.js");
    expect(projected.network.requests[1]?.url.pathname)
      .toBe("/_next/static/media/Inter-roman.var.<compiled-content-hash>.woff2");
    expect(projected.network.requests[0]?.response.headers).toEqual([
      { name: "content-length", value: "<compiled-static-content-length>" },
      { name: "etag", value: "<compiled-static-etag>" },
      { name: "strict-transport-security", value: "max-age=31536000" },
    ]);
    expect(projected.dom.children[0]?.attributes).toEqual([
      { name: "href", value: "/_next/static/chunks/<compiled-content-hash>.js" },
      { name: "data-source", value: "/_next/static/chunks/3_pz_xyhj63hd.js" },
    ]);
  });

  test("keeps every hashed-static projection near miss exact", () => {
    const mutations: Array<(request: ReturnType<typeof hashedStaticRequest>) => void> = [
      (request) => { request.method = "POST"; },
      (request) => { request.scope = "external"; },
      (request) => { request.navigation = true; },
      (request) => { request.resourceType = "document"; },
      (request) => { request.serverAction = { present: true, identifier: null }; },
      (request) => { request.requestHeaders.push({ name: "rsc", value: null }); },
      (request) => { request.url.query.push({ key: "v", value: "1" }); },
      (request) => { request.url.fragment = "fragment"; },
      (request) => { request.url.origin = "<external-origin:0123456789abcdef>"; },
      (request) => { request.url.pathname = "/_next/static/chunks/application.js"; },
      (request) => { request.url.pathname = "/_next/static/chunks/nested/12345678.js"; },
      (request) => { request.url.pathname = "/_next/static/media/12345678.woff2"; },
      (request) => { request.redirectedFrom = 0; },
      (request) => { request.failure = { errorText: { bytes: 4, sha256: "1".repeat(64) } }; },
      (request) => { request.response.status = 404; },
      (request) => { request.postData = { bytes: 1, sha256: "2".repeat(64) }; },
      (request) => { request.externalTransport = "<redacted>"; },
    ];

    for (const mutate of mutations) {
      const request = hashedStaticRequest(
        "/_next/static/chunks/3_pz_xyhj63hd.js",
        "script",
        0,
      );
      mutate(request);
      const original = structuredClone(request);
      const projected = projectCharacterizationManifestForComparison({
        network: { requests: [request], serverActions: [] },
      }) as { network: { requests: Array<typeof request> } };
      expect(projected.network.requests[0], JSON.stringify(original)).toEqual(original);
    }
  });

  test("pins the Turnstile interception and callback-free contract", () => {
    expect(TURNSTILE_SCRIPT_URL).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    );
    expect(TURNSTILE_STUB_CONTRACT.callbacks).toBe("never invoked");
    expect(TURNSTILE_STUB_CONTRACT.state).toBe("challenge-pending");
    expect(TURNSTILE_STUB_SOURCE).not.toContain("options.callback");
    expect(TURNSTILE_STUB_SOURCE).not.toContain("error-callback");
  });

  test("selects a byte-identical screenshot majority in every permutation", () => {
    const stable = Buffer.from([137, 80, 78, 71, 1]);
    const oneChannelNearMiss = Buffer.from([137, 80, 78, 71, 2]);
    const permutations = [
      [stable, stable, oneChannelNearMiss],
      [stable, oneChannelNearMiss, stable],
      [oneChannelNearMiss, stable, stable],
    ];
    for (const values of permutations) {
      expect(selectByteIdenticalMajority(values)).toEqual(stable);
    }
  });

  test("fails closed for all-different screenshots and invalid counts", () => {
    expect(() => selectByteIdenticalMajority([
      Buffer.from([1, 2, 3]),
      Buffer.from([1, 2, 4]),
      Buffer.from([1, 2, 5]),
    ])).toThrow(/three byte-different PNGs/);
    expect(() => selectByteIdenticalMajority([
      Buffer.from([1]),
      Buffer.from([1]),
    ])).toThrow(/exactly 3 PNGs/);
  });

  test("selects only consecutive byte-identical terminal screenshot evidence", () => {
    const warmup = Buffer.from([137, 80, 78, 71, 1]);
    const stable = Buffer.from([137, 80, 78, 71, 2]);
    const changed = Buffer.from([137, 80, 78, 71, 3]);

    expect(selectByteIdenticalTerminalScreenshot([
      warmup,
      stable,
      stable,
    ])).toEqual(stable);
    for (const values of [
      [stable, stable, changed],
      [stable, changed, stable],
      [warmup, stable, changed],
    ]) {
      expect(() => selectByteIdenticalTerminalScreenshot(values)).toThrow(
        /not byte-identical/,
      );
    }
    expect(() => selectByteIdenticalTerminalScreenshot([
      stable,
      stable,
    ])).toThrow(/exactly 3 PNGs/);
  });

  test("serializes paired terminal screenshots without weakening exact evidence", async () => {
    const calls: string[] = [];
    let concurrent = 0;
    let maximumConcurrent = 0;
    let releaseBaseline!: () => void;
    const baselineBlocked = new Promise<void>((resolve) => {
      releaseBaseline = resolve;
    });
    const capture = createSerializedPairTerminalScreenshotCapture(async (page) => {
      const label = page as unknown as string;
      calls.push(label);
      concurrent += 1;
      maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      try {
        if (label === "baseline") await baselineBlocked;
        return Buffer.from(label);
      } finally {
        concurrent -= 1;
      }
    });

    const baseline = capture.capture("baseline", "baseline" as unknown as Page);
    const candidate = capture.capture("candidate", "candidate" as unknown as Page);
    await Promise.resolve();
    expect(calls).toEqual(["baseline"]);
    releaseBaseline();

    await expect(Promise.all([baseline, candidate])).resolves.toEqual([
      Buffer.from("baseline"),
      Buffer.from("candidate"),
    ]);
    expect(calls).toEqual(["baseline", "candidate"]);
    expect(maximumConcurrent).toBe(1);
  });

  test("releases a paired candidate when baseline fails before screenshot capture", async () => {
    const calls: string[] = [];
    const capture = createSerializedPairTerminalScreenshotCapture(async (page) => {
      const label = page as unknown as string;
      calls.push(label);
      return Buffer.from(label);
    });

    const candidate = capture.capture("candidate", "candidate" as unknown as Page);
    await Promise.resolve();
    expect(calls).toEqual([]);
    capture.complete("baseline");

    await expect(candidate).resolves.toEqual(Buffer.from("candidate"));
    expect(calls).toEqual(["candidate"]);
  });

  test("interleaves fixed paired warm-up and terminal evidence without retrying", async () => {
    const calls: string[] = [];
    const captures = new Map<string, number>();
    let concurrentCaptures = 0;
    let maximumConcurrentCaptures = 0;
    const result = await captureInterleavedPairTerminalScreenshots(
      {
        baseline: "baseline" as unknown as Page,
        candidate: "candidate" as unknown as Page,
      },
      async (page) => {
        const role = page as unknown as string;
        const index = (captures.get(role) ?? 0) + 1;
        captures.set(role, index);
        calls.push(`${role}:capture:${index}`);
        concurrentCaptures += 1;
        maximumConcurrentCaptures = Math.max(
          maximumConcurrentCaptures,
          concurrentCaptures,
        );
        try {
          return Buffer.from(index === 1 ? `${role}:warmup` : `${role}:terminal`);
        } finally {
          concurrentCaptures -= 1;
        }
      },
      async (page) => {
        calls.push(`${page as unknown as string}:settle`);
      },
    );

    expect(result).toEqual({
      baseline: Buffer.from("baseline:terminal"),
      candidate: Buffer.from("candidate:terminal"),
    });
    expect(calls).toEqual([
      "baseline:capture:1",
      "candidate:capture:1",
      "baseline:settle",
      "candidate:settle",
      "baseline:capture:2",
      "candidate:capture:2",
      "baseline:settle",
      "candidate:settle",
      "baseline:capture:3",
      "candidate:capture:3",
    ]);
    expect(captures).toEqual(new Map([
      ["baseline", 3],
      ["candidate", 3],
    ]));
    expect(maximumConcurrentCaptures).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
  });

  test("returns stable distinct paired screenshots without normalizing an A/B diff", async () => {
    const captures = new Map<string, number>();
    const result = await captureInterleavedPairTerminalScreenshots(
      {
        baseline: "baseline" as unknown as Page,
        candidate: "candidate" as unknown as Page,
      },
      async (page) => {
        const role = page as unknown as string;
        captures.set(role, (captures.get(role) ?? 0) + 1);
        return Buffer.from(role === "baseline" ? "stable-a" : "stable-b");
      },
      async () => {},
    );

    expect(result.baseline).toEqual(Buffer.from("stable-a"));
    expect(result.candidate).toEqual(Buffer.from("stable-b"));
    expect(result.baseline).not.toEqual(result.candidate);
  });

  test("stops after each exact interleaved capture slot failure", async () => {
    for (let failedCapture = 1; failedCapture <= 6; failedCapture += 1) {
      let captureCount = 0;
      let settleCount = 0;
      const expected = new Error(`capture ${failedCapture} failed`);
      await expect(captureInterleavedPairTerminalScreenshots(
        {
          baseline: "baseline" as unknown as Page,
          candidate: "candidate" as unknown as Page,
        },
        async () => {
          captureCount += 1;
          if (captureCount === failedCapture) throw expected;
          return Buffer.from("stable");
        },
        async () => { settleCount += 1; },
      )).rejects.toBe(expected);
      expect(captureCount).toBe(failedCapture);
      expect(settleCount).toBe(failedCapture <= 2 ? 0 : failedCapture <= 4 ? 2 : 4);
    }
  });

  test("waits for both settles and stops after every exact settle slot failure", async () => {
    for (let failedSettle = 1; failedSettle <= 4; failedSettle += 1) {
      let captureCount = 0;
      let settleCount = 0;
      const settledCalls = new Set<number>();
      await expect(captureInterleavedPairTerminalScreenshots(
        {
          baseline: "baseline" as unknown as Page,
          candidate: "candidate" as unknown as Page,
        },
        async () => {
          captureCount += 1;
          return Buffer.from("stable");
        },
        async () => {
          settleCount += 1;
          const current = settleCount;
          if (current === failedSettle) throw new Error(`settle ${current} failed`);
          await Promise.resolve();
          settledCalls.add(current);
        },
      )).rejects.toThrow(/Interleaved .* settle failed/);
      expect(settleCount).toBe(failedSettle <= 2 ? 2 : 4);
      expect(captureCount).toBe(failedSettle <= 2 ? 2 : 4);
      expect(settledCalls).toContain(
        failedSettle % 2 === 1 ? failedSettle + 1 : failedSettle - 1,
      );
    }
  });

  test("fails closed on terminal drift in either interleaved role", async () => {
    for (const driftRole of ["baseline", "candidate"] as const) {
      const captures = new Map<string, number>();
      await expect(captureInterleavedPairTerminalScreenshots(
        {
          baseline: "baseline" as unknown as Page,
          candidate: "candidate" as unknown as Page,
        },
        async (page) => {
          const role = page as unknown as string;
          const index = (captures.get(role) ?? 0) + 1;
          captures.set(role, index);
          return Buffer.from(
            role === driftRole && index === 3
              ? `${role}:changed`
              : `${role}:stable`,
          );
        },
        async () => {},
      )).rejects.toThrow(/not byte-identical/);
    }
  });

  test("barriers concurrent preparation before serial terminal evidence", async () => {
    const lifecycle = createSerializedPairCaptureTaskLifecycle();
    const calls: string[] = [];
    let releaseBaselineTerminal!: () => void;
    const baselineTerminalBlocked = new Promise<void>((resolve) => {
      releaseBaselineTerminal = resolve;
    });
    const settlements = Promise.allSettled([
      lifecycle.capture(
        "baseline",
        async () => {
          calls.push("baseline:prepare");
          return "baseline-prepared";
        },
        async (prepared) => {
          calls.push(`baseline:terminal:${prepared}`);
          await baselineTerminalBlocked;
          return "baseline";
        },
      ),
      lifecycle.capture(
        "candidate",
        async () => {
          calls.push("candidate:prepare");
          return "candidate-prepared";
        },
        async (prepared) => {
          calls.push(`candidate:terminal:${prepared}`);
          return "candidate";
        },
      ),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([
      "baseline:prepare",
      "candidate:prepare",
      "baseline:terminal:baseline-prepared",
    ]);
    releaseBaselineTerminal();
    await expect(settlements).resolves.toEqual([
      { status: "fulfilled", value: "baseline" },
      { status: "fulfilled", value: "candidate" },
    ]);
    expect(calls).toEqual([
      "baseline:prepare",
      "candidate:prepare",
      "baseline:terminal:baseline-prepared",
      "candidate:terminal:candidate-prepared",
    ]);
  });

  test("releases the candidate terminal lane after baseline terminal rejection", async () => {
    const lifecycle = createSerializedPairCaptureTaskLifecycle();
    const calls: string[] = [];
    const baselineError = new Error("baseline capture failed");
    const settlements = await Promise.allSettled([
      lifecycle.capture(
        "baseline",
        async () => {
          calls.push("baseline:prepare");
          return "baseline-prepared";
        },
        async () => {
          calls.push("baseline:terminal");
          throw baselineError;
        },
      ),
      lifecycle.capture(
        "candidate",
        async () => {
          calls.push("candidate:prepare");
          return "candidate-prepared";
        },
        async () => {
          calls.push("candidate:terminal");
          return "candidate-completed";
        },
      ),
    ]);

    expect(calls).toEqual([
      "baseline:prepare",
      "candidate:prepare",
      "baseline:terminal",
      "candidate:terminal",
    ]);
    expect(settlements).toEqual([
      { status: "rejected", reason: baselineError },
      { status: "fulfilled", value: "candidate-completed" },
    ]);
  });

  test("releases the preparation barrier after one role fails", async () => {
    const lifecycle = createSerializedPairCaptureTaskLifecycle();
    const calls: string[] = [];
    const baselineError = new Error("baseline preparation failed");
    const settlements = await Promise.allSettled([
      lifecycle.capture(
        "baseline",
        async () => {
          calls.push("baseline:prepare");
          throw baselineError;
        },
        async () => {
          calls.push("baseline:terminal");
        },
      ),
      lifecycle.capture(
        "candidate",
        async () => {
          calls.push("candidate:prepare");
          return "candidate-prepared";
        },
        async () => {
          calls.push("candidate:terminal");
        },
      ),
    ]);

    expect(calls).toEqual(["baseline:prepare", "candidate:prepare"]);
    expect(settlements[0]).toEqual({ status: "rejected", reason: baselineError });
    expect(settlements[1]).toMatchObject({
      status: "rejected",
      reason: expect.objectContaining({
        message: "Paired characterization preparation barrier failed in baseline role.",
      }),
    });
  });

  test("serializes complete paired preparation and terminal evidence", async () => {
    const lifecycle = createSerializedPairCaptureTaskLifecycle();
    const calls: string[] = [];
    let releaseBaselineTerminal!: () => void;
    const baselineTerminalBlocked = new Promise<void>((resolve) => {
      releaseBaselineTerminal = resolve;
    });
    const settlements = Promise.allSettled([
      lifecycle.captureSerialized(
        "baseline",
        async () => {
          calls.push("baseline:prepare");
          return "baseline-prepared";
        },
        async (prepared) => {
          calls.push(`baseline:terminal:${prepared}`);
          await baselineTerminalBlocked;
          return "baseline";
        },
      ),
      lifecycle.captureSerialized(
        "candidate",
        async () => {
          calls.push("candidate:prepare");
          return "candidate-prepared";
        },
        async (prepared) => {
          calls.push(`candidate:terminal:${prepared}`);
          return "candidate";
        },
      ),
    ]);

    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([
      "baseline:prepare",
      "baseline:terminal:baseline-prepared",
    ]);
    releaseBaselineTerminal();
    await expect(settlements).resolves.toEqual([
      { status: "fulfilled", value: "baseline" },
      { status: "fulfilled", value: "candidate" },
    ]);
    expect(calls).toEqual([
      "baseline:prepare",
      "baseline:terminal:baseline-prepared",
      "candidate:prepare",
      "candidate:terminal:candidate-prepared",
    ]);
  });

  test("runs serialized candidate evidence after baseline preparation rejection", async () => {
    const lifecycle = createSerializedPairCaptureTaskLifecycle();
    const calls: string[] = [];
    const baselineError = new Error("serialized baseline preparation failed");
    const settlements = await Promise.allSettled([
      lifecycle.captureSerialized(
        "baseline",
        async () => {
          calls.push("baseline:prepare");
          throw baselineError;
        },
        async () => {
          calls.push("baseline:terminal");
        },
      ),
      lifecycle.captureSerialized(
        "candidate",
        async () => {
          calls.push("candidate:prepare");
          return "candidate-prepared";
        },
        async () => {
          calls.push("candidate:terminal");
          return "candidate-completed";
        },
      ),
    ]);

    expect(calls).toEqual([
      "baseline:prepare",
      "candidate:prepare",
      "candidate:terminal",
    ]);
    expect(settlements).toEqual([
      { status: "rejected", reason: baselineError },
      { status: "fulfilled", value: "candidate-completed" },
    ]);
  });

  test("runs serialized candidate evidence after baseline terminal rejection", async () => {
    const lifecycle = createSerializedPairCaptureTaskLifecycle();
    const calls: string[] = [];
    const baselineError = new Error("serialized baseline terminal failed");
    const settlements = await Promise.allSettled([
      lifecycle.captureSerialized(
        "baseline",
        async () => {
          calls.push("baseline:prepare");
          return "baseline-prepared";
        },
        async () => {
          calls.push("baseline:terminal");
          throw baselineError;
        },
      ),
      lifecycle.captureSerialized(
        "candidate",
        async () => {
          calls.push("candidate:prepare");
          return "candidate-prepared";
        },
        async () => {
          calls.push("candidate:terminal");
          return "candidate-completed";
        },
      ),
    ]);

    expect(calls).toEqual([
      "baseline:prepare",
      "baseline:terminal",
      "candidate:prepare",
      "candidate:terminal",
    ]);
    expect(settlements).toEqual([
      { status: "rejected", reason: baselineError },
      { status: "fulfilled", value: "candidate-completed" },
    ]);
  });

  test("pins the canonical Chromium software-render launch policy", () => {
    expect(DETERMINISTIC_CHROMIUM_LAUNCH_ARGS).toEqual([
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-gpu-rasterization",
      "--disable-skia-runtime-opts",
      "--disable-lcd-text",
      "--disable-font-subpixel-positioning",
      "--font-render-hinting=none",
      "--disable-oop-rasterization",
    ]);
  });

  test("pins the additive archive provenance correction outside raw inventory", async () => {
    const evidence = browserProvenanceCorrectionEvidence();
    expect(evidence.legacyForensicRecord.retainedValue).toMatch(/^[a-f0-9]{40}$/);
    expect(evidence.legacyForensicRecord.retainedValue).not.toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.recomputation).toMatchObject({
      archiveFormat: "git archive tar stream",
      bytes: 7_587_840,
      sha256: "6ccdccdd162ede951850759392a72376792988080307b4e29ae0cffef2397a03",
    });
    expect(evidence.inventoryContract).toMatchObject({
      rawArtifactCount: 126,
      correctionSidecarExcludedFromRawAggregate: true,
      rawAggregateRemains:
        "bf449337e7222adc093f9adb7c1b3d7f2c122af74720bf1e1dfacb34fb69f4c3",
    });
    expect(PROVENANCE_CORRECTION_FILE).toBe("provenance-correction-v1.json");
  });
});

function comparisonManifest() {
  const external = requestRecord("external", 1);
  external.scope = "external";
  const prefetch = requestRecord("prefetch", 2, true);
  const action = requestRecord("kept-action", 3);
  action.serverAction = { present: true, identifier: null };
  return {
    route: { final: "/login?redirect_to=%2Fcabinet", redirects: ["/cabinet", "/login"] },
    browserState: { cookies: ["kept"], storage: { local: ["kept"] } },
    consolePolicy: {
      observedExpected: [
        {
          type: "warning",
          location: { url: { origin: "<external-origin:0123456789abcdef>" } },
        },
        {
          type: "warning",
          location: { url: { origin: "<app-origin>" } },
        },
      ],
    },
    network: {
      requests: [
        requestRecord("document", 0),
        external,
        prefetch,
        action,
      ],
      serverActions: [{ order: 0, requestIndex: 3 }],
    },
  };
}

function requestRecord(url: string, index: number, prefetch = false) {
  const one = {
    bytes: 1,
    sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
  };
  return {
    index,
    method: "GET",
    url,
    scope: "application",
    resourceType: prefetch ? "fetch" : "script",
    navigation: false,
    serverAction: { present: false, identifier: null } as {
      present: boolean;
      identifier: null;
    },
    requestHeaders: prefetch
      ? [
          { name: "next-router-prefetch", value: { ...one } },
          { name: "rsc", value: { ...one } },
        ]
      : [],
    redirectedFrom: null as number | null,
    response: null as { status: number } | null,
    failure: null as ReturnType<typeof netErrAborted> | null,
  };
}

function netErrAborted() {
  return {
    errorText: {
      bytes: 16,
      sha256: "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e",
    },
  };
}

function readinessLedgerEntry(overrides: Partial<{
  body_bytes: number;
  body_sha256: string;
  effect: string;
  idempotency_key_present: boolean;
  idempotency_key_sha256: string | null;
  method: string;
  pathname: string;
  query_keys: string[];
  sequence: number;
  service: string;
}> = {}) {
  return {
    body_bytes: 0,
    body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    effect: "read_public_plans",
    idempotency_key_present: false,
    idempotency_key_sha256: null as string | null,
    method: "GET",
    pathname: "/api/v1/public/plans/public",
    query_keys: [] as string[],
    sequence: 1,
    service: "remnashop",
    ...overrides,
  };
}

function enrichedReadinessLedgerEntry(overrides: Partial<{
  body_bytes: number;
  body_contract: unknown;
  body_sha256: string;
  credential_contract: unknown;
  effect: string;
  idempotency_key_contract: unknown;
  method: string;
  pathname: string;
  sequence: number;
  service: string;
}> = {}) {
  return {
    ...readinessLedgerEntry(),
    body_contract: null as unknown,
    credential_contract: {
      authorization_scheme: null,
      cookie_names: [],
      header_names: [],
    } as unknown,
    idempotency_key_contract: null as unknown,
    ...overrides,
  };
}

function cabinetReadLedgerEntry(kind: "devices" | "offers", sequence: number) {
  return enrichedReadinessLedgerEntry({
    credential_contract: {
      authorization_scheme: null,
      cookie_names: ["access_token"],
      header_names: [],
    },
    effect: kind === "devices" ? "read_devices" : "read_offers",
    pathname: `/api/v1/public/subscription/${kind}`,
    sequence,
  });
}

function journeyProviderLedgerManifest(entries: Array<Record<string, unknown>>) {
  return {
    schemaVersion: 2,
    baselineCommit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
    project: "journey-390x844",
    journey: "email-register-verify-and-login",
    source: {
      fixtureContract: { version: "journey-v5", sha256: "2".repeat(64) },
    },
    providerEffects: { entries },
  };
}

function enrichedReadinessCycle() {
  return [
    enrichedReadinessLedgerEntry({ sequence: 1 }),
    enrichedReadinessLedgerEntry({
      credential_contract: {
        authorization_scheme: "Bearer",
        cookie_names: [],
        header_names: ["authorization"],
      },
      effect: "read_metadata",
      pathname: "/api/system/metadata",
      sequence: 2,
      service: "remnawave",
    }),
    enrichedReadinessLedgerEntry({
      effect: "jwks_read",
      pathname: "/.well-known/jwks.json",
      sequence: 3,
      service: "telegram-oidc",
    }),
    ...[
      "/api/v1/public/auth/email/start",
      "/api/v1/public/auth/identify",
      "/api/v1/public/auth/service-session",
      "/api/v1/public/auth/notification-preferences",
    ].map((pathname, index) => enrichedReadinessLedgerEntry({
      body_bytes: 2,
      body_contract: { encoding: "json", value: {} },
      body_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
      credential_contract: {
        authorization_scheme: null,
        cookie_names: [],
        header_names: ["x-remnashop-auth-service-key"],
      },
      effect: "probe_contract",
      method: "POST",
      pathname,
      sequence: index + 4,
    })),
  ];
}

function journeySourceProvenance(
  revisionSeed: string,
  imageSeed: string,
  imageTag: string,
) {
  return {
    revision: revisionSeed.repeat(40),
    imageDigest: `sha256:${imageSeed.repeat(64)}`,
    imageTag,
    migrationImageDigest: `sha256:${imageSeed.repeat(64)}`,
    migrationImageTag: `${imageTag}-migration`,
    publicBuildContract: { version: "1", sha256: "1".repeat(64) },
    fixtureContract: { version: "journey-v5", sha256: "2".repeat(64) },
    browser: {
      engine: "chromium",
      version: "140.0.0.0",
      playwright: "1.62.1",
      launchArgs: journeyProvenanceLaunchArgs(),
      syntheticHostnames: [...JOURNEY_SYNTHETIC_HOSTNAMES],
      tlsPolicy: { ...JOURNEY_SYNTHETIC_TLS_POLICY },
    },
  };
}

function staticPwaManifest(
  pathname: string,
  request: ReturnType<typeof staticCspChunkRequest>,
) {
  return {
    route: {
      requested: {
        origin: "<app-origin>",
        pathname,
        query: [],
        fragment: null,
      },
    },
    network: { requests: [request], serverActions: [] },
  };
}

function staticCspChunkRequest(index: number) {
  return {
    index,
    method: "GET",
    url: {
      origin: "<app-origin>",
      pathname: "/_next/static/chunks/app-123.js",
      query: [] as unknown[],
      fragment: null,
    },
    scope: "application",
    resourceType: "script",
    navigation: false,
    serverAction: { present: false, identifier: null } as {
      present: boolean;
      identifier: null;
    },
    requestHeaders: [] as Array<{ name: string; value: unknown }>,
    postData: null as { bytes: number; sha256: string } | null,
    redirectedFrom: null,
    response: null as { status: number } | null,
    failure: {
      errorText: {
        bytes: 3,
        sha256: "438ced67d76cf3c3bf3e9781a9640ab685b2c877f7cc93b6758cc641efd51bc6",
      },
    } as ReturnType<typeof netErrAborted> | null,
    externalTransport: null,
  };
}

function fontRequest(filename: string, index: number) {
  return {
    index,
    method: "GET",
    url: {
      origin: "<app-origin>",
      pathname: `/_next/static/media/${filename}`,
      query: [] as Array<{ key: string; value: string }>,
      fragment: null,
    },
    scope: "application",
    resourceType: "font",
    navigation: false,
    serverAction: { present: false, identifier: null } as {
      present: boolean;
      identifier: null;
    },
    requestHeaders: [] as Array<{ name: string; value: unknown }>,
    postData: null,
    redirectedFrom: null as number | null,
    response: { status: 200 } as { status: number } | null,
    failure: null as ReturnType<typeof netErrAborted> | null,
    externalTransport: null,
  };
}

function requestUrlPathname(request: { url: unknown }) {
  if (typeof request.url === "string") return request.url;
  if (
    request.url
    && typeof request.url === "object"
    && !Array.isArray(request.url)
    && typeof (request.url as Record<string, unknown>).pathname === "string"
  ) {
    return (request.url as Record<string, unknown>).pathname as string;
  }
  return "<missing-pathname>";
}

function externalTurnstileRequest(index: number): NetworkManifestEntry {
  return {
    index,
    method: "GET",
    url: canonicalizeUrl(TURNSTILE_SCRIPT_URL, "https://app.test"),
    scope: "external",
    resourceType: "script",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [],
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      statusText: "OK",
      fromServiceWorker: false,
      headers: [],
    },
    failure: null,
    externalTransport: "<redacted>",
  };
}

function hashedStaticRequest(
  pathname: string,
  resourceType: string,
  index: number,
) {
  return {
    index,
    method: "GET",
    url: {
      origin: "<app-origin>",
      pathname,
      query: [] as Array<{ key: string; value: string }>,
      fragment: null as string | null,
    },
    scope: "application",
    resourceType,
    navigation: false,
    serverAction: { present: false, identifier: null } as {
      present: boolean;
      identifier: null;
    },
    requestHeaders: [] as Array<{ name: string; value: unknown }>,
    postData: null as { bytes: number; sha256: string } | null,
    redirectedFrom: null as number | null,
    response: {
      status: 200,
      statusText: "OK",
      fromServiceWorker: false,
      headers: [
        { name: "content-length", value: "123" },
        { name: "etag", value: '"raw-etag"' },
        { name: "strict-transport-security", value: "max-age=31536000" },
      ],
    },
    failure: null as ReturnType<typeof netErrAborted> | null,
    externalTransport: null as "<redacted>" | null,
  };
}

function projectBytes(value: Uint8Array) {
  return Buffer.from(JSON.stringify(projectCharacterizationManifestForComparison(
    JSON.parse(Buffer.from(value).toString("utf8")),
  )));
}
