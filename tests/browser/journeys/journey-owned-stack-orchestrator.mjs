import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  JOURNEY_COMPOSE_SERVICE_NAMES,
  JOURNEY_COMPOSE_VOLUME_NAMES,
  attestJourneyComposeRuntime,
  prepareJourneyComposeInputs,
} from "./journey-compose-runtime-attestation.mjs";
import {
  JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
  buildJourneySyntheticEnvironment,
} from "./journey-synthetic-environment-contract.mjs";

const fixtureSnapshotNames = Object.freeze({
  "/app/browser-db-observer.mjs": "fixture-browser-db-observer.mjs",
  "/etc/caddy/Caddyfile": "fixture-Caddyfile",
  "/fixture/db-observer-provision.sh": "fixture-db-observer-provision.sh",
  "/mock/oidc-mock.mjs": "fixture-oidc-mock.mjs",
  "/mock/provider-mock.mjs": "fixture-provider-mock.mjs",
});
const contractFilename = "browser-journey-contract.json";
const preparedHandles = new WeakSet();
const startedHandles = new WeakSet();
const cleanedHandles = new WeakSet();
const lifecycleBounds = new WeakMap();

export async function withJourneyOwnedStackPair({ baseline, candidate }, callback) {
  exactKeys(arguments[0], ["baseline", "candidate"]);
  if (typeof callback !== "function") fail("Owned dual-stack callback is invalid.");
  assertDistinctPairInputs(baseline, candidate);
  const settled = await Promise.allSettled([
    prepareJourneyOwnedStack(baseline),
    prepareJourneyOwnedStack(candidate),
  ]);
  const handles = settled.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
  if (settled.some(({ status }) => status === "rejected")) {
    const cleanup = await Promise.allSettled(
      handles.map((handle) => cleanupJourneyOwnedStack(handle)),
    );
    if (cleanup.some(({ status }) => status === "rejected")) {
      fail("Verifier-owned preparation failure cleanup did not complete exactly.");
    }
    fail("Both verifier-owned stacks must prepare before any Compose creation.");
  }
  let value;
  let cleanupReceipts;
  try {
    const starts = await Promise.allSettled(handles.map((handle) => startJourneyOwnedStack(handle)));
    if (starts.some(({ status }) => status === "rejected")) {
      fail("Both verifier-owned stacks must start concurrently from verified inputs.");
    }
    const runtimeSettlements = await Promise.allSettled(
      handles.map((handle) => attestJourneyOwnedStack(handle)),
    );
    if (runtimeSettlements.some(({ status }) => status === "rejected")) {
      fail("Both verifier-owned stack runtime attestations must settle before cleanup.");
    }
    const runtimes = runtimeSettlements.map(({ value: runtime }) => runtime);
    value = await callback(Object.freeze({
      baseline: Object.freeze({
        inputReceipt: handles[0].inputReceipt,
        runtime: runtimes[0],
        status: "verifier-owned-runtime-attested",
      }),
      candidate: Object.freeze({
        inputReceipt: handles[1].inputReceipt,
        runtime: runtimes[1],
        status: "verifier-owned-runtime-attested",
      }),
    }));
  } finally {
    const cleanup = await Promise.allSettled(
      handles.filter((handle) => !cleanedHandles.has(handle))
        .map((handle) => cleanupJourneyOwnedStack(handle)),
    );
    if (cleanup.some(({ status }) => status === "rejected")) {
      fail("Verifier-owned dual stacks did not pass exact cleanup.");
    }
    cleanupReceipts = cleanup.map(({ value: receipt }) => receipt);
  }
  return Object.freeze({
    cleanup: Object.freeze({
      stacks: Object.freeze([
        Object.freeze({ role: "baseline", ...cleanupReceipts[0] }),
        Object.freeze({ role: "candidate", ...cleanupReceipts[1] }),
      ]),
      status: "verifier-owned-stack-pair-cleaned",
    }),
    value,
  });
}

export async function prepareJourneyOwnedStack({
  repositoryRoot,
  contractPath,
  contract,
  expectedApplicationImageDigest,
  expectedMigrationImageDigest,
  runDocker,
}) {
  exactKeys(arguments[0], [
    "contract",
    "contractPath",
    "expectedApplicationImageDigest",
    "expectedMigrationImageDigest",
    "repositoryRoot",
    "runDocker",
  ]);
  if (typeof runDocker !== "function") fail("Owned-stack Docker runner is invalid.");
  const source = await prepareJourneyComposeInputs({
    repositoryRoot,
    contractPath,
    contract,
    runDocker,
  });
  await assertJourneyProjectAbsent(contract.project, runDocker, source.queryEnvironment);

  const directory = await mkdtemp(path.join(
    tmpdir(),
    `clean-pay-provider-${sha256(contract.project).slice(0, 12)}-`,
  ));
  await chmod(directory, 0o700).catch(() => undefined);
  const createdFiles = [];
  try {
    const observed = source.syntheticEnvironment.environment;
    const generated = buildJourneySyntheticEnvironment({
      appImage: contract.images.application,
      appPort: observed.CLEAN_PAY_PORT,
      connectProxyPort: publicationPort(contract.publications.connectProxy, "127.0.0.1"),
      directory,
      migrationImage: contract.images.migration,
      project: contract.project,
      providerPort: observed.CLEAN_PAY_BROWSER_PROVIDER_PORT,
      proxyBind: observed.CLEAN_PAY_BROWSER_PROXY_BIND,
      revision: contract.revision,
      turnstileSiteKey: observed.TURNSTILE_SITE_KEY,
    });
    for (const filename of JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES) {
      await privateWrite(path.join(directory, filename), generated.files[filename]);
      createdFiles.push(filename);
    }
    const fixtureSourceOverrides = {};
    for (const [destination, filename] of Object.entries(fixtureSnapshotNames)) {
      const bytes = await readBoundedRegularFile(source.bindSources[destination], 512 * 1024);
      const target = path.join(directory, filename);
      await privateWrite(target, bytes);
      createdFiles.push(filename);
      fixtureSourceOverrides[destination] = target;
    }
    await privateWrite(
      path.join(directory, contractFilename),
      `${JSON.stringify(contract, null, 2)}\n`,
    );
    createdFiles.push(contractFilename);
    const snapshotContractPath = path.join(directory, contractFilename);
    const prepared = await prepareJourneyComposeInputs({
      repositoryRoot,
      contractPath: snapshotContractPath,
      contract,
      fixtureSourceOverrides,
      runDocker,
    });
    await assertJourneyProjectAbsent(contract.project, runDocker, prepared.queryEnvironment);
    const handle = Object.freeze({
      contract,
      contractPath: snapshotContractPath,
      createdFiles: Object.freeze([...createdFiles].sort()),
      directory,
      expectedApplicationImageDigest,
      expectedMigrationImageDigest,
      fixtureSourceOverrides: Object.freeze({ ...fixtureSourceOverrides }),
      inputReceipt: Object.freeze({
        composeSourceSha256: prepared.composeSourceSha256,
        fixtureSourceContractSha256: await fixtureHashContract(fixtureSourceOverrides),
        generatedEnvironmentDirectorySha256: sha256(normalizePath(directory)),
        projectSha256: sha256(contract.project),
        roleEnvironmentContractSha256: generated.fileContractSha256,
        roleEnvironmentPolicySha256: generated.policyContractSha256,
        renderedComposeSha256: prepared.renderedComposeSha256,
      }),
      prepared,
      repositoryRoot,
      runDocker,
    });
    preparedHandles.add(handle);
    return handle;
  } catch (error) {
    try {
      await cleanupExactDirectory(directory, createdFiles);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Owned journey preparation and exact cleanup both failed.",
      );
    }
    throw error;
  }
}

export async function startJourneyOwnedStack(handle) {
  assertHandle(handle);
  if (startedHandles.has(handle) || cleanedHandles.has(handle)) {
    fail("Owned journey stack handle is not startable exactly once.");
  }
  await assertJourneyProjectAbsent(
    handle.contract.project,
    handle.runDocker,
    handle.prepared.queryEnvironment,
  );
  const current = await prepareJourneyComposeInputs({
    repositoryRoot: handle.repositoryRoot,
    contractPath: handle.contractPath,
    contract: handle.contract,
    fixtureSourceOverrides: handle.fixtureSourceOverrides,
    runDocker: handle.runDocker,
  });
  assertPreparedInputsUnchanged(handle, current);
  const lifecycleNotBefore = new Date().toISOString();
  lifecycleBounds.set(handle, lifecycleNotBefore);
  await handle.runDocker([
    "compose",
    "--project-name", handle.contract.project,
    "--env-file", handle.prepared.authoritativeEnvironmentPath,
    ...handle.prepared.composeFiles.flatMap((file) => ["--file", file]),
    "up", "--detach", "--no-build", "--wait", "--wait-timeout", "240",
  ], 64 * 1024, handle.prepared.queryEnvironment);
  startedHandles.add(handle);
  return Object.freeze({ ...handle.inputReceipt, status: "verifier-owned-stack-started" });
}

export async function attestJourneyOwnedStack(handle) {
  assertHandle(handle);
  if (!startedHandles.has(handle) || cleanedHandles.has(handle)) {
    fail("Owned journey stack must be started before runtime attestation.");
  }
  return attestJourneyComposeRuntime({
    repositoryRoot: handle.repositoryRoot,
    contractPath: handle.contractPath,
    contract: handle.contract,
    expectedApplicationImageDigest: handle.expectedApplicationImageDigest,
    expectedMigrationImageDigest: handle.expectedMigrationImageDigest,
    fixtureSourceOverrides: handle.fixtureSourceOverrides,
    lifecycleNotBefore: lifecycleBounds.get(handle),
    runDocker: handle.runDocker,
  });
}

export async function cleanupJourneyOwnedStack(handle) {
  assertHandle(handle);
  if (cleanedHandles.has(handle)) fail("Owned journey stack cleanup is exactly once.");
  const resources = await inspectOwnedResources(
    handle.contract.project,
    handle.runDocker,
    handle.prepared.queryEnvironment,
  );
  if (resources.count > 0) {
    const current = await prepareJourneyComposeInputs({
      repositoryRoot: handle.repositoryRoot,
      contractPath: handle.contractPath,
      contract: handle.contract,
      fixtureSourceOverrides: handle.fixtureSourceOverrides,
      runDocker: handle.runDocker,
    });
    assertPreparedInputsUnchanged(handle, current);
    await handle.runDocker([
      "compose",
      "--project-name", handle.contract.project,
      "--env-file", handle.prepared.authoritativeEnvironmentPath,
      ...handle.prepared.composeFiles.flatMap((file) => ["--file", file]),
      "down", "--volumes", "--timeout", "120",
    ], 64 * 1024, handle.prepared.queryEnvironment);
  }
  await assertJourneyProjectAbsent(
    handle.contract.project,
    handle.runDocker,
    handle.prepared.queryEnvironment,
  );
  await cleanupExactDirectory(handle.directory, handle.createdFiles);
  cleanedHandles.add(handle);
  return Object.freeze({
    generatedEnvironmentDirectorySha256: handle.inputReceipt.generatedEnvironmentDirectorySha256,
    projectSha256: sha256(handle.contract.project),
    status: "verifier-owned-stack-cleaned",
  });
}

export async function assertJourneyProjectAbsent(project, runDocker, environment) {
  const filter = `label=com.docker.compose.project=${project}`;
  const outputs = await Promise.all([
    runDocker(["ps", "--all", "--no-trunc", "--quiet", "--filter", filter], 4 * 1024, environment),
    runDocker(["network", "ls", "--no-trunc", "--quiet", "--filter", filter], 4 * 1024, environment),
    runDocker(["volume", "ls", "--quiet", "--filter", filter], 4 * 1024, environment),
  ]);
  if (outputs.some((output) => splitLines(output).length !== 0)) {
    fail("Verifier-owned journey project is not absent before creation or after cleanup.");
  }
}

function assertDistinctPairInputs(baseline, candidate) {
  for (const input of [baseline, candidate]) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail("Owned stack pair input is invalid.");
    }
  }
  if (baseline.contract?.project === candidate.contract?.project
    || baseline.contractPath === candidate.contractPath
    || baseline.expectedApplicationImageDigest === candidate.expectedApplicationImageDigest
    || baseline.expectedMigrationImageDigest === candidate.expectedMigrationImageDigest) {
    fail("Owned stack pair inputs are not isolated and image-distinct.");
  }
  const publications = [
    ...Object.values(baseline.contract?.publications ?? {}),
    ...Object.values(candidate.contract?.publications ?? {}),
  ];
  if (publications.length !== 8 || new Set(publications).size !== publications.length) {
    fail("Owned stack pair publications are not exactly distinct.");
  }
}

function assertPreparedInputsUnchanged(handle, current) {
  if (current.composeSourceSha256 !== handle.inputReceipt.composeSourceSha256
    || current.renderedComposeSha256 !== handle.inputReceipt.renderedComposeSha256
    || current.syntheticEnvironment.fileContractSha256
      !== handle.inputReceipt.roleEnvironmentContractSha256
    || current.syntheticEnvironment.policyContractSha256
      !== handle.inputReceipt.roleEnvironmentPolicySha256) {
    fail("Owned journey inputs changed after their pre-start receipt.");
  }
}

async function inspectOwnedResources(project, runDocker, environment) {
  const filter = `label=com.docker.compose.project=${project}`;
  const [containers, networks, volumes] = await Promise.all([
    runDocker(["ps", "--all", "--no-trunc", "--quiet", "--filter", filter], 4 * 1024, environment),
    runDocker(["network", "ls", "--no-trunc", "--quiet", "--filter", filter], 4 * 1024, environment),
    runDocker(["volume", "ls", "--quiet", "--filter", filter], 4 * 1024, environment),
  ]);
  const groups = [
    ["container", splitLines(containers)],
    ["network", splitLines(networks)],
    ["volume", splitLines(volumes)],
  ];
  const observedServices = new Set();
  const observedNetworks = new Set();
  const observedVolumes = new Set();
  let count = 0;
  for (const [kind, identities] of groups) {
    if (identities.length > 32 || new Set(identities).size !== identities.length
      || identities.some((identity) => kind === "volume"
        ? !new RegExp(`^${escapePattern(project)}_[a-z0-9-]{1,80}$`).test(identity)
        : !/^[a-f0-9]{64}$/.test(identity))) {
      fail("Owned journey resource query is invalid or overflowed.");
    }
    count += identities.length;
    for (const identity of identities) {
      const inspected = parseJson(await runDocker([
        kind, "inspect", identity,
      ], 512 * 1024, environment));
      if (!Array.isArray(inspected) || inspected.length !== 1) fail("Owned resource inspection is invalid.");
      const labels = kind === "container" ? inspected[0]?.Config?.Labels : inspected[0]?.Labels;
      if (labels?.["com.docker.compose.project"] !== project) {
        fail("Refusing cleanup of a resource outside the exact verifier-owned project.");
      }
      if (kind === "container") {
        const service = labels?.["com.docker.compose.service"];
        if (!JOURNEY_COMPOSE_SERVICE_NAMES.includes(service)
          || observedServices.has(service)
          || inspected[0]?.Name !== `/${project}-${service}-1`) {
          fail("Refusing cleanup of an unexpected project container.");
        }
        observedServices.add(service);
      } else if (kind === "network") {
        const logical = labels?.["com.docker.compose.network"];
        if (logical !== "default" || observedNetworks.has(logical)
          || inspected[0]?.Name !== `${project}_default`) {
          fail("Refusing cleanup of an unexpected project network.");
        }
        observedNetworks.add(logical);
      } else {
        const logical = labels?.["com.docker.compose.volume"];
        if (!JOURNEY_COMPOSE_VOLUME_NAMES.includes(logical)
          || observedVolumes.has(logical)
          || inspected[0]?.Name !== `${project}_${logical}`) {
          fail("Refusing cleanup of an unexpected project volume.");
        }
        observedVolumes.add(logical);
      }
    }
  }
  return { count };
}

function escapePattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fixtureHashContract(sources) {
  const records = [];
  for (const [destination, source] of Object.entries(sources).sort(([left], [right]) => (
    left.localeCompare(right)
  ))) {
    records.push({
      destination,
      sha256: sha256(await readBoundedRegularFile(source, 512 * 1024)),
    });
  }
  return sha256(JSON.stringify(records));
}

async function privateWrite(target, bytes) {
  await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  await chmod(target, 0o600).catch(() => undefined);
}

async function cleanupExactDirectory(directory, createdFiles) {
  const realDirectory = await realpath(directory);
  const expected = [...createdFiles].sort();
  const observedBefore = (await readdir(realDirectory)).sort();
  const unexpected = observedBefore.filter((filename) => !expected.includes(filename));
  const missing = expected.filter((filename) => !observedBefore.includes(filename));
  let invalidKnownEntry = false;
  for (const filename of expected) {
    if (missing.includes(filename)) continue;
    const target = path.join(realDirectory, filename);
    const details = await lstat(target);
    if (!details.isFile() || details.isSymbolicLink()) {
      invalidKnownEntry = true;
      continue;
    }
    await unlink(target);
  }
  if (unexpected.length > 0 || invalidKnownEntry || (await readdir(realDirectory)).length !== 0) {
    fail("Owned input snapshot cleanup found an unexpected or missing exact entry.");
  }
  await rmdir(realDirectory);
  if (missing.length > 0) {
    fail("Owned input snapshot cleanup found an unexpected or missing exact entry.");
  }
}

async function readBoundedRegularFile(target, maximumBytes) {
  const requested = path.resolve(target);
  const requestedDetails = await lstat(requested);
  const resolved = await realpath(target);
  const details = await lstat(resolved);
  if (requestedDetails.isSymbolicLink() || !details.isFile()
    || details.size <= 0 || details.size > maximumBytes) {
    fail("Owned input source is outside its bounded regular-file contract.");
  }
  const bytes = await readFile(resolved);
  if (bytes.byteLength !== details.size || bytes.byteLength > maximumBytes) {
    fail("Owned input source changed while being read.");
  }
  return bytes;
}

function publicationPort(publication, host) {
  const match = new RegExp(`^${host.replaceAll(".", "\\.")}:(?<port>\\d{4,5})$`).exec(publication ?? "");
  if (!match || String(Number(match.groups.port)) !== match.groups.port
    || Number(match.groups.port) > 65_535) fail("Owned stack publication is invalid.");
  return match.groups.port;
}

function assertHandle(handle) {
  if (!handle || typeof handle !== "object" || !preparedHandles.has(handle)) {
    fail("Owned journey stack handle is invalid.");
  }
}

function splitLines(value) {
  return String(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseJson(value) {
  try {
    return JSON.parse(String(value));
  } catch {
    fail("Owned journey Docker inspection is not valid JSON.");
  }
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("Owned journey stack input keys are not exact.");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(value) {
  const resolved = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function fail(message) {
  throw new Error(message);
}
