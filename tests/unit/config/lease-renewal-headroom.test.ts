import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/** Reads `const NAME = <number expression>;` and evaluates the arithmetic. */
function numericConstant(source: string, name: string) {
  const match = new RegExp(`const ${name} = ([0-9_*\\s+]+);`).exec(source);
  expect(match, `${name} should be a numeric constant`).not.toBeNull();

  const expression = match?.[1]?.replaceAll("_", "") ?? "";
  // Only digits, whitespace and * + survive the pattern above.
  return expression
    .split("+")
    .reduce((total, term) => total + term
      .split("*")
      .reduce((product, factor) => product * Number(factor.trim()), 1), 0);
}

describe("lease renewal headroom", () => {
  // A long-running operation holds its claim by renewing a lease on a timer.
  // If the timer interval ever approaches the lease, one slow renewal lets the
  // lease lapse while the work is still in flight -- another worker may then
  // claim the same payment or callback. The ratios are healthy today, but
  // nothing recorded that they have to be.
  const cases = [
    {
      what: "durable Telegram callback",
      file: "src/backend/integrations/telegram/durable-callback.ts",
      lease: "CALLBACK_LEASE_MS",
      renewalPattern: /options\.heartbeatMs \?\? ([0-9_]+)/,
    },
    {
      what: "payment owner fence",
      file: "src/backend/integrations/payments/payment-user-merge-service.ts",
      lease: "paymentOwnerFenceLeaseMs",
      renewalPattern: /const paymentOwnerFenceRenewIntervalMs = ([0-9_]+);/,
    },
  ];

  it.each(cases)("renews the $what lease with room for a missed attempt", ({ file, lease, renewalPattern }) => {
    const source = readFileSync(file, "utf8");
    const leaseMs = numericConstant(source, lease);
    const renewalMs = Number(renewalPattern.exec(source)?.[1]?.replaceAll("_", ""));

    expect(leaseMs).toBeGreaterThan(0);
    expect(renewalMs).toBeGreaterThan(0);

    // At least three renewals inside one lease, so two may be lost to a slow
    // database or a paused event loop before ownership is actually at risk.
    expect(leaseMs / renewalMs).toBeGreaterThanOrEqual(3);
  });
});
