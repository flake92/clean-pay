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
      synchronousFrameObserved: false,
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
          queueMicrotask(() => {
            (
              window as unknown as {
                cleanPayChatwootPendingIdentity?: { phase: string };
              }
            ).cleanPayChatwootPendingIdentity = { phase: "sent" };
            window.$chatwoot?.setUser("identity-B", {
              name: "B",
              identifier_hash: "hash-B",
              custom_attributes: {},
            });
          });
        } else if (
          event.data === 'chatwoot-widget:{"event":"loaded"}'
          && event.source === current?.contentWindow
        ) {
          queueMicrotask(() => {
            probe.synchronousFrameObserved = (
              window as unknown as { __cleanPayChatwootBoundaryCalls?: Array<{ method?: string }> }
            ).__cleanPayChatwootBoundaryCalls?.some(({ method }) => method === "frame.loaded") === true;
          });
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
  await expect.poll(() => page.evaluate(() => (
    window as unknown as {
      __syntheticChatwootSdkProbe: { synchronousFrameObserved: boolean };
    }
  ).__syntheticChatwootSdkProbe.synchronousFrameObserved)).toBe(true);

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
    (
      window as unknown as {
        cleanPayChatwootPendingIdentity?: { phase: string };
      }
    ).cleanPayChatwootPendingIdentity = { phase: "waiting_for_frame" };
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

test("defers restored ownership without a current identity until the trusted frame loads", async ({ page }) => {
  const caddy = await readFile(path.resolve(__dirname, "Caddyfile"), "utf8");
  const sdk = syntheticChatwootSdkSource(caddy);
  await page.route(`${applicationOrigin}/**`, (route) => route.fulfill({
    body: "<!doctype html><title>Restored Chatwoot ownership contract</title>",
    contentType: "text/html",
    status: 200,
  }));
  await page.route(`${chatwootOrigin}/**`, (route) => route.fulfill({
    body: "<!doctype html><title>Trusted Chatwoot frame</title>",
    contentType: "text/html",
    status: 200,
  }));
  await page.context().addCookies([{
    domain: "pay.ci.clean-pay.dev",
    name: "cw_conversation",
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "crestoredbrowserjourney01",
  }]);
  await page.goto(`${applicationOrigin}/fixture`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("clean-pay:chatwoot-ownership:v1", JSON.stringify({
      conversation: "25:1234abcd",
      core: "25:2345bcde",
      customAttributes: "25:3456cdef",
    }));
    localStorage.removeItem("clean-pay:chatwoot-identity:v1");
    Object.defineProperty(window, "__syntheticChatwootReadyCount", {
      configurable: true,
      value: { count: 0 },
    });
    addEventListener("chatwoot:ready", () => {
      (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
        .__syntheticChatwootReadyCount.count += 1;
    });
  });
  await page.addScriptTag({ content: sdk });
  await page.evaluate(({ baseUrl, websiteToken }) => {
    window.chatwootSDK?.run({ baseUrl, websiteToken });
  }, { baseUrl: chatwootOrigin, websiteToken: "a".repeat(64) });

  expect(await page.evaluate(() => ({
    calls: (window as unknown as { __cleanPayChatwootBoundaryCalls: unknown[] })
      .__cleanPayChatwootBoundaryCalls,
    hasLoaded: window.$chatwoot?.hasLoaded,
    readyCount: (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
      .__syntheticChatwootReadyCount.count,
  }))).toEqual({
    calls: [{ method: "run", baseUrl: chatwootOrigin, websiteTokenBytes: 64 }],
    hasLoaded: false,
    readyCount: 0,
  });

  await page.evaluate((baseUrl) => {
    const frame = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement;
    dispatchEvent(new MessageEvent("message", {
      data: 'chatwoot-widget:{"event":"loaded"}',
      origin: baseUrl,
      source: frame.contentWindow,
    }));
  }, chatwootOrigin);
  await expect.poll(() => page.evaluate(() => ({
    calls: (window as unknown as { __cleanPayChatwootBoundaryCalls: unknown[] })
      .__cleanPayChatwootBoundaryCalls,
    hasLoaded: window.$chatwoot?.hasLoaded,
    readyCount: (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
      .__syntheticChatwootReadyCount.count,
  }))).toEqual({
    calls: [
      { method: "run", baseUrl: chatwootOrigin, websiteTokenBytes: 64 },
      { method: "frame.loaded" },
    ],
    hasLoaded: true,
    readyCount: 1,
  });
});

test("keeps readiness eager when restored ownership still has its current identity", async ({ page }) => {
  const caddy = await readFile(path.resolve(__dirname, "Caddyfile"), "utf8");
  const sdk = syntheticChatwootSdkSource(caddy);
  await page.route(`${applicationOrigin}/**`, (route) => route.fulfill({
    body: "<!doctype html><title>Active Chatwoot identity contract</title>",
    contentType: "text/html",
    status: 200,
  }));
  await page.route(`${chatwootOrigin}/**`, (route) => route.fulfill({
    body: "<!doctype html><title>Trusted Chatwoot frame</title>",
    contentType: "text/html",
    status: 200,
  }));
  await page.context().addCookies([{
    domain: "pay.ci.clean-pay.dev",
    name: "cw_conversation",
    path: "/",
    sameSite: "Lax",
    secure: true,
    value: "cactivebrowserjourney001",
  }]);
  await page.goto(`${applicationOrigin}/fixture`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.setItem("clean-pay:chatwoot-ownership:v1", "owned");
    localStorage.setItem("clean-pay:chatwoot-identity:v1", "current");
    Object.defineProperty(window, "__syntheticChatwootReadyCount", {
      configurable: true,
      value: { count: 0 },
    });
    addEventListener("chatwoot:ready", () => {
      (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
        .__syntheticChatwootReadyCount.count += 1;
    });
  });
  await page.addScriptTag({ content: sdk });
  await page.evaluate(({ baseUrl, websiteToken }) => {
    window.chatwootSDK?.run({ baseUrl, websiteToken });
  }, { baseUrl: chatwootOrigin, websiteToken: "a".repeat(64) });

  await expect.poll(() => page.evaluate(() => ({
    calls: (window as unknown as { __cleanPayChatwootBoundaryCalls: unknown[] })
      .__cleanPayChatwootBoundaryCalls,
    hasLoaded: window.$chatwoot?.hasLoaded,
    readyCount: (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
      .__syntheticChatwootReadyCount.count,
  }))).toEqual({
    calls: [{ method: "run", baseUrl: chatwootOrigin, websiteTokenBytes: 64 }],
    hasLoaded: true,
    readyCount: 1,
  });
});

for (const fixture of [
  {
    identity: "current",
    initial: { hasLoaded: false, readyCount: 0 },
    name: "keeps an explicitly restored journey frame-gated after identity storage is recreated",
    scope: "restored",
  },
  {
    identity: null,
    initial: { hasLoaded: true, readyCount: 1 },
    name: "keeps the dedicated lifecycle proof eager despite an ownership-only snapshot",
    scope: "eager",
  },
] as const) {
  test(fixture.name, async ({ page }) => {
    const caddy = await readFile(path.resolve(__dirname, "Caddyfile"), "utf8");
    const sdk = syntheticChatwootSdkSource(caddy);
    await page.route(`${applicationOrigin}/**`, (route) => route.fulfill({
      body: "<!doctype html><title>Scoped Chatwoot readiness contract</title>",
      contentType: "text/html",
      status: 200,
    }));
    await page.route(`${chatwootOrigin}/**`, (route) => route.fulfill({
      body: "<!doctype html><title>Trusted Chatwoot frame</title>",
      contentType: "text/html",
      status: 200,
    }));
    await page.context().addCookies([{
      domain: "pay.ci.clean-pay.dev",
      name: "cw_conversation",
      path: "/",
      sameSite: "Lax",
      secure: true,
      value: "cscopedbrowserjourney01",
    }]);
    await page.goto(`${applicationOrigin}/fixture`, { waitUntil: "domcontentloaded" });
    await page.evaluate(({ identity, scope }) => {
      localStorage.setItem("clean-pay:chatwoot-ownership:v1", "owned");
      if (identity === null) localStorage.removeItem("clean-pay:chatwoot-identity:v1");
      else localStorage.setItem("clean-pay:chatwoot-identity:v1", identity);
      Object.defineProperty(window, "__cleanPayChatwootFixtureReadiness", {
        configurable: false,
        enumerable: false,
        value: scope,
        writable: false,
      });
      Object.defineProperty(window, "__syntheticChatwootReadyCount", {
        configurable: true,
        value: { count: 0 },
      });
      addEventListener("chatwoot:ready", () => {
        (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
          .__syntheticChatwootReadyCount.count += 1;
      });
    }, { identity: fixture.identity, scope: fixture.scope });
    await page.addScriptTag({ content: sdk });
    await page.evaluate(({ baseUrl, websiteToken }) => {
      window.chatwootSDK?.run({ baseUrl, websiteToken });
    }, { baseUrl: chatwootOrigin, websiteToken: "a".repeat(64) });

    await expect.poll(() => page.evaluate(() => ({
      hasLoaded: window.$chatwoot?.hasLoaded,
      readyCount: (window as unknown as { __syntheticChatwootReadyCount: { count: number } })
        .__syntheticChatwootReadyCount.count,
    }))).toEqual(fixture.initial);

    if (fixture.scope === "restored") {
      await page.evaluate((baseUrl) => {
        const frame = document.getElementById("chatwoot_live_chat_widget") as HTMLIFrameElement;
        dispatchEvent(new MessageEvent("message", {
          data: 'chatwoot-widget:{"event":"loaded"}',
          origin: baseUrl,
          source: frame.contentWindow,
        }));
      }, chatwootOrigin);
      await expect.poll(() => page.evaluate(() => ({
        hasLoaded: window.$chatwoot?.hasLoaded,
        readyCount: (
          window as unknown as { __syntheticChatwootReadyCount: { count: number } }
        ).__syntheticChatwootReadyCount.count,
      }))).toEqual({ hasLoaded: true, readyCount: 1 });
    }
  });
}
