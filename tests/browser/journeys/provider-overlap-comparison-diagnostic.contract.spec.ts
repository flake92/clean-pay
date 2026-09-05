import { createHash } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { createJourneySanitizedErrorEvidence } from "./journey-error-evidence.mjs";
import { JOURNEY_FIXTURE_FILENAMES } from "./journey-fixture-manifest.mjs";
import { writeJourneySanitizedOutput } from "./journey-owned-stack-orchestrator.mjs";
import {
  createProviderOverlapComparisonDiagnostic,
  withProviderOverlapComparisonDiagnostic,
} from "./provider-overlap-comparison-diagnostic.mjs";

type SemanticEntry = {
  disposition: "abort" | "continue";
  key: string;
  redirectEdge: string | null;
  responseContentType: string | null;
  responseFailureSha256: string | null;
  responseStatus: number | null;
};

test("binds the failure diagnostic and its regression contract into the journey fixture", () => {
  const required = [
    "provider-overlap-comparison-diagnostic.contract.spec.ts",
    "provider-overlap-comparison-diagnostic.mjs",
  ];
  expect(JOURNEY_FIXTURE_FILENAMES.filter((filename) => required.includes(filename))).toEqual(required);
});

test("distinguishes order differences from changed semantic counts without changing either ledger", () => {
  const baseline = navigation();
  const reordered = [...baseline.semanticRequestLedger];
  [reordered[1], reordered[2]] = [reordered[2], reordered[1]];
  const candidate = navigation(reordered);
  const before = JSON.stringify({ baseline, candidate });
  const diagnostic = comparisonDiagnostic(baseline, candidate);
  expect(diagnostic).toMatchObject({ status: "different", mismatchCount: 2, mismatchesTruncated: false });
  expect(diagnostic.baseline.keyCounts).toEqual(diagnostic.candidate.keyCounts);
  expect(diagnostic.firstMismatches).toEqual([
    { index: 1, baseline: baseline.semanticRequestLedger[1], candidate: reordered[1] },
    { index: 2, baseline: baseline.semanticRequestLedger[2], candidate: reordered[2] },
  ]);
  expect(JSON.stringify({ baseline, candidate })).toBe(before);
});

test("retains an added request and an allowed response metadata difference", () => {
  const baseline = navigation();
  const changed = structuredClone(baseline.semanticRequestLedger);
  changed[1].responseContentType = "text/javascript";
  changed.push(semantic("turnstile-widget-script"));
  const diagnostic = createProviderOverlapComparisonDiagnostic(baseline, navigation(changed));
  expect(diagnostic).toMatchObject({
    status: "different",
    baseline: { semanticEntryCount: 9 },
    candidate: { semanticEntryCount: 10 },
    mismatchCount: 2,
    firstMismatches: [
      { index: 1, candidate: { responseContentType: "text/javascript" } },
      { index: 9, baseline: null, candidate: { key: "turnstile-widget-script" } },
    ],
  });
});

test("reconstructs the real normalized property order and separates static-class differences", () => {
  const baseline = navigation();
  const candidate = navigation(baseline.semanticRequestLedger, [
    "next-static-font", "next-static-css", "next-static-image", "next-static-js",
  ]);
  candidate.semanticRequestLedger = candidate.semanticRequestLedger.map((entry) => (
    Object.fromEntries(Object.entries(entry).reverse()) as SemanticEntry
  ));
  const diagnostic = comparisonDiagnostic(baseline, candidate);
  expect(diagnostic).toMatchObject({ status: "different", mismatchCount: 0, firstMismatches: [] });
  expect(diagnostic.baseline.semanticLedgerSha256).toBe(diagnostic.candidate.semanticLedgerSha256);
  expect(diagnostic.candidate.staticClasses).toContain("next-static-image");
  expect(createProviderOverlapComparisonDiagnostic(baseline, structuredClone(baseline)))
    .toMatchObject({ status: "equal", mismatchCount: 0 });
});

test("bounds the normalized ledgers, mismatch samples and serialized bytes", () => {
  const baseline = navigation([
    ...navigation().semanticRequestLedger,
    ...Array.from({ length: 247 }, () => semantic("turnstile-widget-script")),
  ]);
  const candidate = navigation([
    ...navigation().semanticRequestLedger,
    ...Array.from({ length: 247 }, () => semantic("app-cabinet-prefetch-blocked")),
  ]);
  const diagnostic = comparisonDiagnostic(baseline, candidate);
  expect(diagnostic).toMatchObject({ status: "different", mismatchCount: 247, mismatchesTruncated: true });
  expect(diagnostic.firstMismatches).toHaveLength(8);
  expect(Buffer.byteLength(JSON.stringify(diagnostic))).toBeLessThanOrEqual(16 * 1024);
  candidate.semanticRequestLedger.push(semantic("turnstile-widget-script"));
  expect(createProviderOverlapComparisonDiagnostic(baseline, candidate)).toEqual(unavailable());
});

test("rejects unbound, unsafe and accessor-backed input without emitting or reading it", () => {
  const privateMarker = "synthetic-private-url-header-body-must-not-escape";
  let reads = 0;
  const baseline = navigation();
  const extraField = navigation();
  Object.assign(extraField.semanticRequestLedger[0], { headers: privateMarker });
  const invalidKey = navigation();
  invalidKey.semanticRequestLedger[0].key = `https://example.invalid/${privateMarker}`;
  const getter = navigation();
  Object.defineProperty(getter.semanticRequestLedger[0], "key", {
    get: () => { reads += 1; return privateMarker; },
  });
  const arrayGetter = navigation();
  Object.defineProperty(arrayGetter.semanticRequestLedger, "0", {
    get: () => { reads += 1; return baseline.semanticRequestLedger[0]; },
  });
  const proxy = new Proxy(navigation(), { get: () => { reads += 1; return privateMarker; } });
  const unbound = { ...navigation(), requestContractSha256: "0".repeat(64) };
  for (const input of [extraField, invalidKey, getter, arrayGetter, proxy, unbound]) {
    const diagnostic = createProviderOverlapComparisonDiagnostic(baseline, input);
    expect(diagnostic).toEqual(unavailable());
    expect(JSON.stringify(diagnostic)).not.toContain(privateMarker);
  }
  expect(reads).toBe(0);
});

test("preserves the exact primary comparison result and error even if diagnostic retention fails", () => {
  const expected = Object.freeze({ status: "unchanged-proof-result" });
  let calls = 0;
  let retained = 0;
  const options = {
    baselineNavigation: navigation(),
    candidateNavigation: navigation(),
    retainDiagnostic: () => { retained += 1; throw new Error("diagnostic retention failure"); },
  };
  expect(withProviderOverlapComparisonDiagnostic({ ...options, compare: () => { calls += 1; return expected; } }))
    .toBe(expected);
  expect(retained).toBe(0);
  const primary = new Error("browser request contract binding does not match its exact contract.");
  let caught;
  try {
    withProviderOverlapComparisonDiagnostic({ ...options, compare: () => { calls += 1; throw primary; } });
  } catch (error) { caught = error; }
  expect(caught).toBe(primary);
  expect(calls).toBe(2);
  expect(retained).toBe(1);
});

test("persists the mismatch with the original failed oracle through the existing create-only writer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "clean-pay-provider-comparison-"));
  const target = path.join(root, "provider-overlap-failure.json");
  const baseline = navigation();
  const candidate = navigation([...baseline.semanticRequestLedger, semantic("turnstile-widget-script")]);
  const primary = new Error("browser request contract binding does not match its exact contract.");
  let requestContractComparison;
  let failure;
  try {
    try {
      withProviderOverlapComparisonDiagnostic({
        compare: () => { throw primary; },
        baselineNavigation: baseline,
        candidateNavigation: candidate,
        retainDiagnostic: (diagnostic: unknown) => { requestContractComparison = diagnostic; },
      });
    } catch (error) { failure = error; }
    expect(failure).toBe(primary);
    const bytes = Buffer.from(`${JSON.stringify({
      status: "dual_image_provider_overlap_failed",
      requestContractComparison,
      ...createJourneySanitizedErrorEvidence(failure),
    })}\n`, "utf8");
    const receipt = await writeJourneySanitizedOutput(target, bytes);
    expect(receipt.sha256).toBe(sha256(bytes));
    expect(await readFile(target)).toEqual(bytes);
    expect(JSON.parse(bytes.toString("utf8"))).toMatchObject({
      status: "dual_image_provider_overlap_failed",
      messageSha256: "b1164c18ba461f274cbb6b5c58e714b2c9e47915a221d111d52c0c193671b9b8",
      requestContractComparison: { status: "different", mismatchCount: 1 },
    });
    await expect(writeJourneySanitizedOutput(target, bytes)).rejects.toThrow();
    expect(await readFile(target)).toEqual(bytes);
  } finally {
    await unlink(target).catch((error) => { if (error.code !== "ENOENT") throw error; });
    await rmdir(root);
  }
});

function comparisonDiagnostic(...inputs: Parameters<typeof createProviderOverlapComparisonDiagnostic>) {
  const diagnostic = createProviderOverlapComparisonDiagnostic(...inputs);
  if (diagnostic.status === "unavailable") throw new Error("Expected a bound normalized comparison.");
  return diagnostic;
}

function unavailable() {
  return {
    schemaVersion: 1,
    kind: "provider-overlap-request-contract-comparison-diagnostic",
    status: "unavailable",
    reason: "input-outside-normalized-contract",
  };
}

function navigation(ledger = [
  semantic("app-login-document"),
  semantic("turnstile-widget-script"),
  semantic("chatwoot-sdk-script"),
  semantic("chatwoot-widget-frame"),
  semantic("app-telegram-start"),
  semantic("telegram-oidc-authorize"),
  semantic("app-telegram-callback"),
  semantic("app-profile-document"),
  semantic("app-cabinet-document"),
], classes = ["next-static-css", "next-static-font", "next-static-js"]) {
  return {
    requestContractSha256: sha256(JSON.stringify({
      version: 1,
      semanticLedger: ledger,
      staticClasses: [...new Set(classes)].sort(),
    })),
    semanticRequestLedger: structuredClone(ledger),
    staticRequestLedger: classes.map((value) => ({ class: value })),
  };
}

function semantic(key: string): SemanticEntry {
  const redirects: Record<string, string> = {
    "telegram-oidc-authorize": "app-telegram-start:307->telegram-oidc-authorize",
    "app-telegram-callback": "telegram-oidc-authorize:302->app-telegram-callback",
    "app-profile-document": "app-telegram-callback:307->app-profile-document",
  };
  const blocked = key === "app-cabinet-prefetch-blocked";
  const appRedirect = key === "app-telegram-start" || key === "app-telegram-callback";
  return {
    disposition: blocked ? "abort" : "continue",
    key,
    redirectEdge: redirects[key] ?? null,
    responseContentType: blocked || key === "telegram-oidc-authorize" ? null
      : appRedirect ? "application/octet-stream"
        : key.endsWith("-script") ? "application/javascript" : "text/html",
    responseFailureSha256: null,
    responseStatus: blocked ? null : key === "telegram-oidc-authorize" ? 302 : appRedirect ? 307 : 200,
  };
}

function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
