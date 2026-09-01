import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { syntheticChatwootSdkSource } from "./caddy-route-policy";

const applicationOrigin = "https://pay.ci.clean-pay.dev";
const chatwootOrigin = "https://chatwoot.browser.clean-pay.dev";

test("binds identity confirmation to the current Chatwoot iframe delivery", async ({ page }) => {
  const caddy = await readFile(path.resolve(__dirname, "Caddyfile"), "utf8");
  const sdk = syntheticChatwootSdkSource(caddy);
  await page.route(`${applicationOrigin}/**`, (route) => route.fulfill({
    body: "<!doctype html><title>Chatwoot SDK generation contract</title>",
    contentType: "text/html",
    status: 200,
  }));
  await page.route(`${chatwootOrigin}/**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/widget") {
      return route.fulfill({ body: "not found", status: 404 });
    }
    const generation = url.searchParams.get("generation") ?? "A";
    return route.fulfill({
      body: `<!doctype html><script>
        const parentOrigin = ${JSON.stringify(applicationOrigin)};
        const generation = ${JSON.stringify(generation)};
        addEventListener("message", (event) => {
          if (event.origin !== parentOrigin || event.source !== parent || event.data?.method !== "identify") return;
          parent.postMessage({
            kind: "probe-identify",
            deliveryId: event.data.deliveryId,
            generation,
          }, parentOrigin);
        });
        parent.postMessage({ kind: "probe-ready", generation }, parentOrigin);
      <\/script>`,
      contentType: "text/html",
      status: 200,
    });
  });
  await page.goto(`${applicationOrigin}/fixture`, { waitUntil: "domcontentloaded" });
  await page.evaluate((expectedOrigin) => {
    const probe = {
      activateReplacementIdentityOnLoaded: false,
      chatwootReadyCount: 0,
      deliveries: [] as unknown[],
      ready: [] as string[],
    };
    Object.defineProperty(window, "__syntheticChatwootSdkProbe", { value: probe });
    addEventListener("chatwoot:ready", () => {
      probe.chatwootReadyCount += 1;
    });
    addEventListener("message", (event) => {
      if (event.origin !== expectedOrigin) return;
      if (typeof event.data === "string") {
        const current = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement | null;
        if (
          probe.activateReplacementIdentityOnLoaded
          && event.data === 'chatwoot-widget:{"event":"loaded"}'
          && event.source === current?.contentWindow
        ) {
          probe.activateReplacementIdentityOnLoaded = false;
          queueMicrotask(() => window.$chatwoot?.setUser("identity-B", {
            name: "B",
            identifier_hash: "hash-B",
            custom_attributes: {},
          }));
        }
        return;
      }
      if (typeof event.data !== "object" || event.data === null) return;
      if (event.data.kind === "probe-ready" && typeof event.data.generation === "string") {
        probe.ready.push(event.data.generation);
      }
      if (event.data.kind === "probe-identify") {
        probe.deliveries.push(structuredClone(event.data));
      }
    });
  }, chatwootOrigin);
  await page.addScriptTag({ content: sdk });
  await page.evaluate(({ baseUrl, websiteToken }) => {
    window.chatwootSDK?.run({ baseUrl, websiteToken });
  }, { baseUrl: chatwootOrigin, websiteToken: "a".repeat(64) });
  await expect.poll(() => page.evaluate(() => ({
    hasLoaded: window.$chatwoot?.hasLoaded,
    readyCount: (
      window as unknown as {
        __syntheticChatwootSdkProbe: { chatwootReadyCount: number };
      }
    ).__syntheticChatwootSdkProbe.chatwootReadyCount,
  }))).toEqual({ hasLoaded: true, readyCount: 1 });
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __syntheticChatwootSdkProbe: { ready: string[] } }
  ).__syntheticChatwootSdkProbe.ready)).toEqual(["A"]);

  await page.evaluate(() => {
    window.$chatwoot?.setUser("identity-A", {
      name: "A",
      identifier_hash: "hash-A",
      custom_attributes: {},
    });
  });
  expect(await page.evaluate(() => (
    window as unknown as { __syntheticChatwootSdkProbe: { deliveries: unknown[] } }
  ).__syntheticChatwootSdkProbe.deliveries)).toEqual([]);

  await page.evaluate((baseUrl) => {
    const first = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement;
    (window as unknown as { __staleSyntheticChatwootWindow: WindowProxy })
      .__staleSyntheticChatwootWindow = first.contentWindow!;
    dispatchEvent(new MessageEvent("message", {
      data: 'chatwoot-widget:{"event":"loaded"}',
      origin: baseUrl,
      source: first.contentWindow,
    }));
  }, chatwootOrigin);
  await expect.poll(() => page.evaluate(() => ({
    hasLoaded: window.$chatwoot?.hasLoaded,
    readyCount: (
      window as unknown as {
        __syntheticChatwootSdkProbe: { chatwootReadyCount: number };
      }
    ).__syntheticChatwootSdkProbe.chatwootReadyCount,
  }))).toEqual({ hasLoaded: true, readyCount: 1 });
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __syntheticChatwootSdkProbe: { deliveries: unknown[] } }
  ).__syntheticChatwootSdkProbe.deliveries)).toEqual([
    { deliveryId: 1, generation: "A", kind: "probe-identify" },
  ]);

  await page.evaluate(() => {
    const current = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement;
    const replacement = current.cloneNode(false) as HTMLIFrameElement;
    const replacementUrl = new URL(current.src);
    replacementUrl.searchParams.set("generation", "B");
    replacement.src = replacementUrl.toString();
    current.replaceWith(replacement);
  });
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __syntheticChatwootSdkProbe: { ready: string[] } }
  ).__syntheticChatwootSdkProbe.ready)).toEqual(["A", "B"]);

  await page.evaluate((baseUrl) => {
    const stale = (window as unknown as { __staleSyntheticChatwootWindow: WindowProxy })
      .__staleSyntheticChatwootWindow;
    const current = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement;
    (
      window as unknown as {
        __syntheticChatwootSdkProbe: { activateReplacementIdentityOnLoaded: boolean };
      }
    ).__syntheticChatwootSdkProbe.activateReplacementIdentityOnLoaded = true;
    dispatchEvent(new MessageEvent("message", {
      data: 'chatwoot-widget:{"event":"loaded"}',
      origin: baseUrl,
      source: stale,
    }));
    dispatchEvent(new MessageEvent("message", {
      data: 'chatwoot-widget:{"event":"loaded"}',
      origin: baseUrl,
      source: current.contentWindow,
    }));
  }, chatwootOrigin);
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __syntheticChatwootSdkProbe: { deliveries: unknown[] } }
  ).__syntheticChatwootSdkProbe.deliveries)).toEqual([
    { deliveryId: 1, generation: "A", kind: "probe-identify" },
    { deliveryId: 2, generation: "B", kind: "probe-identify" },
  ]);

  const calls = await page.evaluate((baseUrl) => {
    const stale = (window as unknown as { __staleSyntheticChatwootWindow: WindowProxy })
      .__staleSyntheticChatwootWindow;
    const current = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement;
    const confirm = (source: WindowProxy, deliveryId: number) => dispatchEvent(
      new MessageEvent("message", {
        data: `chatwoot-widget:${JSON.stringify({
          event: "setAuthCookie",
          data: { deliveryId, widgetAuthToken: "opaque" },
        })}`,
        origin: baseUrl,
        source,
      }),
    );
    confirm(stale, 1);
    confirm(current.contentWindow!, 2);
    confirm(current.contentWindow!, 2);
    return structuredClone((
      window as unknown as { __cleanPayChatwootBoundaryCalls: unknown[] }
    ).__cleanPayChatwootBoundaryCalls);
  }, chatwootOrigin);
  expect(calls).toEqual([
    { method: "run", baseUrl: chatwootOrigin, websiteTokenBytes: 64 },
    {
      method: "setUser",
      identifierBytes: 10,
      attributeKeys: ["custom_attributes", "identifier_hash", "name"],
    },
    { method: "frame.loaded" },
    {
      method: "setUser",
      identifierBytes: 10,
      attributeKeys: ["custom_attributes", "identifier_hash", "name"],
    },
    { method: "frame.loaded" },
    { method: "identity.confirmed" },
  ]);
});
