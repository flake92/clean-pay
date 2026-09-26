import { EventEmitter } from "node:events";

import type { Page, Request, Response } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { recordNetwork } from "../../browser/network-recorder";

describe("network recorder Server Action terminals", () => {
  it("accepts Response.finished as the exact terminal when requestfinished is omitted", async () => {
    const events = new EventEmitter();
    const page = {
      off(event: string, listener: (...args: unknown[]) => void) {
        events.off(event, listener);
        return page;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        events.on(event, listener);
        return page;
      },
    } as unknown as Page;
    const request = {
      allHeaders: vi.fn(async () => ({ "next-action": "synthetic-action" })),
      failure: vi.fn(() => null),
      headers: vi.fn(() => ({ "next-action": "synthetic-action" })),
      isNavigationRequest: vi.fn(() => false),
      method: vi.fn(() => "POST"),
      postDataBuffer: vi.fn(() => Buffer.from("synthetic-payload")),
      redirectedFrom: vi.fn(() => null),
      resourceType: vi.fn(() => "fetch"),
      url: vi.fn(() => "https://pay.test/action"),
    } as unknown as Request;
    let finishResponse!: (result: null | Error) => void;
    const finished = new Promise<null | Error>((resolve) => {
      finishResponse = resolve;
    });
    const response = {
      allHeaders: vi.fn(async () => ({ "content-type": "text/x-component" })),
      finished: vi.fn(() => finished),
      fromServiceWorker: vi.fn(() => false),
      request: vi.fn(() => request),
      status: vi.fn(() => 200),
      statusText: vi.fn(() => "OK"),
      url: vi.fn(() => request.url()),
    } as unknown as Response;
    const recorder = recordNetwork(page, "https://pay.test", {
      serverActionTerminalTimeoutMs: 500,
    });

    events.emit("request", request);
    events.emit("response", response);
    let terminalObserved = false;
    const terminal = recorder.awaitStartedServerActions().then(() => {
      terminalObserved = true;
    });
    await Promise.resolve();
    expect(terminalObserved).toBe(false);

    finishResponse(null);
    await terminal;
    expect(response.finished).toHaveBeenCalledOnce();
    await expect(recorder.finish()).resolves.toEqual([
      expect.objectContaining({
        failure: null,
        response: expect.objectContaining({ status: 200 }),
        serverAction: expect.objectContaining({ present: true }),
      }),
    ]);
  });

  it("accepts an exact top-level application document as the terminal boundary", async () => {
    const events = new EventEmitter();
    const mainFrame = {};
    const page = {
      mainFrame: vi.fn(() => mainFrame),
      off(event: string, listener: (...args: unknown[]) => void) {
        events.off(event, listener);
        return page;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        events.on(event, listener);
        return page;
      },
    } as unknown as Page;
    const action = requestFixture({
      frame: mainFrame,
      headers: { "next-action": "synthetic-action" },
      method: "POST",
      postData: Buffer.from("synthetic-payload"),
      resourceType: "fetch",
      url: "https://pay.test/cabinet",
    });
    const navigation = requestFixture({
      frame: mainFrame,
      headers: {},
      method: "GET",
      postData: null,
      resourceType: "document",
      url: "https://pay.test/link-account",
      navigation: true,
    });
    const recorder = recordNetwork(page, "https://pay.test", {
      serverActionTerminalTimeoutMs: 500,
    });

    events.emit("request", action);
    let terminalObserved = false;
    const terminal = recorder.awaitStartedServerActions().then(() => {
      terminalObserved = true;
    });
    await Promise.resolve();
    expect(terminalObserved).toBe(false);

    events.emit("request", navigation);
    await terminal;
    await expect(recorder.finish()).resolves.toEqual([
      expect.objectContaining({
        failure: null,
        response: null,
        serverAction: expect.objectContaining({ present: true }),
      }),
      expect.objectContaining({
        navigation: true,
        serverAction: expect.objectContaining({ present: false }),
      }),
    ]);
  });

  it("accepts only a same-origin main-frame client navigation as a terminal boundary", async () => {
    const events = new EventEmitter();
    const mainFrame = {
      url: vi.fn(() => "https://pay.test/link-account?auth=telegram_email_replace"),
    };
    const page = {
      mainFrame: vi.fn(() => mainFrame),
      off(event: string, listener: (...args: unknown[]) => void) {
        events.off(event, listener);
        return page;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        events.on(event, listener);
        return page;
      },
    } as unknown as Page;
    const action = requestFixture({
      frame: mainFrame,
      headers: { "next-action": "synthetic-action" },
      method: "POST",
      postData: Buffer.from("synthetic-payload"),
      resourceType: "fetch",
      url: "https://pay.test/link-account",
    });
    const recorder = recordNetwork(page, "https://pay.test", {
      serverActionTerminalTimeoutMs: 500,
    });

    events.emit("request", action);
    let terminalObserved = false;
    const terminal = recorder.awaitStartedServerActions().then(() => {
      terminalObserved = true;
    });
    await Promise.resolve();
    expect(terminalObserved).toBe(false);

    events.emit("framenavigated", {
      url: () => "https://external.test/link-account",
    });
    await Promise.resolve();
    expect(terminalObserved).toBe(false);

    events.emit("framenavigated", mainFrame);
    await terminal;
    await expect(recorder.finish()).resolves.toEqual([
      expect.objectContaining({
        failure: null,
        response: null,
        serverAction: expect.objectContaining({ present: true }),
      }),
    ]);
  });

  it("does not release an action for a subframe document navigation", async () => {
    const events = new EventEmitter();
    const mainFrame = {};
    const page = {
      mainFrame: vi.fn(() => mainFrame),
      off(event: string, listener: (...args: unknown[]) => void) {
        events.off(event, listener);
        return page;
      },
      on(event: string, listener: (...args: unknown[]) => void) {
        events.on(event, listener);
        return page;
      },
    } as unknown as Page;
    const action = requestFixture({
      frame: mainFrame,
      headers: { "next-action": "synthetic-action" },
      method: "POST",
      postData: Buffer.from("synthetic-payload"),
      resourceType: "fetch",
      url: "https://pay.test/cabinet",
    });
    const subframeNavigation = requestFixture({
      frame: {},
      headers: {},
      method: "GET",
      postData: null,
      resourceType: "document",
      url: "https://pay.test/link-account",
      navigation: true,
    });
    const recorder = recordNetwork(page, "https://pay.test", {
      serverActionTerminalTimeoutMs: 20,
    });

    events.emit("request", action);
    events.emit("request", subframeNavigation);

    await expect(recorder.awaitStartedServerActions()).rejects.toThrow(
      "Network recorder timed out waiting for 1 application Server Action request(s)",
    );
    await expect(recorder.finish()).rejects.toThrow(
      "Network recorder timed out waiting for 1 application Server Action request(s)",
    );
  });
});

function requestFixture(input: {
  frame: object;
  headers: Record<string, string>;
  method: "GET" | "POST";
  navigation?: boolean;
  postData: Buffer | null;
  resourceType: "document" | "fetch";
  url: string;
}) {
  return {
    allHeaders: vi.fn(async () => input.headers),
    failure: vi.fn(() => null),
    frame: vi.fn(() => input.frame),
    headers: vi.fn(() => input.headers),
    isNavigationRequest: vi.fn(() => input.navigation ?? false),
    method: vi.fn(() => input.method),
    postDataBuffer: vi.fn(() => input.postData),
    redirectedFrom: vi.fn(() => null),
    resourceType: vi.fn(() => input.resourceType),
    url: vi.fn(() => input.url),
  } as unknown as Request;
}
