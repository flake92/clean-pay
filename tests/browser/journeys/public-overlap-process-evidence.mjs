import { createHash } from "node:crypto";
import { types } from "node:util";

const allowedModes = new Set(["capture", "cleanup", "compare", "prepare", "verify"]);
const allowedRoles = new Set([null, "baseline", "candidate"]);
const allowedInvocationStages = new Set([
  "capture-input",
  "environment-policy",
  "invocation-policy",
  "process-construction",
]);
const maximumLocations = 16;
const classificationRules = Object.freeze([
  Object.freeze(["browser-executable-missing", /Executable doesn't exist/i]),
  Object.freeze(["browser-launch", /browserType\.launch|chromium\.launch/i]),
  Object.freeze(["browser-closed", /Target page, context or browser has been closed/i]),
  Object.freeze(["connection-refused", /ERR_CONNECTION_REFUSED|ECONNREFUSED/i]),
  Object.freeze(["connection-reset", /ERR_CONNECTION_RESET|ECONNRESET/i]),
  Object.freeze(["navigation-timeout", /page\.goto: Timeout|navigation[^\n]*timed out/i]),
  Object.freeze(["playwright-timeout", /Test timeout of \d+ms exceeded|TimeoutError|timed out/i]),
  Object.freeze(["unexpected-console", /Unexpected browser console output/i]),
  Object.freeze(["unexpected-pageerror", /Unexpected pageerror/i]),
  Object.freeze(["replay-policy", /Characterization replay/i]),
  Object.freeze(["evidence-policy", /Public overlap|immutable capture|ownership/i]),
  Object.freeze(["filesystem-permission", /EACCES|permission denied/i]),
  Object.freeze(["filesystem-capacity", /ENOSPC|no space left/i]),
  Object.freeze(["assertion", /expect\(received\)|Expected:|Received:/i]),
  Object.freeze(["no-tests", /No tests found/i]),
]);
const allowedClassifications = new Set([
  ...classificationRules.map(([classification]) => classification),
  "unclassified",
]);

export function createPublicOverlapProcessFailureEvidence(input) {
  exactKeys(input, [
    "code",
    "mode",
    "role",
    "signal",
    "stderr",
    "stderrBytes",
    "stdout",
    "stdoutBytes",
    "terminationReason",
  ]);
  if (!allowedModes.has(input.mode) || !allowedRoles.has(input.role)) {
    throw new Error("Public overlap process evidence scope is invalid.");
  }
  const stdout = exactBytes(input.stdout, "stdout");
  const stderr = exactBytes(input.stderr, "stderr");
  const stdoutBytes = exactByteCount(input.stdoutBytes, stdout, "stdout");
  const stderrBytes = exactByteCount(input.stderrBytes, stderr, "stderr");
  const combined = stripAnsi(Buffer.concat([stdout, Buffer.from("\n"), stderr]).toString("utf8"));
  const classifications = classificationRules
    .filter(([, pattern]) => pattern.test(combined))
    .map(([classification]) => classification)
    .sort();
  if (classifications.length === 0 && combined.trim().length > 0) {
    classifications.push("unclassified");
  }

  return assertPublicOverlapProcessFailureEvidence({
    schemaVersion: 1,
    status: "public_overlap_playwright_process_failed",
    mode: input.mode,
    role: input.role,
    terminationReason: exactOptionalToken(input.terminationReason, "termination reason"),
    exitCode: exactExitCode(input.code),
    signal: exactOptionalToken(input.signal, "signal"),
    stdoutBytes,
    stderrBytes,
    stdoutSha256: sha256(stdout),
    stderrSha256: sha256(stderr),
    classifications,
    sourceLocations: sourceLocations(combined),
    testSummary: testSummary(combined),
  });
}

export function assertPublicOverlapProcessFailureEvidence(value) {
  exactKeys(value, [
    "classifications",
    "exitCode",
    "mode",
    "role",
    "schemaVersion",
    "signal",
    "sourceLocations",
    "status",
    "stderrBytes",
    "stderrSha256",
    "stdoutBytes",
    "stdoutSha256",
    "terminationReason",
    "testSummary",
  ]);
  if (value.schemaVersion !== 1
    || value.status !== "public_overlap_playwright_process_failed") {
    throw new Error("Public overlap process evidence header is invalid.");
  }
  publicOverlapProcessFailureFilename(value.mode, value.role);
  exactOptionalToken(value.terminationReason, "termination reason");
  exactExitCode(value.exitCode);
  exactOptionalToken(value.signal, "signal");
  exactObservedByteCount(value.stdoutBytes, "stdout");
  exactObservedByteCount(value.stderrBytes, "stderr");
  if (!/^[a-f0-9]{64}$/.test(value.stdoutSha256)
    || !/^[a-f0-9]{64}$/.test(value.stderrSha256)) {
    throw new Error("Public overlap process evidence digest is invalid.");
  }
  if (!Array.isArray(value.classifications)
    || value.classifications.length > allowedClassifications.size
    || value.classifications.some((entry) => !allowedClassifications.has(entry))
    || JSON.stringify(value.classifications) !== JSON.stringify(
      [...new Set(value.classifications)].sort(),
    )) {
    throw new Error("Public overlap process evidence classifications are invalid.");
  }
  const locations = exactSourceLocations(value.sourceLocations);
  const summary = exactTestSummary(value.testSummary);
  return Object.freeze({
    ...value,
    classifications: Object.freeze([...value.classifications]),
    sourceLocations: Object.freeze(locations),
    testSummary: Object.freeze(summary),
  });
}

export function createPublicOverlapProcessFailureBundle(captureId, failures) {
  if (typeof captureId !== "string" || !/^[a-f0-9]{16}$/.test(captureId)
    || !Array.isArray(failures) || failures.length < 1 || failures.length > 6) {
    throw new Error("Public overlap process failure bundle input is invalid.");
  }
  const validated = failures.map(assertPublicOverlapProcessFailureEvidence);
  const sorted = [...validated].sort((left, right) => (
    publicOverlapProcessFailureFilename(left.mode, left.role).localeCompare(
      publicOverlapProcessFailureFilename(right.mode, right.role),
    )
  ));
  if (new Set(sorted.map(({ mode, role }) => (
    publicOverlapProcessFailureFilename(mode, role)
  ))).size !== sorted.length) {
    throw new Error("Public overlap process failure bundle scope is not unique.");
  }
  return Object.freeze({
    schemaVersion: 1,
    status: "public_overlap_playwright_process_failures",
    captureId,
    failures: Object.freeze(sorted),
  });
}

export function createPublicOverlapInvocationFailureEvidence(input) {
  exactKeys(input, ["error", "mode", "role", "stage"]);
  if (!allowedInvocationStages.has(input.stage)) {
    throw new Error("Public overlap invocation failure stage is invalid.");
  }
  publicOverlapProcessFailureFilename(input.mode, input.role);
  const sanitized = sanitizeInvocationError(input.error);
  return Object.freeze({
    schemaVersion: 1,
    status: "public_overlap_playwright_invocation_failed",
    mode: input.mode,
    role: input.role,
    stage: input.stage,
    errorClass: sanitized.errorClass,
    errorCode: sanitized.errorCode,
    messageSha256: sha256(sanitized.message),
    sourceLocations: Object.freeze(sourceLocations(sanitized.stack)),
  });
}

function sanitizeInvocationError(value) {
  try {
    if (!types.isNativeError(value)) {
      return { errorClass: "NonError", errorCode: null, message: "non-error", stack: "" };
    }
    const errorClass = new Set([
      "AggregateError", "Error", "RangeError", "ReferenceError", "SyntaxError", "TypeError",
    ]).has(value.name) ? value.name : "Error";
    const message = exactOwnString(value, "message", 4_096) ?? "";
    const stack = safeNativeErrorStack(value);
    const rawCode = ownDataValue(value, "code");
    const errorCode = typeof rawCode === "string" && /^[A-Z][A-Z0-9_]{0,39}$/.test(rawCode)
      ? rawCode
      : null;
    return { errorClass, errorCode, message, stack };
  } catch {
    return { errorClass: "Error", errorCode: null, message: "unreadable-error", stack: "" };
  }
}

function safeNativeErrorStack(value) {
  try {
    const observed = value.stack;
    return typeof observed === "string" && observed.length <= 64 * 1024 ? observed : "";
  } catch {
    return "";
  }
}

function exactOwnString(value, name, maximumCodeUnits) {
  const observed = ownDataValue(value, name);
  return typeof observed === "string" && observed.length <= maximumCodeUnits
    ? observed
    : undefined;
}

function ownDataValue(value, name) {
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

export function publicOverlapProcessFailureFilename(mode, role) {
  if (!allowedModes.has(mode) || !allowedRoles.has(role)
    || (mode === "capture") !== (role !== null)) {
    throw new Error("Public overlap process evidence filename scope is invalid.");
  }
  return `public-${mode}-${role ?? "pair"}-failure.json`;
}

function sourceLocations(value) {
  const locations = new Map();
  const pattern = /(?:^|[\s(])(?:(?:file:\/\/\/|\/|[A-Za-z]:[\\/])(?:[A-Za-z0-9_.-]+[\\/])*)?((?:tests[\\/])browser[\\/][A-Za-z0-9_.\\/-]+\.(?:mjs|ts|tsx)):(\d{1,7}):(\d{1,5})/gm;
  for (const match of value.matchAll(pattern)) {
    const file = match[1].replaceAll("\\", "/");
    const line = Number(match[2]);
    const column = Number(match[3]);
    if (!isExactSourceFile(file)
      || !Number.isSafeInteger(line) || line < 1
      || !Number.isSafeInteger(column) || column < 1) {
      continue;
    }
    const key = `${file}:${line}:${column}`;
    locations.set(key, Object.freeze({ file, line, column }));
    if (locations.size >= maximumLocations) break;
  }
  return [...locations.values()].sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
  ));
}

function exactSourceLocations(value) {
  if (!Array.isArray(value) || value.length > maximumLocations) {
    throw new Error("Public overlap process evidence source locations are invalid.");
  }
  const locations = value.map((entry) => {
    exactKeys(entry, ["column", "file", "line"]);
    if (!isExactSourceFile(entry.file)
      || !Number.isSafeInteger(entry.line) || entry.line < 1
      || !Number.isSafeInteger(entry.column) || entry.column < 1) {
      throw new Error("Public overlap process evidence source location is invalid.");
    }
    return Object.freeze({ file: entry.file, line: entry.line, column: entry.column });
  });
  const sorted = [...locations].sort((left, right) => (
    left.file.localeCompare(right.file)
    || left.line - right.line
    || left.column - right.column
  ));
  if (JSON.stringify(locations) !== JSON.stringify(sorted)
    || new Set(locations.map(({ file, line, column }) => `${file}:${line}:${column}`)).size
      !== locations.length) {
    throw new Error("Public overlap process evidence source location order is invalid.");
  }
  return locations;
}

function isExactSourceFile(value) {
  return typeof value === "string"
    && /^tests\/browser\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:mjs|ts|tsx)$/.test(value)
    && !value.split("/").some((segment) => segment === "." || segment === "..");
}

function testSummary(value) {
  const summary = { failed: null, passed: null, skipped: null };
  const pattern = /(?:^|\s)(\d{1,7})\s+(failed|passed|skipped)(?:\s|$)/gim;
  for (const match of value.matchAll(pattern)) {
    const count = Number(match[1]);
    const status = match[2].toLowerCase();
    if (Number.isSafeInteger(count) && count >= 0) summary[status] = count;
  }
  return summary;
}

function exactTestSummary(value) {
  exactKeys(value, ["failed", "passed", "skipped"]);
  for (const entry of Object.values(value)) {
    if (entry !== null && (!Number.isSafeInteger(entry) || entry < 0)) {
      throw new Error("Public overlap process evidence test summary is invalid.");
    }
  }
  return { failed: value.failed, passed: value.passed, skipped: value.skipped };
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function exactBytes(value, label) {
  if (!(value instanceof Uint8Array) || value.byteLength > 2 * 1024 * 1024) {
    throw new Error(`Public overlap process ${label} evidence is invalid.`);
  }
  return Buffer.from(value);
}

function exactByteCount(value, captured, label) {
  if (!Number.isSafeInteger(value) || value < captured.byteLength) {
    throw new Error(`Public overlap process ${label} byte count is invalid.`);
  }
  return value;
}

function exactObservedByteCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Public overlap process ${label} observed byte count is invalid.`);
  }
  return value;
}

function exactExitCode(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0 || value > 255) {
    throw new Error("Public overlap process exit code is invalid.");
  }
  return value;
}

function exactOptionalToken(value, label) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(value)) {
    throw new Error(`Public overlap process ${label} is invalid.`);
  }
  return value;
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error("Public overlap process evidence fields are invalid.");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
