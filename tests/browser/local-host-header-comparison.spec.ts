import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  projectCharacterizationManifestPairBytesForComparison,
  projectCharacterizationManifestPairForComparison,
} from "./comparison-projection";
import { digestValue } from "./redaction";

const BASELINE_ORIGIN = "http://127.0.0.1:4000";
const CANDIDATE_ORIGIN = "http://127.0.0.1:4100";

test("projects only the pair-proven local application Host header", () => {
  const baseline = manifest(BASELINE_ORIGIN, { poweredBy: true });
  const candidate = manifest(CANDIDATE_ORIGIN, { poweredBy: false });
  const rawBaseline = structuredClone(baseline);
  const rawCandidate = structuredClone(candidate);

  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
    { actualApplicationOrigin: CANDIDATE_ORIGIN },
  );

  expect(projected.expected).toEqual(projected.actual);
  expect(requestHeaders(projected.expected)[1]).toEqual({
    name: "host",
    value: "<validated-local-application-host>",
  });
  expect(baseline).toEqual(rawBaseline);
  expect(candidate).toEqual(rawCandidate);
});

test("preserves both raw byte artifacts while comparing their projections", () => {
  const baseline = Buffer.from(`${JSON.stringify(manifest(BASELINE_ORIGIN))}\n`);
  const candidate = Buffer.from(`${JSON.stringify(manifest(CANDIDATE_ORIGIN))}\n`);
  const baselineBefore = Buffer.from(baseline);
  const candidateBefore = Buffer.from(candidate);

  const projected = projectCharacterizationManifestPairBytesForComparison(
    baseline,
    candidate,
    { actualApplicationOrigin: CANDIDATE_ORIGIN },
  );

  expect(projected.expected).toEqual(projected.actual);
  expect(baseline).toEqual(baselineBefore);
  expect(candidate).toEqual(candidateBefore);
  expect(candidate).not.toEqual(projected.actual);
});

test("matches an immutable public baseline copy only after every Host proves the runner port", async () => {
  const baselinePath = path.join(
    process.cwd(),
    "tests",
    "browser",
    "baselines",
    "f5cb6f543d85256e7733a1ade6a4f451d86cf378-deterministic-v5",
    "chromium-1440x900",
    "protected-cabinet",
    "characterization.json",
  );
  const baseline = await readFile(baselinePath);
  const candidateValue = JSON.parse(baseline.toString("utf8")) as {
    network: { requests: Array<{ requestHeaders: Array<{ name: string; value: unknown }> }> };
  };
  let projectedHostCount = 0;
  for (const candidateRequest of candidateValue.network.requests) {
    for (const header of candidateRequest.requestHeaders) {
      if (header.name !== "host") continue;
      header.value = digestValue(new URL(CANDIDATE_ORIGIN).host);
      projectedHostCount += 1;
    }
  }
  const candidate = Buffer.from(`${JSON.stringify(candidateValue, null, 2)}\n`);

  const projected = projectCharacterizationManifestPairBytesForComparison(
    baseline,
    candidate,
    { actualApplicationOrigin: CANDIDATE_ORIGIN },
  );

  expect(projectedHostCount).toBe(3);
  expect(projected.expected).toEqual(projected.actual);
  await expect(readFile(baselinePath)).resolves.toEqual(baseline);
});

test("keeps Host projection context and manifest near misses exact", () => {
  const cases: Array<{
    label: string;
    origin?: string;
    mutateBaseline?: (value: ReturnType<typeof manifest>) => void;
    mutateCandidate?: (value: ReturnType<typeof manifest>) => void;
  }> = [
    { label: "missing runner origin", origin: undefined },
    { label: "baseline port is not isolated", origin: BASELINE_ORIGIN },
    { label: "localhost alias is not the runner address", origin: "http://localhost:4100" },
    { label: "HTTPS is not the local runner protocol", origin: "https://127.0.0.1:4100" },
    { label: "origin contains a path", origin: "http://127.0.0.1:4100/app" },
    {
      label: "candidate Host digest does not match runner origin",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => setHost(value, "127.0.0.1:4171"),
    },
    {
      label: "baseline Host digest is not the pinned capture origin",
      origin: CANDIDATE_ORIGIN,
      mutateBaseline: (value) => setHost(value, "127.0.0.1:4001"),
    },
    {
      label: "candidate Host byte count is wrong",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => {
        (requestHeaders(value)[1]!.value as { bytes: number }).bytes += 1;
      },
    },
    {
      label: "duplicate candidate Host",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => {
        requestHeaders(value).splice(2, 0, structuredClone(requestHeaders(value)[1]!));
      },
    },
    {
      label: "duplicate baseline Host",
      origin: CANDIDATE_ORIGIN,
      mutateBaseline: (value) => {
        requestHeaders(value).splice(2, 0, structuredClone(requestHeaders(value)[1]!));
      },
    },
    {
      label: "uppercase header name",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { requestHeaders(value)[1]!.name = "Host"; },
    },
    {
      label: "Host has an adjacent field",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => {
        Object.assign(requestHeaders(value)[1]!, { source: "fixture" });
      },
    },
    {
      label: "another request header changed",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => {
        requestHeaders(value)[0]!.value = digestValue("application/xml");
      },
    },
    {
      label: "header order changed",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { requestHeaders(value).reverse(); },
    },
    {
      label: "candidate request has external scope",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { request(value).scope = "external"; },
    },
    {
      label: "both requests have external scope",
      origin: CANDIDATE_ORIGIN,
      mutateBaseline: (value) => { request(value).scope = "external"; },
      mutateCandidate: (value) => { request(value).scope = "external"; },
    },
    {
      label: "candidate URL has external origin",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => {
        request(value).url.origin = "<external-origin:0123456789abcdef>";
      },
    },
    {
      label: "route differs",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { value.route.id = "register"; },
    },
    {
      label: "project differs",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { value.project = "chromium-1440x900"; },
    },
    {
      label: "schema differs",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { value.schemaVersion = 2; },
    },
    {
      label: "baseline commit differs",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { value.baselineCommit = "0".repeat(40); },
    },
    {
      label: "request identity differs",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => { request(value).method = "POST"; },
    },
    {
      label: "request count differs",
      origin: CANDIDATE_ORIGIN,
      mutateCandidate: (value) => {
        value.network.requests.push(structuredClone(value.network.requests[0]!));
      },
    },
  ];

  for (const nearMiss of cases) {
    const baseline = manifest(BASELINE_ORIGIN);
    const candidate = manifest(CANDIDATE_ORIGIN);
    nearMiss.mutateBaseline?.(baseline);
    nearMiss.mutateCandidate?.(candidate);
    const baselineHeaders = structuredClone(requestHeaders(baseline));
    const candidateHeaders = structuredClone(requestHeaders(candidate));

    const projected = projectCharacterizationManifestPairForComparison(
      baseline,
      candidate,
      { actualApplicationOrigin: nearMiss.origin },
    );

    expect(requestHeaders(projected.expected), nearMiss.label).toEqual(baselineHeaders);
    expect(requestHeaders(projected.actual), nearMiss.label).toEqual(candidateHeaders);
    expect(projected.expected, nearMiss.label).not.toEqual(projected.actual);
  }
});

test("rejects one invalid Host-bearing request atomically", () => {
  const baseline = manifest(BASELINE_ORIGIN);
  const candidate = manifest(CANDIDATE_ORIGIN);
  baseline.network.requests.push(structuredClone(baseline.network.requests[0]!));
  candidate.network.requests.push(structuredClone(candidate.network.requests[0]!));
  baseline.network.requests[1]!.index = 1;
  candidate.network.requests[1]!.index = 1;
  candidate.network.requests[1]!.requestHeaders[1]!.value = digestValue("127.0.0.1:4999");

  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
    { actualApplicationOrigin: CANDIDATE_ORIGIN },
  );

  expect(requestHeaders(projected.expected)).toEqual(requestHeaders(baseline));
  expect(requestHeaders(projected.actual)).toEqual(requestHeaders(candidate));
  expect(projected.expected).not.toEqual(projected.actual);
});

function manifest(
  origin: string,
  options: { poweredBy?: boolean } = {},
) {
  return {
    schemaVersion: 1,
    baselineCommit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
    project: "chromium-390x844",
    route: {
      id: "login",
      kind: "public",
      requested: applicationUrl("/login"),
      final: applicationUrl("/login"),
      redirects: [],
      finalStatus: 200,
    },
    network: {
      requests: [{
        index: 0,
        method: "GET",
        url: applicationUrl("/login"),
        scope: "application",
        resourceType: "document",
        navigation: true,
        serverAction: { present: false, identifier: null },
        requestHeaders: [
          { name: "accept", value: digestValue("text/html") },
          { name: "host", value: digestValue(new URL(origin).host) },
          { name: "user-agent", value: digestValue("pinned-browser") },
        ],
        postData: null,
        redirectedFrom: null,
        response: {
          status: 200,
          statusText: "OK",
          fromServiceWorker: false,
          headers: [
            { name: "content-type", value: "text/html; charset=utf-8" },
            ...(options.poweredBy ? [{
              name: "x-powered-by",
              value: {
                bytes: 7,
                sha256: "30b7f8482c4f570c063e4dff04b91ddc9b2b5f535ac70fedffb1cf34e0d23ec6",
              },
            }] : []),
          ],
        },
        failure: null,
        externalTransport: null,
      }],
      serverActionCount: 0,
      serverActions: [],
    },
  };
}

function applicationUrl(pathname: string) {
  return { origin: "<app-origin>", pathname, query: [], fragment: null };
}

function request(value: ReturnType<typeof manifest>) {
  return value.network.requests[0]!;
}

function requestHeaders(value: unknown) {
  return request(value as ReturnType<typeof manifest>).requestHeaders;
}

function setHost(value: ReturnType<typeof manifest>, host: string) {
  requestHeaders(value)[1]!.value = digestValue(host);
}
