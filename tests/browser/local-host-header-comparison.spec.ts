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

test("projects an ephemeral pair only after both distinct loopback origins are proven", () => {
  const ephemeralBaselineOrigin = "http://127.0.0.1:4201";
  const ephemeralCandidateOrigin = "http://127.0.0.1:4202";
  const projected = projectCharacterizationManifestPairForComparison(
    manifest(ephemeralBaselineOrigin),
    manifest(ephemeralCandidateOrigin),
    {
      expectedApplicationOrigin: ephemeralBaselineOrigin,
      actualApplicationOrigin: ephemeralCandidateOrigin,
    },
  );

  expect(projected.expected).toEqual(projected.actual);
  expect(requestHeaders(projected.expected)[1]).toEqual({
    name: "host",
    value: "<validated-local-application-host>",
  });
});

test("accepts port 4000 when it is explicitly bound as one side of a live pair", () => {
  const liveCandidateOrigin = "http://127.0.0.1:4202";
  const projected = projectCharacterizationManifestPairForComparison(
    manifest(BASELINE_ORIGIN),
    manifest(liveCandidateOrigin),
    {
      expectedApplicationOrigin: BASELINE_ORIGIN,
      actualApplicationOrigin: liveCandidateOrigin,
    },
  );

  expect(projected.expected).toEqual(projected.actual);
});

test("keeps ephemeral Host digests exact unless both origins are strict and distinct", () => {
  const ephemeralBaselineOrigin = "http://127.0.0.1:4201";
  const ephemeralCandidateOrigin = "http://127.0.0.1:4202";
  const nearMisses = [
    { expectedApplicationOrigin: undefined, actualApplicationOrigin: ephemeralCandidateOrigin },
    { expectedApplicationOrigin: "http://localhost:4201", actualApplicationOrigin: ephemeralCandidateOrigin },
    { expectedApplicationOrigin: ephemeralBaselineOrigin, actualApplicationOrigin: ephemeralBaselineOrigin },
    { expectedApplicationOrigin: ephemeralBaselineOrigin, actualApplicationOrigin: "http://127.0.0.1:4203" },
  ];

  for (const options of nearMisses) {
    const baseline = manifest(ephemeralBaselineOrigin);
    const candidate = manifest(ephemeralCandidateOrigin);
    const projected = projectCharacterizationManifestPairForComparison(
      baseline,
      candidate,
      options,
    );
    expect(projected.expected, JSON.stringify(options)).not.toEqual(projected.actual);
    expect(requestHeaders(projected.expected), JSON.stringify(options)).toEqual(
      requestHeaders(baseline),
    );
    expect(requestHeaders(projected.actual), JSON.stringify(options)).toEqual(
      requestHeaders(candidate),
    );
  }
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

test("projects only an exact optional Origin header on public static chunks", () => {
  const baseline = manifest(BASELINE_ORIGIN);
  const candidate = manifest(CANDIDATE_ORIGIN);
  addStaticScript(baseline, "baseline", true);
  addStaticScript(candidate, "candidate", false);

  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
    {
      actualApplicationOrigin: CANDIDATE_ORIGIN,
      expectedApplicationOrigin: BASELINE_ORIGIN,
    },
  );

  expect(projected.expected).toEqual(projected.actual);
  expect(staticRequest(projected.expected).requestHeaders.map((header) => header.name))
    .toEqual([
      "accept",
      "accept-language",
      "referer",
      "sec-ch-ua",
      "sec-ch-ua-mobile",
      "sec-ch-ua-platform",
      "user-agent",
    ]);

  const nearMisses: Array<{
    label: string;
    mutateBaseline?: (value: ReturnType<typeof manifest>) => void;
    mutateCandidate?: (value: ReturnType<typeof manifest>) => void;
  }> = [
    {
      label: "invalid Origin target",
      mutateBaseline: (value) => {
        const origin = staticRequest(value).requestHeaders[2]!.value as Record<string, unknown>;
        origin.pathname = "/login";
      },
    },
    {
      label: "non-static request",
      mutateBaseline: (value) => {
        staticRequest(value).resourceType = "fetch";
      },
    },
    {
      label: "adjacent header drift",
      mutateCandidate: (value) => {
        staticRequest(value).requestHeaders[0]!.value = digestValue("application/json");
      },
    },
  ];

  for (const nearMiss of nearMisses) {
    const nearMissBaseline = manifest(BASELINE_ORIGIN);
    const nearMissCandidate = manifest(CANDIDATE_ORIGIN);
    addStaticScript(nearMissBaseline, "baseline", true);
    addStaticScript(nearMissCandidate, "candidate", false);
    nearMiss.mutateBaseline?.(nearMissBaseline);
    nearMiss.mutateCandidate?.(nearMissCandidate);

    const rejected = projectCharacterizationManifestPairForComparison(
      nearMissBaseline,
      nearMissCandidate,
      {
        actualApplicationOrigin: CANDIDATE_ORIGIN,
        expectedApplicationOrigin: BASELINE_ORIGIN,
      },
    );

    expect(rejected.expected, nearMiss.label).not.toEqual(rejected.actual);
  }
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

function addStaticScript(
  value: ReturnType<typeof manifest>,
  seed: string,
  includeOrigin: boolean,
) {
  value.network.requests.push({
    index: value.network.requests.length,
    method: "GET",
    url: applicationUrl(`/_next/static/chunks/${seed}12345678.js`),
    scope: "application",
    resourceType: "script",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [
      { name: "accept", value: digestValue("*/*") },
      { name: "accept-language", value: digestValue("en-US") },
      ...(includeOrigin
        ? [{
            name: "origin",
            value: applicationUrl("/"),
          }]
        : []),
      {
        name: "referer",
        value: {
          origin: "<app-origin>",
          pathname: "/login",
          query: [{ key: "redirect_to", value: "<sha256:41b9b7d9f873870d>" }],
          fragment: null,
        },
      },
      { name: "sec-ch-ua", value: digestValue("chromium") },
      { name: "sec-ch-ua-mobile", value: digestValue("?1") },
      { name: "sec-ch-ua-platform", value: digestValue("Linux") },
      { name: "user-agent", value: digestValue("pinned-browser") },
    ],
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      statusText: "OK",
      fromServiceWorker: false,
      headers: [
        { name: "content-type", value: "application/javascript; charset=UTF-8" },
        { name: "etag", value: digestValue(`${seed}:etag`) },
      ],
    },
    failure: null,
    externalTransport: null,
  } as unknown as ReturnType<typeof manifest>["network"]["requests"][number]);
}

function staticRequest(value: unknown) {
  return (value as ReturnType<typeof manifest>).network.requests[1]!;
}
