import { createHash } from "node:crypto";

const allowedModes = new Set(["capture", "cleanup", "compare", "prepare", "verify"]);
const allowedRoles = new Set([null, "baseline", "candidate"]);
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

  return Object.freeze({
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
    classifications: Object.freeze(classifications),
    sourceLocations: Object.freeze(sourceLocations(combined)),
    testSummary: Object.freeze(testSummary(combined)),
  });
}

function sourceLocations(value) {
  const locations = new Map();
  const pattern = /(?:^|[\s(])((?:tests[\\/])browser[\\/][A-Za-z0-9_.\\/-]+\.(?:mjs|ts|tsx)):(\d{1,7}):(\d{1,5})/gm;
  for (const match of value.matchAll(pattern)) {
    const file = match[1].replaceAll("\\", "/");
    const line = Number(match[2]);
    const column = Number(match[3]);
    if (!Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1) {
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
