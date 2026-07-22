import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";

const scannedRoots = [
  "README.md",
  "README.ru_RU.md",
  "src",
  "tests",
  "deploy",
  "docs",
  "start.sh",
];

const textExtensions = new Set([
  "",
  ".css",
  ".env",
  ".example",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".scss",
  ".sh",
  ".sql",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const ignoredNames = new Set([".git", ".next", "node_modules", "package-lock.json"]);

const encodingDamagePatterns = [
  {
    name: "UTF-8 decoded as Windows-1251/Cyrillic mojibake",
    pattern:
      /(?:\u0420[\u00a0\u045f\u040e\u045c\u201d\u00b0\u0451\u00b5\u00bb\u0455\u0457\u0491]|\u0421[\u0403\u201a\u040a\u2039\u045a\u0192\u0451]|\u0432\u0402)/u,
  },
  {
    name: "UTF-8 decoded as Latin-1 mojibake",
    pattern: /(?:\u00d0[\u0080-\u00bf]|\u00d1[\u0080-\u00bf]|\u00c3[\u0080-\u00bf]|\u00e2[\u0080-\u00bf])/u,
  },
  {
    name: "Unicode replacement character from a failed decode",
    pattern: /\ufffd/u,
  },
];

function isTextFile(path: string) {
  return textExtensions.has(extname(path)) || path.includes(".env") || path.endsWith(".example");
}

function collectTextFiles(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }

  const name = path.split(/[\\/]/).at(-1) ?? path;
  if (ignoredNames.has(name)) {
    return [];
  }

  const stat = statSync(path);
  if (!stat.isDirectory()) {
    return isTextFile(path) ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) => collectTextFiles(join(path, entry)));
}

describe("source text encoding", () => {
  it("does not contain mojibake fragments or replacement characters in repo-facing text files", () => {
    const offenders = scannedRoots
      .flatMap(collectTextFiles)
      .flatMap((file) => {
        const lines = readFileSync(file, "utf8").split(/\r?\n/);

        return lines.flatMap((line, index) => {
          const match = encodingDamagePatterns.find(({ pattern }) => pattern.test(line));

          return match ? [`${file}:${index + 1}: ${match.name}: ${line.slice(0, 180)}`] : [];
        });
      });

    expect(offenders).toEqual([]);
  });

  it("keeps repository text encoding policy explicit", () => {
    const attributes = readFileSync(".gitattributes", "utf8");
    const editorConfig = readFileSync(".editorconfig", "utf8");

    expect(attributes).toContain("*.md text eol=lf");
    expect(attributes).toContain("*.ts text eol=lf");
    expect(attributes).toContain("*.tsx text eol=lf");
    expect(attributes).toContain("*.sh text eol=lf");
    expect(attributes).toContain("start.sh text eol=lf");
    expect(editorConfig).toContain("charset = utf-8");
    expect(editorConfig).toContain("end_of_line = lf");
  });
});
