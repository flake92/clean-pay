#!/usr/bin/env node

import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const upstream = new URL(process.argv[2] ?? "");
const trustedOrigin = new URL(process.argv[3] ?? "").origin;
if (!/^https?:$/.test(upstream.protocol) || !/^https:/.test(trustedOrigin)) {
  throw new Error("usage: verify-server-action-boundary.mjs UPSTREAM_URL TRUSTED_HTTPS_ORIGIN");
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

async function post({
  contentType = "text/plain;charset=UTF-8",
  body = "[null]",
  headers = {},
  streamed = false,
} = {}) {
  const requestHeaders = new Headers({
    "content-type": contentType,
    "next-action": "clean-pay-invalid-live-boundary-probe",
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

  const encodings = [
    "text/plain;charset=UTF-8",
    "application/x-www-form-urlencoded",
    "multipart/form-data; boundary=clean-pay-live-boundary",
  ];
  for (const contentType of encodings) {
    const exact = await post({
      contentType,
      body: "x".repeat(BODY_LIMIT),
      headers: { origin: trustedOrigin },
    });
    if (exact.status === 403 || exact.status === 413) {
      throw new Error(`${contentType}: exact-limit trusted request was blocked with ${exact.status}`);
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
  if (trustedReferer.status === 403 || trustedReferer.status === 413) {
    throw new Error("trusted Referer was incorrectly replaced by forged forwarding metadata");
  }
  await trustedReferer.arrayBuffer();

  process.stdout.write(
    "Live reverse-proxy Server Action origin and 64 KiB boundary matrix passed.\n",
  );
} finally {
  await new Promise((resolve, reject) => {
    proxy.close((error) => error ? reject(error) : resolve());
  });
}
