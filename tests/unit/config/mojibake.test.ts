import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const productionTextFiles = [
  "src/backend/integrations/remnashop/errors.ts",
  "src/backend/http/bff-response.ts",
  "src/proxy.ts",
  "src/app/api/bff/payments/status/route.ts",
];

describe("source text encoding", () => {
  it("does not contain common mojibake fragments in production-facing messages", () => {
    const root = process.cwd();
    const mojibakeFragments = [
      "\u0420\u2019",
      "\u0420\u040C",
      "\u0420\u040F",
      "\u0420\u201D",
      "\u0420\u0491",
      "\u0420\u00B5",
      "\u0421\u040A",
      "\u0421\u2039",
      "\u0421\u040F",
      "\u0421\u2021",
      "\u0421\u20AC",
      "\u0421\u201A",
      "\u0421\u0402",
      "\u0421\u0192",
      "\u0432\u0402",
    ];
    const offenders = productionTextFiles.flatMap((file) => {
      const text = readFileSync(join(root, file), "utf8");

      return mojibakeFragments.some((fragment) => text.includes(fragment)) ? [file] : [];
    });

    expect(offenders).toEqual([]);
  });
});
