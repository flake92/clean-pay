import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  assertPublicOverlapProcessFailureEvidence,
  createPublicOverlapInvocationFailureEvidence,
  createPublicOverlapProcessFailureBundle,
  createPublicOverlapProcessFailureEvidence,
  publicOverlapProcessFailureFilename,
} from "./public-overlap-process-evidence.mjs";
import { writeJourneySanitizedOutput } from "./journey-owned-stack-orchestrator.mjs";

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

test("derives exact non-aliasing create-only artifact names for process scope", () => {
  expect(publicOverlapProcessFailureFilename("capture", "baseline"))
    .toBe("public-capture-baseline-failure.json");
  expect(publicOverlapProcessFailureFilename("capture", "candidate"))
    .toBe("public-capture-candidate-failure.json");
  expect(publicOverlapProcessFailureFilename("compare", null))
    .toBe("public-compare-pair-failure.json");
  expect(() => publicOverlapProcessFailureFilename("capture", null))
    .toThrow("filename scope is invalid");
  expect(() => publicOverlapProcessFailureFilename("verify", "baseline"))
    .toThrow("filename scope is invalid");
});

test("drops adversarial traversal and URL-like source locations", () => {
  const adversarialStdout = Buffer.from([
    "at tests/browser/../../private-token.ts:7:1",
    "at https://person.example.invalid/tests/browser/private.ts:8:2",
  ].join("\n"), "utf8");
  const evidence = createPublicOverlapProcessFailureEvidence({
    code: 1,
    mode: "capture",
    role: "baseline",
    signal: null,
    stderr: Buffer.alloc(0),
    stderrBytes: 0,
    stdout: adversarialStdout,
    stdoutBytes: adversarialStdout.byteLength,
    terminationReason: null,
  });

  expect(evidence.sourceLocations).toEqual([]);
  expect(JSON.stringify(evidence)).not.toContain("private-token");
  expect(JSON.stringify(evidence)).not.toContain("person.example.invalid");
});

test("orders and freezes an exact unique post-cleanup failure bundle", () => {
  const candidate = createPublicOverlapProcessFailureEvidence({
    code: 1,
    mode: "capture",
    role: "candidate",
    signal: null,
    stderr,
    stderrBytes: stderr.byteLength,
    stdout,
    stdoutBytes: stdout.byteLength,
    terminationReason: null,
  });
  const baseline = createPublicOverlapProcessFailureEvidence({
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
  const bundle = createPublicOverlapProcessFailureBundle(
    "0123456789abcdef",
    [candidate, baseline],
  );

  expect(bundle).toMatchObject({
    schemaVersion: 1,
    status: "public_overlap_playwright_process_failures",
    captureId: "0123456789abcdef",
  });
  expect(bundle.failures.map(({ role }) => role)).toEqual(["baseline", "candidate"]);
  expect(Object.isFrozen(bundle)).toBe(true);
  expect(Object.isFrozen(bundle.failures)).toBe(true);
  expect(() => createPublicOverlapProcessFailureBundle(
    "0123456789abcdef",
    [baseline, baseline],
  )).toThrow("scope is not unique");
});

test("projects pre-spawn failures to a bounded code and repository source location", () => {
  const error = Object.assign(new TypeError(privateMarker), { code: "ERR_INVALID_ARG_TYPE" });
  error.stack = [
    `TypeError: ${privateMarker}`,
    "    at file:///home/runner/work/clean-pay/clean-pay/tests/browser/journeys/prove-public-characterization-overlap.mjs:232:23",
  ].join("\n");
  const evidence = createPublicOverlapInvocationFailureEvidence({
    error,
    mode: "capture",
    role: "candidate",
    stage: "process-construction",
  });

  expect(evidence).toEqual({
    schemaVersion: 1,
    status: "public_overlap_playwright_invocation_failed",
    mode: "capture",
    role: "candidate",
    stage: "process-construction",
    errorClass: "TypeError",
    errorCode: "ERR_INVALID_ARG_TYPE",
    messageSha256: sha256(Buffer.from(privateMarker)),
    sourceLocations: [{
      file: "tests/browser/journeys/prove-public-characterization-overlap.mjs",
      line: 232,
      column: 23,
    }],
  });
  expect(JSON.stringify(evidence)).not.toContain(privateMarker);
});

test("seals concurrent role failures as exactly two schema-valid private-free files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clean-pay-public-overlap-process-"));
  const entries = (["baseline", "candidate"] as const).map((role) => {
    const evidence = createPublicOverlapProcessFailureEvidence({
      code: 1,
      mode: "capture",
      role,
      signal: null,
      stderr,
      stderrBytes: stderr.byteLength,
      stdout,
      stdoutBytes: stdout.byteLength,
      terminationReason: null,
    });
    const filename = publicOverlapProcessFailureFilename("capture", role);
    return { evidence, filename, bytes: Buffer.from(`${JSON.stringify(evidence)}\n`, "utf8") };
  });
  try {
    await Promise.all(entries.map(({ bytes, filename }) => (
      writeJourneySanitizedOutput(path.join(root, filename), bytes)
    )));
    expect((await readdir(root)).sort()).toEqual(entries.map(({ filename }) => filename).sort());
    for (const { filename } of entries) {
      const bytes = await readFile(path.join(root, filename));
      expect(bytes.toString("utf8")).not.toContain(privateMarker);
      expect(assertPublicOverlapProcessFailureEvidence(JSON.parse(bytes.toString("utf8"))))
        .toMatchObject({ mode: "capture", status: "public_overlap_playwright_process_failed" });
    }
    const sealedBefore = await readFile(path.join(root, entries[0].filename));
    await expect(writeJourneySanitizedOutput(
      path.join(root, entries[0].filename),
      entries[0].bytes,
    )).rejects.toMatchObject({ code: "EEXIST" });
    const sealedAfter = await readFile(path.join(root, entries[0].filename));
    expect(sha256(sealedAfter)).toBe(sha256(sealedBefore));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
