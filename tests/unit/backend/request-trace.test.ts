import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));

import {
  currentRequestTrace,
  tracedHeaders,
} from "@/backend/observability/request-trace";

describe("request trace propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts bounded request identifiers and W3C trace context", async () => {
    mocks.headers.mockResolvedValue(new Headers({
      "x-request-id": "request-1234",
      "x-clean-pay-trace-id": "0123456789abcdef0123456789abcdef",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    }));

    const trace = await currentRequestTrace();

    expect(trace).toEqual({
      requestId: "request-1234",
      traceId: "0123456789abcdef0123456789abcdef",
      traceparent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    });
    expect(tracedHeaders({ accept: "application/json" }, trace)).toMatchObject({
      accept: "application/json",
      "x-request-id": "request-1234",
      traceparent: trace.traceparent,
    });
  });

  it("drops malformed external values and tolerates missing request context", async () => {
    mocks.headers.mockResolvedValueOnce(new Headers({
      "x-request-id": "short",
      "x-clean-pay-trace-id": "not-a-trace-id",
      traceparent: "invalid",
    }));
    await expect(currentRequestTrace()).resolves.toEqual({
      requestId: null,
      traceId: null,
      traceparent: null,
    });

    mocks.headers.mockRejectedValueOnce(new Error("outside request scope"));
    await expect(currentRequestTrace()).resolves.toEqual({
      requestId: null,
      traceId: null,
      traceparent: null,
    });
  });
});
