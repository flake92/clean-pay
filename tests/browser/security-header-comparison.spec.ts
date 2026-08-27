import { expect, test } from "@playwright/test";

import { projectCharacterizationManifestPairForComparison } from "./comparison-projection";

const nextJsDisclosure = {
  name: "x-powered-by",
  value: {
    bytes: 7,
    sha256: "30b7f8482c4f570c063e4dff04b91ddc9b2b5f535ac70fedffb1cf34e0d23ec6",
  },
};

const stableHeaders = [
  { name: "content-type", value: "text/html; charset=utf-8" },
  nextJsDisclosure,
  { name: "x-content-type-options", value: "nosniff" },
];

test("allows only the exact baseline Next.js disclosure to be removed", () => {
  const baseline = manifest(stableHeaders);
  const candidate = manifest(stableHeaders.filter((header) => header !== nextJsDisclosure));
  const projected = projectCharacterizationManifestPairForComparison(
    baseline,
    candidate,
  );

  expect(projected.expected).toEqual(projected.actual);
  expect(baseline.network.requests[0]?.response.headers).toEqual(stableHeaders);

  const unchanged = projectCharacterizationManifestPairForComparison(
    baseline,
    structuredClone(baseline),
  );
  expect(unchanged.expected).toEqual(unchanged.actual);
});

test("keeps reverse, mutated, duplicate, and adjacent header differences observable", () => {
  const baseline = manifest(stableHeaders);
  const candidate = manifest(stableHeaders.filter((header) => header !== nextJsDisclosure));
  const differentDisclosure = {
    name: "x-powered-by",
    value: { bytes: 8, sha256: "1".repeat(64) },
  };
  const cases = [
    {
      label: "reverse addition",
      expected: candidate,
      actual: baseline,
    },
    {
      label: "different baseline value removed",
      expected: manifest([stableHeaders[0], differentDisclosure, stableHeaders[2]]),
      actual: candidate,
    },
    {
      label: "candidate changed the value",
      expected: baseline,
      actual: manifest([stableHeaders[0], differentDisclosure, stableHeaders[2]]),
    },
    {
      label: "another response header also disappeared",
      expected: baseline,
      actual: manifest([stableHeaders[0]]),
    },
    {
      label: "response status also changed",
      expected: baseline,
      actual: manifest(candidate.network.requests[0]!.response.headers, { status: 201 }),
    },
    {
      label: "duplicate disclosure",
      expected: manifest([
        stableHeaders[0],
        nextJsDisclosure,
        nextJsDisclosure,
        stableHeaders[2],
      ]),
      actual: candidate,
    },
    {
      label: "external response",
      expected: manifest(stableHeaders, { scope: "external" }),
      actual: manifest(candidate.network.requests[0]!.response.headers, { scope: "external" }),
    },
  ];

  for (const value of cases) {
    const projected = projectCharacterizationManifestPairForComparison(
      value.expected,
      value.actual,
    );
    expect(projected.expected, value.label).not.toEqual(projected.actual);
  }
});

function manifest(
  headers: unknown[],
  options: { scope?: "application" | "external"; status?: number } = {},
) {
  return {
    network: {
      requests: [{
        index: 0,
        method: "GET",
        url: {
          origin: options.scope === "external" ? "<external-origin:fixture>" : "<app-origin>",
          pathname: "/login",
          query: [],
          fragment: null,
        },
        scope: options.scope ?? "application",
        resourceType: "document",
        navigation: true,
        serverAction: { present: false, identifier: null },
        requestHeaders: [],
        postData: null,
        redirectedFrom: null,
        response: {
          status: options.status ?? 200,
          statusText: options.status === 201 ? "Created" : "OK",
          fromServiceWorker: false,
          headers: structuredClone(headers),
        },
        failure: null,
        externalTransport: null,
      }],
      serverActions: [],
    },
  };
}
