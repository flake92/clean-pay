import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";
import { captureProviderOverlapResponseEvidence } from "./provider-overlap-browser-contract.mjs";
import { createProviderOverlapProfileActionDiagnostic } from "./provider-overlap-profile-action-diagnostic.mjs";

const abortSha256 = createHash("sha256").update("net::ERR_ABORTED").digest("hex");

test("binds the profile-action observer and contract into the journey fixture", () => {
  const names = [
    "provider-overlap-profile-action-diagnostic.contract.spec.ts",
    "provider-overlap-profile-action-diagnostic.mjs",
  ];
  expect(JOURNEY_FIXTURE_FILENAMES.filter((name) => names.includes(name))).toEqual(names);
});

test("distinguishes an abort before profile quiet from a late action canceled after goto", () => {
  const observer = createProviderOverlapProfileActionDiagnostic();
  const early = {};
  const late = {};
  observer.setPhase("wait-profile-chatwoot-identity");
  observer.request(early);
  observer.response(early);
  observer.terminal(early, false, abortSha256);
  observer.setPhase("inspect-profile-frame");
  observer.checkpoint("profile-quiet-completed");
  observer.setPhase("arm-provider-overlap");
  observer.request(late);
  observer.response(late);
  observer.setPhase("navigate-cabinet");
  observer.checkpoint("cabinet-goto-called");
  observer.terminal(late, false, abortSha256);
  const result = observer.snapshot();
  expect(result.status).toBe("recorded");
  expect(result.entries).toEqual([
    {
      occurrence: 1,
      request: { sequence: 1, phase: "wait-profile-chatwoot-identity" },
      response: { sequence: 2, phase: "wait-profile-chatwoot-identity" },
      terminal: { sequence: 3, phase: "wait-profile-chatwoot-identity", finished: false, failureSha256: abortSha256 },
    },
    {
      occurrence: 2,
      request: { sequence: 5, phase: "arm-provider-overlap" },
      response: { sequence: 6, phase: "arm-provider-overlap" },
      terminal: { sequence: 8, phase: "navigate-cabinet", finished: false, failureSha256: abortSha256 },
    },
  ]);
  expect(result.checkpoints.map(({ sequence }) => sequence)).toEqual([4, 7]);
  expect(result.cdpCanceled).toBe("unavailable-without-request-identity-binding");
});

test("binds concurrent same-class occurrences by object identity across reversed completions", () => {
  const observer = createProviderOverlapProfileActionDiagnostic();
  const requests = [{}, {}, {}];
  observer.setPhase("wait-profile-heading");
  requests.forEach(observer.request);
  for (const request of [...requests].reverse()) {
    observer.response(request);
    observer.terminal(request, true, null);
  }
  const result = observer.snapshot();
  expect(result.status).toBe("recorded");
  expect(result.entries.map(({ occurrence, response, terminal }) => [
    occurrence, response?.sequence, terminal?.sequence,
  ])).toEqual([[1, 8, 9], [2, 6, 7], [3, 4, 5]]);
  const snapshot = JSON.stringify(result);
  observer.setPhase("inspect-profile-frame");
  observer.checkpoint("profile-quiet-completed");
  expect(JSON.stringify(result)).toBe(snapshot);
  expect(Object.isFrozen(result.entries[0].terminal)).toBe(true);
});

test("bounds identities and output bytes without reading request properties or serialization hooks", () => {
  const observer = createProviderOverlapProfileActionDiagnostic();
  let reads = 0;
  const privateMarker = "synthetic-private-body-cookie-url";
  observer.setPhase("drain-profile-requests");
  for (let index = 0; index < 1000; index += 1) {
    const request = Object.defineProperties({}, {
      url: { get: () => { reads += 1; return privateMarker; } },
      toJSON: { get: () => { reads += 1; throw new Error(privateMarker); } },
    });
    observer.request(request);
    observer.response(request);
    observer.terminal(request, false, abortSha256);
  }
  const result = observer.snapshot();
  expect(result).toMatchObject({ status: "recorded", maximumOccurrences: 8, truncated: true });
  expect(result.entries).toHaveLength(8);
  const bytes = JSON.stringify(result);
  expect(Buffer.byteLength(bytes)).toBeLessThan(8192);
  expect(bytes).not.toContain(privateMarker);
  expect(reads).toBe(0);
});

test("invalid observations cannot throw, leak inputs, or replace an existing primary error", () => {
  let reads = 0;
  const privateMarker = "synthetic-private-header-value";
  const proxy = new Proxy({}, { get: () => { reads += 1; throw new Error(privateMarker); } });
  const operations = [
    (observer: ReturnType<typeof createProviderOverlapProfileActionDiagnostic>) => observer.setPhase(privateMarker),
    (observer: ReturnType<typeof createProviderOverlapProfileActionDiagnostic>) => observer.request(proxy),
    (observer: ReturnType<typeof createProviderOverlapProfileActionDiagnostic>) => observer.response({}),
    (observer: ReturnType<typeof createProviderOverlapProfileActionDiagnostic>) => observer.checkpoint("cabinet-goto-called"),
    (observer: ReturnType<typeof createProviderOverlapProfileActionDiagnostic>) => {
      const request = {};
      observer.request(request);
      observer.terminal(request, false, privateMarker);
    },
  ];
  for (const operation of operations) {
    const observer = createProviderOverlapProfileActionDiagnostic();
    observer.setPhase("wait-profile-heading");
    const primary = new Error("unchanged acceptance failure");
    let caught;
    try {
      try { throw primary; } finally { operation(observer); }
    } catch (error) { caught = error; }
    expect(caught).toBe(primary);
    expect(observer.snapshot().status).toBe("invalid-observation");
    expect(JSON.stringify(observer.snapshot())).not.toContain(privateMarker);
  }
  expect(reads).toBe(0);
});

test("flags duplicate or inconsistent terminal events instead of overwriting earlier evidence", () => {
  for (const operation of ["duplicate-request", "duplicate-response", "duplicate-terminal", "false-success"]) {
    const observer = createProviderOverlapProfileActionDiagnostic();
    const request = {};
    observer.setPhase("wait-profile-heading");
    observer.request(request);
    observer.response(request);
    if (operation === "duplicate-request") observer.request(request);
    if (operation === "duplicate-response") observer.response(request);
    if (operation === "duplicate-terminal") {
      observer.terminal(request, false, abortSha256);
      observer.terminal(request, true, null);
    }
    if (operation === "false-success") observer.terminal(request, true, abortSha256);
    expect(observer.snapshot().status).toBe("invalid-observation");
    if (operation === "duplicate-terminal") {
      expect(observer.snapshot().entries[0].terminal).toMatchObject({ finished: false, failureSha256: abortSha256 });
    }
  }
});

test("records a headerless failure without inventing a response or changing its hash", () => {
  const observer = createProviderOverlapProfileActionDiagnostic();
  const request = {};
  observer.setPhase("arm-provider-overlap");
  observer.request(request);
  observer.setPhase("navigate-cabinet");
  observer.terminal(request, false, abortSha256);
  expect(observer.snapshot()).toMatchObject({
    status: "recorded",
    entries: [{ response: null, terminal: { finished: false, failureSha256: abortSha256, phase: "navigate-cabinet" } }],
  });
});

test("observing an abort preserves the real response evidence and rejection of other failures", async () => {
  const request = {};
  const observer = createProviderOverlapProfileActionDiagnostic();
  observer.setPhase("wait-profile-heading");
  observer.request(request);
  observer.response(request);
  const classification = {
    disposition: "continue", expectedStatuses: [200], key: "app-profile-action",
    navigation: false, staticAssetSha256: null, staticPath: null,
  };
  const response = {
    request: () => request, status: () => 200,
    headers: () => ({ "content-type": "text/x-component" }),
    body: async () => { throw new Error("unavailable body"); },
    finished: async () => { throw new Error("must use actual terminal gate"); },
  };
  const terminal = Object.freeze({ finished: false, failureSha256: abortSha256 });
  observer.terminal(request, terminal.finished, terminal.failureSha256);
  await expect(captureProviderOverlapResponseEvidence({
    classification, request, response, terminal: Promise.resolve(terminal),
  })).resolves.toMatchObject({ body: null, responseStatus: 200, responseFailureSha256: abortSha256 });
  expect(observer.snapshot().entries[0].terminal).toMatchObject(terminal);
  await expect(captureProviderOverlapResponseEvidence({
    classification, request, response,
    terminal: Promise.resolve({ finished: false, failureSha256: createHash("sha256").update("net::ERR_FAILED").digest("hex") }),
  })).rejects.toThrow("Browser response did not finish cleanly");
});

test("publishes phase evidence only after observation and marks quiet and goto at their actual boundaries", async () => {
  const source = await readFile(path.resolve("tests/browser/journeys/prove-provider-overlap.mjs"), "utf8");
  expect(source).toContain('...(profileActionLifecycle === undefined ? {} : { profileActionLifecycle })');
  expect(source).toContain('if (classification.key === "app-profile-action")');
  expect(source).toMatch(/await waitForResponseCaptureQuiet\(\);\s+markProviderFailurePhase\(role, "inspect-profile-frame"\);\s+providerProfileActionDiagnosticState\[role\]\.checkpoint\("profile-quiet-completed"\)/);
  expect(source).toMatch(/checkpoint\("cabinet-goto-called"\);\s+cabinetResponse = await page.goto/);
  expect(source).toContain("terminal.release(terminalResult)");
  expect(source).toContain('if (!terminal && entry.classification.key === "app-profile-action")');
});
