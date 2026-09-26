import { createHash } from "node:crypto";
import { types } from "node:util";

const maximumEvidenceDepth = 4;
const maximumEvidenceNodes = 16;
const maximumAggregateChildren = 8;
const maximumMessageCodeUnits = 4_096;

export function createJourneySanitizedErrorEvidence(error) {
  try {
    return createEvidence(error);
  } catch {
    return frozenEvidence([], true, "Error", sha256("sanitizer-fallback"));
  }
}

function createEvidence(error) {
  const nodes = [];
  const seen = new Set();
  let truncated = false;

  const visit = (value, depth, parentOrdinal) => {
    if (nodes.length >= maximumEvidenceNodes || depth > maximumEvidenceDepth) {
      truncated = true;
      return;
    }
    if (value !== null && (typeof value === "object" || typeof value === "function")) {
      if (seen.has(value)) {
        truncated = true;
        return;
      }
      seen.add(value);
    }
    const ordinal = nodes.length;
    const proxy = isProxy(value);
    const message = proxy
      ? { truncated: true, value: "proxy-rejection" }
      : errorMessage(value);
    truncated ||= message.truncated;
    const node = Object.freeze({
      depth,
      errorClass: proxy ? "NonError" : errorClass(value),
      messageSha256: sha256(message.value),
      ordinal,
      parentOrdinal,
    });
    nodes.push(node);
    if (proxy) {
      truncated = true;
      return;
    }
    const aggregate = aggregateChildren(value);
    const cause = errorCause(value);
    truncated ||= aggregate.truncated || cause.truncated;
    if (depth === maximumEvidenceDepth) {
      if (aggregate.children.length > 0 || cause.present) {
        truncated = true;
      }
      return;
    }
    for (const child of aggregate.children) {
      visit(child, depth + 1, ordinal);
    }
    if (cause.present) visit(cause.value, depth + 1, ordinal);
  };

  visit(error, 0, null);
  if (nodes.length < 1) throw new Error("Sanitized error evidence is unexpectedly empty.");
  const [root, ...causes] = nodes;
  return frozenEvidence(causes, truncated, root.errorClass, root.messageSha256);
}

function aggregateChildren(value) {
  if (!isNativeError(value)) return { children: [], truncated: false };
  const errors = ownDataProperty(value, "errors");
  if (errors.status === "absent") return { children: [], truncated: false };
  if (errors.status !== "present" || isProxy(errors.value) || !safeArrayIsArray(errors.value)) {
    return { children: [], truncated: true };
  }
  const length = ownDataProperty(errors.value, "length");
  if (length.status !== "present" || !Number.isSafeInteger(length.value) || length.value < 0) {
    return { children: [], truncated: true };
  }
  const children = [];
  let truncated = length.value > maximumAggregateChildren;
  for (let index = 0; index < Math.min(length.value, maximumAggregateChildren); index += 1) {
    const child = ownDataProperty(errors.value, String(index));
    if (child.status === "present") children.push(child.value);
    else truncated = true;
  }
  return { children, truncated };
}

function errorCause(value) {
  if (!isNativeError(value)) return { present: false, truncated: false };
  const cause = ownDataProperty(value, "cause");
  if (cause.status === "absent") return { present: false, truncated: false };
  if (cause.status !== "present") return { present: false, truncated: true };
  return { present: true, truncated: false, value: cause.value };
}

function errorMessage(value) {
  if (!isNativeError(value)) return { truncated: false, value: "non-error-rejection" };
  const message = ownDataProperty(value, "message");
  if (message.status === "absent") return { truncated: false, value: "" };
  if (message.status !== "present" || typeof message.value !== "string") {
    return { truncated: true, value: "unreadable-error-message" };
  }
  if (message.value.length > maximumMessageCodeUnits) {
    return { truncated: true, value: "oversized-error-message" };
  }
  return { truncated: false, value: message.value };
}

function ownDataProperty(value, name) {
  if (value === null || (typeof value !== "object" && typeof value !== "function")) {
    return { status: "absent" };
  }
  if (isProxy(value)) return { status: "unreadable" };
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined) return { status: "absent" };
    return Object.hasOwn(descriptor, "value")
      ? { status: "present", value: descriptor.value }
      : { status: "unreadable" };
  } catch {
    return { status: "unreadable" };
  }
}

function safeArrayIsArray(value) {
  if (isProxy(value)) return false;
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function errorClass(value) {
  if (!isNativeError(value)) return "NonError";
  return ownDataProperty(value, "errors").status === "absent" ? "Error" : "AggregateError";
}

function isNativeError(value) {
  if (isProxy(value)) return false;
  try {
    return types.isNativeError(value);
  } catch {
    return false;
  }
}

function isProxy(value) {
  try {
    return types.isProxy(value);
  } catch {
    return false;
  }
}

function frozenEvidence(causes, truncated, errorClass, messageSha256) {
  return Object.freeze({
    causeEvidence: Object.freeze(causes),
    causeEvidenceTruncated: truncated,
    errorClass,
    messageSha256,
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
