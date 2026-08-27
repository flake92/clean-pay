import { expect, test } from "@playwright/test";

import {
  assertSanitizedHarContract,
  createSanitizedHarContract,
  type SanitizedHarSource,
} from "./sanitized-har";

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
