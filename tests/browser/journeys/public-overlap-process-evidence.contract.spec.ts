import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createPublicOverlapProcessFailureEvidence } from "./public-overlap-process-evidence.mjs";

const privateMarker = "person@example.invalid bearer-private-marker";
const stdout = Buffer.from([
  privateMarker,
  "Error: page.goto: net::ERR_CONNECTION_REFUSED",
  "    at tests/browser/public-overlap-capture.ts:150:36",
  "2 failed",
].join("\n"));
const stderr = Buffer.from("TimeoutError: operation timed out\n");

test("projects only bounded sanitized Playwright failure evidence", () => {
  const evidence = createPublicOverlapProcessFailureEvidence({
    code: 1,
    mode: "capture",
    role: "baseline",
    signal: null,
    stderr,
    stderrBytes: stderr.byteLength,
    stdout,
    stdoutBytes: stdout.byteLength,
    terminationReason: null,
  });

  expect(evidence).toEqual({
    schemaVersion: 1,
    status: "public_overlap_playwright_process_failed",
    mode: "capture",
    role: "baseline",
    terminationReason: null,
    exitCode: 1,
    signal: null,
    stdoutBytes: stdout.byteLength,
    stderrBytes: stderr.byteLength,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    classifications: ["connection-refused", "playwright-timeout"],
    sourceLocations: [{
      file: "tests/browser/public-overlap-capture.ts",
      line: 150,
      column: 36,
    }],
    testSummary: { failed: 2, passed: null, skipped: null },
  });
  expect(JSON.stringify(evidence)).not.toContain(privateMarker);
  expect(Object.isFrozen(evidence)).toBe(true);
  expect(Object.isFrozen(evidence.classifications)).toBe(true);
  expect(Object.isFrozen(evidence.sourceLocations)).toBe(true);
  expect(Object.isFrozen(evidence.testSummary)).toBe(true);
});

test("rejects extra fields, invalid scope and dishonest byte counts", () => {
  const valid = {
    code: 1,
    mode: "capture",
    role: "candidate",
    signal: null,
    stderr,
    stderrBytes: stderr.byteLength,
    stdout,
    stdoutBytes: stdout.byteLength,
    terminationReason: null,
  };

  expect(() => createPublicOverlapProcessFailureEvidence({ ...valid, extra: true }))
    .toThrow("fields are invalid");
  expect(() => createPublicOverlapProcessFailureEvidence({ ...valid, role: "other" }))
    .toThrow("scope is invalid");
  expect(() => createPublicOverlapProcessFailureEvidence({
    ...valid,
    stdoutBytes: stdout.byteLength - 1,
  })).toThrow("stdout byte count is invalid");
});

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
