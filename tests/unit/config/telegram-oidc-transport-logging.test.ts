import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function loggerCall(source: string, event: string) {
  const eventIndex = source.indexOf(`"${event}"`);
  expect(eventIndex).toBeGreaterThanOrEqual(0);
  const start = source.lastIndexOf("logger.", eventIndex);
  let depth = 0;
  for (let index = source.indexOf("(", start); index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")" && --depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  throw new Error(`Incomplete logger call for ${event}`);
}

describe("Telegram OIDC transport logging boundary", () => {
  it("keeps the executable safe-log events beside the credentialed transport", () => {
    const transport = readFileSync(
      "src/backend/integrations/telegram/oidc-transport.ts",
      "utf8",
    );
    for (const event of [
      "telegram_token_request_sent",
      "telegram_token_response_received",
    ]) {
      const call = loggerCall(transport, event);
      expect(call).not.toMatch(/\b(?:headers|body|url)\s*:/u);
      expect(call).not.toContain("response.headers");
    }
  });
});
