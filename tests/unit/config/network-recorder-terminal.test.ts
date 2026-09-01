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
});
