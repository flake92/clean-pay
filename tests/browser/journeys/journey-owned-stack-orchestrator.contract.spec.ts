import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { PassThrough } from "node:stream";

import { expect, test } from "@playwright/test";

import {
  assertJourneyProjectAbsent,
  attestJourneyOwnedStack,
  cleanupJourneyOwnedStack,
  collectJourneyDockerFailureEvidence,
  createJourneyOwnedInputSnapshot,
  deriveJourneyApplicationImageConfigDigest,
  deriveJourneyMigrationImageConfigDigest,
  dispatchJourneyOwnedStackPair,
  enforceJourneySyntheticPrivateMode,
  JOURNEY_DOCKER_TIMEOUT_CONTRACT,
  JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
  journeyDockerCliEnvironment,
  prepareJourneyOwnedStackLaunch,
  prepareJourneyOwnedStack,
  resolveJourneyDockerCommandTimeoutMs,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
  writeJourneySanitizedOutput,
} from "./journey-owned-stack-orchestrator.mjs";
import {
  JOURNEY_COMPOSE_SERVICE_NAMES,
  JOURNEY_COMPOSE_VOLUME_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import {
  JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
  buildJourneySyntheticEnvironment,
} from "./journey-synthetic-environment-contract.mjs";
import {
  startJourneyConnectProxy,
  stopJourneyConnectProxy,
} from "./journey-connect-proxy-controller.mjs";
import { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";
import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";

type SnapshotWriter = (filename: string, bytes: string | Buffer) => Promise<string>;
type SnapshotWriters = {
  writeContainerReadonlyFixture: SnapshotWriter;
  writeOwnedFile: SnapshotWriter;
};

test("keeps the Compose down watchdog beyond two ordered graceful-stop budgets", () => {
  expect(JOURNEY_DOCKER_TIMEOUT_CONTRACT).toEqual({
    composeDownMs: 300_000,
    composeStopSeconds: 120,
    composeUpMs: 300_000,
    otherMs: 30_000,
  });
  expect(Object.isFrozen(JOURNEY_DOCKER_TIMEOUT_CONTRACT)).toBe(true);
  expect(JOURNEY_DOCKER_TIMEOUT_CONTRACT.composeDownMs).toBeGreaterThan(
    JOURNEY_DOCKER_TIMEOUT_CONTRACT.composeStopSeconds * 2 * 1_000,
  );
  expect(JOURNEY_DOCKER_TIMEOUT_CONTRACT.composeDownMs).toBeLessThanOrEqual(600_000);
  expect(resolveJourneyDockerCommandTimeoutMs(["compose", "up"])).toBe(300_000);
  expect(resolveJourneyDockerCommandTimeoutMs(["compose", "down"])).toBe(300_000);
  expect(resolveJourneyDockerCommandTimeoutMs(["info"])).toBe(30_000);
  expect(resolveJourneyDockerCommandTimeoutMs(["compose", "down"], 17_000)).toBe(17_000);
});

test("is import-safe and refuses a non-isolated pair before its first Docker query", async () => {
  expect(typeof withJourneyOwnedStackPair).toBe("function");
  expect(typeof prepareJourneyOwnedStack).toBe("function");
  expect(typeof prepareJourneyOwnedStackLaunch).toBe("function");
  expect(typeof dispatchJourneyOwnedStackPair).toBe("function");
  expect(typeof deriveJourneyApplicationImageConfigDigest).toBe("function");
  expect(typeof deriveJourneyMigrationImageConfigDigest).toBe("function");
  expect(typeof runJourneyDockerCommand).toBe("function");
  expect(typeof attestJourneyOwnedStack).toBe("function");
  expect(typeof cleanupJourneyOwnedStack).toBe("function");
  expect(typeof assertJourneyProjectAbsent).toBe("function");
  expect(typeof createJourneyOwnedInputSnapshot).toBe("function");
  expect(typeof writeJourneySanitizedOutput).toBe("function");

  let dockerCalls = 0;
  const aliased = {
    contract: {
      project: "clean-pay-browser-journey-provider-proof-baseline-aaaaaaaaaaaa",
      publications: {
        app: "127.0.0.1:4100",
        browserTls: "127.0.0.2:443",
        connectProxy: "127.0.0.1:14444",
        providerControl: "127.0.0.1:13100",
      },
    },
    contractPath: "C:/synthetic/contract.json",
    expectedApplicationAssetImageDigest: `sha256:${"3".repeat(64)}`,
    expectedApplicationImageConfigDigest: `sha256:${"1".repeat(64)}`,
    expectedApplicationRepoDigests: [
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
    ],
    expectedMigrationAssetImageDigest: `sha256:${"2".repeat(64)}`,
    repositoryRoot: path.resolve(__dirname, "../../.."),
    runDocker: async () => {
      dockerCalls += 1;
      return "";
    },
  };
  await expect(withJourneyOwnedStackPair(
    { baseline: aliased, candidate: { ...aliased } },
    async () => undefined,
  )).rejects.toThrow(/not isolated/);
  expect(dockerCalls).toBe(0);
});

test("keeps the Docker child environment deny-by-default while exposing Windows CLI roots", () => {
  const environment = journeyDockerCliEnvironment({
    COMPOSE_FILE: "forbidden-compose.yml",
    DOCKER_API_VERSION: "1.52",
    PATH: "C:\\synthetic\\bin",
    ProgramFiles: "C:\\Program Files",
    ProgramW6432: "C:\\Program Files",
    TOKEN_SHADOW: "forbidden",
    USERPROFILE: "C:\\Users\\Synthetic",
  });
  expect(Object.getPrototypeOf(environment)).toBeNull();
  expect({ ...environment }).toEqual({
    PATH: "C:\\synthetic\\bin",
    ProgramFiles: "C:\\Program Files",
    ProgramW6432: "C:\\Program Files",
    USERPROFILE: "C:\\Users\\Synthetic",
  });
  expect(environment.COMPOSE_FILE).toBeUndefined();
  expect(environment.DOCKER_API_VERSION).toBeUndefined();
  expect(environment.TOKEN_SHADOW).toBeUndefined();
});

test("passes bounded cleanup-query timeouts through both live proof runners", async () => {
  const [provider, chatwoot] = await Promise.all([
    readFile(path.resolve(__dirname, "prove-provider-overlap.mjs"), "utf8"),
    readFile(path.resolve(__dirname, "chatwoot-phase-proof-orchestrator.mjs"), "utf8"),
  ]);
  for (const source of [provider, chatwoot]) {
    expect(source).toContain("commandOptions = {}");
    expect(source).toContain("...commandOptions");
    expect(source).toContain('name !== "timeoutMs"');
  }
});

test("removes its exact temporary snapshot after directory identity setup fails", async () => {
  for (const stage of ["chmod", "identity"] as const) {
    let directory = "";
    let failed = false;
    const operations = snapshotFileSystem({
      chmod: async (target: string, mode: number) => {
        if (stage === "chmod" && target === directory && !failed) {
          failed = true;
          throw new Error("synthetic directory chmod failure");
        }
        return chmod(target, mode);
      },
      lstat: async (...args: Parameters<typeof lstat>) => {
        if (stage === "identity" && args[0] === directory && !failed) {
          failed = true;
          throw new Error("synthetic directory identity failure");
        }
        return lstat(...args);
      },
      mkdtemp: async (prefix: string) => {
        directory = await mkdtemp(prefix);
        return directory;
      },
    });
    await expect(createJourneyOwnedInputSnapshot({
      directoryPrefix: path.join(tmpdir(), `clean-pay-provider-test-${stage}-`),
      expectedFilenames: ["one.txt"],
      populate: async ({ writeOwnedFile }: {
        writeOwnedFile: (filename: string, bytes: string) => Promise<string>;
      }) => writeOwnedFile("one.txt", "one"),
    }, operations, "linux"), stage).rejects.toThrow(new RegExp(stage));
    expect(failed, stage).toBe(true);
    await expect(lstat(directory), stage).rejects.toMatchObject({ code: "ENOENT" });
  }
});

test("removes a create-only file when its post-write identity check fails", async () => {
  let directory = "";
  let failed = false;
  const operations = snapshotFileSystem({
    lstat: async (...args: Parameters<typeof lstat>) => {
      if (path.basename(String(args[0])) === "one.txt" && !failed) {
        failed = true;
        throw new Error("synthetic file identity failure");
      }
      return lstat(...args);
    },
    mkdtemp: async (prefix: string) => {
      directory = await mkdtemp(prefix);
      return directory;
    },
  });
  await expect(createJourneyOwnedInputSnapshot({
    directoryPrefix: path.join(tmpdir(), "clean-pay-provider-test-file-"),
    expectedFilenames: ["one.txt"],
    populate: async ({ writeOwnedFile }: {
      writeOwnedFile: (filename: string, bytes: string) => Promise<string>;
    }) => writeOwnedFile("one.txt", "one"),
  }, operations)).rejects.toThrow(/file identity/);
  expect(failed).toBe(true);
  await expect(lstat(path.join(directory, "one.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
});

test("keeps private snapshot bytes at 0600 and exact container fixtures at 0444", async () => {
  const fixtureName = "fixture-db-observer-provision.sh";
  const privateName = "private.env";
  const tracked = modeTrackingSnapshotFileSystem();
  let directory = "";
  try {
    const snapshot = await createJourneyOwnedInputSnapshot({
      directoryPrefix: path.join(tmpdir(), "clean-pay-provider-mode-contract-"),
      expectedFilenames: [fixtureName, privateName],
      populate: async ({
        writeContainerReadonlyFixture,
        writeOwnedFile,
      }: SnapshotWriters) => {
        await writeOwnedFile(privateName, "PRIVATE=synthetic\n");
        await writeContainerReadonlyFixture(fixtureName, "#!/bin/sh\nexit 20\n");
      },
    }, tracked.operations, "linux");
    directory = snapshot.directory;
    expect(tracked.writeModesByFilename).toEqual(new Map([
      [fixtureName, 0o444],
      [privateName, 0o600],
    ]));
    expect(snapshot.directoryIdentity.permissionBits).toBe(0o700);
    const createdFiles = snapshot.createdFiles as Readonly<Record<
      string,
      { permissionBits: number }
    >>;
    expect(createdFiles[fixtureName].permissionBits).toBe(0o444);
    expect(createdFiles[privateName].permissionBits).toBe(0o600);
  } finally {
    if (directory) {
      await unlink(path.join(directory, fixtureName)).catch(() => undefined);
      await unlink(path.join(directory, privateName)).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
    }
  }
});

test("rejects snapshot access-class mismatches before creating a file", async () => {
  const cases = [
    {
      filename: "private.env",
      write: "container" as const,
    },
    {
      filename: "fixture-db-observer-provision.sh",
      write: "private" as const,
    },
  ];
  for (const fixture of cases) {
    let directory = "";
    const operations = snapshotFileSystem({
      mkdtemp: async (prefix: string) => {
        directory = await mkdtemp(prefix);
        return directory;
      },
    });
    await expect(createJourneyOwnedInputSnapshot({
      directoryPrefix: path.join(tmpdir(), `clean-pay-provider-access-${fixture.write}-`),
      expectedFilenames: [fixture.filename],
      populate: async ({
        writeContainerReadonlyFixture,
        writeOwnedFile,
      }: SnapshotWriters) => {
        if (fixture.write === "container") {
          return writeContainerReadonlyFixture(fixture.filename, "synthetic");
        }
        return writeOwnedFile(fixture.filename, "synthetic");
      },
    }, operations, "win32")).rejects.toThrow(/access class/);
    await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
  }
});

test("rejects chmod-only drift even when owned snapshot bytes and inode are unchanged", async () => {
  const filename = "private.env";
  let directory = "";
  const tracked = modeTrackingSnapshotFileSystem({
    mkdtemp: async (prefix: string) => {
      directory = await mkdtemp(prefix);
      return directory;
    },
  });
  let observed: unknown;
  try {
    await createJourneyOwnedInputSnapshot({
      directoryPrefix: path.join(tmpdir(), "clean-pay-provider-mode-drift-"),
      expectedFilenames: [filename],
      populate: async ({ writeOwnedFile }: SnapshotWriters) => {
        const target = await writeOwnedFile(filename, "PRIVATE=synthetic\n");
        tracked.permissionBitsByPath.set(path.resolve(target), 0o644);
        throw new Error("synthetic primary failure");
      },
    }, tracked.operations, "linux");
  } catch (error) {
    observed = error;
  }
  try {
    expect(observed).toBeInstanceOf(AggregateError);
    expect((observed as AggregateError).errors).toHaveLength(2);
    expect((observed as AggregateError).errors[1]).toMatchObject({
      message: expect.stringContaining("permissions"),
    });
  } finally {
    if (directory) {
      await unlink(path.join(directory, filename)).catch(() => undefined);
      await rmdir(directory).catch(() => undefined);
    }
  }
});

test("binds synthetic-only material without claiming a Windows owner-only DACL", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "clean-pay-private-mode-test-"));
  const target = path.join(directory, "sanitized-proof.json");
  await writeFile(target, "{}\n", { flag: "wx" });
  try {
    let chmodCalls = 0;
    let lstatCalls = 0;
    await expect(enforceJourneySyntheticPrivateMode(target, 0o600, {
      chmodPath: async () => {
        chmodCalls += 1;
        throw new Error("Windows chmod must not be treated as a DACL control");
      },
      lstatPath: async () => {
        lstatCalls += 1;
        throw new Error("Windows DACL must not be inferred from POSIX mode bits");
      },
      materialContract: JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
      platform: "win32",
    })).resolves.toEqual({
      materialContract: JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
      status: "synthetic-material-no-windows-owner-only-claim",
    });
    expect(chmodCalls).toBe(0);
    expect(lstatCalls).toBe(0);
    await expect(enforceJourneySyntheticPrivateMode(target, 0o600, {
      chmodPath: async () => { throw new Error("synthetic chmod failure"); },
      lstatPath: lstat,
      platform: "linux",
    })).rejects.toThrow("synthetic chmod failure");
    const cli = await readFile(path.resolve(__dirname, "prove-provider-overlap.mjs"), "utf8");
    expect(cli).toContain("await writeJourneySanitizedOutput(outputPath, bytes)");
    expect(cli).not.toMatch(/writeJourneySanitizedOutput\([^\n]+catch/);
  } finally {
    await unlink(target);
    await rmdir(directory);
  }
});

test("writes sanitized output through a create-only FileHandle and rejects identity failures", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "clean-pay-sanitized-output-test-"));
  const bytes = Buffer.from("{\"status\":\"synthetic\"}\n", "utf8");
  const defaultOperations = {
    chmod,
    lstat,
    open,
    readFile,
    realpath,
    unlink,
  };
  try {
    const success = path.join(directory, "success.json");
    await expect(writeJourneySanitizedOutput(success, bytes)).resolves.toMatchObject({
      bytes: bytes.byteLength,
      materialContract: JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
      status: "sanitized-create-only-output-written",
    });
    expect(await readFile(success)).toEqual(bytes);
    await expect(writeJourneySanitizedOutput(success, bytes)).rejects.toMatchObject({ code: "EEXIST" });

    const chmodFailure = path.join(directory, "chmod-failure.json");
    await expect(writeJourneySanitizedOutput(chmodFailure, bytes, {
      fileSystem: {
        ...defaultOperations,
        chmod: async () => { throw new Error("synthetic chmod failure"); },
      },
      platform: "linux",
    })).rejects.toThrow("synthetic chmod failure");
    await expect(lstat(chmodFailure)).rejects.toMatchObject({ code: "ENOENT" });

    const modeMismatch = path.join(directory, "mode-mismatch.json");
    let injectWrongMode = true;
    await expect(writeJourneySanitizedOutput(modeMismatch, bytes, {
      fileSystem: {
        ...defaultOperations,
        lstat: (async (...args: Parameters<typeof lstat>) => {
          const details = await lstat(...args);
          if (!injectWrongMode) return details;
          injectWrongMode = false;
          return new Proxy(details, {
            get(target, property, receiver) {
              if (property === "mode") return 0o644n;
              return Reflect.get(target, property, receiver);
            },
          });
        }) as typeof lstat,
      },
      platform: "linux",
    })).rejects.toThrow(/POSIX private mode/);
    await expect(lstat(modeMismatch)).rejects.toMatchObject({ code: "ENOENT" });

    const shortWrite = path.join(directory, "short-write.json");
    await expect(writeJourneySanitizedOutput(shortWrite, bytes, {
      fileSystem: {
        ...defaultOperations,
        open: (async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            close: () => handle.close(),
            stat: (options: { bigint: true }) => handle.stat(options),
            sync: () => handle.sync(),
            writeFile: async (value: Uint8Array) => {
              await handle.write(value.subarray(0, 1));
              throw new Error("synthetic short write");
            },
          };
        }) as unknown as typeof open,
      },
    })).rejects.toThrow("synthetic short write");
    await expect(lstat(shortWrite)).rejects.toMatchObject({ code: "ENOENT" });

    const initialStatFailure = path.join(directory, "initial-stat-failure.json");
    await expect(writeJourneySanitizedOutput(initialStatFailure, bytes, {
      fileSystem: {
        ...defaultOperations,
        open: (async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          let statCalls = 0;
          return {
            close: () => handle.close(),
            stat: (options: { bigint: true }) => {
              statCalls += 1;
              if (statCalls === 1) throw new Error("synthetic initial fstat failure");
              return handle.stat(options);
            },
            sync: () => handle.sync(),
            writeFile: (value: Uint8Array) => handle.writeFile(value),
          };
        }) as unknown as typeof open,
      },
    })).rejects.toThrow("synthetic initial fstat failure");
    await expect(lstat(initialStatFailure)).rejects.toMatchObject({ code: "ENOENT" });

    const unprovenStatFailure = path.join(directory, "unproven-stat-failure.json");
    await expect(writeJourneySanitizedOutput(unprovenStatFailure, bytes, {
      fileSystem: {
        ...defaultOperations,
        open: (async (...args: Parameters<typeof open>) => {
          const handle = await open(...args);
          return {
            close: () => handle.close(),
            stat: () => { throw new Error("synthetic persistent fstat failure"); },
            sync: () => handle.sync(),
            writeFile: (value: Uint8Array) => handle.writeFile(value),
          };
        }) as unknown as typeof open,
      },
    })).rejects.toThrow(/recovery identity was proven/);
    expect((await lstat(unprovenStatFailure)).size).toBe(0);
    await unlink(unprovenStatFailure);

    const alternate = path.join(directory, "alternate.json");
    await writeFile(alternate, "alternate\n", { flag: "wx" });
    const substituted = path.join(directory, "substituted.json");
    await expect(writeJourneySanitizedOutput(substituted, bytes, {
      fileSystem: {
        ...defaultOperations,
        realpath: (async (target: Parameters<typeof realpath>[0]) => (
          path.resolve(String(target)) === path.resolve(substituted)
            ? alternate
            : realpath(target)
        )) as unknown as typeof realpath,
      },
    })).rejects.toThrow(/path or bytes changed/);
    await expect(lstat(substituted)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(alternate, "utf8")).toBe("alternate\n");
  } finally {
    for (const filename of [
      "success.json", "alternate.json", "unproven-stat-failure.json",
    ]) {
      await unlink(path.join(directory, filename)).catch(() => undefined);
    }
    await rmdir(directory);
  }
});

test("contains no top-level runner or broad cleanup primitive", async () => {
  const source = await readFile(path.resolve(
    __dirname,
    "journey-owned-stack-orchestrator.mjs",
  ), "utf8");
  expect(source).not.toMatch(/process\.(?:argv|exit|exitCode)/);
  expect(source).not.toMatch(/\brm\s*\(|recursive\s*:\s*true|\*\//);
  expect(source).toContain("const launchPlans = await Promise.all(handles.map(prepareJourneyOwnedStackLaunch))");
  expect(source).toContain("launchReceipt = await dispatchJourneyOwnedStackPair(handles, launchPlans)");
  expect(source).toContain("await assertJourneyProjectAbsent");
});

test("derives a migration config through an unstarted owned probe and removes it exactly", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const configDigest = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, configDigest);
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "1".repeat(32),
    runDocker: docker.run,
  })).resolves.toMatchObject({
    assetImageDigest: assetDigest,
    configDigest,
    status: "verifier-owned-unstarted-config-probe-cleaned",
  });
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container create"))
    .toBe(true);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container start"))
    .toBe(false);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container rm"))
    .toBe(true);
});

test("preserves the exact classic config binding shape and digest contract", async () => {
  const contract = ownedContract("baseline");
  const assetImageDigest = `sha256:${"2".repeat(64)}`;
  const configDigest = `sha256:${"3".repeat(64)}`;
  const probeNonce = "7".repeat(32);
  const docker = createOwnedDockerMock(contract, assetImageDigest, configDigest);
  const binding = {
    assetImageDigest,
    configDigest,
    referenceSha256: testSha256(contract.images.migration),
    repoDigests: [assetImageDigest],
    role: "migration",
  };
  const expected = {
    ...binding,
    contractSha256: testSha256(JSON.stringify(binding)),
    probeOwnershipSha256: testSha256(
      `${testSha256(contract.project)}:migration:${probeNonce}`,
    ),
    status: "verifier-owned-unstarted-config-probe-cleaned",
  };
  const identity = await deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetImageDigest,
    probeNonce,
    runDocker: docker.run,
  });
  expect(identity).toEqual(expected);
  expect(JSON.stringify(identity)).toBe(JSON.stringify(expected));
  expect(docker.activeProbeCount).toBe(0);
});

test("binds containerd root plus platform manifest without inspecting child digests", async () => {
  const contract = ownedContract("baseline");
  const applicationAssetImageDigest = `sha256:${"a".repeat(64)}`;
  const applicationConfigDigest = `sha256:${"4".repeat(64)}`;
  const applicationManifestDigest = `sha256:${"b".repeat(64)}`;
  const migrationAssetImageDigest = `sha256:${"2".repeat(64)}`;
  const migrationConfigDigest = `sha256:${"3".repeat(64)}`;
  const migrationManifestDigest = `sha256:${"5".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    migrationAssetImageDigest,
    migrationConfigDigest,
    {
      applicationManifestDigest,
      applicationManifestMediaType:
        "application/vnd.docker.distribution.manifest.v2+json",
      migrationManifestDigest,
      mode: "containerd",
    },
  );
  const application = await deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationAssetImageDigest,
    expectedApplicationImageConfigDigest: applicationConfigDigest,
    expectedApplicationManifestDigest: applicationManifestDigest,
    expectedApplicationRepoDigests: [
      applicationAssetImageDigest,
      applicationManifestDigest,
    ],
    probeNonce: "8".repeat(32),
    runDocker: docker.run,
  });
  const migration = await deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: migrationAssetImageDigest,
    probeNonce: "9".repeat(32),
    runDocker: docker.run,
  });
  expect(application).toMatchObject({
    assetImageDigest: applicationAssetImageDigest,
    configDigest: applicationConfigDigest,
    imageSelectionMode: "containerd-root-manifest",
    manifestDigest: applicationManifestDigest,
    runtimeImageDigest: applicationAssetImageDigest,
    status: "verifier-owned-unstarted-root-manifest-probe-cleaned",
  });
  expect(migration).toMatchObject({
    assetImageDigest: migrationAssetImageDigest,
    imageSelectionMode: "containerd-root-manifest",
    manifestDigest: migrationManifestDigest,
    runtimeImageDigest: migrationAssetImageDigest,
    status: "verifier-owned-unstarted-root-manifest-probe-cleaned",
  });
  expect(Object.hasOwn(migration, "configDigest")).toBe(false);
  const imageInspectionTargets = docker.calls
    .filter((args) => args.slice(0, 2).join(" ") === "image inspect")
    .map((args) => args[2]);
  expect(imageInspectionTargets).not.toContain(applicationConfigDigest);
  expect(imageInspectionTargets).not.toContain(applicationManifestDigest);
  expect(imageInspectionTargets).not.toContain(migrationConfigDigest);
  expect(imageInspectionTargets).not.toContain(migrationManifestDigest);
  expect(docker.activeProbeCount).toBe(0);
});

test("binds a containerd single-manifest root only to the same selected digest", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationConfig = `sha256:${"4".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationRoot,
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  const identity = await deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: applicationConfig,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "d".repeat(32),
    runDocker: docker.run,
  });
  expect(identity).toMatchObject({
    assetImageDigest: applicationRoot,
    configDigest: applicationConfig,
    manifestDigest: applicationRoot,
    runtimeImageDigest: applicationRoot,
  });
  expect(docker.activeProbeCount).toBe(0);
});

test("binds Docker's exact config annotation on a containerd single-manifest root", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationConfig = `sha256:${"4".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestAnnotations: { "config.digest": applicationConfig },
      applicationManifestDigest: applicationRoot,
      applicationRootAnnotations: { "config.digest": applicationConfig },
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  const identity = await deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: applicationConfig,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "1".repeat(32),
    runDocker: docker.run,
  });
  expect(identity).toMatchObject({
    assetImageDigest: applicationRoot,
    configDigest: applicationConfig,
    manifestDigest: applicationRoot,
    runtimeImageDigest: applicationRoot,
  });
  expect(Object.hasOwn(identity, "manifestConfigDigest")).toBe(false);
  expect(docker.activeProbeCount).toBe(0);
});

test("keeps root-only and selected-only annotations validation-only and byte-stable", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationConfig = `sha256:${"4".repeat(64)}`;
  const annotation = { "config.digest": applicationConfig };
  const identities = [];
  for (const annotationOptions of [
    {},
    { applicationRootAnnotations: annotation },
    { applicationManifestAnnotations: annotation },
    {
      applicationManifestAnnotations: annotation,
      applicationRootAnnotations: annotation,
    },
  ]) {
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      {
        ...annotationOptions,
        applicationManifestDigest: applicationRoot,
        applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
        mode: "containerd",
      },
    );
    identities.push(await deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: applicationRoot,
      expectedApplicationImageConfigDigest: applicationConfig,
      expectedApplicationManifestDigest: applicationRoot,
      expectedApplicationRepoDigests: [applicationRoot],
      probeNonce: "e".repeat(32),
      runDocker: docker.run,
    }));
    expect(docker.activeProbeCount).toBe(0);
  }
  for (const identity of identities.slice(1)) {
    expect(identity).toEqual(identities[0]);
    expect(JSON.stringify(identity)).toBe(JSON.stringify(identities[0]));
  }
  expect(Object.keys(identities[0]).sort()).toEqual([
    "assetImageDigest",
    "configDigest",
    "contractSha256",
    "imageSelectionMode",
    "manifestDigest",
    "probeOwnershipSha256",
    "referenceSha256",
    "repoDigests",
    "role",
    "runtimeImageDigest",
    "status",
  ]);
});

test("binds an exact migration config annotation without exposing it in the receipt", async () => {
  const contract = ownedContract("baseline");
  const migrationRoot = `sha256:${"2".repeat(64)}`;
  const migrationConfig = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    migrationRoot,
    migrationConfig,
    {
      migrationManifestAnnotations: { "config.digest": migrationConfig },
      migrationManifestDigest: migrationRoot,
      migrationRootAnnotations: { "config.digest": migrationConfig },
      migrationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      migrationMode: "containerd",
    },
  );
  const identity = await deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: migrationRoot,
    expectedMigrationManifestDigest: migrationRoot,
    probeNonce: "6".repeat(32),
    runDocker: docker.run,
  });
  expect(identity).toMatchObject({
    assetImageDigest: migrationRoot,
    manifestDigest: migrationRoot,
    runtimeImageDigest: migrationRoot,
  });
  expect(Object.hasOwn(identity, "configDigest")).toBe(false);
  expect(Object.hasOwn(identity, "manifestConfigDigest")).toBe(false);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects malformed or unbound authoritative root config annotations", async () => {
  const cases = [
    {
      label: "wrong root config digest",
      rootAnnotations: { "config.digest": `sha256:${"5".repeat(64)}` },
      singleRoot: true,
    },
    {
      label: "extra root annotation",
      rootAnnotations: {
        "config.digest": `sha256:${"4".repeat(64)}`,
        unexpected: `sha256:${"5".repeat(64)}`,
      },
      singleRoot: true,
    },
    {
      label: "annotation on index root",
      rootAnnotations: { "config.digest": `sha256:${"4".repeat(64)}` },
      singleRoot: false,
    },
  ] as const;
  for (const { label, rootAnnotations, singleRoot } of cases) {
    const contract = ownedContract("baseline");
    const applicationRoot = `sha256:${"a".repeat(64)}`;
    const applicationManifest = singleRoot
      ? applicationRoot
      : `sha256:${"b".repeat(64)}`;
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      {
        ...(singleRoot ? {
          applicationManifestAnnotations: {
            "config.digest": `sha256:${"4".repeat(64)}`,
          },
          applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
        } : {}),
        applicationManifestDigest: applicationManifest,
        applicationRootAnnotations: { ...rootAnnotations },
        mode: "containerd",
      },
    );
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: applicationRoot,
      expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
      expectedApplicationManifestDigest: applicationManifest,
      expectedApplicationRepoDigests: singleRoot
        ? [applicationRoot]
        : [applicationRoot, applicationManifest],
      probeNonce: "d".repeat(32),
      runDocker: docker.run,
    }), label).rejects.toThrow(/root/);
    expect(docker.activeProbeCount, label).toBe(0);
  }
});

test("revalidates the initial root annotation snapshot after containerd selection", async () => {
  const cases: Array<{
    annotations: unknown;
    initialRootSize?: number;
    label: string;
    singleRoot: boolean;
  }> = [
    { annotations: null, label: "null annotations", singleRoot: true },
    { annotations: [], label: "array annotations", singleRoot: true },
    { annotations: {}, label: "empty annotations", singleRoot: true },
    {
      annotations: { "config.digest": "not-a-digest" },
      label: "malformed config digest",
      singleRoot: true,
    },
    {
      annotations: { "config.digest": `sha256:${"5".repeat(64)}` },
      label: "wrong config digest",
      singleRoot: true,
    },
    {
      annotations: { "config.digest": `sha256:${"4".repeat(64)}` },
      initialRootSize: 4096,
      label: "annotated root and selected size mismatch",
      singleRoot: true,
    },
    {
      annotations: { "config.digest": `sha256:${"4".repeat(64)}` },
      label: "annotation on index root",
      singleRoot: false,
    },
  ];
  for (const { annotations, initialRootSize = 2048, label, singleRoot } of cases) {
    const contract = ownedContract("baseline");
    const applicationRoot = `sha256:${"a".repeat(64)}`;
    const applicationManifest = singleRoot
      ? applicationRoot
      : `sha256:${"b".repeat(64)}`;
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      {
        applicationManifestDigest: applicationManifest,
        ...(singleRoot ? {
          applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
        } : {}),
        mode: "containerd",
      },
    );
    let imageInspections = 0;
    const run = async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      const output = await docker.run(args, maximumBytes, environment);
      if (args[0] === "image" && args[1] === "inspect") {
        imageInspections += 1;
        if (imageInspections === 1) {
          const [image] = JSON.parse(output) as [Record<string, unknown>];
          const descriptor = image.Descriptor as Record<string, unknown>;
          descriptor.annotations = annotations;
          descriptor.size = initialRootSize;
          return JSON.stringify([image]);
        }
      }
      return output;
    };
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: applicationRoot,
      expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
      expectedApplicationManifestDigest: applicationManifest,
      expectedApplicationRepoDigests: singleRoot
        ? [applicationRoot]
        : [applicationRoot, applicationManifest],
      probeNonce: "f".repeat(32),
      runDocker: run,
    }), label).rejects.toThrow(/root/);
    expect(docker.activeProbeCount, label).toBe(0);
  }
});

test("rejects initial root annotation disappearance without leaking it into cleanup", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationConfig = `sha256:${"4".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationRoot,
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  let imageInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "image" && args[1] === "inspect") {
      imageInspections += 1;
      const [image] = JSON.parse(output) as [Record<string, unknown>];
      (image.Descriptor as Record<string, unknown>).size = 2048;
      if (imageInspections === 1) {
        (image.Descriptor as Record<string, unknown>).annotations = {
          "config.digest": applicationConfig,
        };
      }
      return JSON.stringify([image]);
    }
    return output;
  };
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: applicationConfig,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "0".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/annotation presence changed/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects authoritative root config and size drift on the first recheck", async () => {
  for (const drift of ["config", "size"] as const) {
    const contract = ownedContract("baseline");
    const applicationRoot = `sha256:${"a".repeat(64)}`;
    const applicationConfig = `sha256:${"4".repeat(64)}`;
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      {
        applicationManifestAnnotations: { "config.digest": applicationConfig },
        applicationManifestDigest: applicationRoot,
        applicationRootAnnotations: { "config.digest": applicationConfig },
        applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
        mode: "containerd",
      },
    );
    let imageInspections = 0;
    const run = async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      const output = await docker.run(args, maximumBytes, environment);
      if (args[0] === "image" && args[1] === "inspect") {
        imageInspections += 1;
        if (imageInspections === 2) {
          const [image] = JSON.parse(output) as [Record<string, unknown>];
          const descriptor = image.Descriptor as Record<string, unknown>;
          if (drift === "config") {
            descriptor.annotations = { "config.digest": `sha256:${"5".repeat(64)}` };
          } else {
            descriptor.size = 2049;
          }
          return JSON.stringify([image]);
        }
      }
      return output;
    };
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: applicationRoot,
      expectedApplicationImageConfigDigest: applicationConfig,
      expectedApplicationManifestDigest: applicationRoot,
      expectedApplicationRepoDigests: [applicationRoot],
      probeNonce: "1".repeat(32),
      runDocker: run,
    }), drift).rejects.toThrow(drift === "config" ? /root annotations/ : /root size changed/);
    expect(docker.activeProbeCount, drift).toBe(0);
  }
});

test("freezes a migration root-only config annotation across root rechecks", async () => {
  const contract = ownedContract("baseline");
  const migrationRoot = `sha256:${"2".repeat(64)}`;
  const initialConfig = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    migrationRoot,
    initialConfig,
    {
      migrationManifestDigest: migrationRoot,
      migrationRootAnnotations: { "config.digest": initialConfig },
      migrationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      migrationMode: "containerd",
    },
  );
  let imageInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "image" && args[1] === "inspect") {
      imageInspections += 1;
      if (imageInspections === 2) {
        const [image] = JSON.parse(output) as [Record<string, unknown>];
        (image.Descriptor as Record<string, unknown>).annotations = {
          "config.digest": `sha256:${"5".repeat(64)}`,
        };
        return JSON.stringify([image]);
      }
    }
    return output;
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: migrationRoot,
    expectedMigrationManifestDigest: migrationRoot,
    probeNonce: "3".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/root annotations are invalid/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects a config annotation when the authoritative OCI root is an index", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationConfig = `sha256:${"4".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestAnnotations: { "config.digest": applicationConfig },
      applicationManifestDigest: applicationRoot,
      mode: "containerd",
    },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: applicationConfig,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "7".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/manifest/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects an OCI index root that aliases its selected manifest without annotations", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationRoot,
      mode: "containerd",
    },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "9".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/index root aliases/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects an annotated manifest media type that differs from its authoritative root", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationConfig = `sha256:${"4".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestAnnotations: { "config.digest": applicationConfig },
      applicationManifestDigest: applicationRoot,
      applicationManifestMediaType: "application/vnd.docker.distribution.manifest.v2+json",
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: applicationConfig,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "8".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/manifest/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects an unannotated manifest media type that differs from a single root", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationRoot,
      applicationManifestMediaType: "application/vnd.docker.distribution.manifest.v2+json",
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "b".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/single-manifest root media type/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects config annotations outside the exact single-manifest attestation", async () => {
  const cases = [
    {
      annotations: { "config.digest": `sha256:${"5".repeat(64)}` },
      label: "wrong config digest",
      manifestIsRoot: true,
    },
    {
      annotations: {
        "config.digest": `sha256:${"4".repeat(64)}`,
        unexpected: `sha256:${"5".repeat(64)}`,
      },
      label: "extra annotation",
      manifestIsRoot: true,
    },
    {
      annotations: { "config.digest": `sha256:${"4".repeat(64)}` },
      label: "annotation on index child",
      manifestIsRoot: false,
    },
  ] as const;
  for (const { annotations, label, manifestIsRoot } of cases) {
    const contract = ownedContract("baseline");
    const applicationRoot = `sha256:${"a".repeat(64)}`;
    const applicationManifest = manifestIsRoot
      ? applicationRoot
      : `sha256:${"b".repeat(64)}`;
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      {
        applicationManifestAnnotations: { ...annotations },
        applicationManifestDigest: applicationManifest,
        ...(manifestIsRoot ? {
          applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
        } : {}),
        mode: "containerd",
      },
    );
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: applicationRoot,
      expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
      expectedApplicationManifestDigest: applicationManifest,
      expectedApplicationRepoDigests: manifestIsRoot
        ? [applicationRoot]
        : [applicationRoot, applicationManifest],
      probeNonce: "2".repeat(32),
      runDocker: docker.run,
    }), label).rejects.toThrow(/manifest/);
    expect(docker.activeProbeCount, label).toBe(0);
  }
});

test("rejects malformed config annotations on a true single-manifest root", async () => {
  const malformedAnnotations: Array<[string, unknown]> = [
    ["null", null],
    ["array", []],
    ["empty", {}],
    ["non-digest", { "config.digest": "not-a-digest" }],
  ];
  for (const [label, annotations] of malformedAnnotations) {
    const contract = ownedContract("baseline");
    const applicationRoot = `sha256:${"a".repeat(64)}`;
    const applicationConfig = `sha256:${"4".repeat(64)}`;
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      {
        applicationManifestAnnotations: { "config.digest": applicationConfig },
        applicationManifestDigest: applicationRoot,
        applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
        mode: "containerd",
      },
    );
    let injected = false;
    const run = async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      const output = await docker.run(args, maximumBytes, environment);
      if (!injected && args[0] === "container" && args[1] === "inspect") {
        injected = true;
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        (probe.ImageManifestDescriptor as Record<string, unknown>).annotations = annotations;
        return JSON.stringify([probe]);
      }
      return output;
    };
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: applicationRoot,
      expectedApplicationImageConfigDigest: applicationConfig,
      expectedApplicationManifestDigest: applicationRoot,
      expectedApplicationRepoDigests: [applicationRoot],
      probeNonce: "3".repeat(32),
      runDocker: run,
    }), label).rejects.toThrow(/manifest/);
    expect(docker.activeProbeCount, label).toBe(0);
  }
});

test("detects migration annotation drift and still removes its exact owned probe", async () => {
  const contract = ownedContract("baseline");
  const migrationRoot = `sha256:${"2".repeat(64)}`;
  const migrationConfig = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    migrationRoot,
    migrationConfig,
    {
      migrationManifestAnnotations: { "config.digest": migrationConfig },
      migrationManifestDigest: migrationRoot,
      migrationRootAnnotations: { "config.digest": migrationConfig },
      migrationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      migrationMode: "containerd",
    },
  );
  let probeInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "container" && args[1] === "inspect") {
      probeInspections += 1;
      if (probeInspections === 2) {
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        delete (probe.ImageManifestDescriptor as Record<string, unknown>).annotations;
        return JSON.stringify([probe]);
      }
    }
    return output;
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: migrationRoot,
    expectedMigrationManifestDigest: migrationRoot,
    probeNonce: "4".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/selection changed/);
  expect(docker.activeProbeCount).toBe(0);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container rm"))
    .toBe(true);
});

test("detects unannotated platform manifest media-type drift before exact cleanup", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationManifest = `sha256:${"b".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationManifest,
      mode: "containerd",
    },
  );
  let probeInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "container" && args[1] === "inspect") {
      probeInspections += 1;
      if (probeInspections === 2) {
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        (probe.ImageManifestDescriptor as Record<string, unknown>).mediaType =
          "application/vnd.docker.distribution.manifest.v2+json";
        return JSON.stringify([probe]);
      }
    }
    return output;
  };
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationManifest,
    expectedApplicationRepoDigests: [applicationRoot, applicationManifest],
    probeNonce: "c".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/selection changed/);
  expect(docker.activeProbeCount).toBe(0);
});

test("detects annotated platform manifest size drift before exact cleanup", async () => {
  const contract = ownedContract("baseline");
  const migrationRoot = `sha256:${"2".repeat(64)}`;
  const migrationConfig = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    migrationRoot,
    migrationConfig,
    {
      migrationManifestAnnotations: { "config.digest": migrationConfig },
      migrationManifestDigest: migrationRoot,
      migrationRootAnnotations: { "config.digest": migrationConfig },
      migrationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      migrationMode: "containerd",
    },
  );
  let probeInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "container" && args[1] === "inspect") {
      probeInspections += 1;
      if (probeInspections === 2) {
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        (probe.ImageManifestDescriptor as Record<string, unknown>).size = 2049;
        return JSON.stringify([probe]);
      }
    }
    return output;
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: migrationRoot,
    expectedMigrationManifestDigest: migrationRoot,
    probeNonce: "4".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/annotations are invalid/);
  expect(docker.activeProbeCount).toBe(0);
});

test("binds unannotated manifest size into cleanup selection and removes on drift", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationManifest = `sha256:${"b".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationManifest,
      mode: "containerd",
    },
  );
  let probeInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "container" && args[1] === "inspect") {
      probeInspections += 1;
      if (probeInspections === 2) {
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        (probe.ImageManifestDescriptor as Record<string, unknown>).size = 2049;
        return JSON.stringify([probe]);
      }
    }
    return output;
  };
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationManifest,
    expectedApplicationRepoDigests: [applicationRoot, applicationManifest],
    probeNonce: "2".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/selection changed/);
  expect(docker.activeProbeCount).toBe(0);
});

test("preserves annotation drift and exact removal failures in one AggregateError", async () => {
  const contract = ownedContract("baseline");
  const migrationRoot = `sha256:${"2".repeat(64)}`;
  const migrationConfig = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    migrationRoot,
    migrationConfig,
    {
      migrationManifestAnnotations: { "config.digest": migrationConfig },
      migrationManifestDigest: migrationRoot,
      migrationRootAnnotations: { "config.digest": migrationConfig },
      migrationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      migrationMode: "containerd",
    },
  );
  let probeInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    if (args[0] === "container" && args[1] === "rm") {
      throw new Error("synthetic exact removal failure");
    }
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "container" && args[1] === "inspect") {
      probeInspections += 1;
      if (probeInspections === 2) {
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        delete (probe.ImageManifestDescriptor as Record<string, unknown>).annotations;
        return JSON.stringify([probe]);
      }
    }
    return output;
  };
  let captured: unknown;
  try {
    await deriveJourneyMigrationImageConfigDigest({
      contract,
      environment: {},
      expectedMigrationAssetImageDigest: migrationRoot,
      expectedMigrationManifestDigest: migrationRoot,
      probeNonce: "5".repeat(32),
      runDocker: run,
    });
  } catch (error) {
    captured = error;
  }
  expect(captured).toBeInstanceOf(AggregateError);
  const messages = (captured as AggregateError).errors.map((error) => String(error));
  expect(messages).toEqual([
    expect.stringMatching(/selection changed/),
    expect.stringMatching(/synthetic exact removal failure/),
  ]);
  expect(docker.activeProbeCount).toBe(1);
});

test("rejects authoritative root media-type drift and removes the exact probe", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationRoot,
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  let imageInspections = 0;
  const run = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "image" && args[1] === "inspect") {
      imageInspections += 1;
      if (imageInspections === 2) {
        const [image] = JSON.parse(output) as [Record<string, unknown>];
        (image.Descriptor as Record<string, unknown>).mediaType =
          "application/vnd.oci.image.index.v1+json";
        return JSON.stringify([image]);
      }
    }
    return output;
  };
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationRoot,
    expectedApplicationRepoDigests: [applicationRoot],
    probeNonce: "a".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/media type changed/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects a containerd single-manifest root with a different selected manifest", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationManifest = `sha256:${"b".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationManifest,
      applicationRootMediaType: "application/vnd.oci.image.manifest.v1+json",
      mode: "containerd",
    },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationManifest,
    expectedApplicationRepoDigests: [applicationRoot, applicationManifest],
    probeNonce: "e".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/single-manifest/);
  expect(docker.activeProbeCount).toBe(0);
});

test("binds containerd descriptors to an attested linux arm64 platform", async () => {
  const contract = ownedContract("baseline");
  const applicationRoot = `sha256:${"a".repeat(64)}`;
  const applicationManifest = `sha256:${"b".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    {
      applicationManifestDigest: applicationManifest,
      imagePlatformArchitecture: "arm64",
      mode: "containerd",
    },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: applicationRoot,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationManifestDigest: applicationManifest,
    expectedApplicationRepoDigests: [applicationRoot, applicationManifest],
    expectedImagePlatform: { architecture: "arm64", os: "linux" },
    probeNonce: "f".repeat(32),
    runDocker: docker.run,
  })).resolves.toMatchObject({ manifestDigest: applicationManifest });
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects an explicit null image platform before the first Docker query", async () => {
  const contract = ownedContract("baseline");
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: `sha256:${"a".repeat(64)}`,
    expectedApplicationImageConfigDigest: `sha256:${"4".repeat(64)}`,
    expectedApplicationRepoDigests: [`sha256:${"a".repeat(64)}`],
    expectedImagePlatform: null,
    probeNonce: "0".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/expected image platform/);
  expect(docker.calls).toEqual([]);
});

test("rejects malformed or unattested containerd descriptors and still removes its probe", async () => {
  const mutations: Array<[string, (probe: Record<string, unknown>) => void]> = [
    ["absent", (probe) => { delete probe.ImageManifestDescriptor; }],
    ["present null", (probe) => { probe.ImageManifestDescriptor = null; }],
    ["extra field", (probe) => {
      (probe.ImageManifestDescriptor as Record<string, unknown>).unexpected = true;
    }],
    ["media type", (probe) => {
      (probe.ImageManifestDescriptor as Record<string, unknown>).mediaType = "text/plain";
    }],
    ["size", (probe) => {
      (probe.ImageManifestDescriptor as Record<string, unknown>).size = 0;
    }],
    ["platform", (probe) => {
      const descriptor = probe.ImageManifestDescriptor as Record<string, unknown>;
      (descriptor.platform as Record<string, unknown>).architecture = "arm64";
    }],
    ["digest", (probe) => {
      (probe.ImageManifestDescriptor as Record<string, unknown>).digest =
        `sha256:${"f".repeat(64)}`;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const contract = ownedContract("baseline");
    const assetDigest = `sha256:${"a".repeat(64)}`;
    const configDigest = `sha256:${"4".repeat(64)}`;
    const manifestDigest = `sha256:${"b".repeat(64)}`;
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      { mode: "containerd", applicationManifestDigest: manifestDigest },
    );
    let injected = false;
    const run = async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      const output = await docker.run(args, maximumBytes, environment);
      if (!injected && args[0] === "container" && args[1] === "inspect") {
        injected = true;
        const [probe] = JSON.parse(output) as [Record<string, unknown>];
        mutate(probe);
        return JSON.stringify([probe]);
      }
      return output;
    };
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: assetDigest,
      expectedApplicationImageConfigDigest: configDigest,
      expectedApplicationManifestDigest: manifestDigest,
      expectedApplicationRepoDigests: [assetDigest, manifestDigest],
      probeNonce: "a".repeat(32),
      runDocker: run,
    }), label).rejects.toThrow(/manifest|OCI root selection/);
    expect(docker.activeProbeCount, label).toBe(0);
    expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container rm"), label)
      .toBe(true);
  }
});

test("requires an app attestation whenever containerd exposes a platform manifest", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"a".repeat(64)}`;
  const configDigest = `sha256:${"4".repeat(64)}`;
  const manifestDigest = `sha256:${"b".repeat(64)}`;
  const docker = createOwnedDockerMock(
    contract,
    `sha256:${"2".repeat(64)}`,
    `sha256:${"3".repeat(64)}`,
    { mode: "containerd", applicationManifestDigest: manifestDigest },
  );
  await expect(deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: {},
    expectedApplicationAssetImageDigest: assetDigest,
    expectedApplicationImageConfigDigest: configDigest,
    expectedApplicationRepoDigests: [assetDigest, manifestDigest],
    probeNonce: "b".repeat(32),
    runDocker: docker.run,
  })).rejects.toThrow(/asset manifest attestation/);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects an app config attestation that aliases a containerd root or manifest", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"a".repeat(64)}`;
  const manifestDigest = `sha256:${"b".repeat(64)}`;
  for (const configDigest of [assetDigest, manifestDigest]) {
    const docker = createOwnedDockerMock(
      contract,
      `sha256:${"2".repeat(64)}`,
      `sha256:${"3".repeat(64)}`,
      { mode: "containerd", applicationManifestDigest: manifestDigest },
    );
    await expect(deriveJourneyApplicationImageConfigDigest({
      contract,
      environment: {},
      expectedApplicationAssetImageDigest: assetDigest,
      expectedApplicationImageConfigDigest: configDigest,
      expectedApplicationManifestDigest: manifestDigest,
      expectedApplicationRepoDigests: [assetDigest, manifestDigest],
      probeNonce: "c".repeat(32),
      runDocker: docker.run,
    })).rejects.toThrow(/config attestation/);
    expect(docker.activeProbeCount).toBe(0);
  }
});

test("cleans an owned probe after malformed first inspection without masking the failure", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const configDigest = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, configDigest);
  let probeInspections = 0;
  const run = async (args: string[], maximumBytes?: number, environment: Record<string, string> = {}) => {
    if (args[0] === "container" && args[1] === "inspect" && probeInspections++ === 0) {
      return JSON.stringify([{ unexpected: true }]);
    }
    return docker.run(args, maximumBytes, environment);
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "2".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/probe/);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container rm"))
    .toBe(true);
  expect(docker.activeProbeCount).toBe(0);
});

test("recovers and removes a probe when create side-effects before rejecting", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, `sha256:${"3".repeat(64)}`);
  let rejectedCreate = false;
  const run = async (args: string[], maximumBytes?: number, environment: Record<string, string> = {}) => {
    if (!rejectedCreate && args[0] === "container" && args[1] === "create") {
      rejectedCreate = true;
      await docker.run(args, maximumBytes, environment);
      throw new Error("synthetic create transport failure");
    }
    return docker.run(args, maximumBytes, environment);
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "3".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/create transport failure/);
  expect(docker.activeProbeCount).toBe(0);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container rm"))
    .toBe(true);
});

test("uses unpredictable caller-bound probe ownership so concurrent runs cannot adopt each other", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, `sha256:${"3".repeat(64)}`);
  const identities = await Promise.all(["a", "b"].map((digit) => (
    deriveJourneyMigrationImageConfigDigest({
      contract,
      environment: {},
      expectedMigrationAssetImageDigest: assetDigest,
      probeNonce: digit.repeat(32),
      runDocker: docker.run,
    })
  )));
  const creations = docker.calls.filter((args) => (
    args[0] === "container" && args[1] === "create"
  ));
  expect(creations).toHaveLength(2);
  expect(new Set(creations.map((args) => args[args.indexOf("--name") + 1])).size).toBe(2);
  expect(new Set(creations.map((args) => args[args.indexOf("--label") + 1])).size).toBe(2);
  expect(new Set(identities.map(({ probeOwnershipSha256 }) => probeOwnershipSha256)).size)
    .toBe(2);
  expect(docker.activeProbeCount).toBe(0);
});

test("rejects an image Id masquerading as an OCI root before creating a probe", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, `sha256:${"3".repeat(64)}`);
  const run = async (args: string[], maximumBytes?: number, environment: Record<string, string> = {}) => {
    if (args[0] === "image" && args[1] === "inspect") {
      return JSON.stringify([{ Id: assetDigest, RepoDigests: [] }]);
    }
    return docker.run(args, maximumBytes, environment);
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "4".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/OCI root/);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container create"))
    .toBe(false);
});

test("rejects a wrong authoritative descriptor even when a stale RepoDigest matches", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, `sha256:${"3".repeat(64)}`);
  const run = async (args: string[], maximumBytes?: number, environment: Record<string, string> = {}) => {
    if (args[0] === "image" && args[1] === "inspect") {
      return JSON.stringify([{
        Descriptor: { digest: `sha256:${"f".repeat(64)}` },
        Id: `sha256:${"3".repeat(64)}`,
        RepoDigests: [`clean-pay-migration@${assetDigest}`],
      }]);
    }
    return docker.run(args, maximumBytes, environment);
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "d".repeat(32),
    runDocker: run,
  })).rejects.toThrow(/authoritative OCI root descriptor/);
  expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container create"))
    .toBe(false);
});

test("uses only an exact reference RepoDigest when an OCI descriptor is unavailable", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const configDigest = `sha256:${"3".repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, configDigest);
  const run = async (args: string[], maximumBytes?: number, environment: Record<string, string> = {}) => {
    const output = await docker.run(args, maximumBytes, environment);
    if (args[0] === "image" && args[1] === "inspect") {
      const [inspection] = JSON.parse(output);
      delete inspection.Descriptor;
      inspection.RepoDigests = [`clean-pay-migration@${assetDigest}`];
      return JSON.stringify([inspection]);
    }
    return output;
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "e".repeat(32),
    runDocker: run,
  })).resolves.toMatchObject({ configDigest });
  expect(docker.activeProbeCount).toBe(0);

  const unboundDocker = createOwnedDockerMock(contract, assetDigest, configDigest);
  const unboundRun = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await unboundDocker.run(args, maximumBytes, environment);
    if (args[0] === "image" && args[1] === "inspect") {
      const [inspection] = JSON.parse(output);
      delete inspection.Descriptor;
      inspection.RepoDigests = [`unrelated.example/clean-pay@${assetDigest}`];
      return JSON.stringify([inspection]);
    }
    return output;
  };
  await expect(deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: {},
    expectedMigrationAssetImageDigest: assetDigest,
    probeNonce: "f".repeat(32),
    runDocker: unboundRun,
  })).rejects.toThrow(/attested OCI root/);
  expect(unboundDocker.calls.some((args) => args.slice(0, 2).join(" ") === "container create"))
    .toBe(false);
});

test("rejects selected-config root mismatch and reference retarget with exact cleanup", async () => {
  const contract = ownedContract("baseline");
  const assetDigest = `sha256:${"2".repeat(64)}`;
  const configDigest = `sha256:${"3".repeat(64)}`;
  for (const mode of ["selected-config", "retarget"] as const) {
    const docker = createOwnedDockerMock(contract, assetDigest, configDigest);
    let referenceInspections = 0;
    const run = async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      if (args[0] === "image" && args[1] === "inspect") {
        if (mode === "selected-config" && args[2] === configDigest) {
          const wrong = `sha256:${"f".repeat(64)}`;
          return JSON.stringify([{ Id: configDigest, Descriptor: { digest: wrong }, RepoDigests: [] }]);
        }
        if (args[2] === contract.images.migration) {
          referenceInspections += 1;
          if (mode === "retarget" && referenceInspections === 2) {
            const wrong = `sha256:${"e".repeat(64)}`;
            return JSON.stringify([{ Id: configDigest, Descriptor: { digest: wrong }, RepoDigests: [] }]);
          }
        }
      }
      return docker.run(args, maximumBytes, environment);
    };
    await expect(deriveJourneyMigrationImageConfigDigest({
      contract,
      environment: {},
      expectedMigrationAssetImageDigest: assetDigest,
      probeNonce: (mode === "selected-config" ? "5" : "6").repeat(32),
      runDocker: run,
    }), mode).rejects.toThrow(/OCI root/);
    expect(docker.activeProbeCount, mode).toBe(0);
    expect(docker.calls.some((args) => args.slice(0, 2).join(" ") === "container rm"), mode)
      .toBe(true);
  }
});

test("rejects a wrong application tag mapping before any Compose up", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  let applicationInspections = 0;
  const originalRun = fixture.docker.run;
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await originalRun(args, maximumBytes, environment);
    if (args[0] === "container" && args[1] === "inspect"
      && String(output).includes("clean-pay-application-config")
      && applicationInspections++ === 0) {
      const [probe] = JSON.parse(output);
      probe.Image = `sha256:${"f".repeat(64)}`;
      return JSON.stringify([probe]);
    }
    return output;
  };
  try {
    await expect(prepareJourneyOwnedStack(fixture.input)).rejects.toThrow(/application probe/);
    expect(fixture.docker.upCalls).toBe(0);
    expect(fixture.docker.activeProbeCount).toBe(0);
  } finally {
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("prepares an exact containerd receipt and pins both launch images to OCI roots", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot, { mode: "containerd" });
  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    expect(handle.contract.images).toEqual({
      application: fixture.input.expectedApplicationAssetImageDigest,
      migration: fixture.input.expectedMigrationAssetImageDigest,
    });
    expect(Object.keys(handle.inputReceipt).sort()).toEqual([
      "applicationImageBindingContractSha256",
      "applicationImageConfigDigest",
      "applicationImageManifestDigest",
      "applicationImageRuntimeDigest",
      "composeSourceSha256",
      "fixtureBindingContractSha256",
      "fixtureMountSubsetContractSha256",
      "fixtureSourceContractSha256",
      "generatedEnvironmentDirectorySha256",
      "globalFixtureContractSha256",
      "imageProbeOwnershipContractSha256",
      "imageSelectionMode",
      "migrationImageBindingContractSha256",
      "migrationImageManifestDigest",
      "migrationImageRuntimeDigest",
      "projectSha256",
      "renderedComposeSha256",
      "roleEnvironmentContractSha256",
      "roleEnvironmentPolicySha256",
    ].sort());
    expect(handle.inputReceipt).toMatchObject({
      applicationImageConfigDigest: fixture.input.expectedApplicationImageConfigDigest,
      applicationImageManifestDigest: fixture.input.expectedApplicationManifestDigest,
      applicationImageRuntimeDigest: fixture.input.expectedApplicationAssetImageDigest,
      imageSelectionMode: "containerd-root-manifest",
      migrationImageRuntimeDigest: fixture.input.expectedMigrationAssetImageDigest,
    });
    expect(Object.hasOwn(handle.inputReceipt, "migrationImageConfigDigest")).toBe(false);
    const launchEnvironment = await readFile(path.join(handle.directory, ".env"), "utf8");
    expect(launchEnvironment).toContain(
      `CLEAN_PAY_IMAGE=${fixture.input.expectedApplicationAssetImageDigest}`,
    );
    expect(launchEnvironment).toContain(
      `CLEAN_PAY_MIGRATION_IMAGE=${fixture.input.expectedMigrationAssetImageDigest}`,
    );
    await expect(prepareJourneyOwnedStackLaunch(handle)).resolves.toMatchObject({
      projectSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
  } finally {
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("rejects mixed Docker image selection modes before creating a launch snapshot", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot, {
    applicationMode: "containerd",
    migrationMode: "classic",
  });
  try {
    await expect(prepareJourneyOwnedStack(fixture.input)).rejects.toThrow(/selection modes/);
    expect(fixture.docker.activeProbeCount).toBe(0);
    expect(fixture.docker.upCalls).toBe(0);
  } finally {
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("rejects incomplete or overlapping containerd identities before Compose up", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const incomplete = await createOwnedInput("baseline", repositoryRoot, { mode: "containerd" });
  const overlapping = await createOwnedInput("baseline", repositoryRoot, {
    migrationManifestDigest: `sha256:${"4".repeat(64)}`,
    mode: "containerd",
  });
  incomplete.input.expectedApplicationRepoDigests = [
    incomplete.input.expectedApplicationAssetImageDigest,
  ];
  try {
    await expect(prepareJourneyOwnedStack(incomplete.input)).rejects.toThrow(
      /omits its selected platform manifest/,
    );
    await expect(prepareJourneyOwnedStack(overlapping.input)).rejects.toThrow(
      /identities overlap/,
    );
    for (const fixture of [incomplete, overlapping]) {
      expect(fixture.docker.upCalls).toBe(0);
      expect(fixture.docker.activeProbeCount).toBe(0);
    }
  } finally {
    await Promise.all([
      removeSyntheticInputDirectory(incomplete.directory),
      removeSyntheticInputDirectory(overlapping.directory),
    ]);
  }
});

test("rejects a containerd-to-classic mode drift during the pre-launch recheck", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot, { mode: "containerd" });
  const baseRun = fixture.docker.run;
  const applicationConfigDigest = fixture.input.expectedApplicationImageConfigDigest;
  let drift = false;
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await baseRun(args, maximumBytes, environment);
    if (drift && args[0] === "container" && args[1] === "inspect") {
      const [probe] = JSON.parse(output);
      if (probe?.Config?.Image === fixture.input.contract.images.application) {
        probe.Image = applicationConfigDigest;
        delete probe.ImageManifestDescriptor;
        return JSON.stringify([probe]);
      }
    }
    return output;
  };
  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    drift = true;
    await expect(prepareJourneyOwnedStackLaunch(handle)).rejects.toThrow();
    expect(fixture.docker.upCalls).toBe(0);
    expect(fixture.docker.activeProbeCount).toBe(0);
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
  } finally {
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("settles both delayed image rechecks before rejecting and cleaning a launch", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  const baseRun = fixture.docker.run;
  let launchRecheck = false;
  let appFailureInjected = false;
  let migrationBlocked = false;
  let resolveApplicationCleanup: () => void = () => undefined;
  let releaseMigration: () => void = () => undefined;
  const applicationCleanup = new Promise<void>((resolve) => {
    resolveApplicationCleanup = resolve;
  });
  const migrationBarrier = new Promise<void>((resolve) => {
    releaseMigration = resolve;
  });
  let resolveMigrationBlocked: () => void = () => undefined;
  const migrationReachedBarrier = new Promise<void>((resolve) => {
    resolveMigrationBlocked = resolve;
  });
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    const output = await baseRun(args, maximumBytes, environment);
    if (!launchRecheck) return output;
    if (args[0] === "container" && args[1] === "inspect") {
      const [probe] = JSON.parse(output);
      if (!appFailureInjected && probe?.Config?.Image === fixture.input.contract.images.application) {
        appFailureInjected = true;
        probe.Image = `sha256:${"f".repeat(64)}`;
        return JSON.stringify([probe]);
      }
      if (!migrationBlocked && probe?.Config?.Image === fixture.input.contract.images.migration) {
        migrationBlocked = true;
        resolveMigrationBlocked();
        await migrationBarrier;
      }
    }
    if (appFailureInjected && args[0] === "container" && args[1] === "rm") {
      resolveApplicationCleanup();
    }
    return output;
  };
  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    launchRecheck = true;
    let launchSettled = false;
    let launchError: unknown;
    const launch = prepareJourneyOwnedStackLaunch(handle).then(
      () => { launchSettled = true; },
      (error) => {
        launchSettled = true;
        launchError = error;
      },
    );
    await Promise.all([applicationCleanup, migrationReachedBarrier]);
    expect(launchSettled).toBe(false);
    expect(fixture.docker.activeProbeCount).toBe(1);
    releaseMigration();
    await launch;
    expect(String((launchError as Error)?.message)).toContain(
      "Both verifier-owned image rechecks must settle before cleanup.",
    );
    expect(fixture.docker.activeProbeCount).toBe(0);
    expect(fixture.docker.upCalls).toBe(0);
    await cleanupJourneyOwnedStack(handle);
    handle = undefined;
  } finally {
    releaseMigration();
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("settles both delayed stack launch rechecks before pair cleanup", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const [baseline, candidate] = await Promise.all([
    createOwnedInput("baseline", repositoryRoot),
    createOwnedInput("candidate", repositoryRoot),
  ]);
  let releaseCandidateMigration: () => void = () => undefined;
  const candidateMigrationBarrier = new Promise<void>((resolve) => {
    releaseCandidateMigration = resolve;
  });
  let resolveCandidateBlocked: () => void = () => undefined;
  const candidateBlocked = new Promise<void>((resolve) => {
    resolveCandidateBlocked = resolve;
  });
  let resolveBaselineCleanup: () => void = () => undefined;
  const baselineCleanup = new Promise<void>((resolve) => {
    resolveBaselineCleanup = resolve;
  });
  let resolveCandidateApplicationCleanup: () => void = () => undefined;
  const candidateApplicationCleanup = new Promise<void>((resolve) => {
    resolveCandidateApplicationCleanup = resolve;
  });

  const wrap = (
    fixture: typeof baseline,
    behavior: "fail-application" | "block-migration",
  ) => {
    const baseRun = fixture.docker.run;
    let applicationCreates = 0;
    let migrationCreates = 0;
    let launchApplicationId: string | undefined;
    let failureInjected = false;
    let migrationBlocked = false;
    return async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      const isCreate = args[0] === "container" && args[1] === "create";
      const name = isCreate ? args[args.indexOf("--name") + 1] : "";
      if (name.includes("-application-")) applicationCreates += 1;
      if (name.includes("-migration-")) migrationCreates += 1;
      const output = await baseRun(args, maximumBytes, environment);
      if (isCreate && name.includes("-application-") && applicationCreates === 2) {
        launchApplicationId = String(output).trim();
      }
      if (args[0] === "container" && args[1] === "inspect") {
        const [probe] = JSON.parse(output);
        if (behavior === "fail-application" && applicationCreates === 2
          && !failureInjected
          && probe?.Config?.Image === fixture.input.contract.images.application) {
          failureInjected = true;
          probe.Image = `sha256:${"f".repeat(64)}`;
          return JSON.stringify([probe]);
        }
        if (behavior === "block-migration" && migrationCreates === 2
          && !migrationBlocked
          && probe?.Config?.Image === fixture.input.contract.images.migration) {
          migrationBlocked = true;
          resolveCandidateBlocked();
          await candidateMigrationBarrier;
        }
      }
      if (behavior === "fail-application"
        && args[0] === "container" && args[1] === "rm"
        && args[2] === launchApplicationId) {
        resolveBaselineCleanup();
      }
      if (behavior === "block-migration"
        && args[0] === "container" && args[1] === "rm"
        && args[2] === launchApplicationId) {
        resolveCandidateApplicationCleanup();
      }
      return output;
    };
  };
  baseline.input.runDocker = wrap(baseline, "fail-application");
  candidate.input.runDocker = wrap(candidate, "block-migration");

  try {
    let callbackCalled = false;
    let pairSettled = false;
    let pairError: unknown;
    const pairOperation = withJourneyOwnedStackPair({
      baseline: baseline.input,
      candidate: candidate.input,
    }, async () => {
      callbackCalled = true;
    }).then(
      () => { pairSettled = true; },
      (error) => {
        pairSettled = true;
        pairError = error;
      },
    );
    await Promise.all([baselineCleanup, candidateApplicationCleanup, candidateBlocked]);
    expect(pairSettled).toBe(false);
    expect(callbackCalled).toBe(false);
    expect(candidate.docker.activeProbeCount).toBe(1);
    releaseCandidateMigration();
    await pairOperation;
    expect(String((pairError as Error)?.message)).toContain(
      "Both verifier-owned pre-launch rechecks must settle before cleanup.",
    );
    expect(baseline.docker.activeProbeCount).toBe(0);
    expect(candidate.docker.activeProbeCount).toBe(0);
    expect(baseline.docker.upCalls + candidate.docker.upCalls).toBe(0);
  } finally {
    releaseCandidateMigration();
    await Promise.all([
      removeSyntheticInputDirectory(baseline.directory),
      removeSyntheticInputDirectory(candidate.directory),
    ]);
  }
});

test("waits for two empty post-down observations and keeps Compose progress quiet", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  const project = fixture.input.contract.project;
  const projectFilter = `label=com.docker.compose.project=${project}`;
  const resourceId = "e".repeat(64);
  const baseRun = fixture.docker.run;
  let resourceVisible = false;
  let downIssued = false;
  let postDownPsObservations = 0;
  let downArgs: string[] | undefined;
  const cleanupQueryTimeouts: number[] = [];
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
    commandOptions?: { timeoutMs?: number },
  ) => {
    const projectQuery = args.includes(projectFilter);
    if (args[0] === "compose" && args.includes("down")) {
      downArgs = [...args];
      downIssued = true;
      return "";
    }
    if (args[0] === "ps" && projectQuery && resourceVisible) {
      if (!downIssued) return resourceId;
      postDownPsObservations += 1;
      if (commandOptions?.timeoutMs !== undefined) {
        cleanupQueryTimeouts.push(commandOptions.timeoutMs);
      }
      return postDownPsObservations === 1 ? resourceId : "";
    }
    if (args[0] === "container" && args[1] === "inspect" && args[2] === resourceId) {
      return JSON.stringify([{
        Id: resourceId,
        Name: `/${project}-app-1`,
        Config: {
          Labels: {
            "com.docker.compose.project": project,
            "com.docker.compose.service": "app",
          },
        },
      }]);
    }
    return baseRun(args, maximumBytes, environment);
  };

  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    const plan = await prepareJourneyOwnedStackLaunch(handle);
    expect(plan.args.slice(0, 3)).toEqual(["compose", "--progress", "quiet"]);
    resourceVisible = true;
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
    expect(downArgs?.slice(0, 3)).toEqual(["compose", "--progress", "quiet"]);
    expect(downArgs?.slice(-4)).toEqual([
      "down", "--volumes", "--timeout",
      String(JOURNEY_DOCKER_TIMEOUT_CONTRACT.composeStopSeconds),
    ]);
    expect(postDownPsObservations).toBe(3);
    expect(cleanupQueryTimeouts).toHaveLength(3);
    expect(cleanupQueryTimeouts.every((timeout) => timeout > 0 && timeout <= 2_000)).toBe(true);
  } finally {
    resourceVisible = false;
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("preserves Compose launch and cleanup failures in rejection order", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const [baseline, candidate] = await Promise.all([
    createOwnedInput("baseline", repositoryRoot),
    createOwnedInput("candidate", repositoryRoot),
  ]);
  const primaryError = new Error("synthetic Compose launch failure");
  const cleanupError = new Error("synthetic cleanup query failure");
  const snapshotDirectories = new Set<string>();
  let rejectBaselineCleanup = false;
  let baselineCleanupQueryAttempts = 0;
  const wrap = (fixture: typeof baseline, rejectLaunch: boolean) => {
    const baseRun = fixture.docker.run;
    return async (
      args: string[],
      maximumBytes?: number,
      environment: Record<string, string> = {},
    ) => {
      if (args[0] === "compose" && args.includes("config")) {
        const envFile = args[args.indexOf("--env-file") + 1];
        const directory = path.dirname(envFile);
        if (path.basename(directory).startsWith("clean-pay-provider-")) {
          snapshotDirectories.add(directory);
        }
      }
      if (rejectLaunch && args[0] === "compose" && args.includes("up")) {
        rejectBaselineCleanup = true;
        throw primaryError;
      }
      if (rejectLaunch && rejectBaselineCleanup && args[0] === "ps"
        && args.includes(`label=com.docker.compose.project=${fixture.input.contract.project}`)) {
        baselineCleanupQueryAttempts += 1;
        throw cleanupError;
      }
      return baseRun(args, maximumBytes, environment);
    };
  };
  baseline.input.runDocker = wrap(baseline, true);
  candidate.input.runDocker = wrap(candidate, false);

  try {
    let captured: unknown;
    const operation = withJourneyOwnedStackPair({
      baseline: baseline.input,
      candidate: candidate.input,
    }, async () => undefined).catch((error) => {
      captured = error;
    });
    await expect.poll(() => candidate.docker.upCalls).toBe(1);
    candidate.docker.releaseUp();
    await operation;
    expect(captured).toBeInstanceOf(AggregateError);
    expect((captured as AggregateError).message).toBe(
      "Verifier-owned dual-stack operation failed and exact cleanup was not proven.",
    );
    const [primary, cleanup] = (captured as AggregateError).errors;
    expect(primary).toBeInstanceOf(AggregateError);
    expect((primary as AggregateError).message).toBe(
      "Both verifier-owned stacks must start from one completed launch barrier.",
    );
    expect((primary as AggregateError).errors).toEqual([primaryError]);
    expect(cleanup).toBe(cleanupError);
    expect(baselineCleanupQueryAttempts).toBe(1);
  } finally {
    rejectBaselineCleanup = false;
    for (const directory of snapshotDirectories) {
      await removeOwnedSnapshotDirectory(directory);
    }
    await Promise.all([
      removeSyntheticInputDirectory(baseline.directory),
      removeSyntheticInputDirectory(candidate.directory),
    ]);
  }
});

test("keeps a rejected Compose down fail-closed even after resources disappear", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  const project = fixture.input.contract.project;
  const projectFilter = `label=com.docker.compose.project=${project}`;
  const resourceId = "f".repeat(64);
  const downError = new Error("synthetic rejected down");
  const baseRun = fixture.docker.run;
  let resourceVisible = false;
  let rejectDown = true;
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    if (args[0] === "compose" && args.includes("down")) {
      resourceVisible = false;
      if (rejectDown) throw downError;
      return "";
    }
    if (args[0] === "ps" && args.includes(projectFilter) && resourceVisible) {
      return resourceId;
    }
    if (args[0] === "container" && args[1] === "inspect" && args[2] === resourceId) {
      return JSON.stringify([{
        Id: resourceId,
        Name: `/${project}-app-1`,
        Config: {
          Labels: {
            "com.docker.compose.project": project,
            "com.docker.compose.service": "app",
          },
        },
      }]);
    }
    return baseRun(args, maximumBytes, environment);
  };

  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    resourceVisible = true;
    let captured: unknown;
    await cleanupJourneyOwnedStack(handle).catch((error) => { captured = error; });
    expect(captured).toBe(downError);
    rejectDown = false;
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
  } finally {
    resourceVisible = false;
    rejectDown = false;
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("does not retry a rejected post-down Docker query", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  const project = fixture.input.contract.project;
  const projectFilter = `label=com.docker.compose.project=${project}`;
  const resourceId = "1".repeat(64);
  const queryError = new Error("synthetic post-down query failure");
  const baseRun = fixture.docker.run;
  let afterDown = false;
  let rejectQuery = true;
  let resourceVisible = false;
  let queryAttempts = 0;
  let observedQueryTimeout: number | undefined;
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
    commandOptions?: { timeoutMs?: number },
  ) => {
    if (args[0] === "compose" && args.includes("down")) {
      afterDown = true;
      return "";
    }
    if (args[0] === "ps" && args.includes(projectFilter) && resourceVisible) {
      if (!afterDown) return resourceId;
      queryAttempts += 1;
      observedQueryTimeout = commandOptions?.timeoutMs;
      if (rejectQuery) throw queryError;
      return "";
    }
    if (args[0] === "container" && args[1] === "inspect" && args[2] === resourceId) {
      return JSON.stringify([{
        Id: resourceId,
        Name: `/${project}-app-1`,
        Config: {
          Labels: {
            "com.docker.compose.project": project,
            "com.docker.compose.service": "app",
          },
        },
      }]);
    }
    return baseRun(args, maximumBytes, environment);
  };

  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    resourceVisible = true;
    let captured: unknown;
    await cleanupJourneyOwnedStack(handle).catch((error) => { captured = error; });
    expect(captured).toBe(queryError);
    expect(queryAttempts).toBe(1);
    expect(observedQueryTimeout).toBeGreaterThan(0);
    expect(observedQueryTimeout).toBeLessThanOrEqual(2_000);
    afterDown = false;
    rejectQuery = false;
    resourceVisible = false;
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
  } finally {
    afterDown = false;
    rejectQuery = false;
    resourceVisible = false;
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("enforces the monotonic post-down deadline and leaves cleanup retryable", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  const project = fixture.input.contract.project;
  const projectFilter = `label=com.docker.compose.project=${project}`;
  const resourceId = "2".repeat(64);
  const baseRun = fixture.docker.run;
  const originalNow = performance.now.bind(performance);
  const originalOwnNow = Object.getOwnPropertyDescriptor(performance, "now");
  let afterDown = false;
  let clockCalls = 0;
  let resourceVisible = false;
  let restored = false;
  let postDownQueries = 0;
  let observedQueryTimeout: number | undefined;
  const restoreClock = () => {
    if (restored) return;
    restored = true;
    if (originalOwnNow === undefined) Reflect.deleteProperty(performance, "now");
    else Object.defineProperty(performance, "now", originalOwnNow);
  };
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => {
      if (!afterDown) return originalNow();
      clockCalls += 1;
      if (clockCalls === 1) return 0;
      if (clockCalls === 2) return 1;
      return 20_000;
    },
  });
  fixture.input.runDocker = async (
    args: string[],
    maximumBytes?: number,
    environment: Record<string, string> = {},
    commandOptions?: { timeoutMs?: number },
  ) => {
    if (args[0] === "compose" && args.includes("down")) {
      afterDown = true;
      return "";
    }
    if (args[0] === "ps" && args.includes(projectFilter) && resourceVisible) {
      if (!afterDown) return resourceId;
      postDownQueries += 1;
      observedQueryTimeout = commandOptions?.timeoutMs;
      return resourceId;
    }
    if (args[0] === "container" && args[1] === "inspect" && args[2] === resourceId) {
      return JSON.stringify([{
        Id: resourceId,
        Name: `/${project}-app-1`,
        Config: {
          Labels: {
            "com.docker.compose.project": project,
            "com.docker.compose.service": "app",
          },
        },
      }]);
    }
    return baseRun(args, maximumBytes, environment);
  };

  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    resourceVisible = true;
    let captured: unknown;
    await cleanupJourneyOwnedStack(handle).catch((error) => { captured = error; });
    expect(String((captured as Error)?.message)).toContain(
      "project is not absent before creation or after cleanup",
    );
    expect(postDownQueries).toBe(1);
    expect(observedQueryTimeout).toBe(2_000);
    afterDown = false;
    resourceVisible = false;
    restoreClock();
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
  } finally {
    afterDown = false;
    resourceVisible = false;
    restoreClock();
    if (handle !== undefined) {
      await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    }
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("prepares both immutable stacks before same-turn launch dispatch and cleans exact snapshots", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixtures = await Promise.all([
    createOwnedInput("baseline", repositoryRoot),
    createOwnedInput("candidate", repositoryRoot),
  ]);
  const handles = [];
  try {
    for (const fixture of fixtures) {
      handles.push(await prepareJourneyOwnedStack(fixture.input));
      expect(fixture.docker.composeEnvironments.length).toBeGreaterThanOrEqual(2);
      for (const environment of fixture.docker.composeEnvironments) {
        expect(environment.COMPOSE_PROJECT_NAME).toBeUndefined();
        expect(environment.TURNSTILE_SITE_KEY).toBeUndefined();
      }
      expect(handles.at(-1)?.inputReceipt.migrationImageBindingContractSha256)
        .toMatch(/^[a-f0-9]{64}$/);
      expect(Object.keys(handles.at(-1)!.inputReceipt)).toEqual([
        "applicationImageConfigDigest",
        "composeSourceSha256",
        "applicationImageBindingContractSha256",
        "fixtureBindingContractSha256",
        "fixtureMountSubsetContractSha256",
        "fixtureSourceContractSha256",
        "generatedEnvironmentDirectorySha256",
        "globalFixtureContractSha256",
        "migrationImageBindingContractSha256",
        "migrationImageConfigDigest",
        "imageProbeOwnershipContractSha256",
        "projectSha256",
        "roleEnvironmentContractSha256",
        "roleEnvironmentPolicySha256",
        "renderedComposeSha256",
      ]);
      expect(handles.at(-1)?.contract.images).toEqual({
        application: fixture.input.expectedApplicationImageConfigDigest,
        migration: handles.at(-1)?.expectedMigrationRuntimeImageDigest,
      });
      const preparedHandle = handles.at(-1);
      expect(preparedHandle).toBeDefined();
      const launchEnvironment = await readFile(path.join(preparedHandle!.directory, ".env"), "utf8");
      expect(launchEnvironment).toContain(
        `CLEAN_PAY_IMAGE=${fixture.input.expectedApplicationImageConfigDigest}`,
      );
      expect(launchEnvironment).not.toContain(`CLEAN_PAY_IMAGE=${fixture.input.contract.images.application}`);
    }
    const plans = await Promise.all(handles.map(prepareJourneyOwnedStackLaunch));
    const dispatchPromise = dispatchJourneyOwnedStackPair(handles, plans);
    expect(fixtures.map(({ docker }) => docker.upCalls)).toEqual([1, 1]);
    fixtures.forEach(({ docker }) => docker.releaseUp());
    await expect(dispatchPromise).resolves.toMatchObject({
      status: "dual-compose-up-dispatched-after-shared-barrier",
      dispatches: [{ ordinal: 0 }, { ordinal: 1 }],
    });

    const swapped = path.join(handles[0].directory, ".env");
    const retained = `${swapped}.retained`;
    await rename(swapped, retained);
    await writeFile(swapped, "substituted\n", { flag: "wx" });
    await expect(cleanupJourneyOwnedStack(handles[0])).rejects.toThrow(/identity|cleanup/);
    await unlink(swapped);
    await rename(retained, swapped);
    await expect(cleanupJourneyOwnedStack(handles[0])).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    await expect(cleanupJourneyOwnedStack(handles[1])).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
  } finally {
    await Promise.all(fixtures.map(({ directory }) => removeSyntheticInputDirectory(directory)));
  }
});

test("stops a ready peer when the second event listener fails before any Compose dispatch", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const [baseline, candidate] = await Promise.all([
    createOwnedInput("baseline", repositoryRoot),
    createOwnedInput("candidate", repositoryRoot),
  ]);
  const listenerFailure = new Error("synthetic candidate listener failure");
  candidate.input.startDockerEventCapture = () => { throw listenerFailure; };
  try {
    await expect(withJourneyOwnedStackPair({
      baseline: baseline.input,
      candidate: candidate.input,
    }, async () => undefined)).rejects.toThrow(
      /Both verifier-owned pre-launch rechecks must settle before cleanup/,
    );
    expect(baseline.docker.upCalls + candidate.docker.upCalls).toBe(0);
    expect(baseline.docker.activeEventCaptureCount).toBe(0);
    expect(candidate.docker.activeEventCaptureCount).toBe(0);
    expect(baseline.docker.activeBarrierCount + candidate.docker.activeBarrierCount).toBe(0);
  } finally {
    await Promise.all([
      removeSyntheticInputDirectory(baseline.directory),
      removeSyntheticInputDirectory(candidate.directory),
    ]);
  }
});

test("dispatches the peer synchronously and settles both captures after a synchronous launch throw", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixtures = await Promise.all([
    createOwnedInput("baseline", repositoryRoot),
    createOwnedInput("candidate", repositoryRoot),
  ]);
  const primaryError = new Error("synthetic synchronous Compose launch failure");
  const baselineRun = fixtures[0].docker.run;
  let synchronousLaunchCalls = 0;
  fixtures[0].input.runDocker = (args, maximumBytes, environment) => {
    if (args[0] === "compose" && args.includes("up")) {
      synchronousLaunchCalls += 1;
      throw primaryError;
    }
    return baselineRun(args, maximumBytes, environment);
  };
  const handles = [];
  try {
    handles.push(...await Promise.all(fixtures.map(({ input }) => prepareJourneyOwnedStack(input))));
    const plans = await Promise.all(handles.map(prepareJourneyOwnedStackLaunch));
    const dispatch = dispatchJourneyOwnedStackPair(handles, plans);
    expect(synchronousLaunchCalls).toBe(1);
    expect(fixtures[1].docker.upCalls).toBe(1);
    fixtures[1].docker.releaseUp();
    let captured: unknown;
    await dispatch.catch((error) => { captured = error; });
    expect(captured).toBeInstanceOf(AggregateError);
    expect((captured as AggregateError).errors).toEqual([primaryError]);
    expect(fixtures.map(({ docker }) => docker.activeEventCaptureCount)).toEqual([0, 0]);
    await Promise.all(handles.map(cleanupJourneyOwnedStack));
    handles.length = 0;
  } finally {
    await Promise.all(handles.map((handle) => cleanupJourneyOwnedStack(handle).catch(() => undefined)));
    await Promise.all(fixtures.map(({ directory }) => removeSyntheticInputDirectory(directory)));
  }
});

test("proves an event barrier absent when remove side-effects before rejecting", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot);
  const baseRun = fixture.docker.run;
  const removalFailure = new Error("synthetic barrier remove response failure");
  let barrierId: string | undefined;
  let failureInjected = false;
  fixture.input.runDocker = async (args, maximumBytes, environment) => {
    if (args[0] === "container" && args[1] === "create"
      && args.some((entry) => entry.startsWith("io.clean-pay.event-barrier="))) {
      const output = await baseRun(args, maximumBytes, environment);
      barrierId = output;
      return output;
    }
    if (!failureInjected && args[0] === "container" && args[1] === "rm"
      && args[2] === barrierId) {
      failureInjected = true;
      await baseRun(args, maximumBytes, environment);
      throw removalFailure;
    }
    return baseRun(args, maximumBytes, environment);
  };
  let handle: Awaited<ReturnType<typeof prepareJourneyOwnedStack>> | undefined;
  try {
    handle = await prepareJourneyOwnedStack(fixture.input);
    await expect(prepareJourneyOwnedStackLaunch(handle)).rejects.toBe(removalFailure);
    expect(fixture.docker.activeBarrierCount).toBe(0);
    expect(fixture.docker.activeEventCaptureCount).toBe(0);
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    handle = undefined;
  } finally {
    if (handle !== undefined) await cleanupJourneyOwnedStack(handle).catch(() => undefined);
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("keeps snapshot cleanup retryable until event-capture termination is proven", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const fixture = await createOwnedInput("baseline", repositoryRoot, {
    eventCaptureUnprovenStopAttempts: 1,
  });
  const handle = await prepareJourneyOwnedStack(fixture.input);
  try {
    await prepareJourneyOwnedStackLaunch(handle);
    await expect(cleanupJourneyOwnedStack(handle)).rejects.toThrow(/termination unproven/);
    expect(fixture.docker.activeEventCaptureCount).toBe(1);
    expect(fixture.docker.eventCaptureStopAttempts).toBe(1);
    await expect(lstat(handle.directory)).resolves.toBeDefined();
    await expect(cleanupJourneyOwnedStack(handle)).resolves.toMatchObject({
      status: "verifier-owned-stack-cleaned",
    });
    expect(fixture.docker.activeEventCaptureCount).toBe(0);
    expect(fixture.docker.eventCaptureStopAttempts).toBe(2);
    await expect(lstat(handle.directory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await removeSyntheticInputDirectory(fixture.directory);
  }
});

test("kills a timed-out Docker child but settles only after stdio close", async () => {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.exitCode = null;
  child.pid = 424242;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const killSignals: NodeJS.Signals[] = [];
  child.kill = (signal = "SIGTERM") => {
    killSignals.push(signal);
    return true;
  };
  const outcome = runJourneyDockerCommand(
    ["info"],
    128,
    {},
    {
      repositoryRoot: path.resolve(__dirname, "../../.."),
      spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
      terminationGraceMs: 5,
      timeoutMs: 5,
    },
  ).then(() => "fulfilled", () => "rejected");
  await expect.poll(() => killSignals, { timeout: 500 }).toEqual(["SIGTERM", "SIGKILL"]);
  child.emit("exit", null, "SIGTERM");
  await expect(Promise.race([
    outcome,
    new Promise((resolve) => setTimeout(() => resolve("pending"), 10)),
  ])).resolves.toBe("pending");
  child.signalCode = "SIGTERM";
  child.stdout.end();
  child.stderr.end();
  child.emit("close", null, "SIGTERM");
  await expect(outcome).resolves.toBe("rejected");
});

test("projects Docker launch stderr to bounded synthetic-service evidence", async () => {
  const stderrText = "dependency failed to start: container private-project-app-1 is unhealthy";
  const failure = await failedDockerOperation(
    ["compose", "--project-name", "private-project", "up", "--detach", "--wait"],
    stderrText,
  );

  expect(collectJourneyDockerFailureEvidence(failure)).toEqual([{
    schemaVersion: 1,
    status: "journey_docker_operation_failed",
    operation: "compose-up",
    terminationReason: "exit",
    exitCode: 1,
    signal: null,
    stdoutBytes: 0,
    stderrBytes: Buffer.byteLength(stderrText),
    stdoutSha256: createHash("sha256").update("").digest("hex"),
    stderrSha256: createHash("sha256").update(stderrText).digest("hex"),
    classifications: ["container-unhealthy", "dependency-failed"],
    services: ["app"],
  }]);
  expect(JSON.stringify(collectJourneyDockerFailureEvidence(failure)))
    .not.toContain("private-project");
});

test("keeps Docker failure projection total, bounded and fixed-vocabulary", async () => {
  const mutableArgs = ["deploy", "bearer-secret"];
  const unknownFailure = await failedDockerOperation(
    mutableArgs,
    "opaque failure",
    () => { mutableArgs[1] = "second-secret"; },
    999,
    "BEARERSECRET" as NodeJS.Signals,
  );
  const unknownEvidence = collectJourneyDockerFailureEvidence(unknownFailure);
  expect(unknownEvidence).toMatchObject([{
    exitCode: null,
    operation: "docker-other",
    signal: null,
  }]);
  expect(JSON.stringify(unknownEvidence)).not.toMatch(/bearer-secret|second-secret/i);

  const overlappingFailure = await failedDockerOperation(
    ["compose", "up"],
    'service "browser-db-observer-provision" didn\'t complete successfully: exit 23\n',
  );
  expect(collectJourneyDockerFailureEvidence(overlappingFailure)).toMatchObject([{
    classifications: ["container-exited"],
    services: ["browser-db-observer-provision"],
  }]);

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  expect(collectJourneyDockerFailureEvidence(revoked.proxy)).toEqual([]);
  let deep: object = {};
  for (let depth = 0; depth < 20_000; depth += 1) deep = { cause: deep };
  expect(collectJourneyDockerFailureEvidence(deep)).toEqual([]);
});

test("keeps observer provisioning failures fixed-code and output-silent", async () => {
  const source = await readFile(
    path.resolve(__dirname, "db-observer-provision.sh"),
    "utf8",
  );
  expect(source).toContain("--command='SELECT 1'");
  expect(source).toContain("unset PGOPTIONS");
  expect(source).toContain(">/dev/null 2>&1 || base_status=$?");
  expect(source).toContain("<<SQL || provision_status=$?");
  expect(source).toContain(">/dev/null 2>&1 <<SQL");
  expect(source).toContain("statement_timeout=15000 -c lock_timeout=5000");
  for (const code of [20, 21, 22, 23, 24]) expect(source).toContain(`exit ${code}`);
  expect(source).not.toMatch(/\b(?:cat|tee)\b|set\s+-x/);
});

test("rejects a killed Docker child without close only after OS absence is proven", async () => {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.exitCode = null;
  child.pid = 434343;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const killSignals: NodeJS.Signals[] = [];
  child.kill = (signal = "SIGTERM") => {
    killSignals.push(signal);
    return true;
  };
  let livenessChecks = 0;
  const outcome = runJourneyDockerCommand(
    ["info"],
    128,
    {},
    {
      killCloseTimeoutMs: 5,
      repositoryRoot: path.resolve(__dirname, "../../.."),
      spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
      terminationGraceMs: 5,
      timeoutMs: 5,
      verifyProcessTerminated: async (pid: number | undefined) => {
        expect(pid).toBe(child.pid);
        livenessChecks += 1;
        return livenessChecks >= 2;
      },
    },
  );
  await expect(outcome).rejects.toThrow(/os-terminated-without-close/);
  expect(killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  expect(livenessChecks).toBe(2);
});

test("waits for CONNECT proxy close after a partial-readiness protocol failure", async () => {
  const child = fakeProxyChild(12);
  let settled = false;
  const outcome = startJourneyConnectProxy({
    environment: process.env,
    lifecycleBounds: shortProxyLifecycleBounds(),
    listenHost: "127.0.0.1",
    listenPort: "14444",
    repositoryRoot: path.resolve(__dirname, "../../.."),
    spawnProcess: () => child,
    targetHost: "127.0.0.2",
    targetPort: "443",
  }).then(
    () => "fulfilled",
    () => "rejected",
  ).finally(() => { settled = true; });
  child.stdout.write('{"status":"unexpected"}\n');
  await new Promise((resolve) => setTimeout(resolve, 3));
  expect(child.killSignals[0]).toBe("SIGTERM");
  expect(settled).toBe(false);
  expect(await outcome).toBe("rejected");
  expect(child.closed).toBe(true);
});

test("waits for CONNECT proxy close after a bounded stop timeout", async () => {
  const child = fakeProxyChild(20);
  const handlePromise = startJourneyConnectProxy({
    environment: process.env,
    lifecycleBounds: shortProxyLifecycleBounds(),
    listenHost: "127.0.0.1",
    listenPort: "14445",
    repositoryRoot: path.resolve(__dirname, "../../.."),
    spawnProcess: () => child,
    targetHost: "127.0.0.3",
    targetPort: "443",
  });
  child.stdout.write(`${JSON.stringify({
    allowedHostCount: JOURNEY_SYNTHETIC_HOSTNAMES.length,
    limits: {
      establishedIdleTimeoutMs: 1,
      maxClientConnections: 1,
      maxHeaderBytes: 1,
      prefaceTimeoutMs: 1,
      upstreamConnectTimeoutMs: 1,
    },
    listen: "127.0.0.1:14445",
    status: "ready",
    target: "127.0.0.3:443",
  })}\n`);
  const handle = await handlePromise;
  let settled = false;
  const outcome = stopJourneyConnectProxy(handle).then(
    () => "fulfilled",
    () => "rejected",
  ).finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 9));
  expect(child.killSignals[0]).toBe("SIGTERM");
  expect(settled).toBe(false);
  expect(await outcome).toBe("rejected");
  expect(child.closed).toBe(true);
});

test("settles a CONNECT termination without close only after exact PID absence", async () => {
  const child = fakeProxyChild(null);
  let checks = 0;
  const outcome = startJourneyConnectProxy({
    environment: process.env,
    lifecycleBounds: { ...shortProxyLifecycleBounds(), killCloseTimeoutMs: 5 },
    listenHost: "127.0.0.1",
    listenPort: "14446",
    repositoryRoot: path.resolve(__dirname, "../../.."),
    spawnProcess: () => child,
    targetHost: "127.0.0.4",
    targetPort: "443",
    verifyProcessTerminated: async (pid: number | undefined) => {
      expect(pid).toBe(child.pid);
      checks += 1;
      return checks >= 2;
    },
  }).then(() => "fulfilled", () => "rejected");
  child.stdout.write('{"status":"unexpected"}\n');
  await expect(outcome).resolves.toBe("rejected");
  expect(checks).toBe(2);
  expect(child.closed).toBe(false);
  expect(child.killSignals).toContain("SIGKILL");
});

test("keeps CONNECT cleanup fail-stop while an exact child PID may still be live", async () => {
  const child = fakeProxyChild(null);
  let absent = false;
  let checks = 0;
  const outcome = startJourneyConnectProxy({
    environment: process.env,
    lifecycleBounds: { ...shortProxyLifecycleBounds(), killCloseTimeoutMs: 5 },
    listenHost: "127.0.0.1",
    listenPort: "14447",
    repositoryRoot: path.resolve(__dirname, "../../.."),
    spawnProcess: () => child,
    targetHost: "127.0.0.5",
    targetPort: "443",
    verifyProcessTerminated: async () => {
      checks += 1;
      return absent;
    },
  }).then(() => "fulfilled", () => "rejected");
  child.stdout.write('{"status":"unexpected"}\n');
  await expect(Promise.race([
    outcome,
    new Promise((resolve) => setTimeout(() => resolve("pending"), 25)),
  ])).resolves.toBe("pending");
  expect(checks).toBeGreaterThan(0);
  expect(child.closed).toBe(false);
  absent = true;
  await expect(outcome).resolves.toBe("rejected");
});

async function failedDockerOperation(
  args: string[],
  stderrText: string,
  beforeClose: () => void = () => undefined,
  code = 1,
  signal: NodeJS.Signals | null = null,
) {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    pid: number;
    signalCode: NodeJS.Signals | null;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (requestedSignal?: NodeJS.Signals) => boolean;
  };
  child.exitCode = null;
  child.pid = 454545;
  child.signalCode = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  const outcome = runJourneyDockerCommand(args, 1_024, {}, {
    repositoryRoot: path.resolve(__dirname, "../../.."),
    spawnProcess: (() => child) as unknown as typeof import("node:child_process").spawn,
    timeoutMs: 1_000,
  });
  beforeClose();
  child.stdout.end();
  child.stderr.end(stderrText);
  child.emit("close", code, signal);
  return outcome.catch((error) => error);
}

function shortProxyLifecycleBounds() {
  return {
    killCloseTimeoutMs: 40,
    readinessTimeoutMs: 40,
    shutdownTimeoutMs: 5,
    terminationGraceMs: 5,
  };
}

function fakeProxyChild(closeDelayMs: number | null) {
  const child = new EventEmitter() as EventEmitter & {
    closed: boolean;
    exitCode: number | null;
    killSignals: NodeJS.Signals[];
    pid: number;
    signalCode: NodeJS.Signals | null;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.closed = false;
  child.exitCode = null;
  child.killSignals = [];
  child.pid = 454545;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal = "SIGTERM") => {
    child.killSignals.push(signal);
    if (child.killSignals.length === 1 && closeDelayMs !== null) {
      setTimeout(() => {
        child.closed = true;
        child.signalCode = signal;
        child.stdout.end();
        child.stderr.end();
        child.emit("close", null, signal);
      }, closeDelayMs);
    }
    return true;
  };
  return child;
}

async function createOwnedInput(
  role: "baseline" | "candidate",
  repositoryRoot: string,
  dockerOptions: Parameters<typeof createOwnedDockerMock>[3] = {},
) {
  const contract = ownedContract(role);
  contract.fixtureContract.sha256 = await currentJourneyFixtureContractSha256Async();
  const directory = await mkdtemp(path.join(tmpdir(), `clean-pay-owned-input-${role}-`));
  const turnstileSiteKey = `custom-turnstile-${role}-${"x".repeat(24)}`;
  const generated = buildJourneySyntheticEnvironment({
    appImage: contract.images.application,
    appPort: contract.publications.app.split(":")[1],
    connectProxyPort: contract.publications.connectProxy.split(":")[1],
    directory,
    migrationImage: contract.images.migration,
    project: contract.project,
    providerPort: contract.publications.providerControl.split(":")[1],
    proxyBind: contract.publications.browserTls.split(":")[0],
    revision: contract.revision,
    turnstileSiteKey,
  });
  contract.publicBuildContract.sha256 = generated.publicBuildContractSha256;
  for (const filename of JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES) {
    await writeFile(
      path.join(directory, filename),
      (generated.files as Record<string, string>)[filename],
      { flag: "wx" },
    );
  }
  const contractPath = path.join(directory, "browser-journey-contract.json");
  await writeFile(contractPath, `${JSON.stringify(contract)}\n`, { flag: "wx" });
  const assetDigest = `sha256:${(role === "baseline" ? "2" : "6").repeat(64)}`;
  const configDigest = `sha256:${(role === "baseline" ? "3" : "7").repeat(64)}`;
  const docker = createOwnedDockerMock(contract, assetDigest, configDigest, dockerOptions);
  const applicationManifestDigest = dockerOptions.applicationManifestDigest
    ?? `sha256:${(role === "baseline" ? "b" : "d").repeat(64)}`;
  const applicationUsesContainerd = (dockerOptions.applicationMode ?? dockerOptions.mode)
    === "containerd";
  return {
    directory,
    docker,
    input: {
      repositoryRoot,
      contractPath,
      contract,
      expectedApplicationAssetImageDigest:
        `sha256:${(role === "baseline" ? "a" : "c").repeat(64)}`,
      expectedApplicationImageConfigDigest:
        `sha256:${(role === "baseline" ? "4" : "8").repeat(64)}`,
      ...(applicationUsesContainerd
        ? { expectedApplicationManifestDigest: applicationManifestDigest }
        : {}),
      expectedApplicationRepoDigests: [
        `sha256:${(role === "baseline" ? "a" : "c").repeat(64)}`,
        `sha256:${(role === "baseline" ? "b" : "d").repeat(64)}`,
      ],
      ...(dockerOptions.imagePlatformArchitecture === undefined ? {} : {
        expectedImagePlatform: {
          architecture: dockerOptions.imagePlatformArchitecture,
          os: "linux",
        },
      }),
      expectedMigrationAssetImageDigest: assetDigest,
      runDocker: docker.run,
      startDockerEventCapture: docker.startEventCapture,
    },
  };
}

function ownedContract(role: "baseline" | "candidate") {
  const baseline = role === "baseline";
  return {
    project: `clean-pay-browser-journey-provider-proof-${role}-${(baseline ? "a" : "b").repeat(12)}`,
    revision: (baseline ? "1" : "2").repeat(40),
    images: {
      application: `clean-pay-app:${role}`,
      migration: `clean-pay-migration:${role}`,
    },
    fixtureContract: {
      domain: "clean-pay-browser-journey-fixture-v5",
      sha256: "",
    },
    publicBuildContract: { version: "1", sha256: "" },
    publications: {
      app: baseline ? "127.0.0.1:4100" : "127.0.0.1:4200",
      browserTls: baseline ? "127.0.0.2:443" : "127.0.0.3:443",
      connectProxy: baseline ? "127.0.0.1:14444" : "127.0.0.1:14544",
      providerControl: baseline ? "127.0.0.1:13100" : "127.0.0.1:13200",
    },
  };
}

function createOwnedDockerMock(
  contract: ReturnType<typeof ownedContract>,
  asset: string,
  config: string,
  options: {
    applicationMode?: "classic" | "containerd";
    applicationManifestAnnotations?: Record<string, string>;
    applicationManifestDigest?: string;
    applicationManifestMediaType?: string;
    applicationRootAnnotations?: Record<string, string>;
    applicationRootMediaType?: string;
    eventCaptureUnprovenStopAttempts?: number;
    imagePlatformArchitecture?: "amd64" | "arm64";
    migrationMode?: "classic" | "containerd";
    migrationManifestAnnotations?: Record<string, string>;
    migrationManifestDigest?: string;
    migrationManifestMediaType?: string;
    migrationRootAnnotations?: Record<string, string>;
    migrationRootMediaType?: string;
    mode?: "classic" | "containerd";
  } = {},
) {
  const calls: string[][] = [];
  const composeEnvironments: Array<Record<string, string>> = [];
  const baseline = contract.project.includes("baseline");
  const mode = options.mode ?? "classic";
  const identities = {
    application: {
      asset: `sha256:${(baseline ? "a" : "c").repeat(64)}`,
      config: `sha256:${(baseline ? "4" : "8").repeat(64)}`,
      manifest: options.applicationManifestDigest
        ?? `sha256:${(baseline ? "b" : "d").repeat(64)}`,
      reference: contract.images.application,
    },
    migration: {
      asset,
      config,
      manifest: options.migrationManifestDigest
        ?? `sha256:${(baseline ? "5" : "9").repeat(64)}`,
      reference: contract.images.migration,
    },
  } as const;
  const selectionModes = {
    application: options.applicationMode ?? mode,
    migration: options.migrationMode ?? mode,
  } as const;
  const active = new Map<string, {
    name: string;
    owner: string;
    role: keyof typeof identities;
  }>();
  const barriers = new Map<string, {
    image: string;
    name: string;
    nonce: string;
    project: string;
  }>();
  let activeEventCapture: ReturnType<typeof startEventCapture> | undefined;
  let eventOrdinal = 0n;
  let eventCaptureStopAttempts = 0;
  let upCalls = 0;
  let probeOrdinal = 0;
  let releaseUp: () => void = () => undefined;
  const upBarrier = new Promise<void>((resolve) => { releaseUp = resolve; });
  const run = async (
    args: string[],
    _maximumBytes?: number,
    environment: Record<string, string> = {},
  ) => {
    calls.push([...args]);
    if (args[0] === "compose" && args.includes("config")) {
      composeEnvironments.push(environment);
      const envFile = args[args.indexOf("--env-file") + 1];
      const assignments = Object.fromEntries((await readFile(envFile, "utf8"))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator), line.slice(separator + 1)];
        }));
      return JSON.stringify(composeModel(contract, {
        application: assignments.CLEAN_PAY_IMAGE,
        migration: assignments.CLEAN_PAY_MIGRATION_IMAGE,
      }));
    }
    if (args[0] === "compose" && args.includes("up")) {
      upCalls += 1;
      await upBarrier;
      return "";
    }
    if (args[0] === "image" && args[1] === "inspect") {
      const matched = Object.entries(identities).find(([role, entry]) => (
        args[2] === entry.reference
          || args[2] === (selectionModes[role as keyof typeof selectionModes] === "containerd"
            ? entry.asset
            : entry.config)
      ));
      if (!matched) throw new Error(`Unexpected image inspection: ${args[2]}`);
      const [role, identity] = matched as [keyof typeof identities, (typeof identities)[keyof typeof identities]];
      const containerd = selectionModes[role] === "containerd";
      const manifestAnnotations = role === "application"
        ? options.applicationManifestAnnotations
        : options.migrationManifestAnnotations;
      const rootAnnotations = role === "application"
        ? options.applicationRootAnnotations
        : options.migrationRootAnnotations;
      return JSON.stringify([{
        Id: containerd ? identity.asset : identity.config,
        Descriptor: containerd ? {
          digest: identity.asset,
          mediaType: role === "application"
            ? (options.applicationRootMediaType
              ?? "application/vnd.oci.image.index.v1+json")
            : (options.migrationRootMediaType
              ?? "application/vnd.oci.image.index.v1+json"),
          ...(rootAnnotations === undefined
            ? {}
            : { annotations: { ...rootAnnotations } }),
          size: rootAnnotations === undefined && manifestAnnotations === undefined ? 4096 : 2048,
        } : { digest: identity.asset },
        RepoDigests: [`registry.example/clean-pay@${identity.asset}`],
      }]);
    }
    if (args[0] === "container" && args[1] === "create") {
      const name = args[args.indexOf("--name") + 1];
      const barrierOwner = args.find((entry) => entry.startsWith("io.clean-pay.event-barrier="));
      if (barrierOwner !== undefined) {
        const nonce = barrierOwner.slice("io.clean-pay.event-barrier=".length);
        const projectLabel = args.find((entry) => entry.startsWith("com.docker.compose.project="));
        probeOrdinal += 1;
        const barrierId = probeOrdinal.toString(16).padStart(64, "0");
        barriers.set(barrierId, {
          image: args.at(-1)!,
          name,
          nonce,
          project: projectLabel!.slice("com.docker.compose.project=".length),
        });
        activeEventCapture?.observeBarrier(barrierId, nonce);
        return barrierId;
      }
      const role = name.includes("-application-") ? "application" : "migration";
      const label = args[args.indexOf("--label") + 1];
      probeOrdinal += 1;
      const probeId = probeOrdinal.toString(16).padStart(64, "0");
      active.set(probeId, {
        name,
        owner: label.slice("io.clean-pay.verifier-probe=".length),
        role,
      });
      return probeId;
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const barrier = barriers.get(args[2]);
      if (barrier) {
        return JSON.stringify([{
          Id: args[2],
          Image: barrier.image,
          Name: `/${barrier.name}`,
          RestartCount: 0,
          Config: {
            Entrypoint: ["/bin/true"],
            Image: barrier.image,
            Labels: {
              "com.docker.compose.project": barrier.project,
              "com.docker.compose.service": "journey-event-barrier",
              "io.clean-pay.event-barrier": barrier.nonce,
            },
          },
          HostConfig: { NetworkMode: "none" },
          State: { Running: false, Status: "created" },
        }]);
      }
      const probe = active.get(args[2]);
      if (!probe) throw new Error(`Unexpected probe inspection: ${args[2]}`);
      const { name, owner, role } = probe;
      const identity = identities[role];
      const selectionMode = selectionModes[role];
      const manifestAnnotations = role === "application"
        ? options.applicationManifestAnnotations
        : options.migrationManifestAnnotations;
      return JSON.stringify([{
        Id: args[2],
        Image: selectionMode === "containerd" ? identity.asset : identity.config,
        ...(selectionMode === "containerd" ? {
          ImageManifestDescriptor: {
            digest: identity.manifest,
            mediaType: role === "application"
              ? (options.applicationManifestMediaType
                ?? "application/vnd.oci.image.manifest.v1+json")
              : (options.migrationManifestMediaType
                ?? "application/vnd.oci.image.manifest.v1+json"),
            platform: {
              architecture: options.imagePlatformArchitecture ?? "amd64",
              os: "linux",
              ...(options.imagePlatformArchitecture === "arm64" ? { variant: "v8" } : {}),
            },
            ...(manifestAnnotations === undefined
              ? {}
              : { annotations: { ...manifestAnnotations } }),
            size: 2048,
          },
        } : {}),
        Name: `/${name}`,
        RestartCount: 0,
        Config: {
          Entrypoint: ["/bin/true"],
          Image: identity.reference,
          Labels: { "io.clean-pay.verifier-probe": owner },
        },
        State: { Running: false, Status: "created" },
      }]);
    }
    if (args[0] === "container" && args[1] === "rm") {
      if (barriers.delete(args[2])) return args[2];
      active.delete(args[2]);
      return args[2];
    }
    if (args[0] === "ps"
      && args.some((entry) => entry.includes("io.clean-pay.event-barrier"))) {
      const labelFilter = args.find((entry) => entry.startsWith(
        "label=io.clean-pay.event-barrier=",
      ));
      const nameFilter = args.find((entry) => entry.startsWith("name=^/"));
      const nonce = labelFilter?.slice("label=io.clean-pay.event-barrier=".length);
      const expectedName = nameFilter?.slice("name=^/".length, -1);
      return [...barriers.entries()]
        .filter(([, barrier]) => barrier.nonce === nonce && barrier.name === expectedName)
        .map(([id]) => id)
        .join("\n");
    }
    if (args[0] === "ps"
      && args.some((entry) => entry.includes("io.clean-pay.verifier-probe"))) {
      const labelFilter = args.find((entry) => entry.startsWith(
        "label=io.clean-pay.verifier-probe=",
      ));
      const nameFilter = args.find((entry) => entry.startsWith("name=^/"));
      const expectedOwner = labelFilter?.slice("label=io.clean-pay.verifier-probe=".length);
      const expectedName = nameFilter?.slice("name=^/".length, -1);
      return [...active.entries()]
        .filter(([, probe]) => probe.owner === expectedOwner && probe.name === expectedName)
        .map(([id]) => id)
        .join("\n");
    }
    if (["ps", "network", "volume"].includes(args[0])) return "";
    throw new Error(`Unexpected mocked Docker command: ${args.join(" ")}`);
  };
  function startEventCapture() {
    type BarrierEventReceipt = Readonly<{ containerId: string; timeNano: string }>;
    const observed = new Map<string, BarrierEventReceipt>();
    const waiters = new Map<string, Array<(value: BarrierEventReceipt) => void>>();
    const lines: string[] = [];
    let stopped = false;
    const capture = {
      observeBarrier: (id: string, nonce: string) => {
        eventOrdinal += 1n;
        const timeNano = (BigInt(Date.now()) * 1_000_000n + eventOrdinal).toString();
        const receipt = Object.freeze({ containerId: id, timeNano });
        observed.set(nonce, receipt);
        lines.push(`${timeNano}|create|${id}|journey-event-barrier|${nonce}`);
        for (const resolve of waiters.get(nonce) ?? []) resolve(receipt);
        waiters.delete(nonce);
      },
      stop: async () => {
        if (stopped) throw new Error("synthetic event capture stopped twice");
        eventCaptureStopAttempts += 1;
        if (eventCaptureStopAttempts <= (options.eventCaptureUnprovenStopAttempts ?? 0)) {
          throw new Error("synthetic event capture termination unproven");
        }
        stopped = true;
        if (activeEventCapture === capture) activeEventCapture = undefined;
        return lines.join("\n");
      },
      terminationProven: () => stopped,
      waitForBarrier: (nonce: string) => {
        if (observed.has(nonce)) return Promise.resolve(observed.get(nonce)!);
        return new Promise<BarrierEventReceipt>((resolve) => {
          const current = waiters.get(nonce) ?? [];
          current.push(resolve);
          waiters.set(nonce, current);
        });
      },
    };
    activeEventCapture = capture;
    return capture;
  }
  return {
    calls,
    composeEnvironments,
    get activeBarrierCount() { return barriers.size; },
    get activeEventCaptureCount() { return activeEventCapture === undefined ? 0 : 1; },
    get activeProbeCount() { return active.size; },
    get eventCaptureStopAttempts() { return eventCaptureStopAttempts; },
    get upCalls() { return upCalls; },
    releaseUp: () => releaseUp(),
    run,
    startEventCapture,
  };
}

function composeModel(
  contract: ReturnType<typeof ownedContract>,
  images: { application?: string; migration?: string } = {},
) {
  return {
    name: contract.project,
    networks: { default: { name: `${contract.project}_default` } },
    services: Object.fromEntries(JOURNEY_COMPOSE_SERVICE_NAMES.map((name) => [name, {
      image: name === "migration"
        ? (images.migration ?? contract.images.migration)
        : (images.application ?? contract.images.application),
      networks: { default: null },
    }])),
    volumes: Object.fromEntries(JOURNEY_COMPOSE_VOLUME_NAMES.map((name) => [name, {
      name: `${contract.project}_${name}`,
    }])),
  };
}

function snapshotFileSystem(overrides: Record<string, unknown> = {}) {
  return {
    chmod,
    lstat,
    mkdtemp,
    readFile,
    readdir,
    realpath,
    rmdir,
    unlink,
    writeFile,
    ...overrides,
  };
}

function modeTrackingSnapshotFileSystem(overrides: Record<string, unknown> = {}) {
  const permissionBitsByPath = new Map<string, number>();
  const writeModesByFilename = new Map<string, number>();
  const operations = snapshotFileSystem({
    chmod: async (...args: Parameters<typeof chmod>) => {
      await chmod(...args);
      if (typeof args[1] !== "number") throw new Error("Synthetic chmod mode must be numeric.");
      permissionBitsByPath.set(path.resolve(String(args[0])), args[1]);
    },
    lstat: async (...args: Parameters<typeof lstat>) => {
      const details = await lstat(...args);
      const permissionBits = permissionBitsByPath.get(path.resolve(String(args[0])));
      if (permissionBits !== undefined) {
        const currentMode = details.mode;
        const nextMode = typeof currentMode === "bigint"
          ? (currentMode & ~0o777n) | BigInt(permissionBits)
          : (currentMode & ~0o777) | permissionBits;
        Reflect.set(details, "mode", nextMode);
      }
      return details;
    },
    writeFile: async (...args: Parameters<typeof writeFile>) => {
      await writeFile(...args);
      const options = args[2];
      const mode = options && typeof options === "object" && "mode" in options
        ? options.mode
        : undefined;
      if (typeof mode === "number") {
        const target = path.resolve(String(args[0]));
        permissionBitsByPath.set(target, mode);
        writeModesByFilename.set(path.basename(target), mode);
      }
    },
    ...overrides,
  });
  return { operations, permissionBitsByPath, writeModesByFilename };
}

function testSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function removeSyntheticInputDirectory(directory: string) {
  for (const filename of [
    ...JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
    "browser-journey-contract.json",
  ]) {
    await unlink(path.join(directory, filename)).catch(() => undefined);
  }
  await rmdir(directory).catch(() => undefined);
}

async function removeOwnedSnapshotDirectory(directory: string) {
  try {
    await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return;
    throw error;
  }
  for (const filename of [
    ...JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
    "fixture-browser-db-observer.mjs",
    "fixture-Caddyfile",
    "fixture-db-observer-provision.sh",
    "fixture-oidc-mock.mjs",
    "fixture-provider-mock.mjs",
    "browser-journey-contract.json",
  ]) {
    await unlink(path.join(directory, filename)).catch((error) => {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    });
  }
  await rmdir(directory);
}
