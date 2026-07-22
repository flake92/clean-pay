import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = path.resolve("src/app/api");
const docs = readFileSync(path.join(apiRoot, "ENDPOINTS.md"), "utf8");

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory()
      ? routeFiles(target)
      : entry.name === "route.ts"
        ? [target]
        : [];
  });
}

function implementedEndpoints() {
  return routeFiles(apiRoot).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(apiRoot, path.dirname(file)).replaceAll(path.sep, "/");
    const route = `/api/${relative}`;

    return [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)]
      .map((match) => `${match[1]} ${route}`);
  }).sort();
}

function documentedEndpoints() {
  return [...docs.matchAll(/^\| `((?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/api\/[^`]+)` \|/gm)]
    .map((match) => match[1])
    .sort();
}

describe("API endpoint flow map", () => {
  it("matches every implemented API route and HTTP method exactly", () => {
    expect(documentedEndpoints()).toEqual(implementedEndpoints());
  });

  it("does not reference missing local source files", () => {
    for (const match of docs.matchAll(/`(src\/(?:app|backend)\/[^`]+\.(?:ts|tsx))`/g)) {
      if (match[1].includes("*") || match[1].includes("<")) continue;
      expect(() => readFileSync(match[1], "utf8"), match[1]).not.toThrow();
    }
  });
});
