import { readFileSync } from "node:fs";

import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

/** The argument list of each call to `name(`, as source text. */
function callArguments(source: string, name: string) {
  const calls: string[] = [];

  for (const match of source.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
    const lineStart = source.lastIndexOf("\n", match.index);
    // Skip the declaration itself.
    if (/\b(async\s+)?function\s*$/.test(source.slice(lineStart, match.index))) continue;

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

    calls.push(source.slice(match.index + match[0].length, index));
  }

  return calls;
}

describe("upstream request timeouts", () => {
  const sources = globSync(["src/backend/**/*.ts"]).map((file) => ({
    file,
    source: readFileSync(file, "utf8"),
  }));

  it("bounds every upstream request so none can hang a handler", () => {
    // An upstream that accepts a connection and then never answers would
    // otherwise hold a request until the platform kills it, and readiness,
    // checkout and session recovery all call outward on a reader's path.
    const unbounded: string[] = [];

    for (const { file, source } of sources) {
      for (const name of ["fetch", "fetchRemnashop", "fetchRemnashopAdmin"]) {
        for (const args of callArguments(source, name)) {
          // The signal may be inline, or come from the shared init builder,
          // or be forwarded from a caller that already carries one.
          const bounded = /\bsignal\b/.test(args)
            || args.includes("remnashopRequestInit")
            || args.includes("requestInit")
            || args.includes("init");
          if (!bounded) unbounded.push(`${file}: ${name}(${args.slice(0, 60)}…`);
        }
      }
    }

    expect(unbounded).toEqual([]);
  });

  it("keeps a finite default for callers that do not choose one", () => {
    const client = readFileSync(
      "src/backend/integrations/remnashop/api-client.ts",
      "utf8",
    );

    // Every timeoutMs fallback must be a real number, never undefined or 0.
    const fallbacks = [...client.matchAll(/timeoutMs\s*\?\?\s*([0-9_]+)/g)]
      .map((match) => Number(match[1]?.replaceAll("_", "")));

    expect(fallbacks.length).toBeGreaterThan(0);
    for (const fallback of fallbacks) {
      expect(fallback).toBeGreaterThan(0);
      expect(fallback).toBeLessThanOrEqual(30_000);
    }
  });
});
