const LEVELS = new Set(["debug", "info", "warn", "error"]);
const SENSITIVE_IDENTIFIER_KEY = /(?:^|_)(?:operation|payment|user|session)_ids?(?:_|$)/;
const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_ENTRIES = 100;

function safeMetadataValue(key, value, seen, depth = 0) {
  const normalizedKey = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
  if (SENSITIVE_IDENTIFIER_KEY.test(normalizedKey)) {
    return "[redacted]";
  }

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value !== "object") return "[unsupported]";
  if (depth >= MAX_METADATA_DEPTH) return "[max-depth]";
  if (seen.has(value)) return "[circular]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ENTRIES)
      .map((entry) => safeMetadataValue("", entry, seen, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_METADATA_ENTRIES)
      .filter(([, entry]) => entry !== undefined)
      .map(([nestedKey, entry]) => [
        nestedKey,
        safeMetadataValue(nestedKey, entry, seen, depth + 1),
      ]),
  );
}

export function sanitizeDeployLogMessage(message) {
  return String(message)
    .replace(
      /\b([A-Za-z0-9_]*(?:operation|payment|user|session)(?:_?ids?))=[^\s|.]*/gi,
      "$1=[redacted]",
    );
}

function printableValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

/**
 * A small dependency-free logger for entrypoints and maintenance workers.
 * It intentionally accepts only already-safe deployment metadata: never pass
 * environment values, credentials, request headers, or response bodies here.
 */
export function deployLog(level, event, message, metadata = {}) {
  const normalizedLevel = LEVELS.has(level) ? level : "info";
  const seen = new WeakSet();
  const context = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) =>
      ` | ${key}=${printableValue(safeMetadataValue(key, value, seen))}`
    )
    .join("");
  const safeMessage = sanitizeDeployLogMessage(message);
  const line = `${new Date().toISOString()} | ${normalizedLevel.toUpperCase().padEnd(8, " ")} | clean-pay/deploy | ${safeMessage} | event=${event}${context}`;

  if (normalizedLevel === "error") {
    console.error(line);
  } else if (normalizedLevel === "warn") {
    console.warn(line);
  } else if (normalizedLevel === "debug") {
    console.debug(line);
  } else {
    console.info(line);
  }
}
