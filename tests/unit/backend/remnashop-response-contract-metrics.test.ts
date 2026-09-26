import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const metrics = vi.hoisted(() => ({
  recordUpstreamRequest: vi.fn(),
}));

vi.mock("@/backend/observability/metrics", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/backend/observability/metrics")>(),
  recordUpstreamRequest: metrics.recordUpstreamRequest,
}));

import {
  bindRemnashopResponseContract,
  createRemnashopTransport,
} from "@/backend/integrations/remnashop/request-transport";

const observer = {
  requestSent: vi.fn(),
  responseReceived: vi.fn(),
  requestFailed: vi.fn(),
  adminRequestSent: vi.fn(),
  adminResponseReceived: vi.fn(),
  adminRequestFailed: vi.fn(),
};

describe("Remnashop response-contract metric boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records one outcome only after the bound decoder and completion contract", async () => {
    const order: string[] = [];
    metrics.recordUpstreamRequest.mockImplementation(() => {
      order.push("metric");
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ state: "PENDING", provider_extra: true })),
    );
    const options = bindRemnashopResponseContract(
      { accessToken: "synthetic-access-token" },
      {
        decodeResponse(value: unknown) {
          order.push("decode");
          const input = value as Record<string, unknown>;
          return { state: String(input.state) };
        },
        complete(decoded) {
          order.push("complete");
          if (decoded.state !== "SUCCEEDED") {
            throw new TypeError("response status contract failed");
          }
          return decoded;
        },
      },
    );

    expect(Object.keys(options)).toEqual(["accessToken"]);
    const transport = createRemnashopTransport(observer);
    await expect(
      transport.remnashopRequest("/subscription/payment-operations/PURCHASE", options),
    ).rejects.toThrow("response status contract failed");

    expect(order).toEqual(["decode", "complete", "metric"]);
    expect(metrics.recordUpstreamRequest).toHaveBeenCalledOnce();
    expect(metrics.recordUpstreamRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "remnashop",
        operation: "/subscription/payment-operations/:operation",
        outcome: "unavailable",
      }),
    );
  });

  it("consumes a bound contract once even when the first request fails", async () => {
    const decodeResponse = vi.fn((value: unknown) => value);
    const options = bindRemnashopResponseContract(
      { accessToken: "synthetic-access-token" },
      { decodeResponse },
    );
    vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("synthetic transport failure"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ state: "PENDING", provider_extra: true })),
      );
    const transport = createRemnashopTransport(observer);

    await expect(
      transport.remnashopRequest("/subscription/payment-operations/PURCHASE", options),
    ).rejects.toThrow();
    await expect(
      transport.remnashopRequest("/subscription/payment-operations/PURCHASE", options),
    ).resolves.toEqual({ state: "PENDING", provider_extra: true });

    expect(decodeResponse).not.toHaveBeenCalled();
    expect(metrics.recordUpstreamRequest).toHaveBeenCalledTimes(2);
    expect(metrics.recordUpstreamRequest.mock.calls.map(([input]) => input.outcome))
      .toEqual(["unavailable", "success"]);
  });
});
