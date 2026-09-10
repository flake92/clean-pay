import { readFileSync } from "node:fs";

import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

import {
  defaultTransaction,
  extendedTransaction,
  idempotencyTransaction,
  standardTransaction,
} from "@/backend/database/transaction-policy";

/** The second top-level argument of each $transaction( ... ) call, or null. */
function transactionOptions(source: string) {
  const options: (string | null)[] = [];

  for (const match of source.matchAll(/\$transaction\(/g)) {
    let depth = 0;
    let index = match.index + match[0].length - 1;

    while (index < source.length) {
      const character = source[index];
      if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }

    const call = source.slice(match.index + match[0].length, index);
    let nested = 0;
    let second: string | null = null;

    for (let cursor = 0; cursor < call.length; cursor += 1) {
      const character = call[cursor] ?? "";
      if ("([{".includes(character)) nested += 1;
      else if (")]}".includes(character)) nested -= 1;
      else if (character === "," && nested === 0) {
        second = call.slice(cursor + 1).trim();
        break;
      }
    }

    options.push(second);
  }

  return options;
}

describe("interactive transaction bounds", () => {
  const sources = globSync(["src/backend/**/*.ts"]).map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  }));

  it("gives every interactive transaction an explicit, named bound", () => {
    // A transaction with no second argument runs on whatever the installed
    // Prisma release defaults to, so a dependency upgrade could change how long
    // twenty-five of them hold a connection without touching this repository.
    const unbounded: string[] = [];
    const anonymous: string[] = [];

    for (const { file, source } of sources) {
      for (const option of transactionOptions(source)) {
        if (option === null) unbounded.push(file);
        // A bound computed from a caller's deadline is legitimate and cannot
        // be a shared constant. A bound with the numbers written in place is
        // how five copies of the same pair drifted apart, so require a name.
        else if (/maxWait:\s*\d/.test(option)) anonymous.push(file);
      }
    }

    expect(unbounded, "transactions without any bound").toEqual([]);
    expect(anonymous, "transactions with an inline bound instead of a policy").toEqual([]);
  });

  it("keeps the policies ordered and distinct", () => {
    const policies = [
      defaultTransaction,
      standardTransaction,
      extendedTransaction,
      idempotencyTransaction,
    ];

    for (const policy of policies) {
      expect(policy.maxWait).toBeGreaterThan(0);
      // Waiting longer for a connection than the work may hold one would let a
      // transaction expire before it ever started.
      expect(policy.maxWait).toBeLessThan(policy.timeout);
    }

    const timeouts = policies.map((policy) => policy.timeout);
    expect(timeouts).toEqual([...timeouts].sort((left, right) => left - right));
    expect(new Set(timeouts).size).toBe(timeouts.length);
  });
});
