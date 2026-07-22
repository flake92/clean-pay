export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogEvent = {
  level: LogLevel;
  event: string;
  category?: string;
  source?: string;
  message?: string;
  metadata?: Record<string, unknown>;
};

type LogSubscriber = (event: LogEvent) => void;

const levelWeight: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const redactedKeyPattern = /(password|token|secret|cookie|authorization|verifier|nonce|state|key)/i;
const exactRedactedKeys = new Set([
  "cf-turnstile-response",
  "response",
  "turnstileToken",
]);
const identityRedactedKeys = new Set([
  "email",
  "targetemail",
  "pendingemail",
  "verificationtargetemail",
  "telegramid",
  "telegram_id",
  "tgid",
  "userid",
  "currentuserid",
  "sourceuserids",
  "mergeduserids",
  "sessionid",
  "credentialid",
  "operationid",
  "paymentid",
  "remnashopuserid",
  "upstreamaccountid",
  "hwid",
]);
const subscribers = new Set<LogSubscriber>();

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase();

  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  return "info";
}

export function shouldLog(level: LogLevel) {
  return levelWeight[level] >= levelWeight[configuredLevel()];
}

export function sanitizeLogValue(value: unknown): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeLogValue(item))
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();

      if (
        (exactRedactedKeys.has(key) ||
          identityRedactedKeys.has(normalizedKey) ||
          redactedKeyPattern.test(key)) &&
        typeof item !== "boolean"
      ) {
        output[key] = "[redacted]";
        continue;
      }

      const sanitized = sanitizeLogValue(item);

      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }

    return output;
  }

  return String(value);
}

function writeConsoleLog(event: LogEvent) {
  if (!shouldLog(event.level)) {
    return;
  }

  const metadata = sanitizeLogValue(event.metadata ?? {});
  const level = event.level.toUpperCase().padEnd(8, " ");
  const source = event.source ?? event.category ?? "app";
  const message = event.message ?? event.event;
  const metadataText = formatMetadata(metadata);
  const line = `${new Date().toISOString()} | ${level} | clean-pay/${source} | ${message} | event=${event.event}${metadataText}`;

  if (event.level === "error") {
    console.error(line);
    return;
  }

  if (event.level === "warn") {
    console.warn(line);
    return;
  }

  if (event.level === "debug") {
    console.debug(line);
    return;
  }

  console.info(line);
}

function formatMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return "";
  }

  const entries = Object.entries(metadata);

  if (entries.length === 0) {
    return "";
  }

  return entries
    .map(([key, value]) => ` | ${key}=${formatLogValue(value)}`)
    .join("");
}

function formatLogValue(value: unknown) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value);
}

export const logEventBus = {
  publish(event: LogEvent) {
    for (const subscriber of subscribers) {
      subscriber(event);
    }
  },
  subscribe(subscriber: LogSubscriber) {
    subscribers.add(subscriber);

    return () => subscribers.delete(subscriber);
  },
};

logEventBus.subscribe(writeConsoleLog);

export function logEvent(level: LogLevel, event: string, metadata: Record<string, unknown> = {}, options: {
  category?: string;
  source?: string;
  message?: string;
} = {}) {
  logEventBus.publish({
    level,
    event,
    category: options.category,
    source: options.source,
    message: options.message,
    metadata,
  });
}

export const logger = {
  debug: (event: string, metadata?: Record<string, unknown>, options?: { category?: string; source?: string; message?: string }) =>
    logEvent("debug", event, metadata, options),
  info: (event: string, metadata?: Record<string, unknown>, options?: { category?: string; source?: string; message?: string }) =>
    logEvent("info", event, metadata, options),
  warn: (event: string, metadata?: Record<string, unknown>, options?: { category?: string; source?: string; message?: string }) =>
    logEvent("warn", event, metadata, options),
  error: (event: string, metadata?: Record<string, unknown>, options?: { category?: string; source?: string; message?: string }) =>
    logEvent("error", event, metadata, options),
};
