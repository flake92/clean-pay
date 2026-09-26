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
const emailPattern = /(?<![\w.+-])[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?![\w.-])/g;
const bearerPattern = /\b(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const secretValuePattern = /(["']?(?:password|passwd|secret|token|authorization|api[_-]?key|signature|sign)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi;
const exactRedactedKeys = new Set([
  "cf-turnstile-response",
  "response",
  "turnstiletoken",
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
const safeCorrelationKeys = new Set(["requestid", "traceid"]);
const subscribers = new Set<LogSubscriber>();

function isIdentityKey(normalizedKey: string) {
  if (safeCorrelationKeys.has(normalizedKey)) return false;

  return identityRedactedKeys.has(normalizedKey)
    || normalizedKey === "id"
    || normalizedKey === "ip"
    || normalizedKey.includes("email")
    || normalizedKey.includes("username")
    || normalizedKey.includes("fullname")
    || normalizedKey.includes("displayname")
    || normalizedKey.includes("photourl")
    || /(?:user|session|account|credential|operation|payment|record|telegram|tg|hw|hold|actor|owner|authstate|device)ids?$/.test(normalizedKey)
    || /(?:identity|owner|actor|clientip|ipaddress)$/.test(normalizedKey);
}

function configuredLevel(): LogLevel {
  const value = process.env.LOG_LEVEL?.toLowerCase();

  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }

  return "info";
}

function shouldLog(level: LogLevel) {
  return levelWeight[level] >= levelWeight[configuredLevel()];
}

function sanitizeLogValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
): unknown {
  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? "[invalid-date]"
      : value.toISOString();
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (typeof value === "string") {
    return value
      .replace(emailPattern, "[redacted-email]")
      .replace(bearerPattern, "$1[redacted]")
      .replace(secretValuePattern, "$1[redacted]");
  }

  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return "[circular]";
    ancestors.add(value);
    const output = value
      .map((item) => sanitizeLogValueInternal(item, ancestors))
      .filter((item) => item !== undefined);
    ancestors.delete(value);
    return output;
  }

  if (typeof value === "object") {
    if (ancestors.has(value)) return "[circular]";
    ancestors.add(value);
    const output: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();

      if (
        (exactRedactedKeys.has(normalizedKey) ||
          isIdentityKey(normalizedKey) ||
          redactedKeyPattern.test(key)) &&
        typeof item !== "boolean"
      ) {
        output[key] = "[redacted]";
        continue;
      }

      const sanitized = sanitizeLogValueInternal(item, ancestors);

      if (sanitized !== undefined) {
        output[key] = sanitized;
      }
    }

    ancestors.delete(value);
    return output;
  }

  return String(value);
}

export function sanitizeLogValue(value: unknown): unknown {
  return sanitizeLogValueInternal(value, new WeakSet());
}

function writeConsoleLog(event: LogEvent) {
  if (!shouldLog(event.level)) {
    return;
  }

  const metadata = sanitizeLogValue(event.metadata ?? {});
  const level = event.level.toUpperCase().padEnd(8, " ");
  const source = event.source ?? event.category ?? "app";
  const message = event.message ?? humanizeEvent(event.event);
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

function humanizeEvent(event: string) {
  const words = event.replace(/[_-]+/g, " ").trim();

  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Application event";
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

function logEvent(level: LogLevel, event: string, metadata: Record<string, unknown> = {}, options: {
  category?: string;
  source?: string;
  message?: string;
} = {}) {
  const sanitizedMetadata = sanitizeLogValue(metadata) as Record<string, unknown>;
  const sanitizedMessage = options.message === undefined
    ? undefined
    : sanitizeLogValue(options.message) as string;

  logEventBus.publish({
    level,
    event,
    category: options.category,
    source: options.source,
    message: sanitizedMessage,
    metadata: sanitizedMetadata,
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
