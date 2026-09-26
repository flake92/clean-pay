import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  JOURNEY_GENERATED_ENVIRONMENT_FILENAMES,
  cleanupGeneratedEnvironment,
  cleanupRetainedGeneratedEnvironment,
  prepareGeneratedEnvironmentDirectory,
  sanitizedJourneyContractEvidence,
  writeSanitizedJourneyContractEvidence,
} from "./journey-generated-environment-lifecycle.mjs";

const project = "clean-pay-browser-journey-lifecycle-contract";
const temporaryRoots = new Set<string>();

test.afterEach(async () => {
  await Promise.all([...temporaryRoots].map(async (directory) => {
    await rm(directory, { force: true, recursive: true });
  }));
  temporaryRoots.clear();
});

test("removes the exact generated files and only a directory created by this run", async () => {
  const { generatedDirectory } = await temporaryGeneratedDirectory(false);
  const state = await prepareGeneratedEnvironmentDirectory({
    directory: generatedDirectory,
    project,
  });
  await writeFile(path.join(generatedDirectory, ".env"), "synthetic-secret=value\n", "utf8");
  await writeFile(
    path.join(generatedDirectory, "browser-journey-contract.json"),
    `${JSON.stringify(contract())}\n`,
    "utf8",
  );

  await expect(cleanupGeneratedEnvironment(state)).resolves.toMatchObject({
    status: "generated_environment_cleaned",
    projectSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    directorySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    directoryRemoved: true,
  });
  await expect(access(generatedDirectory)).rejects.toMatchObject({ code: "ENOENT" });
});

test("leaves a caller-created destination present and empty", async () => {
  const { generatedDirectory } = await temporaryGeneratedDirectory(true);
  const state = await prepareGeneratedEnvironmentDirectory({
    directory: generatedDirectory,
    project,
  });
  await writeFile(path.join(generatedDirectory, ".env.app"), "generated=true\n", "utf8");

  await expect(cleanupGeneratedEnvironment(state)).resolves.toMatchObject({
    directoryRemoved: false,
  });
  await expect(readdir(generatedDirectory)).resolves.toEqual([]);
});

test("cleans known sensitive files but refuses to remove an unexpected caller entry", async () => {
  const { generatedDirectory } = await temporaryGeneratedDirectory(false);
  const state = await prepareGeneratedEnvironmentDirectory({
    directory: generatedDirectory,
    project,
  });
  await writeFile(path.join(generatedDirectory, ".env"), "synthetic-secret=value\n", "utf8");
  await writeFile(path.join(generatedDirectory, "caller-owned.txt"), "retain\n", "utf8");

  await expect(cleanupGeneratedEnvironment(state)).rejects.toThrow(
    "exact files were cleaned only",
  );
  await expect(access(path.join(generatedDirectory, ".env"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(path.join(generatedDirectory, "caller-owned.txt"), "utf8"))
    .resolves.toBe("retain\n");
});

test("cleanup handoff accepts only a complete legacy set bound to the exact project", async () => {
  const { generatedDirectory } = await temporaryGeneratedDirectory(true);
  for (const filename of JOURNEY_GENERATED_ENVIRONMENT_FILENAMES) {
    const value = filename === "browser-journey-contract.json"
      ? `${JSON.stringify(contract())}\n`
      : "generated=true\n";
    await writeFile(path.join(generatedDirectory, filename), value, "utf8");
  }

  await expect(cleanupRetainedGeneratedEnvironment({
    directory: generatedDirectory,
    project,
  })).resolves.toMatchObject({
    status: "retained_generated_environment_cleaned",
    directoryRemoved: false,
  });
  await expect(readdir(generatedDirectory)).resolves.toEqual([]);
});

test("cleanup handoff rejects incomplete, mismatched, and adjacent legacy directories", async () => {
  for (const mutation of ["incomplete", "wrong-project", "adjacent"] as const) {
    const { generatedDirectory } = await temporaryGeneratedDirectory(true);
    for (const filename of JOURNEY_GENERATED_ENVIRONMENT_FILENAMES) {
      if (mutation === "incomplete" && filename === ".env.retention") continue;
      const value = filename === "browser-journey-contract.json"
        ? `${JSON.stringify(contract(mutation === "wrong-project"
          ? "clean-pay-browser-journey-different-contract"
          : project))}\n`
        : "generated=true\n";
      await writeFile(path.join(generatedDirectory, filename), value, "utf8");
    }
    if (mutation === "adjacent") {
      await writeFile(path.join(generatedDirectory, "caller-owned.txt"), "retain\n", "utf8");
    }

    await expect(cleanupRetainedGeneratedEnvironment({
      directory: generatedDirectory,
      project,
    }), mutation).rejects.toThrow();
  }
});

test("writes only a hashed, create-only contract projection under test-results", async () => {
  const { temporaryRoot } = await temporaryGeneratedDirectory(false);
  const raw = contract();
  const projection = sanitizedJourneyContractEvidence(raw);
  const serialized = JSON.stringify(projection);
  expect(serialized).not.toContain(raw.project);
  expect(serialized).not.toContain(raw.images.application);
  expect(serialized).not.toContain(raw.images.migration);
  expect(serialized).not.toContain(raw.publications.app);
  expect(serialized).not.toContain("secretSource");

  const first = await writeSanitizedJourneyContractEvidence({
    contract: raw,
    repositoryRoot: temporaryRoot,
  });
  expect(JSON.parse(await readFile(first.target, "utf8"))).toEqual(projection);
  await expect(writeSanitizedJourneyContractEvidence({
    contract: raw,
    repositoryRoot: temporaryRoot,
  })).rejects.toMatchObject({ code: "EEXIST" });

  const adjacent = structuredClone(raw) as typeof raw & { token?: string };
  adjacent.token = "must-not-be-projected";
  expect(() => sanitizedJourneyContractEvidence(adjacent)).toThrow("unexpected fields");
});

async function temporaryGeneratedDirectory(create: boolean) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "clean-pay-journey-env-"));
  temporaryRoots.add(temporaryRoot);
  const generatedDirectory = path.join(temporaryRoot, "generated");
  if (create) await mkdir(generatedDirectory, { mode: 0o700 });
  return { generatedDirectory, temporaryRoot };
}

function contract(contractProject = project) {
  return {
    schemaVersion: 1,
    kind: "self-contained-synthetic-browser-journey",
    project: contractProject,
    revision: "1".repeat(40),
    images: {
      application: "clean-pay:synthetic-app",
      migration: "clean-pay:synthetic-migration",
    },
    publicBuildContract: { version: "1", sha256: "2".repeat(64) },
    fixtureContract: {
      domain: "clean-pay-browser-journey-fixture-v5",
      sha256: "3".repeat(64),
    },
    publications: {
      app: "127.0.0.1:4100",
      providerControl: "127.0.0.1:13100",
      browserTls: "127.0.0.2:443",
      connectProxy: "127.0.0.1:14444",
    },
    secretSource: "deterministic synthetic fixture labels; no external env or credential file",
    ownedStateReset: {
      postgres: "transactional truncate of public application tables; migrations retained; schema has no sequences",
      redis: "flush DB 0 on the project-local redis service",
      scope: "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
    },
  };
}
