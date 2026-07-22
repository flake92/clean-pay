const LEVELS = new Set(["debug", "info", "warn", "error"]);

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
  const context = Object.entries(metadata)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` | ${key}=${printableValue(value)}`)
    .join("");
  const line = `${new Date().toISOString()} | ${normalizedLevel.toUpperCase().padEnd(8, " ")} | clean-pay/deploy | ${message} | event=${event}${context}`;

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
