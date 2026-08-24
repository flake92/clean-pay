import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const deploy = readFileSync("deploy.sh", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
const productionRules = readFileSync("deploy/prod/production-env-rules.mjs", "utf8");
const imagePreflight = readFileSync("deploy/prod/image-preflight.sh", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");

describe("production image source selection", () => {
  it("keeps both image targets controlled by the authoritative env file", () => {
    for (const source of [deploy, rootStart, productionRules]) {
      expect(source).toContain("CLEAN_PAY_IMAGE");
      expect(source).toContain("CLEAN_PAY_MIGRATION_IMAGE");
    }

    for (const envFile of [".env.example", "deploy/prod/.env.example"]) {
      const example = readFileSync(envFile, "utf8");
      expect(example).toContain("CLEAN_PAY_DEPLOY_SOURCE=build");
      expect(example).toMatch(/^CLEAN_PAY_IMAGE=.+:local$/m);
      expect(example).toMatch(/^CLEAN_PAY_MIGRATION_IMAGE=.+:local$/m);
    }
  });

  it("prepares both targets before starting Compose without an implicit build", () => {
    expect(deploy).toContain("compose build migration app");
    expect(deploy).toContain("compose pull migration app");
    expect(deploy).toContain("compose run --rm --no-deps --pull never migration");

    expect(rootStart).toContain("compose build migration app");
    expect(rootStart).toContain("compose pull migration app");
    expect(rootStart).toContain("compose run --rm --no-deps --pull never migration");

    expect(prodCommand).toContain('composeArgs(operation, "migration", "app")');
    expect(prodCommand).toContain('"run", "--rm", "--no-deps", "--pull", "never", "migration"');

    const deployInstall = deploy.slice(deploy.indexOf("install_services() {"), deploy.indexOf("up() {"));
    const rootStartFunction = rootStart.slice(rootStart.indexOf("start() {"), rootStart.indexOf("verify() {"));
    const prodUp = prodCommand.slice(prodCommand.indexOf('case "up":'), prodCommand.indexOf('case "down":'));
    for (const [source, calls] of [
      [deployInstall, ["prepare_images", "preflight_images", "stop_runtime_services", "run_verified_migration", "start_verified_runtimes"]],
      [rootStartFunction, ["prepare_images", "preflight_images", "stop_runtime_services", "run_verified_migration", "start_verified_runtimes"]],
      [prodUp, ["prepareDeploymentImages", "preflightDeploymentImages", "stopRuntimeServices", "runVerifiedMigration", "startVerifiedRuntimes"]],
    ] as const) {
      const positions = calls.map((call) => source.indexOf(call));
      expect(positions.every((position) => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((left, right) => left - right));
    }
    expect(imagePreflight).toContain("--runtime-env-stdin");
    expect(imagePreflight).toContain("--network none");
    expect(imagePreflight).toContain("app_image_id=$(resolve_image_id");
    expect(imagePreflight).toContain('"$app_image_id"');
  });

  it("stops runtimes, runs exactly one explicit migration, then starts with verified IDs and no pulls", () => {
    for (const source of [deploy, rootStart]) {
      const stop = source.indexOf("stop_runtime_services() {");
      const migration = source.indexOf("run_verified_migration() {");
      const start = source.indexOf("start_verified_runtimes() {");
      expect(stop).toBeGreaterThan(0);
      expect(migration).toBeGreaterThan(stop);
      expect(start).toBeGreaterThan(migration);
      expect(source.slice(migration, start)).toContain("--pull never");
      expect(source.slice(migration, start)).toContain("|| return 1");
      expect(source.slice(stop, migration)).toContain(
        "compose stop reconciliation-worker retention-worker app",
      );
      expect(source.slice(start)).toContain("--no-deps --no-build --pull never");
      expect(source).toContain("CLEAN_PAY_IMAGE=$CLEAN_PAY_VERIFIED_APP_IMAGE");
      const runtimeStart = source.slice(
        source.indexOf("start_verified_runtimes() {"),
        source.indexOf("cleanup_build_artifacts() {") > 0
          ? source.indexOf("cleanup_build_artifacts() {")
          : source.indexOf("assert_reconciliation_worker() {"),
      );
      expect(runtimeStart.indexOf("--wait-timeout 180 app")).toBeLessThan(
        runtimeStart.indexOf("retention-worker"),
      );
      expect(runtimeStart).toContain("|| return 1");
    }

    expect(prodCommand).toContain("childEnvironment.CLEAN_PAY_IMAGE = verifiedImages.application");
    expect(prodCommand).toContain('"--no-deps", "--no-build", "--pull", "never"');
    const nodeRuntimeStart = prodCommand.slice(
      prodCommand.indexOf("function startVerifiedRuntimes() {"),
      prodCommand.indexOf("function prepareRemnashopPaymentRollout"),
    );
    expect(nodeRuntimeStart.indexOf('"--wait-timeout", "180", "app"')).toBeLessThan(
      nodeRuntimeStart.indexOf('...services'),
    );
  });

  it("checks and prunes disk only inside the build branch", () => {
    const prepare = deploy.slice(
      deploy.indexOf("prepare_images() {"),
      deploy.indexOf("cleanup_verified_images() {"),
    );
    const buildBranch = prepare.slice(prepare.indexOf("build)"), prepare.indexOf("pull)"));
    const pullBranch = prepare.slice(prepare.indexOf("pull)"));

    expect(buildBranch).toContain("ensure_build_disk_space");
    expect(pullBranch).not.toContain("ensure_build_disk_space");
    expect(pullBranch).not.toContain("prune");
  });

  it("fails closed unless pull references are exact target-specific digests", () => {
    expect(productionRules).toContain('source !== "build" && source !== "pull"');
    expect(productionRules).toContain("@sha256:([a-f0-9]{64})");
    expect(productionRules).toContain(
      "CLEAN_PAY_IMAGE and CLEAN_PAY_MIGRATION_IMAGE must use different sha256 digests",
    );
  });

  it("pins both build roots to one multi-platform Node index digest", () => {
    const pinnedBase =
      "node:24.18.0-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d";

    expect(dockerfile.match(new RegExp(pinnedBase, "g"))).toHaveLength(2);
    expect(dockerfile).not.toMatch(/^FROM node:24\.18\.0-bookworm-slim AS/m);
  });

  it("publishes the paired GHCR targets from one manual workflow invocation", () => {
    const workflow = readFileSync(".github/workflows/publish-images.yml", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("validate-public-build.mjs");
    expect(workflow).toContain("Reject existing immutable GHCR tags");
    expect(workflow.match(/--build-arg CLEAN_PAY_REVISION="\$GITHUB_SHA"/g)).toHaveLength(2);
    expect(workflow).toContain("CLEAN_PAY_IMAGE=%s");
    expect(workflow).toContain("CLEAN_PAY_MIGRATION_IMAGE=%s");
  });
});
