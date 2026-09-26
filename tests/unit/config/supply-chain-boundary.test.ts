import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dockerignore = readFileSync(".dockerignore", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const npmPolicy = readFileSync(".npmrc", "utf8");
const devcontainerDockerfile = readFileSync(".devcontainer/Dockerfile", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const productionCompose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const e2eRunner = readFileSync("scripts/e2e-devcontainer.mjs", "utf8");
const e2eShellRunner = readFileSync("scripts/e2e-devcontainer.sh", "utf8");
const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/publish-images.yml",
].map((path) => [path, readFileSync(path, "utf8")] as const);

describe("supply-chain boundary", () => {
  it("sends only explicitly allowlisted production build inputs", () => {
    const firstPattern = dockerignore
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#"));

    expect(firstPattern).toBe("**");
    for (const input of [
      "!Dockerfile",
      "!package.json",
      "!package-lock.json",
      "!next.config.ts",
      "!prisma.config.ts",
      "!tsconfig.json",
      "!src/**",
      "!public/**",
      "!prisma/**",
      "!runtime/database-pool.mjs",
      "!runtime/production-env-rules.mjs",
      "!scripts/next-command.mjs",
      "!scripts/prisma-generate.mjs",
      "!deploy/prod/start.sh",
      "!deploy/prod/validate-env.mjs",
      "!deploy/prod/prisma-migration-status.mjs",
    ]) {
      expect(dockerignore, input).toContain(input);
    }

    for (const blocked of [
      "**/.codex-*",
      "**/.git/**",
      "**/.idea/**",
      "**/.vscode/**",
      "**/node_modules/**",
      "**/.env.*",
      "**/*credential*.json",
      "**/*.pem",
      "**/attachments/**",
      "**/*.zip",
    ]) {
      expect(dockerignore, blocked).toContain(blocked);
    }

    expect(npmPolicy.trim()).toBe("strict-allow-scripts=true");
  });

  it("copies the builder inputs explicitly while preserving both targets", () => {
    const builder = dockerfile.slice(
      dockerfile.indexOf("FROM dependencies AS builder"),
      dockerfile.indexOf("FROM node:24.18.0-bookworm-slim", dockerfile.indexOf("FROM dependencies AS builder")),
    );

    expect(dockerfile).not.toMatch(/^COPY \. \.$/mu);
    expect(builder).toContain(
      "COPY next.config.ts prisma.config.ts tsconfig.json ./",
    );
    expect(builder).toContain(
      "COPY scripts/next-command.mjs scripts/prisma-generate.mjs ./scripts/",
    );
    expect(builder).toContain(
      "COPY runtime/database-pool.mjs runtime/production-env-rules.mjs ./runtime/",
    );
    expect(builder).toContain("COPY prisma ./prisma");
    expect(builder).toContain("COPY public ./public");
    expect(builder).toContain("COPY src ./src");
    expect(builder).toContain("ARG CLEAN_PAY_REVISION=local");
    expect(builder).toContain('CLEAN_PAY_BUILD_ID="${CLEAN_PAY_REVISION}"');
    expect(dockerfile).toContain("AS migration");
    expect(dockerfile).toContain("AS runner");
    expect(dockerfile).toContain(
      "node node_modules/prisma/build/index.js validate",
    );
    expect(dockerfile.match(
      /COPY --chown=cleanpay:nodejs runtime\/database-pool\.mjs \.\/runtime\/database-pool\.mjs/gu,
    )).toHaveLength(2);
    expect(dockerfile.match(
      /COPY --chown=cleanpay:nodejs runtime\/production-env-rules\.mjs \.\/runtime\/production-env-rules\.mjs/gu,
    )).toHaveLength(2);
    expect(dockerfile.match(
      /COPY --chown=cleanpay:nodejs deploy\/prod\/database-pool\.mjs \.\/deploy\/prod\/database-pool\.mjs/gu,
    )).toHaveLength(2);
    expect(dockerfile.match(
      /COPY --chown=cleanpay:nodejs deploy\/prod\/production-env-rules\.mjs \.\/deploy\/prod\/production-env-rules\.mjs/gu,
    )).toHaveLength(2);
  });

  it("pins the devcontainer and one-shot Node tooling images by index digest", () => {
    expect(devcontainerDockerfile).toMatch(
      /^FROM mcr\.microsoft\.com\/devcontainers\/javascript-node:4-24-bookworm@sha256:[a-f0-9]{64}$/mu,
    );

    const toolingImages = e2eShellRunner.match(/node:24-alpine(?:@sha256:[a-f0-9]{64})?/gu) ?? [];
    expect(toolingImages.length).toBeGreaterThan(0);
    for (const image of toolingImages) {
      expect(image).toMatch(/@sha256:[a-f0-9]{64}$/u);
    }
  });

  it("uses only lockfile-installed Prisma and Vitest executables", () => {
    expect(e2eShellRunner).not.toMatch(/\bnpx\b/u);
    expect(e2eShellRunner).toContain('node "$root_dir/node_modules/prisma/build/index.js"');
    expect(e2eShellRunner).toContain('node "$root_dir/node_modules/vitest/vitest.mjs"');
  });

  it("gives the application two minutes to drain in both Compose entrypoints", () => {
    for (const [path, source] of [
      ["docker-compose.yml", rootCompose],
      ["deploy/prod/docker-compose.yml", productionCompose],
    ] as const) {
      const app = source.split("\n  app:\n")[1]?.split("\n  reconciliation-worker:\n")[0] ?? "";
      expect(app, path).toContain("stop_grace_period: 2m");
    }
  });

  it("does not persist checkout credentials in read-only jobs", () => {
    for (const [path, workflow] of workflows) {
      const lines = workflow.split(/\r?\n/u);
      const checkoutLines = lines
        .map((line, index) => [line, index] as const)
        .filter(([line]) => line.includes("uses: actions/checkout@"));

      expect(checkoutLines.length, path).toBeGreaterThan(0);
      for (const [, index] of checkoutLines) {
        expect(
          lines.slice(index + 1, index + 9).join("\n"),
          `${path}:${index + 1}`,
        ).toContain("persist-credentials: false");
      }
    }
  });

  it("keeps cleanup scoped to the selected one-shot Compose project", () => {
    expect(e2eRunner).toContain('const composeArgs = ["compose", "-p", projectName, "-f", composeFile]');
    expect(e2eRunner).toContain("cleanupComposeStack(composeArgs)");
    expect(e2eRunner).not.toContain('const projectName = process.env.CLEAN_PAY_DEVCONTAINER_PROJECT ?? "clean-pay-dev"');
  });
});
