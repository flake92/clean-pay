import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const runner = readFileSync("scripts/e2e-devcontainer.mjs", "utf8");
const shellRunner = readFileSync("scripts/e2e-devcontainer.sh", "utf8");
const compose = readFileSync(".devcontainer/docker-compose.yml", "utf8");
const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8");
const dependabot = readFileSync(".github/dependabot.yml", "utf8");
const remnashopRevision = "efe7524baaeebaf6743a4b25f3654f7c50c3f3d6";

const hostPortContract = [
  ["CLEAN_PAY_DEVCONTAINER_APP_HOST_PORT", "4000", "4000"],
  ["CLEAN_PAY_DEVCONTAINER_PRISMA_STUDIO_HOST_PORT", "5555", "5555"],
  ["CLEAN_PAY_DEVCONTAINER_POSTGRES_HOST_PORT", "5432", "5432"],
  ["CLEAN_PAY_DEVCONTAINER_REDIS_HOST_PORT", "6379", "6379"],
  ["CLEAN_PAY_DEVCONTAINER_REMNASHOP_HOST_PORT", "5001", "5000"],
  ["CLEAN_PAY_DEVCONTAINER_REMNASHOP_POSTGRES_HOST_PORT", "6767", "5432"],
  ["CLEAN_PAY_DEVCONTAINER_TELEGRAM_OIDC_HOST_PORT", "8090", "8090"],
  ["CLEAN_PAY_DEVCONTAINER_MAILPIT_HTTP_HOST_PORT", "8025", "8025"],
  ["CLEAN_PAY_DEVCONTAINER_MAILPIT_SMTP_HOST_PORT", "1025", "1025"],
  ["CLEAN_PAY_DEVCONTAINER_CADDY_APP_HOST_PORT", "8080", "8080"],
  ["CLEAN_PAY_DEVCONTAINER_CADDY_REMNASHOP_HOST_PORT", "8081", "8081"],
  ["CLEAN_PAY_DEVCONTAINER_CADDY_MAILPIT_HOST_PORT", "8026", "8026"],
] as const;

describe("devcontainer e2e runner readiness", () => {
  it("allows slow dependency installation without waiting forever", () => {
    expect(runner).toContain("seq 1 120");
    expect(runner).toContain("sleep 1");
    expect(runner).toContain("Timed out waiting 120 seconds");
    expect(runner).not.toContain("seq 1 100");
    expect(runner).not.toContain("sleep 0.1");
  });

  it("retries transient devcontainer image build failures with a bound", () => {
    expect(runner).toContain("runWithRetries(");
    expect(runner).toContain('label: "Devcontainer image build/start"');
    expect(runner).toContain("attempts: 3");
    expect(runner).toContain("attempt * 2_000");
  });

  it("allows every published host port to be isolated without changing defaults", () => {
    const configuredPorts = [...compose.matchAll(
      /^\s+- "\$\{(CLEAN_PAY_DEVCONTAINER_[A-Z_]+):-([0-9]+)\}:([0-9]+)"$/gm,
    )].map((match) => [match[1], match[2], match[3]]).sort();

    expect(configuredPorts).toEqual([...hostPortContract].sort());
    expect(compose).not.toMatch(/^\s+- "[0-9]+:[0-9]+"$/m);

    for (const [name] of hostPortContract) {
      expect(runner).toContain(`"${name}"`);
    }
  });

  it("keeps service URLs container-local when host ports are isolated", () => {
    expect(runner).toContain('name === "CLEAN_PAY_E2E_BASE_URL"');
    expect(runner).toContain('? "http://localhost:4000"');
    expect(runner).toContain('name === "CLEAN_PAY_E2E_MAILPIT_URL"');
    expect(runner).toContain('? "http://smtp:8025"');
    expect(runner).toContain('name === "CLEAN_PAY_E2E_OIDC_URL"');
    expect(runner).toContain('? "http://telegram-oidc-mock:8090"');
  });

  it("uses one project-scoped Remnashop image across every service", () => {
    const imageReference =
      "image: ${CLEAN_PAY_DEVCONTAINER_REMNASHOP_IMAGE:-${COMPOSE_PROJECT_NAME:-clean-pay-dev}-remnashop:latest}";

    expect(compose.split(imageReference)).toHaveLength(5);
    expect(runner).toContain("`${projectName}-remnashop:latest`");
    expect(runner).toContain('"CLEAN_PAY_DEVCONTAINER_REMNASHOP_IMAGE"');
  });

  it("preserves an explicitly selected remote Remnashop build context", () => {
    expect(runner).toMatch(
      /!process\.env\.REMNASHOP_HOST_SOURCE\s*&&\s*!process\.env\.REMNASHOP_BUILD_CONTEXT/,
    );
  });

  it("keeps the default E2E source hermetic and accepts newer compatible schemas", () => {
    expect(runner).toContain('process.env.REMNASHOP_DISCOVER_HOST_SOURCE === "1"');
    expect(runner).toContain('"REMNASHOP_MINIMUM_ALEMBIC_REVISION"');
    expect(shellRunner).toContain('REMNASHOP_MINIMUM_ALEMBIC_REVISION:-0054');
    expect(shellRunner).toContain('10#$current_revision >= 10#$minimum_revision');
    expect(shellRunner).not.toContain('current_revision <> \'0054\'');
  });

  it("pins E2E to the compatible Remnashop revision with container migrations", () => {
    expect(compose).toContain(`https://github.com/flake92/remnashop.git#${remnashopRevision}`);
    expect(compose).toContain(`BUILD_COMMIT: ${remnashopRevision}`);
    expect(compose).not.toContain("b9da68a651e9ab0b7ed52d030e13754311614759");
  });

  it("keeps actionable E2E diagnostics and immutable GitHub action runtimes in CI", () => {
    expect(ciWorkflow).toContain('CLEAN_PAY_E2E_DIAGNOSTICS: "1"');
    expect(ciWorkflow).not.toContain('CLEAN_PAY_E2E_DIAGNOSTICS: "0"');
    const actionReferences = [
      ...ciWorkflow.matchAll(/^\s*(?:-\s*)?uses:\s+([^\s#]+)(?:\s+#\s*(\S.*))?$/gm),
    ];

    expect(actionReferences.length).toBeGreaterThan(0);
    for (const [, reference, versionComment] of actionReferences) {
      expect(reference).toMatch(/^[^@\s]+@[0-9a-f]{40}$/);
      expect(versionComment).toMatch(/^v\d/);
    }

    expect(ciWorkflow).toContain(
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0",
    );
    expect(ciWorkflow).toContain(
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0",
    );
    expect(ciWorkflow.match(/node-version-file: \.node-version/g)).toHaveLength(3);
    expect(ciWorkflow).toContain("workflow_dispatch:");
    expect(ciWorkflow).toContain("sh -n deploy.sh start.sh scripts/*.sh deploy/prod/*.sh");
    expect(ciWorkflow).toContain("docker compose --env-file deploy/prod/.env");
    expect(ciWorkflow).toContain("timeout --signal=TERM --kill-after=30s 12m npm run test:e2e");
  });

  it("keeps pinned GitHub Actions current through Dependabot", () => {
    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain('directory: "/"');
    expect(dependabot).toContain("interval: weekly");
  });

  it("pre-creates the Next.js build directory for the unprivileged container user", () => {
    expect(compose).toMatch(
      /sudo mkdir -p[^\n]*node_modules[^\n]*\/home\/node\/\.npm\s+\/workspace\/clean-pay\/\.next/,
    );
    expect(compose).toMatch(
      /sudo chown -R node:node[^\n]*node_modules[^\n]*\/home\/node\/\.npm\s+\/workspace\/clean-pay\/\.next/,
    );
    expect(compose).not.toContain("if [ -d /workspace/clean-pay/.next ]");
    expect(compose).toContain("sudo touch /workspace/clean-pay/next-env.d.ts");
    expect(compose).toMatch(
      /sudo chown -R node:node[\s\S]*\/workspace\/clean-pay\/\.next \/workspace\/clean-pay\/next-env\.d\.ts/,
    );
  });

  it("bounds the test process and graceful Next.js shutdown", () => {
    expect(shellRunner).toContain("timeout --signal=TERM --kill-after=10s 360s");
    expect(shellRunner).toContain('kill -KILL -- "-$next_pid"');
    expect(shellRunner).toContain("for _ in $(seq 1 10)");
  });

  it("cannot block forever while probing or warming Next.js", () => {
    expect(shellRunner).toMatch(
      /--connect-timeout 2\s+\\\s+--max-time 5\s+\\\s+"\$base_url\/api\/health"/,
    );
    expect(shellRunner).toContain("Waiting for Next.js health endpoint");
    expect(shellRunner).toContain("Warming Next.js route: $route");
    expect(shellRunner).toContain("--max-time 45");
    expect(shellRunner).not.toContain("--max-time 90");
  });
});
