import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("deploy/prod/Dockerfile", "utf8");
const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootDockerfile = readFileSync("Dockerfile", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const start = readFileSync("deploy/prod/start.sh", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

describe("production container boundary", () => {
  it("uses the traced standalone runtime instead of the complete dependency tree", () => {
    expect(nextConfig).toContain('output: "standalone"');
    expect(dockerfile).toContain("package.json package-lock.json .npmrc");
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
    const migration = dockerfile.slice(
      dockerfile.indexOf("AS migration"),
      dockerfile.indexOf("AS runner"),
    );

    expect(dockerfile).toContain("AS migration");
    expect(dockerfile).toContain("node node_modules/prisma/build/index.js migrate deploy");
    expect(migration).toContain("--from=dependencies");
    expect(migration).not.toContain("--from=builder");
    expect(migration).toContain("deploy/prod/deploy-log.mjs");
    expect(migration).toContain("deploy/prod/validate-env.mjs");
    expect(migration).toContain("deploy/prod/production-env-rules.mjs");
    expect(compose).toContain("migration:");
    expect(compose).toContain("target: migration");
    expect(compose).toContain("condition: service_completed_successfully");
    expect(start).not.toContain("migrate deploy");
    expect(start).not.toContain("RUN_MIGRATIONS");
  });
});

describe("root production container boundary", () => {
  it("places the standalone server at the path used by the shared startup script", () => {
    const runner = rootDockerfile.slice(rootDockerfile.indexOf("AS runner"));

    expect(rootDockerfile).toContain("package.json package-lock.json .npmrc");
    expect(runner).toContain("/app/.next/standalone ./");
    expect(runner).toContain("/app/.next/static ./.next/static");
    expect(runner).not.toContain("/app/.next ./.next");
    expect(runner).not.toContain("/app/node_modules ./node_modules");
    expect(start).toContain("exec node server.js");
  });

  it("runs migrations once before the root application and workers can start", () => {
    const migration = rootDockerfile.slice(
      rootDockerfile.indexOf("AS migration"),
      rootDockerfile.indexOf("AS runner"),
    );

    expect(rootDockerfile).toContain("AS migration");
    expect(rootDockerfile).toContain(
      "node node_modules/prisma/build/index.js migrate deploy",
    );
    expect(migration).toContain("--from=dependencies");
    expect(migration).not.toContain("--from=builder");
    expect(migration).toContain("deploy/prod/deploy-log.mjs");
    expect(migration).toContain("deploy/prod/validate-env.mjs");
    expect(migration).toContain("deploy/prod/production-env-rules.mjs");
    expect(rootCompose).toContain("migration:");
    expect(rootCompose).toContain("target: migration");
    expect(rootCompose).toContain("target: runner");
    expect(rootCompose).toContain("condition: service_completed_successfully");
    expect(rootStart).toContain("CLEAN_PAY_MIGRATION_IMAGE");
  });

  it("fails fast unless the production Turnstile build invariant is provided", () => {
    expect(rootDockerfile).toContain("ARG TURNSTILE_ENABLED=true");
    expect(rootDockerfile).toContain(
      "ARG TURNSTILE_SITE_KEY=build-time-placeholder-site-key",
    );
    expect(rootCompose.match(/TURNSTILE_ENABLED: \$\{TURNSTILE_ENABLED:\?TURNSTILE_ENABLED=true is required\}/g))
      .toHaveLength(2);
    expect(rootCompose).not.toContain("TURNSTILE_ENABLED: ${TURNSTILE_ENABLED:-false}");
  });
});
