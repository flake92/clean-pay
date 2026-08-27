import { afterEach, describe, expect, it, vi } from "vitest";

import {
  credentialedFetch,
  readBoundedJsonFromUnknown,
  readBoundedResponseText,
  UpstreamInvalidJsonError,
  UpstreamResponseTooLargeError,
} from "@/backend/integrations/http/upstream-http";

describe("credential-bearing upstream HTTP policy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([301, 302, 307, 308])(
    "does not issue a second request for HTTP %s",
    async (status) => {
      const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(null, {
          status,
          headers: { location: "https://redirect.example/credential-target" },
        }),
      );

      await expect(
        credentialedFetch("https://provider.example/resource", {
          headers: { authorization: "Bearer synthetic-token" },
          redirect: "follow",
        } as never),
      ).resolves.toMatchObject({ status });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        "https://provider.example/resource",
        expect.objectContaining({ redirect: "error" }),
      );
    },
  );

  it("rejects an oversized declared body before reading and cancels it", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, {
      headers: { "content-length": "11" },
    });

    await expect(readBoundedResponseText(response, { maxBytes: 10 }))
      .rejects.toBeInstanceOf(UpstreamResponseTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("caps a chunked body by bytes and cancels the stream", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(5));
      },
      cancel,
    });

    await expect(
      readBoundedResponseText(new Response(body), { maxBytes: 10 }),
    ).rejects.toBeInstanceOf(UpstreamResponseTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns parsed JSON only as unknown and rejects malformed JSON", async () => {
    await expect(
      readBoundedJsonFromUnknown(
        new Response(JSON.stringify({ ok: true })),
        { maxBytes: 1_024 },
      ),
    ).resolves.toEqual({ ok: true });

    await expect(
      readBoundedJsonFromUnknown(new Response("not-json"), { maxBytes: 1_024 }),
    ).rejects.toBeInstanceOf(UpstreamInvalidJsonError);
  });

  it("rejects malformed UTF-8 instead of accepting replacement characters", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([
          0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28,
        ]));
      },
      cancel,
    });

    await expect(
      readBoundedJsonFromUnknown(
        new Response(body),
        { maxBytes: 1_024 },
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
