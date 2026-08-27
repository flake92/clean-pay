import { expect, test } from "@playwright/test";

import {
  assertSanitizedHarContract,
  createSanitizedHarContract,
  type SanitizedHarSource,
} from "./sanitized-har";
import { projectJourneyHarEvidencePairBytes } from "./journey-baseline-policy";

test("emits an exact redacted HAR 1.2 contract", () => {
  const source = harSource();
  const har = createSanitizedHarContract(source);
  expect(har.log).toMatchObject({
    version: "1.2",
    creator: {
      name: "Clean Pay browser characterization",
      version: "journey-v5",
    },
  });
  expect(har.log.entries).toHaveLength(1);
  expect(har.log.entries[0]).toMatchObject({
    request: {
      method: "POST",
      url: "https://app.invalid/action?token=%3Csha256%3A0123456789abcdef%3E",
      postData: { text: expect.stringContaining("sha256") },
    },
    response: { status: 200 },
  });
  expect(assertSanitizedHarContract(har)).toEqual(source);
  expect(JSON.stringify(har)).not.toContain("real-secret");
});

test("rejects every HAR field that does not derive from raw redacted evidence", () => {
  const mutations: Array<(value: ReturnType<typeof createSanitizedHarContract>) => void> = [
    (value) => { value.log.version = "1.1"; },
    (value) => { value.log.entries[0]!.request.method = "GET"; },
    (value) => { value.log.entries[0]!.request.url += "&extra=1"; },
    (value) => { value.log.entries[0]!.request.headers[0]!.value = "changed"; },
    (value) => { value.log.entries[0]!.response.status = 201; },
    (value) => { value.log.entries[0]!._cleanPayRequestIndex = 99; },
  ];
  for (const mutate of mutations) {
    const har = createSanitizedHarContract(harSource());
    mutate(har);
    expect(() => assertSanitizedHarContract(har)).toThrow(/do not exactly derive/);
  }

  const widened = createSanitizedHarContract(harSource());
  Object.assign(widened._cleanPay, { unexpected: true });
  expect(() => assertSanitizedHarContract(widened)).toThrow(/malformed/);
});

test("projects exact generated static paths through the HAR envelope", () => {
  const expected = createSanitizedHarContract(journeyHarSource(
    "baseline0chunk.js",
    "1".repeat(40),
  ));
  const actual = createSanitizedHarContract(journeyHarSource(
    "candidate0chunk.js",
    "2".repeat(40),
  ));
  const projected = projectJourneyHarEvidencePairBytes(
    Buffer.from(JSON.stringify(expected)),
    Buffer.from(JSON.stringify(actual)),
  );
  expect(projected.actual.equals(projected.expected)).toBe(true);
});

function harSource(): SanitizedHarSource {
  return {
    source: { imageDigest: "sha256:" + "1".repeat(64) },
    project: "journey-390x844",
    journey: "synthetic",
    navigations: [],
    network: {
      requests: [{
        index: 0,
        method: "POST",
        url: {
          origin: "<app-origin>",
          pathname: "/action",
          query: [{ key: "token", value: "<sha256:0123456789abcdef>" }],
          fragment: null,
        },
        requestHeaders: [{
          name: "authorization",
          value: { bytes: 16, sha256: "2".repeat(64) },
        }],
        postData: { bytes: 32, sha256: "3".repeat(64) },
        response: {
          status: 200,
          statusText: "OK",
          headers: [{ name: "content-type", value: "application/json" }],
        },
        failure: null,
      }],
      serverActionCount: 1,
      serverActions: [{ order: 0, requestIndex: 0 }],
    },
    providerEffects: { entries: [] },
  };
}

function journeyHarSource(chunk: string, revision: string): SanitizedHarSource {
  return {
    source: {
      revision,
      imageDigest: `sha256:${"1".repeat(64)}`,
      imageTag: "clean-pay:test",
      migrationImageDigest: `sha256:${"2".repeat(64)}`,
      migrationImageTag: "clean-pay-migration:test",
      publicBuildContract: { version: "1", sha256: "3".repeat(64) },
      fixtureContract: { version: "journey-v5", sha256: "4".repeat(64) },
      browser: {},
    },
    project: "journey-390x844",
    journey: "public-responsive-keyboard-install-offline-support",
    navigations: [],
    network: {
      requests: [{
        index: 0,
        method: "GET",
        url: {
          origin: "<app-origin>",
          pathname: `/_next/static/chunks/${chunk}`,
          query: [],
          fragment: null,
        },
        scope: "application",
        resourceType: "script",
        navigation: false,
        serverAction: { present: false, identifier: null },
        requestHeaders: [{
          name: "referer",
          value: {
            origin: "<app-origin>",
            pathname: "/install",
            query: [],
            fragment: null,
          },
        }],
        postData: null,
        redirectedFrom: null,
        response: null,
        failure: {
          errorText: {
            bytes: 3,
            sha256: "438ced67d76cf3c3bf3e9781a9640ab685b2c877f7cc93b6758cc641efd51bc6",
          },
        },
        externalTransport: null,
      }],
      serverActionCount: 0,
      serverActions: [],
    },
    providerEffects: { entries: [] },
  };
}
