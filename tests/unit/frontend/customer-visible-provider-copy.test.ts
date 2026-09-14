import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const customerCopyRoots = [
  "src/app",
  "src/application",
  "src/frontend",
  "src/shared",
];

const technicalOnlyFiles = new Set([
  "src/application/health/readiness.ts",
]);

// Cloudflare Turnstile is intentionally named in actionable challenge errors;
// its own widget branding remains unchanged by product policy.
const providerBrand = /Remnashop|Remnawave|Chatwoot/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(?:ts|tsx)$/u.test(entry.name) ? [entryPath] : [];
  });
}

function literalText(node: ts.Node) {
  if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) return node.text;
  if (
    node.kind === ts.SyntaxKind.TemplateHead
    || node.kind === ts.SyntaxKind.TemplateMiddle
    || node.kind === ts.SyntaxKind.TemplateTail
  ) {
    return (node as ts.TemplateLiteralLikeNode).text;
  }
  return null;
}

describe("customer-visible provider copy", () => {
  it("keeps third-party brands out of application-facing string literals", () => {
    const violations: string[] = [];

    for (const file of customerCopyRoots.flatMap(sourceFiles)) {
      const normalizedFile = file.replaceAll("\\", "/");
      if (technicalOnlyFiles.has(normalizedFile)) continue;

      const source = readFileSync(file, "utf8");
      const sourceFile = ts.createSourceFile(
        file,
        source,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        const text = literalText(node);
        if (text && providerBrand.test(text)) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push(`${normalizedFile}:${line + 1}: ${JSON.stringify(text)}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
