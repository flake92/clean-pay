import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production Docker network startup", () => {
  it("checks and creates the configured Remnawave edge network before compose up", () => {
    const source = readFileSync("start.sh", "utf8");
    const startFunction = source.slice(source.indexOf("start() {"), source.indexOf("verify() {"));

    expect(source).toContain("validate_env");
    expect(source).toContain(
      'node "$ROOT_DIR/deploy/prod/validate-env.mjs" --clean-pay-env-file "$ENV_FILE"',
    );
    expect(source).toContain("unset \\");
    expect(source).toContain("COMPOSE_PROFILES \\");
    expect(source).toContain("NEXT_PUBLIC_APP_URL \\");
    expect(source).toContain("    COMPOSE_FILE \\");
    expect(source).toContain('docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE"');
    expect(source).toContain("env_value CLEAN_PAY_EDGE_NETWORK remnawave-network");
    expect(source).toContain("env_value REMNASHOP_DOCKER_NETWORK remnawave-network");
    expect(source).toContain('docker network inspect "$network_name"');
    expect(source).toContain('docker network create "$network_name"');
    const ensureNetwork = source.slice(
      source.indexOf("ensure_network() {"),
      source.indexOf("ensure_redis_host_memory_policy() {"),
    );
    expect(ensureNetwork.indexOf("CLEAN_PAY_EDGE_NETWORK")).toBeLessThan(
      ensureNetwork.indexOf('[ "$MODE" = "remnashop" ] || return 0'),
    );
    expect(ensureNetwork.indexOf("REMNASHOP_DOCKER_NETWORK")).toBeGreaterThan(
      ensureNetwork.indexOf('[ "$MODE" = "remnashop" ] || return 0'),
    );
    expect(ensureNetwork).toContain('[ "$remnashop_network" = "$edge_network" ]');
    expect(startFunction.indexOf("ensure_network")).toBeGreaterThanOrEqual(0);
    expect(startFunction.indexOf("start_verified_runtimes")).toBeGreaterThan(
      startFunction.indexOf("ensure_network"),
    );
    expect(source).toContain(
      "compose up -d --no-deps --no-build --pull never --wait",
    );
  });

  it("boots the built standalone runner image before security scanning", () => {
    const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
    const build = workflow.indexOf("Build the exact production runtime image");
    const smoke = workflow.indexOf("Smoke-test the standalone production runtime");
    const scan = workflow.indexOf("Generate image SBOM");
    const smokeStep = workflow.slice(smoke, scan);

    expect(smoke).toBeGreaterThan(build);
    expect(scan).toBeGreaterThan(smoke);
    expect(smokeStep).not.toContain("--entrypoint");
    expect(smokeStep).toContain("--env NEXT_PUBLIC_APP_URL");
    expect(smokeStep).toContain("clean-pay:ci");
    expect(smokeStep).toContain("/api/health/liveness");
    expect(smokeStep).toContain("--retry-all-errors");
    expect(smokeStep).toContain("event=production_environment_validated");
  });
});
