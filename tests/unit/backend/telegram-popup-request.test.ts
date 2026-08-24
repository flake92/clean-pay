import { describe, expect, it } from "vitest";

import { readTelegramPopupRequest } from "@/backend/integrations/telegram/popup-request";

function request(body: string, headers?: HeadersInit) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  return new Request("http://clean-pay.local/auth/telegram/callback", {
    method: "POST",
    headers: requestHeaders,
    body,
  });
}

describe("Telegram popup HTTP contract", () => {
  it("returns the typed OIDC variant", async () => {
    await expect(
      readTelegramPopupRequest(request(JSON.stringify({ idToken: "signed-token" }))),
    ).resolves.toEqual({ method: "oidc", idToken: "signed-token" });
  });

  it("returns the typed login-widget variant", async () => {
    const authData = { id: 42, auth_date: 123, hash: "signature" };

    await expect(
      readTelegramPopupRequest(request(JSON.stringify({ authData }))),
    ).resolves.toEqual({ method: "login-widget", authData });
  });

  it("rejects malformed or unrelated JSON", async () => {
    await expect(readTelegramPopupRequest(request("{not-json"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    await expect(readTelegramPopupRequest(request(JSON.stringify({ anything: true })))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    await expect(readTelegramPopupRequest(request("null"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
    await expect(readTelegramPopupRequest(request("[]"))).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("enforces the endpoint-specific payload limit", async () => {
    await expect(
      readTelegramPopupRequest(request("{}", { "content-length": String(65 * 1024) })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 413 });

    await expect(
      readTelegramPopupRequest(request("x".repeat(65 * 1024))),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 413 });
  });

  it("preserves the payload-limit error when cancelling the body stream also fails", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(65 * 1024));
      },
      cancel() {
        return Promise.reject(new Error("stream cancellation failed"));
      },
    });
    const streamed = new Request("http://clean-pay.local/auth/telegram/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);

    await expect(readTelegramPopupRequest(streamed)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 413,
    });
  });

  it("rejects a request without a body", async () => {
    const empty = new Request("http://clean-pay.local/auth/telegram/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    await expect(readTelegramPopupRequest(empty)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });

  it("rejects simple cross-site media types before parsing the body", async () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded"]) {
      await expect(readTelegramPopupRequest(request(
        JSON.stringify({ idToken: "signed-token" }),
        { "content-type": contentType },
      ))).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 415 });
    }
  });
});
