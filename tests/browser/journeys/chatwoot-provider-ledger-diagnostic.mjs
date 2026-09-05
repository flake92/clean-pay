import { createHash } from "node:crypto";
import { types } from "node:util";

const ledgerAnnotation = Symbol.for("clean-pay.chatwoot-provider-ledger-diagnostic.v1");
const captureAnnotation = Symbol.for("clean-pay.chatwoot-provider-capture-diagnostic.v1");
const normalizedAnnotation = Symbol.for("clean-pay.chatwoot-provider-normalized-diagnostic.v1");
const maximumEntries = 256;
const maximumSequenceEntries = 64;
const maximumSamples = 8;
const maximumBytes = 16 * 1024;
const classes = new Set([
  "contact_identity_probed", "challenge_verified", "authorization_code_issued",
  "token_exchanged", "jwks_read", "auth_session_issued", "read_profile",
  "read_referral_program", "read_subscription", "read_offers", "read_devices",
  "read_notification_preferences", "read_user_by_uuid",
]);
const phases = new Set(["gap", "stable", "recreated"]);
const checkpoints = new Set([
  "contract-validation", "before-snapshot-wait", "first-snapshot-read", "second-snapshot-read",
  "final-stopped-reread", "final-sealed-reread",
]);
const captureStages = new Set([
  "browser-context", "initial-setup", "initial-profile-login", "initial-cabinet-navigation",
  "gap-barrier", "gap-snapshot", "stable-transition", "stable-snapshot", "logout-clear",
  "recreated-login", "recreated-snapshot", "final-reread",
]);
// Symbols survive the pinned TS loader -> ESM CLI boundary without shared WeakMap state.
// Both decorators return the exact original Error, even if diagnostics cannot be retained.
export function withChatwootProviderLedgerDiagnostic(error, options) {
  try {
    annotate(error, ledgerAnnotation, createChatwootProviderLedgerDiagnostic(options));
  } catch { /* Preserve the primary oracle failure. */ }
  return error;
}

export function withChatwootProviderCaptureDiagnostic(error, options) {
  try {
    const cause = requiredData(options, "cause");
    const role = requiredData(options, "role");
    const pairIndex = requiredData(options, "pairIndex");
    const captureStage = requiredData(options, "captureStage");
    const diagnostic = optionalData(cause, ledgerAnnotation);
    if (diagnostic === undefined) return error;
    if (!new Set(["baseline", "candidate"]).has(role)
      || !Number.isInteger(pairIndex) || pairIndex < 1 || pairIndex > 3
      || !captureStages.has(captureStage)) return error;
    annotate(error, captureAnnotation, Object.freeze({
      role, pairIndex, captureStage, diagnostic: safeDiagnosticCopy(diagnostic),
    }));
  } catch { /* Preserve the existing capture-stage wrapper and its cause. */ }
  return error;
}

export function createChatwootProviderLedgerDiagnostic(options) {
  try { return renderDiagnostic(normalizeOptions(options)); }
  catch { return renderDiagnostic({ status: "unavailable" }); }
}

function normalizeOptions(options) {
    const value = requiredData(options, "value");
    const phase = requiredData(options, "phase");
    const checkpoint = requiredData(options, "checkpoint");
    const expectedEffects = requiredData(options, "expectedEffects");
    const endpointContracts = requiredData(options, "endpointContracts");
    if (!phases.has(phase) || !checkpoints.has(checkpoint)) throw new Error("Invalid diagnostic stage.");
    const expected = safeArray(expectedEffects, 28).map((entry) => {
      if (!classes.has(entry)) throw new Error("Invalid expected class.");
      return entry;
    });
    const expectedEntryCount = phase === "recreated" ? 28 : 15;
    if (expected.length !== expectedEntryCount) throw new Error("Invalid expected count.");
    const endpoints = safeArray(endpointContracts, 32).map((endpoint) => {
      const result = Object.fromEntries(["service", "method", "pathname", "effect"]
        .map((field) => [field, requiredData(endpoint, field)]));
      if (!classes.has(result.effect) || !["GET", "POST"].includes(result.method)
        || typeof result.service !== "string" || result.service.length > 32
        || typeof result.pathname !== "string" || result.pathname.length > 128) {
        throw new Error("Invalid endpoint projection contract.");
      }
      return result;
    });
    const entries = requiredData(value, "entries");
    if (types.isProxy(entries)) throw new Error("Proxy ledger is outside the safe projection.");
    const entriesAreArray = Array.isArray(entries);
    const actualEntryCount = entriesAreArray ? arrayLength(entries) : null;
    const actual = [];
    for (let index = 0; index < Math.min(actualEntryCount ?? 0, maximumEntries); index += 1) {
      const entry = requiredData(entries, String(index));
      const tuple = Object.fromEntries(["service", "method", "pathname", "effect"]
        .map((field) => [field, requiredData(entry, field)]));
      if (Object.values(tuple).some((part) => typeof part !== "string" || part.length > 256)) {
        throw new Error("Endpoint tuple is outside its bounded data contract.");
      }
      const endpoint = endpoints.find((allowed) => ["service", "method", "pathname", "effect"]
        .every((field) => allowed[field] === tuple[field]));
      actual.push(endpoint?.effect ?? "unknown-endpoint");
    }
    return { status: "observed", phase, checkpoint, expected, actual, actualEntryCount, entriesAreArray };
}

function renderDiagnostic(input) {
  const normalized = readNormalized(input);
  let result;
  if (normalized.status === "unavailable") {
    result = {
      schemaVersion: 1, kind: "chatwoot-provider-ledger-mismatch-diagnostic",
      status: "unavailable", reason: "input-outside-safe-projection",
    };
  } else {
    const { expected, actual, phase, checkpoint, actualEntryCount, entriesAreArray } = normalized;
    const firstMismatches = [];
    let positionalMismatchCount = 0;
    for (let index = 0; index < Math.max(expected.length, actual.length); index += 1) {
      const left = expected[index] ?? null;
      const right = actual[index] ?? null;
      if (left === right) continue;
      positionalMismatchCount += 1;
      if (firstMismatches.length < maximumSamples) {
        firstMismatches.push(Object.freeze({ index, expected: left, actual: right }));
      }
    }
    result = {
      schemaVersion: 1,
      kind: "chatwoot-provider-ledger-mismatch-diagnostic",
      status: "observed", phase, checkpoint, expectedEntryCount: expected.length, actualEntryCount, entriesAreArray,
      scannedEntryCount: actual.length,
      scanTruncated: (actualEntryCount ?? 0) > maximumEntries,
      actualSequence: Object.freeze(actual.slice(0, maximumSequenceEntries)),
      actualSequenceTruncated: (actualEntryCount ?? 0) > maximumSequenceEntries,
      unknownEndpointCount: actual.filter((entry) => entry === "unknown-endpoint").length,
      classCounts: Object.freeze([...classes].sort().map((name) => {
        const expectedCount = expected.filter((entry) => entry === name).length;
        const actualCount = actual.filter((entry) => entry === name).length;
        return Object.freeze({
          class: name, expected: expectedCount, actual: actualCount,
          missing: Math.max(expectedCount - actualCount, 0), excess: Math.max(actualCount - expectedCount, 0),
        });
      })),
      firstMismatches: Object.freeze(firstMismatches), positionalMismatchCount,
      mismatchesTruncated: positionalMismatchCount > firstMismatches.length,
      expectedSequenceSha256: digest(expected), actualSequenceSha256: digest(actual),
    };
  }
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > maximumBytes) throw new Error("Diagnostic too large.");
  Object.defineProperty(result, normalizedAnnotation, { value: normalized, enumerable: false });
  return Object.freeze(result);
}

function readNormalized(value) {
  const status = requiredData(value, "status");
  if (status === "unavailable") {
    exactDataKeys(value, ["status"]);
    return Object.freeze({ status });
  }
  exactDataKeys(value, ["status", "phase", "checkpoint", "expected", "actual", "actualEntryCount", "entriesAreArray"]);
  const phase = requiredData(value, "phase");
  const checkpoint = requiredData(value, "checkpoint");
  const entriesAreArray = requiredData(value, "entriesAreArray");
  const actualEntryCount = requiredData(value, "actualEntryCount");
  if (status !== "observed" || !phases.has(phase) || !checkpoints.has(checkpoint)
    || typeof entriesAreArray !== "boolean"
    || (entriesAreArray ? !Number.isInteger(actualEntryCount) || actualEntryCount < 0 || actualEntryCount > 0xffff_ffff
      : actualEntryCount !== null)) throw new Error("Invalid normalized diagnostic identity.");
  const expected = safeArray(requiredData(value, "expected"), 28);
  const actual = safeArray(requiredData(value, "actual"), maximumEntries);
  if (expected.length !== (phase === "recreated" ? 28 : 15)
    || expected.some((entry) => !classes.has(entry))
    || actual.length !== Math.min(actualEntryCount ?? 0, maximumEntries)
    || actual.some((entry) => !classes.has(entry) && entry !== "unknown-endpoint")) {
    throw new Error("Invalid normalized diagnostic sequence.");
  }
  return Object.freeze({ status, phase, checkpoint, expected: Object.freeze(expected),
    actual: Object.freeze(actual), actualEntryCount, entriesAreArray });
}

export function collectChatwootProviderLedgerMismatchEvidence(error) {
  const entries = [];
  const seen = new Set();
  let visited = 0;
  let truncated = false;
  function visit(value, depth) {
    if (!isDataRecord(value) || seen.has(value)) return;
    if (depth > 5 || visited >= 32) { truncated = true; return; }
    visited += 1;
    seen.add(value);
    try {
      const annotation = optionalData(value, captureAnnotation);
      if (annotation !== undefined) {
        const role = requiredData(annotation, "role");
        const pairIndex = requiredData(annotation, "pairIndex");
        const captureStage = requiredData(annotation, "captureStage");
        if (!["baseline", "candidate"].includes(role) || !Number.isInteger(pairIndex)
          || pairIndex < 1 || pairIndex > 3 || !captureStages.has(captureStage)) throw new Error("Invalid annotation.");
        if (entries.length >= 6) truncated = true;
        else {
          const entry = Object.freeze({ role, pairIndex, captureStage,
            diagnostic: safeDiagnosticCopy(requiredData(annotation, "diagnostic")) });
          if (Buffer.byteLength(JSON.stringify({ schemaVersion: 1, entries: [...entries, entry], truncated: true }), "utf8")
            > maximumBytes) truncated = true;
          else entries.push(entry);
        }
      }
    } catch { /* Ignore unsafe annotations instead of publishing arbitrary Error data. */ }
    visit(optionalData(value, "cause"), depth + 1);
    const nested = optionalData(value, "errors");
    if (isDataRecord(nested) && Array.isArray(nested)) {
      const length = arrayLength(nested);
      if (length > 32) truncated = true;
      for (let index = 0; index < Math.min(length, 32); index += 1) {
        visit(optionalData(nested, String(index)), depth + 1);
      }
    }
  }
  try { visit(error, 0); } catch { truncated = true; }
  if (entries.length === 0) return undefined;
  return Object.freeze({ schemaVersion: 1, entries: Object.freeze(entries), truncated });
}

function safeDiagnosticCopy(value) {
  // Recompute every output field and hash from bounded enum tokens. Foreign Error
  // annotations cannot supply arbitrary hashes or recursively nested output objects.
  return renderDiagnostic(requiredData(value, normalizedAnnotation));
}

function exactDataKeys(value, expected) {
  if (!isDataRecord(value) || Object.getOwnPropertySymbols(value).length
    || JSON.stringify(Object.getOwnPropertyNames(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error("Unexpected normalized diagnostic fields.");
  }
  for (const key of expected) requiredData(value, key);
}

function annotate(error, key, value) {
  if (!isDataRecord(error)) return;
  Object.defineProperty(error, key, { value, enumerable: false, writable: false, configurable: false });
}
function isDataRecord(value) { return value !== null && typeof value === "object" && !types.isProxy(value); }
function optionalData(value, key) {
  if (!isDataRecord(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}
function requiredData(value, key) {
  if (!isDataRecord(value)) throw new Error("Expected own data record.");
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error("Expected own data property.");
  return descriptor.value;
}
function arrayLength(value) {
  const length = requiredData(value, "length");
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff) throw new Error("Invalid array length.");
  return length;
}
function safeArray(value, maximum) {
  if (!isDataRecord(value) || !Array.isArray(value)) throw new Error("Expected safe array.");
  const length = arrayLength(value);
  if (length > maximum) throw new Error("Array bound exceeded.");
  return Array.from({ length }, (_, index) => requiredData(value, String(index)));
}
function digest(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
