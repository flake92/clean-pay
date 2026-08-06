import { describe, expect, it } from "vitest";

import { readTelegramPopupRequest } from "@/backend/integrations/telegram/popup-request";

function request(body: string, headers?: HeadersInit) {
  return new Request("http://clean-pay.local/auth/telegram/callback", {
    method: "POST",
    headers,
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
  });

  it("enforces the endpoint-specific payload limit", async () => {
    await expect(
      readTelegramPopupRequest(request("{}", { "content-length": String(65 * 1024) })),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", status: 413 });
  });
});
