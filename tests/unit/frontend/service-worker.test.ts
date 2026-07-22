import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/sw.js/route";
import { serviceWorkerSource } from "@/shared/pwa/service-worker";

type StoredResponse = { body: string; ok: boolean; status: number };

class BrowserRequest {
  cache?: string;
  method: string;
  mode: string;
  url: string;

  constructor(url: string, init: { cache?: string; method?: string; mode?: string } = {}) {
    this.url = url;
    this.cache = init.cache;
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "same-origin";
  }
}

class BrowserResponse implements StoredResponse {
  body: string;
  ok: boolean;
  status: number;

  constructor(body: string, status = 200) {
    this.body = body;
    this.status = status;
    this.ok = status >= 200 && status < 300;
  }

  static error() {
    return new BrowserResponse("", 0);
  }
}

class BrowserCache {
  entries = new Map<string, StoredResponse>();

  async put(request: BrowserRequest, response: StoredResponse) {
    this.entries.set(request.url, response);
  }

  async match(url: string) {
    return this.entries.get(url);
  }
}

function serviceWorkerBrowser() {
  const stores = new Map<string, BrowserCache>();
  let fetchedVersion = "build-one";

  const caches = {
    async delete(name: string) {
      return stores.delete(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async open(name: string) {
      const cache = stores.get(name) ?? new BrowserCache();
      stores.set(name, cache);
      return cache;
    },
  };

  async function installAndActivate(buildId: string) {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const self = {
      addEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
        listeners.set(name, listener);
      },
      clients: { claim: vi.fn(async () => undefined) },
      skipWaiting: vi.fn(async () => undefined),
    };
    const context = {
      Request: BrowserRequest,
      Response: BrowserResponse,
      caches,
      fetch: vi.fn(async (request: BrowserRequest) => new BrowserResponse(`${fetchedVersion}:${request.url}`)),
      self,
    };

    vm.runInNewContext(serviceWorkerSource(buildId), context);

    for (const eventName of ["install", "activate"]) {
      let completion: Promise<unknown> | undefined;
      listeners.get(eventName)?.({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
      await completion;
    }

    return {
      async navigateOffline(path: string) {
        context.fetch.mockRejectedValueOnce(new Error("offline"));
        let response: Promise<BrowserResponse> | undefined;
        listeners.get("fetch")?.({
          request: new BrowserRequest(path, { mode: "navigate" }),
          respondWith: (promise: Promise<BrowserResponse>) => { response = promise; },
        });
        return response;
      },
    };
  }

  return {
    caches,
    installAndActivate,
    setFetchedVersion(version: string) {
      fetchedVersion = version;
    },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("versioned service worker", () => {
  it("serves a build-specific worker without HTTP caching", async () => {
    vi.stubEnv("CLEAN_PAY_BUILD_ID", "release-42");

    const response = await GET();
    const source = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expect(response.headers.get("service-worker-allowed")).toBe("/");
    expect(source).toContain('const CACHE_NAME = "clean-pay-shell-release-42"');
    expect(source).toContain('cache: "reload"');
  });

  it("replaces the cached offline shell when a new build activates", async () => {
    const browser = serviceWorkerBrowser();
    await browser.caches.open("unrelated-application-cache");

    const first = await browser.installAndActivate("build-one");
    await expect(first.navigateOffline("/cabinet")).resolves.toMatchObject({
      body: "build-one:/offline",
    });

    browser.setFetchedVersion("build-two");
    const second = await browser.installAndActivate("build-two");

    await expect(browser.caches.keys()).resolves.toEqual([
      "unrelated-application-cache",
      "clean-pay-shell-build-two",
    ]);
    await expect(second.navigateOffline("/cabinet")).resolves.toMatchObject({
      body: "build-two:/offline",
    });
  });
});
