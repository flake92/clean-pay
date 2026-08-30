import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const dockerfile = readFileSync("Dockerfile", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts: Record<string, string>;
};
const compose = readFileSync("deploy/prod/docker-compose.yml", "utf8");
const rootCompose = readFileSync("docker-compose.yml", "utf8");
const rootStart = readFileSync("start.sh", "utf8");
const start = readFileSync("deploy/prod/start.sh", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");
const dataServiceSandbox = readFileSync(
  "scripts/security/verify-data-service-sandbox.sh",
  "utf8",
);
const runtimeSandbox = readFileSync(
  "scripts/security/verify-runtime-sandbox.sh",
  "utf8",
);
const imageRollbackRehearsal = readFileSync(
  "scripts/security/rehearse-zero-downtime-image-rollback.sh",
  "utf8",
);
const disposableTrafficContinuity = readFileSync(
  "scripts/security/disposable-traffic-continuity.mjs",
  "utf8",
);
const disposableReadinessProvider = readFileSync(
  "scripts/security/disposable-readiness-provider.mjs",
  "utf8",
);
const disposableRollbackReport = readFileSync(
  "scripts/security/disposable-image-rollback-report.mjs",
  "utf8",
);
const publishedCandidateSmoke = readFileSync(
  "scripts/security/smoke-published-candidate.sh",
  "utf8",
);
const gracefulRequestProbe = readFileSync(
  "scripts/security/verify-app-graceful-request.mjs",
  "utf8",
);
const migrationRehearsals = [
  "scripts/security/rehearse-clean-pay-migrations.sh",
  "scripts/security/rehearse-remnashop-migrations.sh",
].map((path) => [path, readFileSync(path, "utf8")] as const);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const devcontainerCompose = readFileSync(".devcontainer/docker-compose.yml", "utf8");
const operationalYamlImageSources = [
  ".devcontainer/docker-compose.yml",
  ".github/workflows/ci.yml",
  "docker-compose.yml",
  "deploy/prod/docker-compose.yml",
].map((path) => [path, readFileSync(path, "utf8")] as const);
const operationalHelperImageSources = [
  "deploy/prod/host-safety.mjs",
  "deploy/prod/redis-host-safety.sh",
].map((path) => [path, readFileSync(path, "utf8")] as const);

describe("production container boundary", () => {
  it("pins every externally pulled devcontainer image by digest", () => {
    const literalImageReferences = [...devcontainerCompose.matchAll(
      /^\s*image:\s*["']?([^\s"']+)/gm,
    )]
      .map((match) => match[1]!)
      .filter((reference) => !reference.startsWith("${"));

    expect(literalImageReferences.length).toBeGreaterThan(0);
    for (const reference of literalImageReferences) {
      expect(reference, reference).toMatch(/@sha256:[a-f0-9]{64}$/);
    }
  });

  it("pins every PostgreSQL and Redis operational image reference by digest", () => {
    for (const [path, source] of operationalYamlImageSources) {
      const references = [...source.matchAll(
        /^\s*image:\s*["']?((?:postgres|redis|valkey\/valkey):[A-Za-z0-9][A-Za-z0-9._-]*(?:@sha256:[a-f0-9]{64})?)/gm,
      )].map((match) => match[1]!);
      expect(references.length, `${path}: data-service images`).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference, `${path}: ${reference}`).toMatch(
          /@sha256:[a-f0-9]{64}$/,
        );
      }
    }
    for (const [path, source] of operationalHelperImageSources) {
      const references = source.match(
        /(?:postgres|redis):[A-Za-z0-9][A-Za-z0-9._-]*(?:@sha256:[a-f0-9]{64})?/g,
      ) ?? [];
      expect(references.length, `${path}: helper image`).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference, `${path}: ${reference}`).toMatch(
          /@sha256:[a-f0-9]{64}$/,
        );
      }
    }
  });

  it("sandboxes every application runtime role with explicit resource bounds", () => {
    for (const [path, source] of [
      ["docker-compose.yml", rootCompose],
      ["deploy/prod/docker-compose.yml", compose],
    ] as const) {
      const sandbox = source.split(/\nx-clean-pay-runtime-sandbox:/)[1]
        ?.split(/\nservices:/)[0] ?? "";
      expect(sandbox, path).toContain("read_only: true");
      expect(sandbox, path).toContain("cap_drop: [ALL]");
      expect(sandbox, path).toContain("security_opt: [no-new-privileges:true]");

      for (const [role, nextRole] of [
        ["migration", "app"],
        ["app", "reconciliation-worker"],
        ["reconciliation-worker", "retention-worker"],
        ["retention-worker", "postgres"],
      ] as const) {
        const section = source.split(`\n  ${role}:\n`)[1]
          ?.split(`\n  ${nextRole}:\n`)[0] ?? "";
        expect(section, `${path}: ${role}`).toContain("<<: *clean-pay-runtime-sandbox");
        expect(section, `${path}: ${role}`).toMatch(/pids_limit: \d+/);
        expect(section, `${path}: ${role}`).toMatch(/mem_limit: (?:512m|1g)/);
        expect(section, `${path}: ${role}`).toMatch(/cpus: (?:0\.5|1\.0)/);
        expect(section, `${path}: ${role}`).toContain("/tmp:rw,noexec,nosuid,nodev");
        if (role === "app") {
          expect(section, `${path}: writable Next cache ownership`).toContain(
            "/app/.next/cache:rw,noexec,nosuid,nodev,size=128m,mode=0700,uid=1001,gid=1001",
          );
        }
      }

      for (const [role, nextRole] of [
        ["postgres", "redis"],
        ["redis", "volumes"],
      ] as const) {
        const section = source.split(`\n  ${role}:\n`)[1]
          ?.split(`\n${nextRole === "volumes" ? "" : "  "}${nextRole}:\n`)[0] ?? "";
        expect(section, `${path}: ${role}`).toContain(
          "security_opt: [no-new-privileges:true]",
        );
        expect(section, `${path}: ${role}`).toContain("read_only: true");
        expect(section, `${path}: ${role}`).toContain("cap_drop: [ALL]");
        expect(section, `${path}: ${role}`).toMatch(/pids_limit: \d+/);
        expect(section, `${path}: ${role}`).toMatch(/mem_limit: (?:512m|1g)/);
        expect(section, `${path}: ${role}`).toMatch(/cpus: (?:0\.5|1\.0)/);
        expect(section, `${path}: ${role}`).toContain(
          role === "postgres" ? 'user: "70:70"' : 'user: "999:1000"',
        );
        expect(section, `${path}: ${role}`).toContain(
          "/tmp:rw,noexec,nosuid,nodev",
        );
        expect(section, `${path}: ${role}`).toContain(
          role === "postgres"
            ? "postgres-data:/var/lib/postgresql/data"
            : "redis-data:/data",
        );
        if (role === "postgres") {
          expect(section, `${path}: ${role}`).toContain(
            "/var/run/postgresql:rw,noexec,nosuid,nodev",
          );
        }
      }
    }
  });

  it("rehearses data-service health, writable data, and immutable roots in CI", () => {
    expect(ci).toContain("Verify hardened data-service runtime boundaries");
    expect(ci).toContain("bash scripts/security/verify-data-service-sandbox.sh");
    expect(ci).toContain("--read-only --cap-drop ALL");
    expect(ci).toContain("touch /app/clean-pay-write-probe");
    expect(ci).toContain("/_next/image?url=%2Fclean-pay-logo.png");
    expect(ci).toContain("touch /app/.next/cache/clean-pay-write-probe");
    expect(dataServiceSandbox).toContain("compose up --detach --wait");
    for (const roleFile of [
      ".env.app",
      ".env.migration",
      ".env.postgres",
      ".env.reconciliation",
      ".env.retention",
    ]) {
      expect(dataServiceSandbox).toContain(roleFile);
    }
    expect(dataServiceSandbox).toContain(".State.Health.Status");
    expect(dataServiceSandbox).toContain("touch /usr/local/clean-pay-sandbox-write");
    expect(dataServiceSandbox).toContain("CREATE TABLE sandbox_write_probe");
    expect(dataServiceSandbox).toContain("redis-cli SET clean-pay-sandbox-probe");
    expect(dataServiceSandbox).toContain("compose down --volumes --remove-orphans");
  });

  it("bounds pinned data-service pulls before Compose starts without registry access", () => {
    expect(dataServiceSandbox).toContain(
      "timeout --signal=TERM --kill-after=10s 180s",
    );
    expect(dataServiceSandbox).toContain("compose config --images postgres redis");
    expect(dataServiceSandbox).toContain("for attempt in 1 2");
    expect(dataServiceSandbox).toContain("docker_bounded pull --quiet");
    expect(dataServiceSandbox).toContain("--pull never postgres redis");
    expect(dataServiceSandbox).toContain(
      "postgres:17-alpine@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73",
    );
    expect(dataServiceSandbox).toContain(
      "redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf",
    );
    expect(dataServiceSandbox).toContain("postgres_image_count != 1");
    expect(dataServiceSandbox).toContain("redis_image_count != 1");
    expect(dataServiceSandbox).toContain("docker_bounded image inspect");
    expect(dataServiceSandbox).toContain("docker_bounded exec");
    expect(dataServiceSandbox).toContain(
      '${RUNNER_TEMP:-${TMPDIR:-/tmp}}',
    );
    expect(dataServiceSandbox).toContain(
      'mktemp --directory "$TEMPORARY_PROJECT_PARENT/clean-pay-data-sandbox.XXXXXX"',
    );
    expect(dataServiceSandbox).toContain(
      'label=com.docker.compose.project=$PROJECT_NAME',
    );
    expect(dataServiceSandbox).toContain("data-service sandbox exact cleanup was not proven");
  });

  it("builds both CI images with the canonical public build contract", () => {
    const buildStep = ci.slice(
      ci.indexOf("Build both exact executable container targets"),
      ci.indexOf("Smoke-test migration image environment validation"),
    );

    expect(buildStep).toContain("compute-public-build-contract.mjs --version");
    expect(buildStep).toContain('public_contract_sha256="$(node scripts/security/compute-public-build-contract.mjs)"');
    expect(buildStep.match(/--build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_VERSION=/g))
      .toHaveLength(2);
    expect(buildStep.match(/--build-arg CLEAN_PAY_PUBLIC_BUILD_CONTRACT_SHA256=/g))
      .toHaveLength(2);
  });

  it("runs the migration, workers, negative capability probe and graceful stop live", () => {
    expect(ci).toContain("Verify the full hardened migration and worker topology");
    expect(ci).toContain("scripts/security/verify-runtime-sandbox.sh");
    expect(runtimeSandbox).toContain("compose up --detach --no-build --pull never --wait");
    expect(runtimeSandbox).toContain("_prisma_migrations");
    expect(runtimeSandbox).toContain("reconciliation-worker retention-worker");
    expect(runtimeSandbox).toContain("mount -t tmpfs");
    expect(runtimeSandbox).toContain("compose stop --timeout 120");
    expect(runtimeSandbox).toContain("event=reconciliation_worker_stopped");
    expect(runtimeSandbox).toContain("event=retention_worker_stopped");
  });

  it("rehearses an actual disposable image promotion and rollback with exact ownership", () => {
    const containerJob = ci.slice(
      ci.indexOf("  container-security:"),
      ci.indexOf("  production-image-browser-journey:"),
    );
    const rehearsalStep = containerJob.indexOf(
      "Rehearse exact disposable image promotion and rollback",
    );
    const runtimeStep = containerJob.indexOf(
      "Verify the full hardened migration and worker topology",
    );
    const evidenceStep = containerJob.indexOf(
      "Preserve sanitized image rollback evidence",
    );

    expect(containerJob).toContain("timeout-minutes: 60");
    expect(containerJob).toContain("fetch-depth: 0");
    expect(runtimeStep).toBeGreaterThan(-1);
    expect(rehearsalStep).toBeGreaterThan(runtimeStep);
    expect(evidenceStep).toBeGreaterThan(rehearsalStep);
    expect(containerJob).toContain(
      "bash scripts/security/rehearse-zero-downtime-image-rollback.sh",
    );
    expect(containerJob).toContain("clean-pay:ci clean-pay-migration:ci");
    expect(containerJob).toContain("f5cb6f543d85256e7733a1ade6a4f451d86cf378");
    expect(containerJob).toContain(".image-rollback-rehearsal/report.json");
    expect(containerJob).toContain(".image-rollback-rehearsal/traffic/result.json");
    expect(containerJob).toContain("if-no-files-found: error");

    expect(imageRollbackRehearsal).toContain(
      "tests/fixtures/write-synthetic-production-env.mjs",
    );
    expect(imageRollbackRehearsal).toContain(
      "CLEAN_PAY_FIXTURE_DEPLOY_SOURCE=build",
    );
    expect(imageRollbackRehearsal).toContain(
      'set_env_value "$TARGET_ENV_FILE" CLEAN_PAY_BIND 127.0.0.1',
    );
    expect(imageRollbackRehearsal).toContain(
      'set_env_value "$TARGET_ENV_FILE" PAYMENT_RECONCILIATION_ENABLED false',
    );
    expect(imageRollbackRehearsal).toContain(
      "io.clean-pay.image-rollback.owner=clean-pay-image-rollback-v1",
    );
    expect(imageRollbackRehearsal).toContain(
      "io.clean-pay.image-rollback.role=previous-app",
    );
    expect(imageRollbackRehearsal).toContain(
      "io.clean-pay.image-rollback.role=previous-migration",
    );
    expect(imageRollbackRehearsal).toContain(
      'git -C "$ROOT_DIR" archive --format=tar "$PREVIOUS_REVISION"',
    );
    expect(imageRollbackRehearsal).toContain(
      '-- "${PREVIOUS_ARCHIVE_INPUTS[@]}"',
    );
    expect(imageRollbackRehearsal).toContain(
      'git -C "$ROOT_DIR" ls-tree -r -z --full-tree "$PREVIOUS_REVISION"',
    );
    expect(imageRollbackRehearsal).toContain("records.length !== 358");
    expect(imageRollbackRehearsal).toContain(
      'cp -- "$ROOT_DIR/.dockerignore" "$PREVIOUS_SOURCE_DIR/.dockerignore"',
    );
    expect(imageRollbackRehearsal).toContain('"$PREVIOUS_SOURCE_DIR"');
    expect(imageRollbackRehearsal).toContain(
      '--build-arg CLEAN_PAY_REVISION="$PREVIOUS_REVISION"',
    );
    expect(imageRollbackRehearsal).toContain(
      'set_env_value "$ROLLBACK_ENV_FILE" CLEAN_PAY_REVISION "$PREVIOUS_REVISION"',
    );
    expect(imageRollbackRehearsal).toContain(
      'run_zero_downtime stage --require-no-pending-migrations',
    );
    expect(imageRollbackRehearsal).toContain(
      'run_zero_downtime promote --traffic-on-canary',
    );
    expect(imageRollbackRehearsal).toContain(
      'run_zero_downtime rollback --traffic-on-canary',
    );
    expect(imageRollbackRehearsal).toContain(
      'run_zero_downtime remove --traffic-off-canary',
    );
    expect(imageRollbackRehearsal).toContain(
      'docker compose --project-name "$PROJECT_NAME"',
    );
    expect(imageRollbackRehearsal).toContain(
      'cmp --silent -- "$TARGET_ENV_FILE" "$ROLLBACK_ENV_FILE"',
    );
    expect(imageRollbackRehearsal).toContain("assert_canary_absent");
    expect(imageRollbackRehearsal).toContain(
      'container_id=$(docker ps --all --quiet --no-trunc',
    );
    expect(imageRollbackRehearsal).toContain("VERIFIED_IMAGE_STATE_COUNT=3");
    expect(imageRollbackRehearsal).toContain("start_traffic_continuity");
    expect(imageRollbackRehearsal).toContain("start_readiness_provider");
    expect(imageRollbackRehearsal).toContain("prove_readiness_provider_contract");
    expect(imageRollbackRehearsal).toContain('switch_traffic_route "$route"');
    expect(imageRollbackRehearsal).toContain("stop_traffic_continuity");
    expect(imageRollbackRehearsal).toContain("stop_readiness_provider");
    for (const [phase, route] of [
      ["stage", "primary"],
      ["promote", "canary"],
      ["rollback", "canary"],
      ["remove", "primary"],
    ]) {
      expect(imageRollbackRehearsal).toContain(`begin_traffic_phase ${phase} ${route}`);
      expect(imageRollbackRehearsal).toContain(`end_traffic_phase ${phase} ${route}`);
    }
    const execution = imageRollbackRehearsal.slice(
      imageRollbackRehearsal.indexOf("PHASE=start-previous-stack"),
    );
    const orderedLifecycle = [
      "start_readiness_provider",
      "start_traffic_continuity",
      "begin_traffic_phase stage primary",
      "run_zero_downtime stage --require-no-pending-migrations",
      "end_traffic_phase stage primary",
      "begin_traffic_phase promote canary",
      "run_zero_downtime promote --traffic-on-canary",
      "end_traffic_phase promote canary",
      "begin_traffic_phase rollback canary",
      "run_zero_downtime rollback --traffic-on-canary",
      "end_traffic_phase rollback canary",
      "begin_traffic_phase remove primary",
      "run_zero_downtime remove --traffic-off-canary",
      "assert_canary_absent",
      "end_traffic_phase remove primary",
      "prove_readiness_provider_contract",
      "stop_traffic_continuity",
      "stop_readiness_provider",
      "cleanup_owned_resources",
    ];
    let lifecycleOffset = -1;
    for (const marker of orderedLifecycle) {
      const nextOffset = execution.indexOf(marker, lifecycleOffset + 1);
      expect(nextOffset, marker).toBeGreaterThan(lifecycleOffset);
      lifecycleOffset = nextOffset;
    }
    const beginPhase = imageRollbackRehearsal.slice(
      imageRollbackRehearsal.indexOf("begin_traffic_phase()"),
      imageRollbackRehearsal.indexOf("end_traffic_phase()"),
    );
    expect(beginPhase.indexOf('switch_traffic_route "$route"')).toBeLessThan(
      beginPhase.indexOf('traffic_phase_checkpoint "$phase" before "$route"'),
    );
    const endPhase = imageRollbackRehearsal.slice(
      imageRollbackRehearsal.indexOf("end_traffic_phase()"),
      imageRollbackRehearsal.indexOf("stop_traffic_continuity()"),
    );
    expect(endPhase.indexOf('traffic_phase_checkpoint "$phase" after "$route"'))
      .toBeLessThan(endPhase.indexOf("prove-progress"));
    expect(endPhase.indexOf("prove-progress"))
      .toBeLessThan(endPhase.indexOf("VERIFIED_TRAFFIC_PHASE_COUNT="));

    const cleanupStart = imageRollbackRehearsal.indexOf(
      "cleanup_owned_resources()",
    );
    const cleanup = imageRollbackRehearsal.slice(
      cleanupStart,
      imageRollbackRehearsal.indexOf("\non_exit()", cleanupStart),
    );
    expect(cleanup).toContain("cleanup_canary");
    expect(cleanup).toContain("cleanup_auxiliary_container");
    expect(cleanup).toContain('"$TRAFFIC_CONTAINER_NAME" "$TRAFFIC_CONTAINER_ID"');
    expect(cleanup).toContain(
      '"$READINESS_PROVIDER_CONTAINER_NAME" "$READINESS_PROVIDER_CONTAINER_ID"',
    );
    expect(cleanup).toContain("down --remove-orphans --volumes --timeout 120");
    expect(cleanup).toContain('label=com.docker.compose.project=$PROJECT_NAME');
    expect(cleanup).toContain("cleanup_previous_image");
    expect(cleanup).toContain("io.clean-pay.image-rollback.owner");
    expect(imageRollbackRehearsal).toContain(
      '[[ -z "$expected_id" || "$listed_id" == "$expected_id" ]]',
    );
    expect(cleanup).toContain("if ! remaining=$(docker ps");
    expect(cleanup).toContain("if ! remaining=$(docker volume ls");
    expect(cleanup).toContain("if ! remaining=$(docker network ls");
    expect(cleanup).not.toMatch(/docker\s+(?:system|volume)\s+prune/u);

    const previousBuilds = imageRollbackRehearsal.slice(
      imageRollbackRehearsal.indexOf("PHASE=build-previous-images"),
      imageRollbackRehearsal.indexOf("PHASE=prepare-synthetic-environment"),
    );
    expect(previousBuilds.indexOf("PREVIOUS_APP_IMAGE_ID=$(image_id")).toBeGreaterThan(
      previousBuilds.indexOf("--tag \"$PREVIOUS_APP_REFERENCE\""),
    );
    expect(previousBuilds.indexOf("--target migration")).toBeGreaterThan(
      previousBuilds.indexOf("PREVIOUS_APP_IMAGE_ID=$(image_id"),
    );
    expect(previousBuilds.indexOf("PREVIOUS_MIGRATION_IMAGE_ID=$(image_id")).toBeGreaterThan(
      previousBuilds.indexOf("--tag \"$PREVIOUS_MIGRATION_REFERENCE\""),
    );

    const reportStart = imageRollbackRehearsal.indexOf("write_report()");
    const reportWriter = imageRollbackRehearsal.slice(
      reportStart,
      imageRollbackRehearsal.indexOf("bootstrap_on_exit()", reportStart),
    );
    expect(reportWriter).toContain("set -C");
    expect(reportWriter).toContain("TARGET_APP_EVIDENCE");
    expect(reportWriter).toContain("PREVIOUS_APP_EVIDENCE");
    expect(reportWriter).toContain("TRAFFIC_CONTINUITY_PROVEN");
    expect(reportWriter).toContain("VERIFIED_IMAGE_STATE_COUNT");
    expect(reportWriter).toContain("clean-pay.disposable-image-rollback.v3");
    expect(reportWriter).toContain("READINESS_PROVIDER_CONTRACT_PROVEN");
    expect(reportWriter).toContain("BASELINE_CONTEXT_ALLOWLIST_PROVEN");
    expect(reportWriter).toContain("ROLLBACK_IMAGE_PREFLIGHT_PROVEN");
    expect(reportWriter).toContain('local temporary="$OUTPUT_DIR/.report.tmp"');
    expect(reportWriter).toContain(
      'node "$REPORT_VALIDATOR_SCRIPT" validate "$temporary"',
    );
    expect(reportWriter).toContain('ln -- "$temporary" "$REPORT_PATH"');
    expect(reportWriter).not.toContain("TARGET_APP_IMAGE_ID");
    expect(reportWriter).not.toContain("PREVIOUS_APP_IMAGE_ID");
    expect(reportWriter).not.toContain("TARGET_ENV_FILE");
    expect(reportWriter).not.toContain("ROLLBACK_ENV_FILE");
    const bootstrapTrap = imageRollbackRehearsal.indexOf(
      "trap bootstrap_on_exit EXIT",
    );
    expect(bootstrapTrap).toBeGreaterThan(reportStart);
    expect(bootstrapTrap).toBeLessThan(
      imageRollbackRehearsal.indexOf('mkdir -- "$OUTPUT_DIR"'),
    );
    expect(imageRollbackRehearsal).toContain(
      'write_report failed "$bootstrap_cleanup_proven"',
    );
    expect(disposableTrafficContinuity).toContain(
      'const livenessPath = "/api/health/liveness"',
    );
    expect(disposableTrafficContinuity).toContain(
      "server.listen(port, bindAddress",
    );
    expect(disposableTrafficContinuity).toContain(
      'const expectedRouteSequence = Object.freeze([',
    );
    expect(disposableTrafficContinuity).toContain(
      'handle = await open(target, "wx", 0o600)',
    );
    expect(disposableTrafficContinuity).toContain("sameIdentity(identity, published)");
    expect(disposableTrafficContinuity).not.toContain("rm(target, { force: true })");
    expect(disposableReadinessProvider).toContain(
      "expectedServiceKeySha256: process.env.CLEAN_PAY_SYNTHETIC_PROVIDER_KEY_SHA256",
    );
    expect(disposableReadinessProvider).toContain("timingSafeEqual(observedHash, expectedHash)");
    expect(disposableReadinessProvider).toContain('const maximumBodyBytes = 1024');
    expect(disposableRollbackReport).toContain(
      'value.schemaVersion !== "clean-pay.disposable-image-rollback.v3"',
    );
    expect(disposableRollbackReport).toContain("new Set(imageIds).size !== imageIds.length");
    expect(disposableRollbackReport).toContain('await open(file, "r+")');
    const readinessProviderLaunch = imageRollbackRehearsal.slice(
      imageRollbackRehearsal.indexOf("start_readiness_provider()"),
      imageRollbackRehearsal.indexOf("prove_readiness_provider_contract()"),
    );
    expect(readinessProviderLaunch).toContain('--network "$EDGE_NETWORK"');
    expect(readinessProviderLaunch).toContain('--network-alias "$READINESS_PROVIDER_ALIAS"');
    expect(readinessProviderLaunch).toContain('--pull never');
    expect(readinessProviderLaunch).not.toContain("--env-file");
    expect(imageRollbackRehearsal).not.toMatch(/\bcaddy\b/iu);
    expect(imageRollbackRehearsal).not.toMatch(/docker\s+system\s+prune/u);
  });

  it("drains an admitted long application request during the 120 second SIGTERM window", () => {
    expect(ci).toContain("verify-app-graceful-request.mjs");
    expect(ci).toContain("clean-pay-ci-runtime 120");
    expect(gracefulRequestProbe).toContain('["stop", "--time", String(graceSeconds), containerName]');
    expect(gracefulRequestProbe).toContain("request.finishRequest()");
    expect(gracefulRequestProbe).toContain("await Promise.all([request.response, stop])");
    expect(gracefulRequestProbe).toContain('stateMatch[1] !== "false"');
    expect(gracefulRequestProbe).toContain('Number(stateMatch[2]) === 137');
  });

  it("isolates concurrent security rehearsals and bounds local HTTP probes", () => {
    expect(runtimeSandbox).toContain('-$$-${RANDOM}');
    expect(publishedCandidateSmoke).toContain('-$$-${RANDOM}');
    for (const [path, source] of migrationRehearsals) {
      expect(source, path).toContain('-$$-${RANDOM}');
    }
    expect(publishedCandidateSmoke.match(/--connect-timeout 2/g)).toHaveLength(2);
    expect(publishedCandidateSmoke.match(/--max-time 10/g)).toHaveLength(2);
    expect(publishedCandidateSmoke).toContain(
      'docker rm --force --volumes "$RUNTIME_CONTAINER" "$PROBE_CONTAINER" "$METADATA_CONTAINER" "$POSTGRES_CONTAINER"',
    );
  });

  it("waits for the final PostgreSQL TCP listener in every disposable security flow", () => {
    const sources = [
      ["scripts/security/smoke-published-candidate.sh", publishedCandidateSmoke, 2],
      ...migrationRehearsals.map(([path, source]) => [path, source, 1] as const),
    ] as const;

    for (const [path, source, expectedProbeCount] of sources) {
      const logicalLines = source
        .replace(/\\\r?\n[ \t]*/gu, " ")
        .split(/\r?\n/u);
      const allReadinessLines = logicalLines.filter((line) => (
        !line.trimStart().startsWith("#") && /\bpg_isready\b/u.test(line)
      ));
      const ownedContainerProbes = allReadinessLines.filter((line) => (
        line.includes('docker exec "$POSTGRES_CONTAINER" pg_isready')
      ));

      expect(allReadinessLines, `${path}: only exact owned-container probes`)
        .toEqual(ownedContainerProbes);
      expect(ownedContainerProbes, `${path}: exact readiness probe count`)
        .toHaveLength(expectedProbeCount);
      for (const probe of ownedContainerProbes) {
        const hostOptions = probe.match(
          /(?:^|\s)(?:--host(?:=[^\s;&|]+|\s+[^\s;&|]+)|-h(?:[^\s;&|]+|\s+[^\s;&|]+))/gu,
        )?.map((option) => option.trim()) ?? [];
        expect(hostOptions, `${path}: one authoritative final-server host`)
          .toEqual(["--host 127.0.0.1"]);
      }
    }
  });

  it("generates Prisma once through the npm prebuild lifecycle", () => {
    const builder = dockerfile.slice(
      dockerfile.indexOf("AS builder"),
      dockerfile.indexOf("AS runtime-base"),
    );

    expect(packageJson.scripts.prebuild).toBe("npm run prisma:generate");
    expect(builder).toContain("npm run build");
    expect(builder).not.toContain("npm run prisma:generate");
  });

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

  it("labels both targets as one traceable release with app public metadata", () => {
    const migration = dockerfile.slice(
      dockerfile.indexOf("AS migration"),
      dockerfile.indexOf("AS runner"),
    );
    const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));

    for (const target of [migration, runner]) {
      expect(target).toContain('org.opencontainers.image.revision="${CLEAN_PAY_REVISION}"');
      expect(target).toContain('org.opencontainers.image.version="${CLEAN_PAY_RELEASE}"');
      expect(target).toContain('io.clean-pay.release="${CLEAN_PAY_RELEASE}"');
    }
    expect(migration).toContain('io.clean-pay.role="migration"');
    expect(runner).toContain('io.clean-pay.role="app"');
    expect(runner).toContain('io.clean-pay.baked-public-app-url="${NEXT_PUBLIC_APP_URL}"');
    expect(runner).toContain('io.clean-pay.baked-brand-name="${NEXT_PUBLIC_BRAND_NAME}"');
    expect(runner).toContain('io.clean-pay.baked-brand-logo-url="${NEXT_PUBLIC_BRAND_LOGO_URL}"');

    for (const source of [compose, rootCompose]) {
      expect(source.match(/CLEAN_PAY_RELEASE: \$\{CLEAN_PAY_RELEASE:-local\}/g)).toHaveLength(2);
      expect(source.match(/CLEAN_PAY_REVISION: \$\{CLEAN_PAY_REVISION:-local\}/g)).toHaveLength(2);
    }
  });
});

describe("root production container boundary", () => {
  it("places the standalone server at the path used by the shared startup script", () => {
    const runner = dockerfile.slice(dockerfile.indexOf("AS runner"));

    expect(dockerfile).toContain("package.json package-lock.json .npmrc");
    expect(runner).toContain("/app/.next/standalone ./");
    expect(runner).toContain("/app/.next/static ./.next/static");
    expect(runner).not.toContain("/app/.next ./.next");
    expect(runner).not.toContain("/app/node_modules ./node_modules");
    expect(start).toContain("exec node server.js");
  });

  it("runs migrations once before the root application and workers can start", () => {
    const migration = dockerfile.slice(
      dockerfile.indexOf("AS migration"),
      dockerfile.indexOf("AS runner"),
    );

    expect(dockerfile).toContain("AS migration");
    expect(dockerfile).toContain(
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
    expect(dockerfile).toContain("ARG TURNSTILE_ENABLED=true");
    expect(dockerfile).toContain(
      "ARG TURNSTILE_WIDGET_ID=build-time-placeholder-site-key",
    );
    expect(rootCompose.match(/TURNSTILE_ENABLED: \$\{TURNSTILE_ENABLED:\?TURNSTILE_ENABLED=true is required\}/g))
      .toHaveLength(1);
    expect(rootCompose).toContain("TURNSTILE_WIDGET_ID: ${TURNSTILE_SITE_KEY:-}");
    expect(rootCompose).not.toContain("TURNSTILE_ENABLED: ${TURNSTILE_ENABLED:-false}");
  });

  it("keeps the app on both the private service and external edge networks", () => {
    for (const [path, source] of [
      ["docker-compose.yml", rootCompose],
      ["deploy/prod/docker-compose.yml", compose],
    ] as const) {
      const app = source.split(/\n  app:\n/)[1]?.split(/\n  reconciliation-worker:\n/)[0] ?? "";

      expect(app, path).toMatch(
        /networks:\s+default:\s+edge:\s+aliases:\s+- clean-pay/,
      );
      expect(source, path).toMatch(
        /\nnetworks:\s+edge:\s+external: true\s+name: \$\{CLEAN_PAY_EDGE_NETWORK:-remnawave-network\}/,
      );
    }
  });
});
