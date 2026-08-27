import { buildContentSecurityPolicy } from "@/shared/security/content-security-policy";

const requestIdPattern = /^[A-Za-z0-9._:-]{8,128}$/;
const traceparentPattern = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export type ProxyRequestSecurity = {
  contentSecurityPolicy: string;
  requestHeaders: Headers;
  requestId: string;
  traceId: string;
};

export function createProxyRequestSecurity({
  headers,
  chatwootBaseUrl,
  chatwootConfigured,
  randomHex,
  randomUuid,
}: {
  headers: Headers;
  chatwootBaseUrl: string | undefined;
  chatwootConfigured: boolean;
  randomHex: (byteLength: number) => string;
  randomUuid: () => string;
}): ProxyRequestSecurity {
  const suppliedRequestId = headers.get("x-request-id")?.trim() ?? "";
  const requestId = requestIdPattern.test(suppliedRequestId)
    ? suppliedRequestId
    : randomUuid();
  const suppliedTraceparent = headers.get("traceparent")?.trim().toLowerCase() ?? "";
  const traceMatch = suppliedTraceparent.match(traceparentPattern);
  const suppliedTraceId = traceMatch?.[1];
  const traceId = suppliedTraceId && !/^0+$/.test(suppliedTraceId)
    ? suppliedTraceId
    : randomHex(16);
  const traceFlags = traceMatch?.[3] ?? "01";
  const nonce = randomHex(16);
  const contentSecurityPolicy = buildContentSecurityPolicy({
    nonce,
    chatwootBaseUrl: chatwootConfigured ? chatwootBaseUrl : null,
  });
  const requestHeaders = new Headers(headers);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set(
    "traceparent",
    `00-${traceId}-${randomHex(8)}-${traceFlags}`,
  );
  requestHeaders.set("x-clean-pay-trace-id", traceId);

  return { contentSecurityPolicy, requestHeaders, requestId, traceId };
}
