import { describe, expect, it } from "vitest";

import { readBffJsonObject } from "@/backend/http/request-body";

describe("bounded JSON request bodies", () => {
  it("parses a JSON object below the byte limit", async () => {
    const request = new Request("http://clean-pay.local/api/test", {
      method: "POST",
      body: JSON.stringify({ value: "ok" }),
    });

    await expect(readBffJsonObject(request)).resolves.toEqual({ value: "ok" });
  });

  it("counts bytes read even when Content-Length understates the body", async () => {
    const request = new Request("http://clean-pay.local/api/test", {
      method: "POST",
      headers: { "content-length": "1" },
      body: JSON.stringify({ value: "payload-over-limit" }),
    });

    await expect(readBffJsonObject(request, { maxBytes: 16 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 413,
    });
  });

  it("distinguishes malformed JSON from oversized input", async () => {
    const request = new Request("http://clean-pay.local/api/test", {
      method: "POST",
      body: "{not-json",
    });

    await expect(readBffJsonObject(request)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      status: 400,
    });
  });
});
