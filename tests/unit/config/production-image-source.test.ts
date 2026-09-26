import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const deploy = readFileSync("deploy.sh", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const prodCommand = readFileSync("deploy/prod/prod.mjs", "utf8");
const productionRules = readFileSync("runtime/production-env-rules.mjs", "utf8");
const imagePreflight = readFileSync("deploy/prod/image-preflight.sh", "utf8");
const dockerfile = readFileSync("Dockerfile", "utf8");
const publicBuildContract = readFileSync(
  "scripts/security/compute-public-build-contract.mjs",
  "utf8",
);

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
    expect(readFileSync("deploy.sh", "utf8")).toContain(
      `NODE_TOOLING_IMAGE="${pinnedBase}"`,
    );
  });

  it("computes an ordered, versioned and unambiguous public build contract", () => {
    expect(publicBuildContract).toContain('const CONTRACT_VERSION = "1"');
    expect(publicBuildContract).toContain("writeBigUInt64BE");
    expect(publicBuildContract).toContain('createHash("sha256")');

    const contractEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NEXT_PUBLIC_APP_URL: "https://pay.example.test",
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "0x4AAAAAContractSiteKey0123456789",
      NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
      NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
    };
    const compute = (environment: NodeJS.ProcessEnv = contractEnvironment) =>
      spawnSync(process.execPath, ["scripts/security/compute-public-build-contract.mjs"], {
        encoding: "utf8",
        env: environment,
      });
    const baseline = compute();
    const version = spawnSync(
      process.execPath,
      ["scripts/security/compute-public-build-contract.mjs", "--version"],
      { encoding: "utf8", env: contractEnvironment },
    );

    expect(baseline.status).toBe(0);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toBe("1");
    expect(baseline.stdout.trim()).toBe(
      "d603b7aca533e270455eda95a1d8267e2ee69564755801377c26e6a8b7a76599",
    );
    for (const name of [
      "NEXT_PUBLIC_APP_URL",
      "TURNSTILE_ENABLED",
      "TURNSTILE_SITE_KEY",
      "NEXT_PUBLIC_BRAND_NAME",
      "NEXT_PUBLIC_BRAND_LOGO_URL",
    ] as const) {
      const changed = compute({ ...contractEnvironment, [name]: `${contractEnvironment[name]}-changed` });
      expect(changed.status).toBe(0);
      expect(changed.stdout).not.toBe(baseline.stdout);
    }

    const missing = { ...contractEnvironment };
    delete missing.TURNSTILE_SITE_KEY;
    const rejected = compute(missing);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("TURNSTILE_SITE_KEY is required");
  });

  it("reserves internal SHA and candidate tag namespaces", () => {
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      CLEAN_PAY_RELEASE: "0.1.1",
      NEXT_PUBLIC_APP_URL: "https://pay.clean-pay.dev",
      NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
      NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
      TURNSTILE_ENABLED: "true",
      TURNSTILE_SITE_KEY: "0x4AAAAAReleaseSiteKey0123456789",
    };
    const validate = (release: string) => spawnSync(
      process.execPath,
      ["deploy/prod/validate-public-build.mjs"],
      {
        encoding: "utf8",
        env: { ...environment, CLEAN_PAY_RELEASE: release },
      },
    );

    expect(validate("0.1.1").status).toBe(0);
    for (const release of ["sha-deadbeef", "SHA-deadbeef", "candidate-123-1"]) {
      const rejected = validate(release);
      expect(rejected.status, release).toBe(1);
      expect(rejected.stderr).toContain("reserved sha-* or candidate-*");
    }
  });

  it("stages and promotes paired GHCR targets through an exact-digest approval boundary", () => {
    const workflow = readFileSync(".github/workflows/publish-images.yml", "utf8");

    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("default: stage");
    expect(workflow).toContain("application_candidate:");
    expect(workflow).toContain("migration_candidate:");
    expect(workflow).toContain("candidate_revision:");
    const workflowDefaults = workflow.slice(
      workflow.indexOf("permissions:"),
      workflow.indexOf("jobs:"),
    );
    const publishJob = workflow.slice(
      workflow.indexOf("  publish:"),
      workflow.indexOf("  scan-candidates:"),
    );
    const scanJob = workflow.slice(
      workflow.indexOf("  scan-candidates:"),
      workflow.indexOf("  smoke-candidates:"),
    );
    const smokeJob = workflow.slice(
      workflow.indexOf("  smoke-candidates:"),
      workflow.indexOf("  stage-complete:"),
    );
    const stageJob = workflow.slice(
      workflow.indexOf("  stage-complete:"),
      workflow.indexOf("  promote:"),
    );
    const promoteJob = workflow.slice(workflow.indexOf("  promote:"));

    expect(workflowDefaults).toContain("packages: read");
    expect(workflowDefaults).not.toContain("packages: write");
    expect(publishJob).toContain("packages: write");
    expect(scanJob).toContain("packages: read");
    expect(scanJob).not.toContain("packages: write");
    expect(smokeJob).toContain("packages: read");
    expect(smokeJob).not.toContain("packages: write");
    expect(stageJob).not.toContain("packages: write");
    expect(promoteJob).toContain("packages: write");
    expect(workflow.match(/packages: write/g)).toHaveLength(2);
    expect(workflow).toContain("linux/amd64,linux/arm64");
    expect(workflow).toContain("validate-public-build.mjs");
    expect(workflow).toContain("compute-public-build-contract.mjs");
    expect(workflow).toContain("compute-public-build-contract.mjs --version");
    expect(workflow).toContain("public-build-contract-version:");
    expect(workflow).toContain("public-build-contract-sha256:");
    expect(workflow).not.toContain('CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION: "1"');
    expect(workflow.match(/--build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION=/g)).toHaveLength(2);
    expect(workflow.match(/--build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256=/g)).toHaveLength(2);
    expect(workflow.match(/--annotation "index:io\.clean-pay\.public-build-contract-version=/g)).toHaveLength(2);
    expect(workflow.match(/--annotation "index:io\.clean-pay\.public-build-contract-sha256=/g)).toHaveLength(2);
    expect(dockerfile.match(/io\.clean-pay\.public-build-contract-version=/g)).toHaveLength(2);
    expect(dockerfile.match(/io\.clean-pay\.public-build-contract-sha256=/g)).toHaveLength(2);
    expect(dockerfile.match(/ARG CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION=local/g))
      .toHaveLength(2);
    expect(workflow).toContain("Guard absent-or-exact immutable GHCR tags");
    expect(workflow).toContain("sha-*|candidate-*");
    expect(workflow).toContain("assert_tag_absent_or_exact");
    expect(workflow).toContain("already has the exact approved digest");
    expect(workflow.match(/--build-arg CLEAN_PAY_REVISION="\$GITHUB_SHA"/g)).toHaveLength(2);
    expect(workflow).toContain('candidate_tag="candidate-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
    expect(workflow).toContain("Promotion checkout may differ from the staged source only by the exact-image approval policy");
    expect(workflow).toContain(
      'git show "${SOURCE_REVISION}:security/container-vulnerability-exceptions.json"',
    );
    expect(workflow).toContain(
      "approval must be added only after staged evidence review",
    );
    expect(workflow).toContain("Verify and reuse only the explicitly approved staged candidates");
    expect(workflow).toContain("Candidate index metadata does not match the exact promotion inputs");
    expect(workflow).toContain("Candidate %s child metadata for linux/%s");
    expect(workflow).toContain('.annotations["io.clean-pay.public-build-contract-sha256"]');
    expect(workflow).toContain('."io.clean-pay.baked-public-app-url" == $app_url');
    expect(workflow).toContain('."io.clean-pay.baked-brand-name" == $brand_name');
    expect(workflow).toContain('."io.clean-pay.baked-brand-logo-url" == $brand_logo_url');
    expect(workflow).toContain('."io.clean-pay.baked-turnstile-site-key" == $turnstile_site_key');
    expect(workflow).toContain("platform-reference");
    expect(workflow).toContain("candidate.index.json");
    expect(workflow).toContain("--expected-platform-image");
    expect(workflow).toContain("--candidate-revision");
    expect(workflow).toContain("canonical gated-report SHA-256");
    expect(workflow).toContain("unreviewed runnable platform");
    expect(workflow).toContain("requestedApproval");
    expect(workflow).toContain("stage-complete:");
    expect(workflow.match(/sha_tag="sha-\$\{SOURCE_REVISION\}"/g)).toHaveLength(2);
    expect(workflow).not.toContain('sha_tag="sha-${GITHUB_SHA}"');
    expect(workflow).toContain("SOURCE_REVISION: ${{ needs.publish.outputs.source-revision }}");
    expect(workflow).toContain("printf 'CLEAN_PAY_REVISION=%s\\n' \"$SOURCE_REVISION\"");
    expect(workflow).toContain("needs: [publish, scan-candidates, smoke-candidates]");
    expect(workflow).toContain("smoke-candidates:");
    expect(workflow).toContain("scripts/security/smoke-published-candidate.sh");
    const candidateSmoke = readFileSync(
      "scripts/security/smoke-published-candidate.sh",
      "utf8",
    );
    expect(candidateSmoke).toContain("run_pre_guard_migrations");
    expect(candidateSmoke).toContain("compute-public-build-contract.mjs");
    expect(candidateSmoke).toContain("compute-public-build-contract.mjs --version");
    expect(candidateSmoke).toContain("CLEAN_PAY_EXPECTED_PUBLIC_BUILD_CONTRACT_SHA256");
    expect(candidateSmoke).toContain("io.clean-pay.public-build-contract-sha256");
    expect(candidateSmoke).toContain("CLEAN_PAY_BAKED_PUBLIC_APP_URL");
    expect(candidateSmoke).toContain("CLEAN_PAY_BAKED_BRAND_NAME");
    expect(candidateSmoke).toContain("CLEAN_PAY_BAKED_BRAND_LOGO_URL");
    expect(candidateSmoke).toContain("CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID");
    expect(candidateSmoke).not.toContain("run_pre_hold_migrations");
    expect(candidateSmoke).toContain(
      "20260825220000_add_payment_retention_hold_lifecycle",
    );
    expect(candidateSmoke).toContain(
      'rm -rf "$partial/prisma/migrations/20260825230000_guard_retention_mutations"',
    );
    expect(candidateSmoke).not.toContain(
      'rm -rf "$partial/prisma/migrations/20260825220000_add_payment_retention_hold_lifecycle"',
    );
    expect(candidateSmoke.match(/rm -rf "\$partial\/prisma\/migrations\//gu)).toHaveLength(1);
    expect(candidateSmoke).toContain("stop exactly at the pre-guard head");
    expect(candidateSmoke).toContain(
      "migration_name = '20260825230000_guard_retention_mutations' AND finished_at IS NOT NULL AND rolled_back_at IS NULL",
    );
    expect(candidateSmoke).toContain('INSERT INTO "PaymentOperation"');
    expect(candidateSmoke).toContain('INSERT INTO "PaymentRecord"');
    expect(candidateSmoke).toContain('FROM "_prisma_migrations"');
    expect(candidateSmoke).toContain("populated forward and no-op sandbox smoke");
    expect(workflow).toContain("if: inputs.mode == 'promote'");
    expect(workflow).toContain("Promote only the scanned multi-platform digests");
    expect(workflow).toContain('test "$observed_digest" = "$expected_digest"');
    expect(workflow.indexOf("scan-candidates:")).toBeLessThan(workflow.indexOf("promote:"));
    expect(workflow.indexOf("smoke-candidates:")).toBeLessThan(workflow.indexOf("promote:"));
    expect(workflow).toContain("CLEAN_PAY_IMAGE=%s");
    expect(workflow).toContain("CLEAN_PAY_MIGRATION_IMAGE=%s");
  });

  it("passes dispatch inputs to shell steps only through the environment", () => {
    const workflow = readFileSync(".github/workflows/publish-images.yml", "utf8");
    const lines = workflow.split(/\r?\n/u);
    const runScripts: string[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const match = /^(\s*)run:\s*(.*)$/u.exec(line);
      if (!match) continue;
      const indentation = match[1]?.length ?? 0;
      const inline = match[2] ?? "";
      if (!/^[|>][0-9+-]*(?:\s+#.*)?$/u.test(inline)) {
        runScripts.push(inline);
        continue;
      }

      const block: string[] = [];
      for (index += 1; index < lines.length; index += 1) {
        const blockLine = lines[index] ?? "";
        const blockIndentation = /^\s*/u.exec(blockLine)?.[0].length ?? 0;
        if (blockLine.trim() !== "" && blockIndentation <= indentation) {
          index -= 1;
          break;
        }
        block.push(blockLine);
      }
      runScripts.push(block.join("\n"));
    }

    expect(runScripts.length).toBeGreaterThan(0);
    expect(runScripts.filter((script) => script.includes("${{ inputs."))).toEqual([]);
    expect(workflow.match(/PUBLISH_MODE: \$\{\{ inputs\.mode \}\}/gu))
      .toHaveLength(4);
  });
});
