import { EventEmitter } from "node:events";
import {
  chmod,
  lstat,
  mkdtemp,
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
import { PassThrough } from "node:stream";

import { expect, test } from "@playwright/test";

import {
  assertJourneyProjectAbsent,
  attestJourneyOwnedStack,
  cleanupJourneyOwnedStack,
  createJourneyOwnedInputSnapshot,
  deriveJourneyApplicationImageConfigDigest,
  deriveJourneyMigrationImageConfigDigest,
  dispatchJourneyOwnedStackPair,
  prepareJourneyOwnedStackLaunch,
  prepareJourneyOwnedStack,
  runJourneyDockerCommand,
  withJourneyOwnedStackPair,
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
    }, operations), stage).rejects.toThrow(new RegExp(stage));
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

function shortProxyLifecycleBounds() {
  return {
    killCloseTimeoutMs: 40,
    readinessTimeoutMs: 40,
    shutdownTimeoutMs: 5,
    terminationGraceMs: 5,
  };
}

function fakeProxyChild(closeDelayMs: number) {
  const child = new EventEmitter() as EventEmitter & {
    closed: boolean;
    exitCode: number | null;
    killSignals: NodeJS.Signals[];
    signalCode: NodeJS.Signals | null;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal?: NodeJS.Signals) => boolean;
  };
  child.closed = false;
  child.exitCode = null;
  child.killSignals = [];
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (signal = "SIGTERM") => {
    child.killSignals.push(signal);
    if (child.killSignals.length === 1) {
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

async function createOwnedInput(role: "baseline" | "candidate", repositoryRoot: string) {
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
  const docker = createOwnedDockerMock(contract, assetDigest, configDigest);
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
      expectedApplicationRepoDigests: [
        `sha256:${(role === "baseline" ? "a" : "c").repeat(64)}`,
        `sha256:${(role === "baseline" ? "b" : "d").repeat(64)}`,
      ],
      expectedMigrationAssetImageDigest: assetDigest,
      runDocker: docker.run,
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

function createOwnedDockerMock(contract: ReturnType<typeof ownedContract>, asset: string, config: string) {
  const calls: string[][] = [];
  const composeEnvironments: Array<Record<string, string>> = [];
  const baseline = contract.project.includes("baseline");
  const identities = {
    application: {
      asset: `sha256:${(baseline ? "a" : "c").repeat(64)}`,
      config: `sha256:${(baseline ? "4" : "8").repeat(64)}`,
      reference: contract.images.application,
    },
    migration: {
      asset,
      config,
      reference: contract.images.migration,
    },
  } as const;
  const active = new Map<string, {
    name: string;
    owner: string;
    role: keyof typeof identities;
  }>();
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
      const identity = Object.values(identities).find(({ reference, config: selected }) => (
        args[2] === reference || args[2] === selected
      ));
      if (!identity) throw new Error(`Unexpected image inspection: ${args[2]}`);
      return JSON.stringify([{
        Id: identity.config,
        Descriptor: { digest: identity.asset },
        RepoDigests: [`registry.example/clean-pay@${identity.asset}`],
      }]);
    }
    if (args[0] === "container" && args[1] === "create") {
      const name = args[args.indexOf("--name") + 1];
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
      const probe = active.get(args[2]);
      if (!probe) throw new Error(`Unexpected probe inspection: ${args[2]}`);
      const { name, owner, role } = probe;
      const identity = identities[role];
      return JSON.stringify([{
        Id: args[2],
        Image: identity.config,
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
      active.delete(args[2]);
      return args[2];
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
  return {
    calls,
    composeEnvironments,
    get activeProbeCount() { return active.size; },
    get upCalls() { return upCalls; },
    releaseUp: () => releaseUp(),
    run,
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

async function removeSyntheticInputDirectory(directory: string) {
  for (const filename of [
    ...JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
    "browser-journey-contract.json",
  ]) {
    await unlink(path.join(directory, filename)).catch(() => undefined);
  }
  await rmdir(directory).catch(() => undefined);
}
