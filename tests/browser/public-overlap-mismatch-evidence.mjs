import { createHash } from "node:crypto";

export const PUBLIC_OVERLAP_PROJECTED_MISMATCH_FILENAME =
  "public-comparison-mismatch.json";

const markerPrefix = "CLEAN_PAY_PUBLIC_OVERLAP_PROJECTED_MISMATCH:";
const maximumEvidenceBytes = 8 * 1024;
const maximumManifestBytes = 4 * 1024 * 1024;
const maximumDifferencePaths = 12;
const maximumDifferenceDepth = 64;
const allowedProjects = new Set([
  "chromium-390x844",
  "chromium-768x1024",
  "chromium-1440x900",
]);
const allowedRoutes = new Set([
  "login",
  "register",
  "tariffs",
  "support",
  "install",
  "offline",
  "protected-cabinet",
  "protected-profile",
  "protected-referral",
  "protected-extend",
  "protected-link-account",
  "protected-verify-email",
  "protected-passkey-setup",
  "protected-payment",
]);
const allowedPathSegments = new Set([
  "actual",
  "ariaLabel",
  "ariaSnapshot",
  "attributes",
  "baselineCommit",
  "body",
  "box",
  "browserState",
  "bytes",
  "cacheNames",
  "children",
  "computedStyles",
  "consolePolicy",
  "cookies",
  "disabled",
  "dom",
  "domain",
  "errorText",
  "expiresInSeconds",
  "externalTransport",
  "failure",
  "field",
  "final",
  "finalStatus",
  "fragment",
  "fromServiceWorker",
  "headers",
  "height",
  "href",
  "httpOnly",
  "id",
  "identifier",
  "index",
  "interactiveElements",
  "key",
  "kind",
  "loading",
  "local",
  "location",
  "method",
  "name",
  "navigation",
  "network",
  "observedExpected",
  "order",
  "origin",
  "path",
  "pathname",
  "payload",
  "postData",
  "present",
  "project",
  "query",
  "redirectedFrom",
  "redirects",
  "requestHeaders",
  "requested",
  "requestIndex",
  "requests",
  "resourceType",
  "response",
  "role",
  "route",
  "sameSite",
  "schemaVersion",
  "scope",
  "screenshot",
  "secure",
  "serverAction",
  "serverActionCount",
  "serverActions",
  "serviceWorkerScopes",
  "session",
  "sha256",
  "status",
  "statusText",
  "storage",
  "style",
  "tag",
  "text",
  "type",
  "url",
  "value",
  "viewport",
  "visible",
  "width",
  "x",
  "y",
]);
const safePath = /^\$(?:(?:\.[A-Za-z][A-Za-z0-9]{0,63})|(?:\[\d{1,7}\]))*(?:\.length)?$/;

export function createPublicOverlapProjectedMismatchMarker(
  caseId,
  expectedProjected,
  actualProjected,
) {
  const expected = exactManifestBytes(expectedProjected, "expected");
  const actual = exactManifestBytes(actualProjected, "actual");
  if (expected.equals(actual)) {
    throw new Error("Public overlap mismatch evidence requires unequal projected manifests.");
  }
  const evidence = assertPublicOverlapProjectedMismatchEvidence({
    schemaVersion: 1,
    status: "public_overlap_projected_manifest_mismatch",
    case: exactCase(caseId),
    differingPaths: collectDifferencePaths(parseJson(expected), parseJson(actual)),
    expectedProjectedSha256: sha256(expected),
    actualProjectedSha256: sha256(actual),
  });
  const token = Buffer.from(JSON.stringify(evidence), "utf8").toString("base64url");
  if (token.length > maximumEvidenceBytes) {
    throw new Error("Public overlap mismatch marker exceeds its bounded evidence policy.");
  }
  return `${markerPrefix}${token}`;
}

export function extractPublicOverlapProjectedMismatchEvidence(stdout, stderr) {
  const combined = stripAnsi(Buffer.concat([
    exactProcessBytes(stdout, "stdout"),
    Buffer.from("\n"),
    exactProcessBytes(stderr, "stderr"),
  ]).toString("utf8"));
  const tokens = [...combined.matchAll(
    /CLEAN_PAY_PUBLIC_OVERLAP_PROJECTED_MISMATCH:([A-Za-z0-9_-]{1,8192})/g,
  )].map((match) => match[1]);
  if (tokens.length === 0) return null;
  const uniqueTokens = [...new Set(tokens)];
  if (uniqueTokens.length !== 1) {
    throw new Error("Public overlap process reported conflicting mismatch evidence.");
  }
  let decoded;
  try {
    const bytes = Buffer.from(uniqueTokens[0], "base64url");
    if (bytes.byteLength < 1 || bytes.byteLength > maximumEvidenceBytes) {
      throw new Error("bounded mismatch evidence required");
    }
    if (bytes.toString("base64url") !== uniqueTokens[0]) {
      throw new Error("canonical mismatch evidence required");
    }
    decoded = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Public overlap process mismatch evidence is invalid.");
  }
  return assertPublicOverlapProjectedMismatchEvidence(decoded);
}

export function assertPublicOverlapProjectedMismatchEvidence(value) {
  exactKeys(value, [
    "actualProjectedSha256",
    "case",
    "differingPaths",
    "expectedProjectedSha256",
    "schemaVersion",
    "status",
  ]);
  if (value.schemaVersion !== 1
    || value.status !== "public_overlap_projected_manifest_mismatch") {
    throw new Error("Public overlap projected mismatch evidence header is invalid.");
  }
  const caseId = exactCase(value.case);
  if (!Array.isArray(value.differingPaths)
    || value.differingPaths.length < 1
    || value.differingPaths.length > maximumDifferencePaths
    || value.differingPaths.some((entry) => !isAllowedDifferencePath(entry))
    || new Set(value.differingPaths).size !== value.differingPaths.length) {
    throw new Error("Public overlap projected mismatch paths are invalid.");
  }
  const expectedProjectedSha256 = exactDigest(
    value.expectedProjectedSha256,
    "expected projected manifest",
  );
  const actualProjectedSha256 = exactDigest(
    value.actualProjectedSha256,
    "actual projected manifest",
  );
  if (expectedProjectedSha256 === actualProjectedSha256) {
    throw new Error("Public overlap projected mismatch digests must differ.");
  }
  return Object.freeze({
    schemaVersion: 1,
    status: "public_overlap_projected_manifest_mismatch",
    case: caseId,
    differingPaths: Object.freeze([...value.differingPaths]),
    expectedProjectedSha256,
    actualProjectedSha256,
  });
}

function collectDifferencePaths(expected, actual) {
  const result = [];
  const observed = new Set();
  const add = (path) => {
    const safe = safePath.test(path) ? path : "$";
    if (!observed.has(safe) && result.length < maximumDifferencePaths) {
      observed.add(safe);
      result.push(safe);
    }
  };
  const visit = (left, right, currentPath, depth) => {
    if (result.length >= maximumDifferencePaths || Object.is(left, right)) return;
    if (depth >= maximumDifferenceDepth) {
      add(currentPath);
      return;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) add(`${currentPath}.length`);
      const commonLength = Math.min(left.length, right.length);
      for (let index = 0; index < commonLength; index += 1) {
        visit(left[index], right[index], `${currentPath}[${index}]`, depth + 1);
        if (result.length >= maximumDifferencePaths) break;
      }
      return;
    }
    if (isRecord(left) && isRecord(right)) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        const segment = allowedPathSegments.has(key) ? key : "field";
        const nextPath = `${currentPath}.${segment}`;
        if (!Object.hasOwn(left, key) || !Object.hasOwn(right, key)) add(nextPath);
        else visit(left[key], right[key], nextPath, depth + 1);
        if (result.length >= maximumDifferencePaths) break;
      }
      return;
    }
    add(currentPath);
  };
  visit(expected, actual, "$", 0);
  if (result.length === 0) add("$");
  return result;
}

function exactCase(value) {
  if (typeof value !== "string") {
    throw new Error("Public overlap projected mismatch case is invalid.");
  }
  const [project, route, ...extra] = value.split("/");
  if (extra.length !== 0 || !allowedProjects.has(project) || !allowedRoutes.has(route)) {
    throw new Error("Public overlap projected mismatch case is invalid.");
  }
  return value;
}

function exactManifestBytes(value, label) {
  if (!(value instanceof Uint8Array)
    || value.byteLength < 1
    || value.byteLength > maximumManifestBytes) {
    throw new Error(`Public overlap ${label} projected manifest is invalid.`);
  }
  return Buffer.from(value);
}

function exactProcessBytes(value, label) {
  if (!(value instanceof Uint8Array) || value.byteLength > 2 * 1024 * 1024) {
    throw new Error(`Public overlap mismatch ${label} is invalid.`);
  }
  return Buffer.from(value);
}

function parseJson(value) {
  try {
    return JSON.parse(value.toString("utf8"));
  } catch {
    throw new Error("Public overlap projected mismatch input is not valid JSON.");
  }
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`Public overlap ${label} digest is invalid.`);
  }
  return value;
}

function isAllowedDifferencePath(value) {
  if (typeof value !== "string" || !safePath.test(value)) return false;
  for (const match of value.matchAll(/\.([A-Za-z][A-Za-z0-9]{0,63})|\[(\d{1,7})\]/g)) {
    const segment = match[1];
    if (segment !== undefined
      && segment !== "length"
      && !allowedPathSegments.has(segment)) {
      return false;
    }
  }
  return true;
}

function exactKeys(value, expected) {
  if (!isRecord(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error("Public overlap projected mismatch evidence fields are invalid.");
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripAnsi(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
