import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { validateDisposableImageRollbackReport } from
  "../../../scripts/security/disposable-image-rollback-report.mjs";

const scriptPath = path.resolve(
  process.cwd(),
  "scripts/security/disposable-image-rollback-report.mjs",
);
const temporaryDirectories: string[] = [];
const genericCliError = "Disposable image rollback report validation failed.\n";
const imageIds = ["a", "b", "c", "d"].map((character) =>
  `sha256:${character.repeat(64)}`);

type Report = ReturnType<typeof validReport>;

function validReport(status: "passed" | "failed" = "passed") {
  return {
    schemaVersion: "clean-pay.disposable-image-rollback.v3",
    status,
    terminalPhase: status === "passed" ? "complete" : "stage",
    cleanupProven: status === "passed",
    authoritativeEnvironmentRestored: status === "passed",
    canaryRemoved: status === "passed",
    trafficContinuityProven: status === "passed",
    disposableTrafficProxyUsed: status === "passed",
    syntheticReadinessProviderUsed: status === "passed",
    syntheticReadinessProviderContractProven: status === "passed",
    verifiedTrafficPhaseCount: status === "passed" ? 4 : 0,
    trafficPath: "owned-edge-network-aliases",
    syntheticEnvironment: true,
    productionDeploymentPerformed: false,
    caddyMutationPerformed: false,
    externalProviderCredentialsUsed: false,
    syntheticProviderCredentialsUsed: status === "passed",
    baselineBuildContextAllowlistProven: status === "passed",
    rollbackImagePreflightProven: status === "passed",
    previousSourceRevision: "1".repeat(40),
    targetSourceRevision: "2".repeat(40),
    verifiedImageStateCount: status === "passed" ? 3 : 0,
    projectContractSha256: "e".repeat(64),
    imageIdentityEvidence: {
      targetApplicationImageId: status === "passed" ? imageIds[0] : null,
      targetMigrationImageId: status === "passed" ? imageIds[1] : null,
      previousApplicationImageId: status === "passed" ? imageIds[2] : null,
      previousMigrationImageId: status === "passed" ? imageIds[3] : null,
    },
  };
}

function expectInvalid(value: unknown) {
  expect(() => validateDisposableImageRollbackReport(value))
    .toThrow("disposable image rollback report is invalid");
}

async function temporaryFile(contents: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "clean-pay-rollback-report-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, "report.json");
  await writeFile(file, contents, { encoding: "utf8", mode: 0o600 });
  return file;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })));
});

describe("disposable image rollback report schema", () => {
  it("accepts the exact passed report and returns a deeply immutable projection", () => {
    const input = validReport();
    const result = validateDisposableImageRollbackReport(input);

    expect(result).toEqual(input);
    expect(result).not.toBe(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.imageIdentityEvidence)).toBe(true);
  });

  it("allows failed evidence to contain null and exact image IDs", () => {
    const input = validReport("failed");
    input.cleanupProven = true;
    input.verifiedTrafficPhaseCount = 3;
    input.verifiedImageStateCount = 2;
    input.imageIdentityEvidence.targetApplicationImageId = imageIds[0];
    input.imageIdentityEvidence.previousApplicationImageId = imageIds[0];

    expect(validateDisposableImageRollbackReport(input)).toEqual(input);
  });

  it.each([
    ["null", null],
    ["an array", []],
    ["a scalar", "report"],
    ["an object with a null prototype", Object.assign(Object.create(null), validReport())],
    ["an extra root field", { ...validReport(), rawOutput: "unreviewed" }],
    ["a missing root field", (() => {
      const value = validReport() as Partial<Report>;
      delete value.trafficPath;
      return value;
    })()],
    ["an extra nested field", {
      ...validReport(),
      imageIdentityEvidence: { ...validReport().imageIdentityEvidence, imageReference: "latest" },
    }],
  ])("rejects %s", (_label, value) => {
    expectInvalid(value);
  });

  it("rejects symbol fields at both schema levels", () => {
    const rootSymbol = validReport() as Report & { [key: symbol]: string };
    rootSymbol[Symbol("unreviewed")] = "value";
    expectInvalid(rootSymbol);

    const nestedSymbol = validReport();
    (nestedSymbol.imageIdentityEvidence as Report["imageIdentityEvidence"] & {
      [key: symbol]: string;
    })[Symbol("unreviewed")] = "value";
    expectInvalid(nestedSymbol);
  });

  it.each([
    ["schemaVersion", "clean-pay.disposable-image-rollback.v2"],
    ["status", "unknown"],
    ["terminalPhase", "Complete"],
    ["terminalPhase", "a".repeat(65)],
    ["trafficPath", "localhost"],
    ["syntheticEnvironment", false],
    ["productionDeploymentPerformed", true],
    ["caddyMutationPerformed", true],
    ["externalProviderCredentialsUsed", true],
    ["previousSourceRevision", "A".repeat(40)],
    ["targetSourceRevision", "2".repeat(39)],
    ["projectContractSha256", "g".repeat(64)],
    ["verifiedTrafficPhaseCount", -1],
    ["verifiedTrafficPhaseCount", 5],
    ["verifiedTrafficPhaseCount", 1.5],
    ["verifiedImageStateCount", -1],
    ["verifiedImageStateCount", 4],
    ["verifiedImageStateCount", Number.MAX_SAFE_INTEGER + 1],
    ["cleanupProven", 1],
  ])("rejects an invalid %s", (key, value) => {
    expectInvalid({ ...validReport("failed"), [key]: value });
  });

  it.each([
    "sha256:ABCDEF" + "a".repeat(58),
    "sha512:" + "a".repeat(64),
    "sha256:" + "a".repeat(63),
    42,
    undefined,
  ])("rejects a malformed failed image identity %#", (imageId) => {
    const failed = validReport("failed");
    const input = {
      ...failed,
      imageIdentityEvidence: {
        ...failed.imageIdentityEvidence,
        targetApplicationImageId: imageId,
      },
    };
    expectInvalid(input);
  });

  it.each([
    ["a non-complete phase", { terminalPhase: "rollback" }],
    ["a false proof", { cleanupProven: false }],
    ["an incomplete traffic count", { verifiedTrafficPhaseCount: 3 }],
    ["an incomplete image-state count", { verifiedImageStateCount: 2 }],
  ])("rejects passed evidence with %s", (_label, override) => {
    expectInvalid({ ...validReport(), ...override });
  });

  it("rejects null or duplicate image identities in passed evidence", () => {
    const missing = validReport();
    missing.imageIdentityEvidence.previousMigrationImageId = null;
    expectInvalid(missing);

    const duplicate = validReport();
    duplicate.imageIdentityEvidence.previousMigrationImageId = imageIds[0];
    expectInvalid(duplicate);
  });
});

describe("disposable image rollback report CLI", () => {
  it("validates an exact report through the file-descriptor path without output", async () => {
    const file = await temporaryFile(JSON.stringify(validReport()));
    const result = spawnSync(process.execPath, [scriptPath, "validate", file], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("fails generically without emitting report values or the file path", async () => {
    const sentinel = "must-never-appear-in-cli-output";
    const file = await temporaryFile(JSON.stringify({ ...validReport(), sentinel }));
    const result = spawnSync(process.execPath, [scriptPath, "validate", file], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(genericCliError);
    expect(result.stderr).not.toContain(sentinel);
    expect(result.stderr).not.toContain(file);
  });

  it("rejects malformed, oversized, and unexpected invocations generically", async () => {
    const malformed = await temporaryFile("{");
    const oversized = await temporaryFile(" ".repeat((16 * 1024) + 1));

    for (const argumentsList of [
      [scriptPath, "validate", malformed],
      [scriptPath, "validate", oversized],
      [scriptPath, "inspect", malformed],
      [scriptPath, "validate", malformed, "extra"],
    ]) {
      const result = spawnSync(process.execPath, argumentsList, {
        encoding: "utf8",
        timeout: 5_000,
        windowsHide: true,
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(genericCliError);
    }
  });

  it("is import-safe and does not install lifecycle handlers or emit output", () => {
    const moduleUrl = pathToFileURL(scriptPath).href;
    const program = `
      const before = {
        sigint: process.listenerCount("SIGINT"),
        sigterm: process.listenerCount("SIGTERM"),
        exitCode: process.exitCode ?? null,
      };
      const imported = await import(${JSON.stringify(moduleUrl)});
      const after = {
        sigint: process.listenerCount("SIGINT"),
        sigterm: process.listenerCount("SIGTERM"),
        exitCode: process.exitCode ?? null,
      };
      process.stdout.write(JSON.stringify({
        before,
        after,
        hasValidator: typeof imported.validateDisposableImageRollbackReport === "function",
      }));
    `;

    const output = execFileSync(process.execPath, ["--input-type=module", "--eval", program], {
      encoding: "utf8",
      timeout: 5_000,
      windowsHide: true,
    });

    expect(JSON.parse(output)).toEqual({
      before: { sigint: 0, sigterm: 0, exitCode: null },
      after: { sigint: 0, sigterm: 0, exitCode: null },
      hasValidator: true,
    });
  });
});
