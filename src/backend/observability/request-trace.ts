import { headers } from "next/headers";

export type RequestTrace = {
  requestId: string | null;
  traceId: string | null;
  traceparent: string | null;
};

export async function currentRequestTrace(): Promise<RequestTrace> {
  try {
    const requestHeaders = await headers();
    const requestId = requestHeaders.get("x-request-id");
    const traceId = requestHeaders.get("x-clean-pay-trace-id");
    const traceparent = requestHeaders.get("traceparent");

    return {
      requestId: requestId && /^[A-Za-z0-9._:-]{8,128}$/.test(requestId)
        ? requestId
        : null,
      traceId: traceId && /^[0-9a-f]{32}$/.test(traceId) ? traceId : null,
      traceparent: traceparent && /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/.test(traceparent)
        ? traceparent
        : null,
    };
  } catch {
    return { requestId: null, traceId: null, traceparent: null };
  }
}

export function tracedHeaders(
  input: HeadersInit | undefined,
  trace: RequestTrace,
) {
  const result = new Headers(input);
  if (trace.traceparent) result.set("traceparent", trace.traceparent);
  if (trace.requestId) result.set("x-request-id", trace.requestId);
  return Object.fromEntries(result.entries());
}
