import { createHash } from "node:crypto";
import { types } from "node:util";

import { validateProviderOverlapSemanticLedger } from "./provider-overlap-browser-contract.mjs";

const maximumEntries = 256;
const maximumMismatches = 8;
const maximumDiagnosticBytes = 16 * 1024;
const semanticFields = Object.freeze([
  "disposition", "key", "redirectEdge", "responseContentType", "responseFailureSha256",
  "responseStatus",
]);
const staticClasses = new Set([
  "next-static-css", "next-static-font", "next-static-image", "next-static-js",
]);
const identity = Object.freeze({
  schemaVersion: 1,
  kind: "provider-overlap-request-contract-comparison-diagnostic",
});

// This observes a failed exact comparison. It never changes its result or error.
export function withProviderOverlapComparisonDiagnostic({
  compare,
  baselineNavigation,
  candidateNavigation,
  retainDiagnostic,
}) {
  try {
    return compare();
  } catch (error) {
    try {
      retainDiagnostic(createProviderOverlapComparisonDiagnostic(
        baselineNavigation,
        candidateNavigation,
      ));
    } catch {
      // Diagnostic publication must not replace the primary oracle failure.
    }
    throw error;
  }
}

export function createProviderOverlapComparisonDiagnostic(baselineNavigation, candidateNavigation) {
  try {
    const baseline = normalizedSnapshot(baselineNavigation);
    const candidate = normalizedSnapshot(candidateNavigation);
    const firstMismatches = [];
    let mismatchCount = 0;
    for (let index = 0; index < Math.max(baseline.ledger.length, candidate.ledger.length); index += 1) {
      const left = baseline.ledger[index] ?? null;
      const right = candidate.ledger[index] ?? null;
      if (JSON.stringify(left) === JSON.stringify(right)) continue;
      mismatchCount += 1;
      if (firstMismatches.length < maximumMismatches) {
        firstMismatches.push(Object.freeze({ index, baseline: left, candidate: right }));
      }
    }
    const diagnostic = Object.freeze({
      ...identity,
      status: baseline.summary.requestContractSha256 === candidate.summary.requestContractSha256
        ? "equal" : "different",
      baseline: baseline.summary,
      candidate: candidate.summary,
      mismatchCount,
      firstMismatches: Object.freeze(firstMismatches),
      mismatchesTruncated: mismatchCount > firstMismatches.length,
    });
    if (Buffer.byteLength(JSON.stringify(diagnostic), "utf8") > maximumDiagnosticBytes) {
      throw new Error("Diagnostic byte bound exceeded.");
    }
    return diagnostic;
  } catch {
    return Object.freeze({
      ...identity,
      status: "unavailable",
      reason: "input-outside-normalized-contract",
    });
  }
}

function normalizedSnapshot(navigation) {
  const digest = dataProperty(navigation, "requestContractSha256");
  if (typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Invalid request contract digest.");
  }
  const semanticEntries = boundedArray(dataProperty(navigation, "semanticRequestLedger"));
  const projected = semanticEntries.map((entry) => {
    requireDataRecord(entry);
    if (Object.getOwnPropertySymbols(entry).length !== 0
      || JSON.stringify(Object.getOwnPropertyNames(entry).sort())
        !== JSON.stringify([...semanticFields].sort())) {
      throw new Error("Unexpected semantic fields.");
    }
    return Object.fromEntries(semanticFields.map((field) => [field, dataProperty(entry, field)]));
  });
  // Reuse the oracle's allowlist on safe data copies; never serialize raw input.
  const ledger = validateProviderOverlapSemanticLedger(projected);
  const classes = [...new Set(boundedArray(dataProperty(navigation, "staticRequestLedger"))
    .map((entry) => {
      const value = dataProperty(entry, "class");
      if (!staticClasses.has(value)) throw new Error("Unexpected static class.");
      return value;
    }))].sort();
  const summaryDigest = sha256(JSON.stringify({ version: 1, semanticLedger: ledger, staticClasses: classes }));
  if (digest !== summaryDigest) throw new Error("Unbound request contract digest.");
  const counts = new Map();
  for (const { key } of ledger) counts.set(key, (counts.get(key) ?? 0) + 1);
  return {
    ledger,
    summary: Object.freeze({
      requestContractSha256: digest,
      semanticLedgerSha256: sha256(JSON.stringify(ledger)),
      semanticEntryCount: ledger.length,
      staticClasses: Object.freeze(classes),
      keyCounts: Object.freeze([...counts].sort(([left], [right]) => left.localeCompare(right))
        .map(([key, count]) => Object.freeze({ key, count }))),
    }),
  };
}

function boundedArray(value) {
  if (!value || types.isProxy(value) || !Array.isArray(value)) {
    throw new Error("Invalid diagnostic array.");
  }
  const length = dataProperty(value, "length");
  if (!Number.isSafeInteger(length) || length < 1 || length > maximumEntries) {
    throw new Error("Diagnostic array bound exceeded.");
  }
  return Array.from({ length }, (_, index) => dataProperty(value, String(index)));
}

function requireDataRecord(value) {
  if (!value || typeof value !== "object" || types.isProxy(value)) {
    throw new Error("Invalid diagnostic record.");
  }
}

function dataProperty(value, key) {
  requireDataRecord(value);
  const property = Object.getOwnPropertyDescriptor(value, key);
  if (!property || !Object.hasOwn(property, "value")) {
    throw new Error("Diagnostic input must contain own data properties.");
  }
  return property.value;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
