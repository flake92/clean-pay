import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

import {
  applicationServerKey,
  pushCardStatus,
  sameServerKey,
  type PushEnvironment,
} from "@/frontend/components/push-notifications-state";
import { serviceWorkerSource } from "@/shared/pwa/service-worker";
import { isPublicPath } from "@/shared/edge/proxy-route-policy";

const env = (overrides: Partial<PushEnvironment> = {}): PushEnvironment => ({
  serverAvailable: true,
  pushSupported: true,
  appleMobile: false,
  standalone: false,
  permission: "default",
  ...overrides,
});

describe("push card state", () => {
  it("guides iPhone users to the installed app before anything else", () => {
    const loaded = { loaded: true, subscribed: false };
    expect(pushCardStatus(env({ serverAvailable: false }), loaded)).toBe("hidden");
    expect(pushCardStatus(env({ appleMobile: true, pushSupported: false }), loaded))
      .toBe("ios-install");
    expect(pushCardStatus(env({ appleMobile: true, standalone: true }), loaded)).toBe("off");
    expect(pushCardStatus(env({ pushSupported: false }), loaded)).toBe("unsupported");
    expect(pushCardStatus(env({ permission: "denied" }), loaded)).toBe("denied");
    expect(pushCardStatus(env(), { loaded: false, subscribed: false })).toBe("loading");
    expect(pushCardStatus(env({ permission: "granted" }), { loaded: true, subscribed: true }))
      .toBe("on");
  });

  it("decodes the VAPID key and detects a rotated key", () => {
    const key = applicationServerKey("BAEC_-8");
    expect([...key]).toEqual([4, 1, 2, 255, 239]);
    expect(sameServerKey(key.buffer as ArrayBuffer, key)).toBe(true);
    expect(sameServerKey(new Uint8Array([4, 1]).buffer, key)).toBe(false);
    expect(sameServerKey(null, key)).toBe(true);
  });
});

describe("service worker notifications", () => {
  function workerWithListeners() {
    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const showNotification = vi.fn(async () => undefined);
    const focus = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const openWindow = vi.fn(async () => undefined);
    const clientsList: Array<Record<string, unknown>> = [];
    const self = {
      addEventListener(name: string, listener: (event: Record<string, unknown>) => void) {
        listeners.set(name, listener);
      },
      location: { origin: "https://pay.example.com" },
      registration: { showNotification },
      clients: {
        claim: vi.fn(),
        matchAll: vi.fn(async () => clientsList),
        openWindow,
      },
      skipWaiting: vi.fn(),
    };
    vm.runInNewContext(
      serviceWorkerSource("build-1", { icon: "/brand/icon-192.png", badge: "/brand/icon-192.png" }),
      { self, URL, caches: {}, fetch: vi.fn(), Request: class {}, Response: class {} },
    );
    async function dispatch(name: string, event: Record<string, unknown>) {
      let work: Promise<unknown> | undefined;
      listeners.get(name)?.({ ...event, waitUntil: (promise: Promise<unknown>) => { work = promise; } });
      await work;
    }
    return { dispatch, showNotification, focus, navigate, openWindow, clientsList };
  }

  it("shows a branded notification for a push message", async () => {
    const worker = workerWithListeners();
    await worker.dispatch("push", {
      data: {
        json: () => ({ title: "Подписка", body: "Скоро закончится", url: "/cabinet", tag: "n-1" }),
      },
    });

    expect(worker.showNotification).toHaveBeenCalledWith("Подписка", expect.objectContaining({
      body: "Скоро закончится",
      icon: "/brand/icon-192.png",
      tag: "n-1",
      data: { url: "https://pay.example.com/cabinet" },
    }));
  });

  it("focuses the open cabinet window instead of opening another one", async () => {
    const worker = workerWithListeners();
    worker.clientsList.push({
      url: "https://pay.example.com/profile",
      focus: worker.focus,
      navigate: worker.navigate,
    });
    const close = vi.fn();
    await worker.dispatch("notificationclick", {
      notification: { close, data: { url: "https://pay.example.com/cabinet" } },
    });

    expect(close).toHaveBeenCalled();
    expect(worker.focus).toHaveBeenCalled();
    expect(worker.navigate).toHaveBeenCalledWith("https://pay.example.com/cabinet");
    expect(worker.openWindow).not.toHaveBeenCalled();
  });

  it("never opens a non-https target from a push payload", async () => {
    const worker = workerWithListeners();
    await worker.dispatch("notificationclick", {
      notification: { close: vi.fn(), data: { url: "javascript:alert(1)" } },
    });
    expect(worker.openWindow).toHaveBeenCalledWith("https://pay.example.com/");
  });
});

describe("public unsubscribe routes", () => {
  it("are reachable without a session", () => {
    expect(isPublicPath("/unsubscribe")).toBe(true);
    expect(isPublicPath("/api/notifications/unsubscribe")).toBe(true);
  });
});
