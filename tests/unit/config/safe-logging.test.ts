import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const logEvents = [
  {
    file: "src/backend/integrations/remnashop/client.ts",
    events: [
      "remnashop_request_sent",
      "remnashop_response_received",
      "remnashop_request_failed",
    ],
  },
  {
    file: "src/backend/http/bff-response.ts",
    events: [
      "bff_response_sent",
      "bff_error_response_sent",
    ],
  },
  {
    file: "src/backend/integrations/telegram/oidc.ts",
    events: [
      "telegram_token_request_sent",
      "telegram_token_response_received",
    ],
  },
  {
    file: "src/backend/security/turnstile.ts",
    events: [
      "turnstile_request_sent",
      "turnstile_response_received",
      "turnstile_request_failed",
    ],
  },
] as const;

function extractLoggerCall(source: string, event: string) {
  const eventIndex = source.indexOf(`"${event}"`);

  expect(eventIndex, `${event} log event should exist`).toBeGreaterThanOrEqual(0);

  const loggerIndex = source.lastIndexOf("logger.", eventIndex);
  const callStart = source.indexOf("(", loggerIndex);
  let depth = 0;

  for (let index = callStart; index < source.length; index += 1) {
    const char = source[index];

    if (char === "(") {
      depth += 1;
    }

    if (char === ")") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(loggerIndex, index + 1);
      }
    }
  }

  throw new Error(`Could not extract logger call for ${event}`);
}

describe("safe production logging shape", () => {
  it("does not log headers, urls or request/response bodies for critical upstream and BFF events", () => {
    const offenders: string[] = [];

    for (const { file, events } of logEvents) {
      const source = readFileSync(file, "utf8");

      for (const event of events) {
        const loggerCall = extractLoggerCall(source, event);
        const unsafe = [
          /\bheaders\s*:/,
          /\bbody\s*:/,
          /\burl\s*:/,
          /Object\.fromEntries\s*\(\s*response\.headers/,
          /parse\w*LogBody/,
        ].filter((pattern) => pattern.test(loggerCall));

        if (unsafe.length > 0) {
          offenders.push(`${file}:${event}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
