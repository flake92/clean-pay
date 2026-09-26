import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import {
  COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES,
  ProductionEnvironmentError,
  validateDeploymentImageReferences,
  validateProductionPublicBuildConfiguration,
} from "../../../deploy/prod/production-env-rules.mjs";

const posixShell = process.platform === "win32"
  ? ["C:/Program Files/Git/bin/sh.exe", "C:/Program Files/Git/usr/bin/sh.exe"]
      .find((candidate) => existsSync(candidate))
  : "sh";
const shellIntegrationTimeout = process.platform === "win32" ? 45_000 : 15_000;
const deployScript = readFileSync("deploy.sh", "utf8");

function shellFunctionFrom(source: string, name: string) {
  const start = source.indexOf(`${name}() {`);
  expect(start, `${name} must exist`).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("\n", start) + 1;
  const nextFunction = source.slice(bodyStart).search(/^\w+\(\) \{/m);
  return nextFunction < 0
    ? source.slice(start)
    : source.slice(start, bodyStart + nextFunction);
}

function imageReferences(overrides: Record<string, string> = {}) {
  return {
    CLEAN_PAY_DEPLOY_SOURCE: "build",
    CLEAN_PAY_IMAGE: "clean-pay-app:test",
    CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-migration:test",
    ...overrides,
  };
}

function validationError(environment: Record<string, string>) {
  try {
    validateDeploymentImageReferences(environment);
  } catch (error) {
    expect(error).toBeInstanceOf(ProductionEnvironmentError);
    return (error as Error).message;
  }

  throw new Error("Expected image reference validation to fail");
}

describe("deployment image reference validation", () => {
  it("accepts distinct explicit build tags and rejects ambiguous or shared targets", () => {
    expect(validateDeploymentImageReferences(imageReferences())).toMatchObject({
      source: "build",
      applicationImage: "clean-pay-app:test",
      migrationImage: "clean-pay-migration:test",
    });
    expect(validateDeploymentImageReferences(imageReferences({
      CLEAN_PAY_IMAGE: "registry.example:5000/owner/clean-pay-app:v1",
      CLEAN_PAY_MIGRATION_IMAGE: "registry.example:5000/owner/clean-pay-migration:v1",
    })).source).toBe("build");
    expect(validationError(imageReferences({ CLEAN_PAY_IMAGE: "clean-pay-app" })))
      .toContain("explicit tag");
    expect(validationError(imageReferences({
      CLEAN_PAY_IMAGE: `clean-pay-app@sha256:${"a".repeat(64)}`,
    }))).toContain("non-digest");
    expect(validationError(imageReferences({
      CLEAN_PAY_MIGRATION_IMAGE: "clean-pay-app:test",
    }))).toContain("different target images");
    expect(validationError(imageReferences({
      CLEAN_PAY_IMAGE: "GHCR.io/owner/clean-pay-app:test",
    }))).toContain("valid non-digest tagged image reference");
    expect(validationError(imageReferences({
      CLEAN_PAY_IMAGE: "ghcr..io/owner/clean-pay-app:test",
    }))).toContain("valid non-digest tagged image reference");
    expect(validationError(imageReferences({
      CLEAN_PAY_IMAGE: "registry.example:70000/owner/clean-pay-app:test",
    }))).toContain("valid non-digest tagged image reference");
  });

  it("requires two exact, target-distinct pull digests even across repositories", () => {
    const firstDigest = "a".repeat(64);
    const secondDigest = "b".repeat(64);
    const result = validateDeploymentImageReferences(imageReferences({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: `ghcr.io/owner/clean-pay-app@sha256:${firstDigest}`,
      CLEAN_PAY_MIGRATION_IMAGE: `ghcr.io/owner/clean-pay-migration@sha256:${secondDigest}`,
    }));

    expect(result).toMatchObject({
      source: "pull",
      applicationDigest: firstDigest,
      migrationDigest: secondDigest,
    });
    expect(validationError(imageReferences({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: `ghcr.io/owner/app@sha256:${firstDigest}`,
      CLEAN_PAY_MIGRATION_IMAGE: `registry.example/other/migration@sha256:${firstDigest}`,
    }))).toContain("different sha256 digests");
    expect(validationError(imageReferences({
      CLEAN_PAY_DEPLOY_SOURCE: "pull",
      CLEAN_PAY_IMAGE: `ghcr.io/owner/app:v1@sha256:${firstDigest}`,
      CLEAN_PAY_MIGRATION_IMAGE: `ghcr.io/owner/migration@sha256:${secondDigest}`,
    }))).toContain("valid image repository");
  });
});

describe("production public build validation", () => {
  const validPublicBuild = {
    NEXT_PUBLIC_APP_URL: "https://pay.clean-pay.dev",
    NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
    NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SITE_KEY: "0x4AAAAAProductionSiteKey0123456789",
  };

  it("uses the production URL, branding and Turnstile rules for publish inputs", () => {
    expect(validateProductionPublicBuildConfiguration(validPublicBuild))
      .toMatchObject({
        appUrl: "https://pay.clean-pay.dev",
        brandName: "Clean Pay",
        brandLogoUrl: "/clean-pay-logo.png",
      });

    for (const [override, expected] of [
      [{ NEXT_PUBLIC_APP_URL: "http://pay.clean-pay.dev" }, "valid https"],
      [{ NEXT_PUBLIC_BRAND_LOGO_URL: "/brand/%2e%2e/private.png" }, "root-relative"],
      [{ TURNSTILE_ENABLED: "false" }, "must be true"],
      [{ TURNSTILE_SITE_KEY: "1x00000000000000000000AA" }, "non-test"],
    ] as const) {
      expect(() => validateProductionPublicBuildConfiguration({
        ...validPublicBuild,
        ...override,
      })).toThrow(expected);
    }
  });
});

describe("deployment image metadata preflight", () => {
  it.skipIf(!posixShell)("checks the paired labels and runs the isolated image validator", () => {
    const fixture = createFakeDockerFixture();

    try {
      const result = runPreflight(fixture, "pull");

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain(
        "release 0.1.1 (0123456789abcdef0123456789abcdef01234567)",
      );
      const calls = readFileSync(fixture.logFile, "utf8");
      expect(calls.match(/image inspect --format \{\{\.Id\}\} clean-pay-app:test/g))
        .toHaveLength(1);
      expect(calls.match(/image inspect --format \{\{\.Id\}\} clean-pay-migration:test/g))
        .toHaveLength(1);
      expect(calls).toContain("run --rm --interactive --network none --read-only");
      expect(calls).toContain("--pids-limit 64 --memory 256m --cpus 0.5");
      expect(calls).toContain(
        "--tmpfs /tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
      );
      expect(calls).toContain(
        `--entrypoint node ${fixture.appId} deploy/prod/validate-env.mjs --runtime-env-stdin`,
      );
      expect(calls).not.toMatch(/Labels.*clean-pay-app:test/);
      expect(calls).toContain("stdin:RUNTIME_SENTINEL=from-authoritative-file");
      expect(readFileSync(fixture.outputFile, "utf8")).toBe(
        `CLEAN_PAY_VERIFIED_APP_IMAGE=${fixture.appId}\n` +
        `CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=${fixture.migrationId}\n`,
      );
    } finally {
      fixture.cleanup();
    }
  }, shellIntegrationTimeout);

  it.skipIf(!posixShell)("fails before the runtime validator for mismatched or untraceable metadata", () => {
    const fixture = createFakeDockerFixture();

    try {
      const mismatched = runPreflight(fixture, "build", {
        FAKE_MIGRATION_REVISION: "fedcba9876543210",
      });
      expect(mismatched.status).toBe(1);
      expect(mismatched.stderr).toContain("different revisions");
      expect(readFileSync(fixture.logFile, "utf8")).not.toContain("run --rm");

      writeFileSync(fixture.logFile, "");
      const mismatchedContract = runPreflight(fixture, "build", {
        FAKE_MIGRATION_CONTRACT_SHA256: "d".repeat(64),
      });
      expect(mismatchedContract.status).toBe(1);
      expect(mismatchedContract.stderr).toContain("different public build contracts");
      expect(readFileSync(fixture.logFile, "utf8")).not.toContain("run --rm");

      writeFileSync(fixture.logFile, "");
      const localPull = runPreflight(fixture, "pull", {
        FAKE_APP_RELEASE: "local",
        FAKE_MIGRATION_RELEASE: "local",
      });
      expect(localPull.status).toBe(1);
      expect(localPull.stderr).toContain("traceable release metadata");
      expect(readFileSync(fixture.logFile, "utf8")).not.toContain("run --rm");
    } finally {
      fixture.cleanup();
    }
  }, shellIntegrationTimeout);
});

describe("build provenance guard", () => {
  it.skipIf(!posixShell)(
    "marks local builds unverified and accepts traceable metadata only for a clean exact HEAD",
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-provenance-"));

      try {
        const local = runProvenance(directory, "local", "local");
        expect(local.status, local.stderr).toBe(0);
        expect(local.stderr).toContain("UNVERIFIED provenance");

        expect(spawnSync("git", ["init", "-q"], { cwd: directory }).status).toBe(0);
        expect(spawnSync("git", ["config", "user.email", "test@example.test"], {
          cwd: directory,
        }).status).toBe(0);
        expect(spawnSync("git", ["config", "user.name", "Test"], {
          cwd: directory,
        }).status).toBe(0);
        writeFileSync(path.join(directory, "tracked.txt"), "reviewed\n");
        expect(spawnSync("git", ["add", "tracked.txt"], { cwd: directory }).status).toBe(0);
        expect(spawnSync("git", ["commit", "-qm", "fixture"], { cwd: directory }).status).toBe(0);
        const revision = spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: directory,
          encoding: "utf8",
        }).stdout.trim();

        const clean = runProvenance(directory, "0.1.1", revision);
        expect(clean.status, clean.stderr).toBe(0);
        expect(clean.stdout).toContain(`verified at ${revision}`);

        expect(runProvenance(directory, "0.1.1", "0".repeat(40)).stderr)
          .toContain("does not match Git HEAD");
        writeFileSync(path.join(directory, "untracked.txt"), "dirty\n");
        expect(runProvenance(directory, "0.1.1", revision).stderr)
          .toContain("require a clean Git checkout");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});

describe("Compose interpolation isolation", () => {
  it("unsets the exact exported interpolation set in both shell launchers", () => {
    for (const script of ["deploy.sh", "start.sh"]) {
      const source = readFileSync(script, "utf8");
      const block = source.match(/compose\(\) \(\s+[^]*?\bunset \\\n([^]*?)\n\n/)?.[1];
      expect(block, script).toBeTruthy();
      const names = block!
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/ \\$/, ""))
        .filter(Boolean)
        .sort();

      expect(names, script).toEqual([...COMPOSE_INTERPOLATION_ENVIRONMENT_NAMES].sort());
    }
  });

  it("reads the disk threshold only from the authoritative env file", () => {
    const deploy = readFileSync("deploy.sh", "utf8");
    const functionSource = deploy.slice(
      deploy.indexOf("ensure_build_disk_space() {"),
      deploy.indexOf("deployment_source() {"),
    );

    expect(functionSource).toContain("min_mb=$(env_value CLEAN_PAY_MIN_FREE_DISK_MB 8192)");
    expect(functionSource).not.toContain("${CLEAN_PAY_MIN_FREE_DISK_MB:-");
  });

  it.skipIf(!posixShell)(
    "resolves and validates restart preflight source when prepare_images never initialized it",
    () => {
      const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-restart-preflight-"));
      const sourceOutput = path.join(directory, "source.txt");
      const appId = `sha256:${"a".repeat(64)}`;
      const migrationId = `sha256:${"b".repeat(64)}`;
      const harness = `
set -eu
verified_image_dir=''
verified_image_output=''
CLEAN_PAY_VERIFIED_APP_IMAGE=''
CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=''
ENV_FILE=/synthetic/production.env
IMAGE_PREFLIGHT_SCRIPT=/synthetic/image-preflight.sh
env_value() {
  if [ "$1" = CLEAN_PAY_DEPLOY_SOURCE ]; then
    printf '%s' "$DEPLOY_SOURCE"
  else
    printf '%s' "\${2:-}"
  fi
}
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
sh() {
  [ "$1" = "$IMAGE_PREFLIGHT_SCRIPT" ]
  printf '%s' "$2" > "$SOURCE_OUTPUT"
  printf '%s\\n%s\\n' \\
    'CLEAN_PAY_VERIFIED_APP_IMAGE=${appId}' \\
    'CLEAN_PAY_VERIFIED_MIGRATION_IMAGE=${migrationId}' > "\${12}"
}
${shellFunctionFrom(deployScript, "deployment_source")}
${shellFunctionFrom(deployScript, "cleanup_verified_images")}
${shellFunctionFrom(deployScript, "preflight_images")}
unset deploy_source
preflight_images '${appId}' '${migrationId}'
printf 'source=%s\\n' "$(cat "$SOURCE_OUTPUT")"
cleanup_verified_images
`;
      const run = (source: string) => spawnSync(posixShell!, ["-c", harness], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          DEPLOY_SOURCE: source,
          SOURCE_OUTPUT: sourceOutput.replaceAll("\\", "/"),
          TMPDIR: directory.replaceAll("\\", "/"),
        },
      });

      try {
        const valid = run("pull");
        expect(valid.status, valid.stderr).toBe(0);
        expect(valid.stdout).toContain("source=pull");

        const invalid = run("archive");
        expect(invalid.status).not.toBe(0);
        expect(invalid.stderr).toContain(
          "CLEAN_PAY_DEPLOY_SOURCE must be build or pull",
        );

        const restartPreflight = shellFunctionFrom(
          deployScript,
          "preflight_runtime_restart_image",
        );
        expect(restartPreflight).toContain("preflight_images");
        expect(restartPreflight).not.toContain("prepare_images");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    shellIntegrationTimeout,
  );
});

function createFakeDockerFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "clean-pay-image-preflight-"));
  const dockerPath = path.join(directory, "docker");
  const envFile = path.join(directory, "runtime.env");
  const logFile = path.join(directory, "docker.log");
  const outputFile = path.join(directory, "verified.env");
  const appId = `sha256:${"a".repeat(64)}`;
  const migrationId = `sha256:${"b".repeat(64)}`;

  writeFileSync(envFile, "RUNTIME_SENTINEL=from-authoritative-file\n");
  writeFileSync(logFile, "");
  writeFileSync(dockerPath, `#!/usr/bin/env sh
set -eu
printf '%s\\n' "$*" >> "$FAKE_DOCKER_LOG"
if [ "$1" = "image" ] && [ "$2" = "inspect" ]; then
  format=$4
  image=$5
  if [ "$format" = "{{.Id}}" ]; then
    if [ "$image" = "clean-pay-app:test" ]; then printf '%s\\n' "$FAKE_APP_ID"; else printf '%s\\n' "$FAKE_MIGRATION_ID"; fi
    exit 0
  fi
  case "$format" in
    *io.clean-pay.role*)
      if [ "$image" = "$FAKE_APP_ID" ]; then printf '%s\\n' app; else printf '%s\\n' migration; fi ;;
    *org.opencontainers.image.version*)
      if [ "$image" = "$FAKE_APP_ID" ]; then printf '%s\\n' "$FAKE_APP_RELEASE"; else printf '%s\\n' "$FAKE_MIGRATION_RELEASE"; fi ;;
    *io.clean-pay.release*)
      if [ "$image" = "$FAKE_APP_ID" ]; then printf '%s\\n' "$FAKE_APP_RELEASE"; else printf '%s\\n' "$FAKE_MIGRATION_RELEASE"; fi ;;
    *org.opencontainers.image.revision*)
      if [ "$image" = "$FAKE_APP_ID" ]; then printf '%s\\n' "$FAKE_APP_REVISION"; else printf '%s\\n' "$FAKE_MIGRATION_REVISION"; fi ;;
    *io.clean-pay.public-build-contract-version*)
      if [ "$image" = "$FAKE_APP_ID" ]; then printf '%s\\n' "$FAKE_APP_CONTRACT_VERSION"; else printf '%s\\n' "$FAKE_MIGRATION_CONTRACT_VERSION"; fi ;;
    *io.clean-pay.public-build-contract-sha256*)
      if [ "$image" = "$FAKE_APP_ID" ]; then printf '%s\\n' "$FAKE_APP_CONTRACT_SHA256"; else printf '%s\\n' "$FAKE_MIGRATION_CONTRACT_SHA256"; fi ;;
    *io.clean-pay.baked-public-app-url*) printf '%s\\n' https://pay.example.test ;;
    *io.clean-pay.baked-brand-name*) printf '%s\\n' 'Clean Pay' ;;
    *io.clean-pay.baked-brand-logo-url*) printf '%s\\n' /clean-pay-logo.png ;;
    *io.clean-pay.baked-turnstile-site-key*) printf '%s\\n' 0x4AAAAAPreflightSiteKey0123456789 ;;
    *) exit 9 ;;
  esac
  exit 0
fi
if [ "$1" = "run" ]; then
  input=$(sed -e 's/[[:space:]]*$//')
  printf 'stdin:%s\\n' "$input" >> "$FAKE_DOCKER_LOG"
  exit 0
fi
exit 8
`);
  chmodSync(dockerPath, 0o755);

  return {
    directory,
    envFile,
    logFile,
    outputFile,
    appId,
    migrationId,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function runPreflight(
  fixture: ReturnType<typeof createFakeDockerFixture>,
  source: "build" | "pull",
  overrides: Record<string, string> = {},
) {
  rmSync(fixture.outputFile, { force: true });
  return spawnSync(
    posixShell!,
    [
      "deploy/prod/image-preflight.sh",
      source,
      "clean-pay-app:test",
      "clean-pay-migration:test",
      fixture.envFile.replaceAll("\\", "/"),
      "https://pay.example.test",
      "Clean Pay",
      "/clean-pay-logo.png",
      "0x4AAAAAPreflightSiteKey0123456789",
      "0.1.1",
      "0123456789abcdef0123456789abcdef01234567",
      fixture.outputFile.replaceAll("\\", "/"),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fixture.directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_DOCKER_LOG: fixture.logFile.replaceAll("\\", "/"),
        FAKE_APP_ID: fixture.appId,
        FAKE_MIGRATION_ID: fixture.migrationId,
        FAKE_APP_RELEASE: "0.1.1",
        FAKE_MIGRATION_RELEASE: "0.1.1",
        FAKE_APP_REVISION: "0123456789abcdef0123456789abcdef01234567",
        FAKE_MIGRATION_REVISION: "0123456789abcdef0123456789abcdef01234567",
        FAKE_APP_CONTRACT_VERSION: "1",
        FAKE_MIGRATION_CONTRACT_VERSION: "1",
        FAKE_APP_CONTRACT_SHA256: "c".repeat(64),
        FAKE_MIGRATION_CONTRACT_SHA256: "c".repeat(64),
        ...overrides,
      },
    },
  );
}

function runProvenance(directory: string, release: string, revision: string) {
  return spawnSync(
    posixShell!,
    [
      path.resolve("deploy/prod/build-provenance.sh"),
      directory,
      "build",
      release,
      revision,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
}
