#!/usr/bin/env node

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const upstream = new URL(process.argv[2] ?? "");
const trustedOrigin = new URL(process.argv[3] ?? "").origin;
const alternateOrigin = process.argv[4] ? new URL(process.argv[4]).origin : undefined;
if (
  !/^https?:$/.test(upstream.protocol)
  || !/^https:/.test(trustedOrigin)
  || (alternateOrigin && !/^https:/.test(alternateOrigin))
) {
  throw new Error(
    "usage: verify-server-action-boundary.mjs UPSTREAM_URL TRUSTED_HTTPS_ORIGIN [ALTERNATE_HTTPS_ORIGIN]",
  );
}
const proxyRequest = upstream.protocol === "https:" ? httpsRequest : httpRequest;

const proxy = createServer((request, response) => {
  const target = new URL(request.url ?? "/", upstream);
  const forwarded = proxyRequest(target, {
    method: request.method,
    headers: {
      ...request.headers,
      host: upstream.host,
      "x-forwarded-host": request.headers.host ?? "unknown",
      "x-forwarded-proto": "https",
    },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  forwarded.on("error", (error) => {
    response.writeHead(502, { "content-type": "text/plain" });
    response.end(error.name);
  });
  request.pipe(forwarded);
});

await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(0, "127.0.0.1", resolve);
});

const address = proxy.address();
if (!address || typeof address === "string") throw new Error("proxy did not bind TCP");
const baseUrl = `http://127.0.0.1:${address.port}`;
const BODY_LIMIT = 64 * 1_024;
// Next.js 16.4+ rejects malformed ids with 400 before the action lookup, so the
// probe uses a well-formed (42-character) id that no deployment ever defines.
// A request that crossed both origin gates then ends in Next's bounded
// "unknown action" response.
const PROBE_ACTION_ID = `00${"c1ea".repeat(10)}`;
const UNKNOWN_ACTION_STATUS = 409;
const UNKNOWN_ACTION_TEXT = "Server Action unavailable.";

async function post({
  contentType = "text/plain;charset=UTF-8",
  body = "[null]",
  headers = {},
  streamed = false,
} = {}) {
  const requestHeaders = new Headers({
    "content-type": contentType,
    "next-action": PROBE_ACTION_ID,
    ...headers,
  });
  const requestBody = streamed
    ? new ReadableStream({
        start(controller) {
          for (let offset = 0; offset < body.length; offset += 4_096) {
            controller.enqueue(new TextEncoder().encode(body.slice(offset, offset + 4_096)));
          }
          controller.close();
        },
      })
    : body;
  return fetch(`${baseUrl}/login`, {
    method: "POST",
    headers: requestHeaders,
    body: requestBody,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
    ...(streamed ? { duplex: "half" } : {}),
  });
}

async function expectBlockedSource(name, headers) {
  const response = await post({ headers });
  const text = await response.text();
  if (response.status !== 403 || text.length > 1_024 || !text.includes("FORBIDDEN")) {
    throw new Error(`${name}: expected bounded 403/FORBIDDEN, received ${response.status}`);
  }
}

async function expectAcceptedSource(name, headers) {
  const response = await post({ headers });
  const text = await response.text();
  if (
    response.status !== UNKNOWN_ACTION_STATUS
    || response.headers.get("x-nextjs-action-not-found") !== "1"
    || text.length > 1_024
    || !text.includes(UNKNOWN_ACTION_TEXT)
  ) {
    throw new Error(
      `${name}: expected bounded ${UNKNOWN_ACTION_STATUS}/x-nextjs-action-not-found after both origin gates, received ${response.status}`,
    );
  }
}

async function expectOversized(name, contentType, streamed) {
  const response = await post({
    contentType,
    body: "x".repeat(BODY_LIMIT + 1),
    headers: { origin: trustedOrigin },
    streamed,
  });
  const text = await response.text();
  if (response.status !== 413 || text.length > 1_024 || !text.includes("PAYLOAD_TOO_LARGE")) {
    throw new Error(`${name}: expected bounded 413/PAYLOAD_TOO_LARGE, received ${response.status}`);
  }
}

try {
  await expectBlockedSource("missing source", {});
  await expectBlockedSource("mismatched origin", { origin: "https://attacker.invalid" });
  await expectBlockedSource("forged forwarding metadata", {
    origin: "https://attacker.invalid",
    host: new URL(trustedOrigin).host,
    "x-forwarded-host": new URL(trustedOrigin).host,
  });

  await expectAcceptedSource("trusted origin", { origin: trustedOrigin });
  if (alternateOrigin) {
    await expectAcceptedSource("alternate trusted origin", { origin: alternateOrigin });
  }

  // Next.js 16.4 no longer dispatches url-encoded bodies as Server Actions; past
  // both origin gates such a request renders the page's 404 instead.
  const encodings = [
    ["text/plain;charset=UTF-8", UNKNOWN_ACTION_STATUS],
    ["application/x-www-form-urlencoded", 404],
    ["multipart/form-data; boundary=clean-pay-live-boundary", UNKNOWN_ACTION_STATUS],
  ];
  for (const [contentType, crossedGatesStatus] of encodings) {
    const exact = await post({
      contentType,
      body: "x".repeat(BODY_LIMIT),
      headers: { origin: trustedOrigin },
    });
    if (exact.status !== crossedGatesStatus) {
      throw new Error(
        `${contentType}: exact-limit trusted request did not cross both origin gates: ${exact.status}`,
      );
    }
    await exact.arrayBuffer();
    await expectOversized(`${contentType} declared length`, contentType, false);
    await expectOversized(`${contentType} chunked`, contentType, true);
  }

  const trustedReferer = await post({
    headers: {
      referer: `${trustedOrigin}/login`,
      host: "attacker.invalid",
      "x-forwarded-host": "attacker.invalid",
    },
  });
  const trustedRefererText = await trustedReferer.text();
  if (
    trustedReferer.status !== UNKNOWN_ACTION_STATUS
    || trustedReferer.headers.get("x-nextjs-action-not-found") !== "1"
    || trustedRefererText.length > 1_024
    || !trustedRefererText.includes(UNKNOWN_ACTION_TEXT)
  ) {
    throw new Error(
      `trusted Referer did not cross both origin gates: ${trustedReferer.status}`,
    );
  }

  process.stdout.write(
    "Live reverse-proxy Server Action origin and 64 KiB boundary matrix passed.\n",
  );
} finally {
  await new Promise((resolve, reject) => {
    proxy.close((error) => error ? reject(error) : resolve());
  });
}
