import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("deploy/prod/Dockerfile", "utf8");
const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const start = readFileSync("deploy/prod/start.sh", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

describe("production container boundary", () => {
  it("uses the traced standalone runtime instead of the complete dependency tree", () => {
    expect(nextConfig).toContain('output: "standalone"');
    const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));
    expect(runner).toContain("/app/.next/standalone ./");
    expect(start).toContain("exec node server.js");
    expect(runner).not.toContain("/app/node_modules ./node_modules");
    expect(runner).not.toContain("prisma.config.ts");
    expect(runner).not.toContain("node_modules/prisma/build/index.js");
    expect(runner).toContain("/app/node_modules/@prisma/adapter-pg");
    expect(runner).toContain("/app/node_modules/@prisma/driver-adapter-utils");
    expect(runner).toContain("/app/node_modules/@prisma/debug");
    expect(runner).toContain("/app/node_modules/postgres-array");
  });

  it("gates application startup on a one-shot migration image", () => {
    expect(dockerfile).toContain("AS migration");
    expect(dockerfile).toContain("node node_modules/prisma/build/index.js migrate deploy");
    expect(compose).toContain("migration:");
    expect(compose).toContain("target: migration");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(start).not.toContain("migrate deploy");
    expect(start).not.toContain("RUN_MIGRATIONS");
  });
});
