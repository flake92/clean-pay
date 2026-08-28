import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  open,
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
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
  JOURNEY_COMPOSE_VOLUME_NAMES,
  attestJourneyComposeRuntime,
  prepareJourneyComposeInputs,
} from "./journey-compose-runtime-attestation.mjs";
import {
  JOURNEY_FIXTURE_CONTRACT_DOMAIN,
  JOURNEY_FIXTURE_FILENAMES,
} from "./journey-fixture-manifest.mjs";
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
const automaticDockerTimeout = Number.NaN;
const containerdImageSelectionMode = "containerd-root-manifest";
const defaultImagePlatform = Object.freeze({ architecture: "amd64", os: "linux" });
const optionalInputValue = Reflect.get(Object.freeze({}), "optional");
const platformImageManifestMediaTypes = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
const rootImageManifestMediaTypes = new Set([
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
export const JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT =
  "synthetic-only-no-external-credential-material-v1";
const preparedHandles = new WeakSet();
const startedHandles = new WeakSet();
const cleanedHandles = new WeakSet();
const launchPreparedHandles = new WeakSet();
const lifecycleBounds = new WeakMap();
const ownedFileSystemOperations = Object.freeze({
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
});
const sanitizedOutputFileSystemOperations = Object.freeze({
  chmod,
  lstat,
  open,
  readFile,
  realpath,
  unlink,
});

export function journeyDockerCliEnvironment(
  source = Object.assign(Object.create(null), process.env),
) {
  const result = Object.create(null);
  for (const name of [
    "APPDATA", "DOCKER_CERT_PATH", "DOCKER_CONFIG",
    "DOCKER_CONTEXT", "DOCKER_HOST", "DOCKER_TLS_VERIFY", "HOME", "LANG",
    "LC_ALL", "LOCALAPPDATA", "PATH", "Path", "PATHEXT", "SYSTEMROOT",
    "SystemRoot", "TEMP", "TMP", "USERPROFILE", "WINDIR", "XDG_CONFIG_HOME",
    "ProgramFiles", "ProgramW6432",
  ]) {
    if (typeof source[name] === "string") result[name] = source[name];
  }
  return result;
}

export async function enforceJourneySyntheticPrivateMode(target, mode, options = {}) {
  const allowedKeys = ["chmodPath", "lstatPath", "materialContract", "platform"];
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((name) => !allowedKeys.includes(name))) {
    fail("Synthetic private-mode options are invalid.");
  }
  const {
    chmodPath = chmod,
    lstatPath = lstat,
    materialContract = JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
    platform = process.platform,
  } = options;
  if (!path.isAbsolute(target) || ![0o600, 0o700].includes(mode)
    || typeof chmodPath !== "function" || typeof lstatPath !== "function"
    || materialContract !== JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT
    || typeof platform !== "string" || platform.length < 1) {
    fail("Synthetic private-mode contract is invalid.");
  }
  if (platform !== "win32") {
    await chmodPath(target, mode);
    const details = await lstatPath(target, { bigint: true });
    const expectedType = mode === 0o700 ? details.isDirectory() : details.isFile();
    if (!expectedType || details.isSymbolicLink()
      || (Number(details.mode) & 0o777) !== mode) {
      fail("Synthetic POSIX private mode was not enforced exactly.");
    }
  }
  return Object.freeze({
    materialContract: JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
    status: platform === "win32"
      ? "synthetic-material-no-windows-owner-only-claim"
      : "synthetic-material-posix-mode-enforced",
  });
}

export async function writeJourneySanitizedOutput(
  target,
  bytes,
  options = {},
) {
  if (!options || typeof options !== "object" || Array.isArray(options)
    || Object.keys(options).some((name) => !["fileSystem", "platform"].includes(name))) {
    fail("Sanitized proof output writer options are invalid.");
  }
  const {
    fileSystem = sanitizedOutputFileSystemOperations,
    platform = process.platform,
  } = options;
  const operationNames = Object.keys(sanitizedOutputFileSystemOperations).sort();
  if (!path.isAbsolute(target) || !(bytes instanceof Uint8Array)
    || bytes.byteLength < 1 || bytes.byteLength > 16 * 1024 * 1024
    || !fileSystem || typeof fileSystem !== "object" || Array.isArray(fileSystem)
    || JSON.stringify(Object.keys(fileSystem).sort()) !== JSON.stringify(operationNames)
    || operationNames.some((name) => typeof fileSystem[name] !== "function")
    || typeof platform !== "string" || platform.length < 1) {
    fail("Sanitized proof output writer contract is invalid.");
  }
  let handle;
  let handleIdentity;
  let primaryError;
  try {
    handle = await fileSystem.open(target, "wx", 0o600);
    const empty = await handle.stat({ bigint: true });
    handleIdentity = sanitizedOutputHandleIdentity(empty);
    if (!empty.isFile() || empty.isSymbolicLink() || empty.size !== 0n) {
      fail("Create-only proof output handle identity is invalid.");
    }
    await handle.writeFile(bytes);
    await handle.sync();
    const written = await handle.stat({ bigint: true });
    if (!written.isFile() || written.isSymbolicLink()
      || written.dev !== handleIdentity.device || written.ino !== handleIdentity.inode
      || written.size !== BigInt(bytes.byteLength)) {
      fail("Create-only proof output handle changed while writing.");
    }
    await handle.close();
    handle = undefined;
    await enforceJourneySyntheticPrivateMode(target, 0o600, {
      chmodPath: fileSystem.chmod,
      lstatPath: fileSystem.lstat,
      platform,
    });
    const requested = await fileSystem.lstat(target, { bigint: true });
    const resolvedPath = await fileSystem.realpath(target);
    const resolved = await fileSystem.lstat(resolvedPath, { bigint: true });
    const observed = await fileSystem.readFile(resolvedPath);
    const after = await fileSystem.lstat(resolvedPath, { bigint: true });
    if (normalizePath(path.resolve(target)) !== normalizePath(path.resolve(resolvedPath))
      || !requested.isFile() || requested.isSymbolicLink()
      || !resolved.isFile() || resolved.isSymbolicLink()
      || requested.dev !== handleIdentity.device || requested.ino !== handleIdentity.inode
      || resolved.dev !== handleIdentity.device || resolved.ino !== handleIdentity.inode
      || after.dev !== resolved.dev || after.ino !== resolved.ino
      || after.size !== resolved.size || after.mtimeNs !== resolved.mtimeNs
      || observed.byteLength !== bytes.byteLength
      || sha256(observed) !== sha256(bytes)) {
      fail("Create-only proof output path or bytes changed after its FileHandle write.");
    }
    return Object.freeze({
      bytes: bytes.byteLength,
      materialContract: JOURNEY_SYNTHETIC_CONFIDENTIALITY_CONTRACT,
      sha256: sha256(bytes),
      status: "sanitized-create-only-output-written",
    });
  } catch (error) {
    primaryError = error;
  } finally {
    if (handle) {
      if (!handleIdentity) {
        try {
          handleIdentity = sanitizedOutputHandleIdentity(
            await handle.stat({ bigint: true }),
          );
        } catch (identityError) {
          primaryError = primaryError
            ? new AggregateError(
              [primaryError, identityError],
              "Sanitized output write failed before its recovery identity was proven.",
            )
            : identityError;
        }
      }
      try {
        await handle.close();
      } catch (closeError) {
        primaryError = primaryError
          ? new AggregateError([primaryError, closeError], "Sanitized output write and close failed.")
          : closeError;
      }
    }
  }
  if (handleIdentity) {
    try {
      const owned = await fileSystem.lstat(target, { bigint: true });
      if (!owned.isFile() || owned.isSymbolicLink()
        || owned.dev !== handleIdentity.device || owned.ino !== handleIdentity.inode) {
        fail("Refusing cleanup of a changed sanitized output identity.");
      }
      await fileSystem.unlink(target);
      try {
        await fileSystem.lstat(target);
        fail("Sanitized output remained after exact failure cleanup.");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } catch (cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        "Sanitized output failed and exact cleanup was not proven.",
      );
    }
  }
  if (!primaryError) fail("Sanitized output writer failed without an exact error.");
  throw primaryError;
}

function sanitizedOutputHandleIdentity(details) {
  if (!details || typeof details !== "object"
    || typeof details.dev !== "bigint" || typeof details.ino !== "bigint") {
    fail("Create-only proof output handle has no exact recovery identity.");
  }
  return Object.freeze({ device: details.dev, inode: details.ino });
}

export function runJourneyDockerCommand(
  args,
  maximumBytes = 64 * 1024,
  environment = journeyDockerCliEnvironment(),
  {
    repositoryRoot = process.cwd(),
    spawnProcess = spawn,
    killCloseTimeoutMs = 2_000,
    terminationGraceMs = 1_000,
    timeoutMs = automaticDockerTimeout,
    verifyProcessTerminated = verifyJourneyProcessTerminated,
  } = {},
) {
  const effectiveTimeoutMs = Number.isNaN(timeoutMs)
    ? (Array.isArray(args) && args.includes("up")
    ? 300_000
    : Array.isArray(args) && args.includes("down") ? 180_000 : 30_000)
    : timeoutMs;
  if (!Array.isArray(args) || args.length < 1
    || args.some((entry) => typeof entry !== "string" || entry.length === 0)
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 2 * 1024 * 1024
      || !Number.isSafeInteger(effectiveTimeoutMs)
      || effectiveTimeoutMs < 1 || effectiveTimeoutMs > 600_000
      || !Number.isSafeInteger(terminationGraceMs)
      || terminationGraceMs < 1 || terminationGraceMs > 5_000
      || !Number.isSafeInteger(killCloseTimeoutMs)
      || killCloseTimeoutMs < 1 || killCloseTimeoutMs > 5_000
      || typeof verifyProcessTerminated !== "function"
      || typeof spawnProcess !== "function" || !path.isAbsolute(repositoryRoot)) {
    fail("Bounded journey Docker command input is invalid.");
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess("docker", args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdoutStream = child.stdout;
    const stderrStream = child.stderr;
    if (!stdoutStream || !stderrStream) {
      fail("Bounded journey Docker child did not expose exact output streams.");
    }
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let stderrBytes = 0;
    let terminationReason = null;
    let escalationTimer;
    let closeVerificationTimer;
    let exitObserved = false;
    let settled = false;
    const clearTimers = () => {
      clearTimeout(timer);
      clearTimeout(escalationTimer);
      clearTimeout(closeVerificationTimer);
    };
    const rejectTerminatedWithoutClose = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      stdoutStream.removeAllListeners("data");
      stderrStream.removeAllListeners("data");
      stdoutStream.destroy();
      stderrStream.destroy();
      reject(new Error(
        `Bounded Docker operation failed (${terminationReason ?? "exit"}:`
        + `os-terminated-without-close:${sha256(stderr)}).`,
      ));
    };
    const verifyClosedAfterKill = async () => {
      if (settled) return;
      let absent = exitObserved;
      if (!absent) {
        try {
          absent = await verifyProcessTerminated(child.pid);
        } catch {
          absent = false;
        }
      }
      if (settled) return;
      if (absent === true) {
        rejectTerminatedWithoutClose();
        return;
      }
      closeVerificationTimer = setTimeout(verifyClosedAfterKill, killCloseTimeoutMs);
    };
    const terminate = (reason) => {
      if (terminationReason !== null) return;
      terminationReason ??= reason;
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      escalationTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
        closeVerificationTimer = setTimeout(verifyClosedAfterKill, killCloseTimeoutMs);
      }, terminationGraceMs);
    };
    const timer = setTimeout(() => terminate("timeout"), effectiveTimeoutMs);
    stdoutStream.setEncoding("utf8");
    stderrStream.setEncoding("utf8");
    stdoutStream.on("data", (chunk) => {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes + chunkBytes > maximumBytes) {
        terminate("stdout-overflow");
        return;
      }
      stdout += chunk;
      stdoutBytes += chunkBytes;
    });
    stderrStream.on("data", (chunk) => {
      const remaining = 4 * 1024 - stderrBytes;
      if (remaining <= 0) return;
      const bytes = Buffer.from(chunk, "utf8").subarray(0, remaining);
      stderr += bytes.toString("utf8");
      stderrBytes += bytes.byteLength;
    });
    child.once("error", () => {
      exitObserved = child.pid === undefined;
      terminate("spawn-error");
    });
    child.once("exit", () => {
      exitObserved = true;
    });
    // `exit` intentionally does not settle. Node guarantees `close` after all
    // stdio streams close; cleanup may begin only after that terminal event.
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (code === 0 && signal === null && terminationReason === null
        && stdoutBytes <= maximumBytes) {
        resolve(stdout.trim());
        return;
      }
      reject(new Error(
        `Bounded Docker operation failed (${terminationReason ?? "exit"}:`
        + `${code ?? signal ?? "unknown"}:${sha256(stderr)}).`,
      ));
    });
  });
}

export async function withJourneyOwnedStackPair({ baseline, candidate }, callback) {
  exactKeys(arguments[0], ["baseline", "candidate"]);
  if (typeof callback !== "function") fail("Owned dual-stack callback is invalid.");
  assertDistinctPairInputs(baseline, candidate);
  const settled = await Promise.allSettled([
    prepareJourneyOwnedStack(baseline),
    prepareJourneyOwnedStack(candidate),
  ]);
  const handles = [];
  for (const result of settled) {
    if (result.status === "fulfilled") handles.push(result.value);
  }
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
  let launchReceipt;
  let cleanupReceipts;
  try {
    const launchSettlements = await settleOwnedStackLaunches(
      handles,
      async (handle) => {
        try {
          return { status: "fulfilled", value: await prepareJourneyOwnedStackLaunch(handle) };
        } catch {
          return { status: "rejected" };
        }
      },
    );
    if (launchSettlements.some(({ status }) => status === "rejected")) {
      fail("Both verifier-owned pre-launch rechecks must settle before cleanup.");
    }
    const launchPlans = [];
    for (const result of launchSettlements) {
      if (result.status === "fulfilled") launchPlans.push(result.value);
    }
    if (launchPlans.length !== handles.length) {
      fail("Verifier-owned pre-launch recheck ledger is incomplete.");
    }
    launchReceipt = await dispatchJourneyOwnedStackPair(handles, launchPlans);
    const runtimeSettlements = await Promise.allSettled(
      handles.map((handle) => attestJourneyOwnedStack(handle)),
    );
    if (runtimeSettlements.some(({ status }) => status === "rejected")) {
      fail("Both verifier-owned stack runtime attestations must settle before cleanup.");
    }
    const runtimes = [];
    for (const result of runtimeSettlements) {
      if (result.status === "fulfilled") runtimes.push(result.value);
    }
    const coexistence = await attestJourneyOwnedStackPairCoexistence(handles);
    launchReceipt = Object.freeze({
      barrierSha256: launchReceipt.barrierSha256,
      coexistence,
      dispatches: launchReceipt.dispatches,
      inputReceiptContractSha256s: launchReceipt.inputReceiptContractSha256s,
      lifecycleNotBefore: launchReceipt.lifecycleNotBefore,
      status: launchReceipt.status,
    });
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
      launch: launchReceipt,
    }));
    await Promise.all(handles.map(assertOwnedInputsUnchanged));
  } finally {
    const cleanup = await Promise.allSettled(
      handles.filter((handle) => !cleanedHandles.has(handle))
        .map((handle) => cleanupJourneyOwnedStack(handle)),
    );
    if (cleanup.some(({ status }) => status === "rejected")) {
      fail("Verifier-owned dual stacks did not pass exact cleanup.");
    }
    cleanupReceipts = [];
    for (const result of cleanup) {
      if (result.status === "fulfilled") cleanupReceipts.push(result.value);
    }
  }
  return Object.freeze({
    cleanup: Object.freeze({
      stacks: Object.freeze([
        Object.freeze({ role: "baseline", ...cleanupReceipts[0] }),
        Object.freeze({ role: "candidate", ...cleanupReceipts[1] }),
      ]),
      status: "verifier-owned-stack-pair-cleaned",
    }),
    launch: launchReceipt,
    value,
  });
}

export async function createJourneyOwnedInputSnapshot(
  { directoryPrefix, expectedFilenames, populate },
  operations = ownedFileSystemOperations,
  platform = process.platform,
) {
  exactKeys(arguments[0], ["directoryPrefix", "expectedFilenames", "populate"]);
  const operationNames = Object.keys(ownedFileSystemOperations).sort();
  if (!operations || typeof operations !== "object" || Array.isArray(operations)
    || JSON.stringify(Object.keys(operations).sort()) !== JSON.stringify(operationNames)
    || operationNames.some((name) => typeof operations[name] !== "function")
    || typeof populate !== "function"
    || typeof platform !== "string" || platform.length < 1
    || !path.isAbsolute(directoryPrefix)) {
    fail("Owned input snapshot factory input is invalid.");
  }
  const temporaryRoot = normalizePath(await operations.realpath(tmpdir()));
  const normalizedPrefix = normalizePath(directoryPrefix);
  if (normalizePath(path.dirname(directoryPrefix)) !== temporaryRoot
    || !path.basename(directoryPrefix).startsWith("clean-pay-provider-")
    || !Array.isArray(expectedFilenames) || expectedFilenames.length < 1
    || new Set(expectedFilenames).size !== expectedFilenames.length
    || expectedFilenames.some((filename) => typeof filename !== "string"
      || filename !== path.basename(filename)
      || [".", ".."].includes(filename)
      || !/^[A-Za-z0-9.][A-Za-z0-9._-]{0,127}$/.test(filename))) {
    fail("Owned input snapshot path or exact filename set is invalid.");
  }
  let directory;
  let directoryIdentity;
  const begunFiles = new Set();
  const createdFiles = {};
  try {
    const createdDirectory = await operations.mkdtemp(directoryPrefix);
    if (!path.isAbsolute(createdDirectory)
      || !normalizePath(createdDirectory).startsWith(normalizedPrefix)
      || normalizePath(path.dirname(createdDirectory)) !== temporaryRoot) {
      fail("Owned input snapshot factory returned an unexpected directory.");
    }
    directory = createdDirectory;
    await enforceJourneySyntheticPrivateMode(directory, 0o700, {
      chmodPath: operations.chmod,
      lstatPath: operations.lstat,
      platform,
    });
    directoryIdentity = await captureOwnedPathIdentity(directory, "directory", operations);
    const writeOwnedFile = async (filename, bytes) => {
      if (!expectedFilenames.includes(filename) || begunFiles.has(filename)
        || (!Buffer.isBuffer(bytes) && typeof bytes !== "string")) {
        fail("Owned input snapshot write is outside its exact create-only contract.");
      }
      begunFiles.add(filename);
      const identity = await privateWrite(path.join(directory, filename), bytes, operations);
      createdFiles[filename] = identity;
      return path.join(directory, filename);
    };
    const value = await populate(Object.freeze({ directory, writeOwnedFile }));
    if (begunFiles.size !== expectedFilenames.length
      || Object.keys(createdFiles).length !== expectedFilenames.length) {
      fail("Owned input snapshot population is incomplete.");
    }
    return Object.freeze({
      createdFiles: Object.freeze({ ...createdFiles }),
      directory,
      directoryIdentity,
      value,
    });
  } catch (error) {
    if (directory === undefined) throw error;
    try {
      await cleanupPartiallyCreatedDirectory(
        directory,
        directoryIdentity,
        begunFiles,
        createdFiles,
        operations,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Owned input snapshot creation and exact recovery cleanup both failed.",
      );
    }
    throw error;
  }
}

async function settleOwnedStackLaunches(handles, prepareJourneyOwnedStackLaunch) {
  const launchPlans = await Promise.all(handles.map(prepareJourneyOwnedStackLaunch));
  return launchPlans;
}

export async function prepareJourneyOwnedStack({
  repositoryRoot,
  contractPath,
  contract,
  expectedApplicationAssetImageDigest,
  expectedApplicationImageConfigDigest,
  expectedApplicationManifestDigest = optionalInputValue,
  expectedApplicationRepoDigests,
  expectedImagePlatform = optionalInputValue,
  expectedMigrationAssetImageDigest,
  runDocker,
}) {
  exactOptionalKeys(arguments[0], [
    "contract",
    "contractPath",
    "expectedApplicationAssetImageDigest",
    "expectedApplicationImageConfigDigest",
    "expectedApplicationRepoDigests",
    "expectedMigrationAssetImageDigest",
    "repositoryRoot",
    "runDocker",
  ], ["expectedApplicationManifestDigest", "expectedImagePlatform"]);
  if (typeof runDocker !== "function") fail("Owned-stack Docker runner is invalid.");
  const imagePlatform = exactImagePlatform(
    expectedImagePlatform === undefined ? defaultImagePlatform : expectedImagePlatform,
    "expected image platform",
  );
  const fixtureBefore = await readFreshJourneyFixtureContract(repositoryRoot);
  if (contract.fixtureContract?.domain !== JOURNEY_FIXTURE_CONTRACT_DOMAIN
    || contract.fixtureContract.sha256 !== fixtureBefore.sha256) {
    fail("Owned stack contract is not bound to the fresh global fixture manifest.");
  }
  const source = await prepareJourneyComposeInputs({
    repositoryRoot,
    contractPath,
    contract,
    fixtureSourceOverrides: undefined,
    runDocker,
  });
  await assertJourneyProjectAbsent(contract.project, runDocker, source.queryEnvironment);
  const probeNonces = Object.freeze({
    initialApplication: randomBytes(16).toString("hex"),
    initialMigration: randomBytes(16).toString("hex"),
    launchApplication: randomBytes(16).toString("hex"),
    launchMigration: randomBytes(16).toString("hex"),
  });
  const applicationIdentity = await deriveJourneyApplicationImageConfigDigest({
    contract,
    environment: source.queryEnvironment,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    ...(expectedApplicationManifestDigest === undefined
      ? {}
      : { expectedApplicationManifestDigest }),
    expectedApplicationRepoDigests,
    expectedImagePlatform: imagePlatform,
    probeNonce: probeNonces.initialApplication,
    runDocker,
  });
  const migrationIdentity = await deriveJourneyMigrationImageConfigDigest({
    contract,
    environment: source.queryEnvironment,
    expectedMigrationAssetImageDigest,
    expectedImagePlatform: imagePlatform,
    probeNonce: probeNonces.initialMigration,
    runDocker,
  });
  const imageSelectionMode = assertCompatibleImageSelection(
    applicationIdentity,
    migrationIdentity,
  );
  const applicationImageRuntimeDigest = runtimeImageDigestOf(applicationIdentity);
  const migrationImageRuntimeDigest = runtimeImageDigestOf(migrationIdentity);
  const launchContract = createImmutableLaunchContract(
    contract,
    applicationImageRuntimeDigest,
    migrationImageRuntimeDigest,
  );

  let snapshot;
  try {
    const observed = source.syntheticEnvironment.environment;
    const expectedFilenames = [
      ...JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
      ...Object.values(fixtureSnapshotNames),
      contractFilename,
    ];
    snapshot = await createJourneyOwnedInputSnapshot({
      directoryPrefix: path.join(
        tmpdir(),
        `clean-pay-provider-${sha256(contract.project).slice(0, 12)}-`,
      ),
      expectedFilenames,
      populate: async ({ directory, writeOwnedFile }) => {
        const generated = buildJourneySyntheticEnvironment({
          appImage: launchContract.images.application,
          appPort: observed.CLEAN_PAY_PORT,
          connectProxyPort: publicationPort(contract.publications.connectProxy, "127.0.0.1"),
          directory,
          migrationImage: launchContract.images.migration,
          project: contract.project,
          providerPort: observed.CLEAN_PAY_BROWSER_PROVIDER_PORT,
          proxyBind: observed.CLEAN_PAY_BROWSER_PROXY_BIND,
          revision: contract.revision,
          turnstileSiteKey: observed.TURNSTILE_SITE_KEY,
        });
        for (const filename of JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES) {
          await writeOwnedFile(filename, generated.files[filename]);
        }
        const fixtureSourceOverrides = {};
        const mountSubset = [];
        for (const [destination, filename] of Object.entries(fixtureSnapshotNames)) {
          const sourcePath = normalizePath(source.bindSources[destination]);
          const fixtureEntry = fixtureBefore.byRealPath.get(sourcePath);
          if (!fixtureEntry) {
            fail("Mounted journey fixture is absent from the global fixture manifest.");
          }
          await writeOwnedFile(filename, fixtureEntry.bytes);
          fixtureSourceOverrides[destination] = path.join(directory, filename);
          mountSubset.push({ destination, sha256: fixtureEntry.sha256 });
        }
        await writeOwnedFile(
          contractFilename,
          `${JSON.stringify(launchContract, null, 2)}\n`,
        );
        const fixtureAfter = await readFreshJourneyFixtureContract(repositoryRoot);
        if (fixtureAfter.sha256 !== fixtureBefore.sha256
          || fixtureAfter.fileContractSha256 !== fixtureBefore.fileContractSha256) {
          fail("Global journey fixture changed while its owned snapshot was created.");
        }
        return Object.freeze({
          fixtureSourceOverrides: Object.freeze(fixtureSourceOverrides),
          generated,
          mountSubset: Object.freeze(mountSubset),
        });
      },
    });
    const { createdFiles, directory, directoryIdentity } = snapshot;
    const { fixtureSourceOverrides, generated, mountSubset } = snapshot.value;
    const snapshotContractPath = path.join(directory, contractFilename);
    const prepared = await prepareJourneyComposeInputs({
      repositoryRoot,
      contractPath: snapshotContractPath,
      contract: launchContract,
      fixtureSourceOverrides,
      runDocker,
    });
    await assertJourneyProjectAbsent(contract.project, runDocker, prepared.queryEnvironment);
    const fixtureMountSubsetContractSha256 = sha256(JSON.stringify(
      [...mountSubset].sort(byDestination),
    ));
    const fixtureBindingContractSha256 = sha256(JSON.stringify({
      globalFixtureContractSha256: fixtureBefore.sha256,
      mountSubsetContractSha256: fixtureMountSubsetContractSha256,
    }));
    const imageProbeOwnershipContractSha256 = sha256(JSON.stringify({
      initialApplication: applicationIdentity.probeOwnershipSha256,
      initialMigration: migrationIdentity.probeOwnershipSha256,
      launchApplication: probeOwnershipSha256(
        contract.project,
        "application",
        probeNonces.launchApplication,
      ),
      launchMigration: probeOwnershipSha256(
        contract.project,
        "migration",
        probeNonces.launchMigration,
      ),
    }));
    const sharedReceipt = {
      composeSourceSha256: prepared.composeSourceSha256,
      applicationImageBindingContractSha256: applicationIdentity.contractSha256,
      fixtureBindingContractSha256,
      fixtureMountSubsetContractSha256,
      fixtureSourceContractSha256: await fixtureHashContract(fixtureSourceOverrides),
      generatedEnvironmentDirectorySha256: sha256(JSON.stringify(directoryIdentity)),
      globalFixtureContractSha256: fixtureBefore.sha256,
      migrationImageBindingContractSha256: migrationIdentity.contractSha256,
      imageProbeOwnershipContractSha256,
      projectSha256: sha256(contract.project),
      roleEnvironmentContractSha256: generated.fileContractSha256,
      roleEnvironmentPolicySha256: generated.policyContractSha256,
      renderedComposeSha256: prepared.renderedComposeSha256,
    };
    const inputReceipt = imageSelectionMode === "classic-config"
      ? Object.freeze({
        applicationImageConfigDigest: applicationIdentity.configDigest,
        composeSourceSha256: sharedReceipt.composeSourceSha256,
        applicationImageBindingContractSha256:
          sharedReceipt.applicationImageBindingContractSha256,
        fixtureBindingContractSha256: sharedReceipt.fixtureBindingContractSha256,
        fixtureMountSubsetContractSha256: sharedReceipt.fixtureMountSubsetContractSha256,
        fixtureSourceContractSha256: sharedReceipt.fixtureSourceContractSha256,
        generatedEnvironmentDirectorySha256:
          sharedReceipt.generatedEnvironmentDirectorySha256,
        globalFixtureContractSha256: sharedReceipt.globalFixtureContractSha256,
        migrationImageBindingContractSha256:
          sharedReceipt.migrationImageBindingContractSha256,
        migrationImageConfigDigest: migrationIdentity.configDigest,
        imageProbeOwnershipContractSha256:
          sharedReceipt.imageProbeOwnershipContractSha256,
        projectSha256: sharedReceipt.projectSha256,
        roleEnvironmentContractSha256: sharedReceipt.roleEnvironmentContractSha256,
        roleEnvironmentPolicySha256: sharedReceipt.roleEnvironmentPolicySha256,
        renderedComposeSha256: sharedReceipt.renderedComposeSha256,
      })
      : Object.freeze({
        applicationImageConfigDigest: applicationIdentity.configDigest,
        applicationImageRuntimeDigest,
        applicationImageManifestDigest: applicationIdentity.manifestDigest,
        composeSourceSha256: sharedReceipt.composeSourceSha256,
        applicationImageBindingContractSha256:
          sharedReceipt.applicationImageBindingContractSha256,
        fixtureBindingContractSha256: sharedReceipt.fixtureBindingContractSha256,
        fixtureMountSubsetContractSha256: sharedReceipt.fixtureMountSubsetContractSha256,
        fixtureSourceContractSha256: sharedReceipt.fixtureSourceContractSha256,
        generatedEnvironmentDirectorySha256:
          sharedReceipt.generatedEnvironmentDirectorySha256,
        globalFixtureContractSha256: sharedReceipt.globalFixtureContractSha256,
        migrationImageBindingContractSha256:
          sharedReceipt.migrationImageBindingContractSha256,
        migrationImageRuntimeDigest,
        migrationImageManifestDigest: migrationIdentity.manifestDigest,
        imageProbeOwnershipContractSha256:
          sharedReceipt.imageProbeOwnershipContractSha256,
        imageSelectionMode,
        projectSha256: sharedReceipt.projectSha256,
        roleEnvironmentContractSha256: sharedReceipt.roleEnvironmentContractSha256,
        roleEnvironmentPolicySha256: sharedReceipt.roleEnvironmentPolicySha256,
        renderedComposeSha256: sharedReceipt.renderedComposeSha256,
      });
    const handle = Object.freeze({
      contract: launchContract,
      contractPath: snapshotContractPath,
      createdFiles: Object.freeze({ ...createdFiles }),
      directory,
      directoryIdentity,
      expectedApplicationAssetImageDigest,
      expectedApplicationImageConfigDigest,
      ...(imageSelectionMode === "containerd-root-manifest" ? {
        expectedApplicationManifestDigest: applicationIdentity.manifestDigest,
        expectedApplicationRuntimeImageDigest: applicationImageRuntimeDigest,
        expectedImageSelectionMode: imageSelectionMode,
        expectedMigrationManifestDigest: migrationIdentity.manifestDigest,
      } : {}),
      expectedApplicationRepoDigests: Object.freeze([...expectedApplicationRepoDigests]),
      expectedImagePlatform: imagePlatform,
      expectedMigrationAssetImageDigest,
      expectedMigrationRuntimeImageDigest: migrationImageRuntimeDigest,
      fixtureSourceOverrides: Object.freeze({ ...fixtureSourceOverrides }),
      inputReceipt,
      prepared,
      probeNonces,
      repositoryRoot,
      runDocker,
      sourceContract: Object.freeze({
        images: Object.freeze({
          application: contract.images.application,
          migration: contract.images.migration,
        }),
        project: contract.project,
      }),
    });
    preparedHandles.add(handle);
    return handle;
  } catch (error) {
    if (snapshot === undefined) throw error;
    try {
      await cleanupExactDirectory(
        snapshot.directory,
        snapshot.directoryIdentity,
        snapshot.createdFiles,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Owned journey preparation and exact cleanup both failed.",
      );
    }
    throw error;
  }
}

export async function prepareJourneyOwnedStackLaunch(handle) {
  assertHandle(handle);
  if (startedHandles.has(handle) || cleanedHandles.has(handle)
    || launchPreparedHandles.has(handle)) {
    fail("Owned journey stack handle is not startable exactly once.");
  }
  launchPreparedHandles.add(handle);
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
  await assertPreparedInputsUnchanged(handle, current);
  const identitySettlements = await Promise.allSettled([
    deriveJourneyApplicationImageConfigDigest({
      contract: handle.sourceContract,
      environment: handle.prepared.queryEnvironment,
      expectedApplicationAssetImageDigest: handle.expectedApplicationAssetImageDigest,
      expectedApplicationImageConfigDigest: handle.expectedApplicationImageConfigDigest,
      ...(handle.expectedApplicationManifestDigest === undefined
        ? {}
        : { expectedApplicationManifestDigest: handle.expectedApplicationManifestDigest }),
      expectedApplicationRepoDigests: handle.expectedApplicationRepoDigests,
      expectedImagePlatform: handle.expectedImagePlatform,
      probeNonce: handle.probeNonces.launchApplication,
      runDocker: handle.runDocker,
    }),
    deriveJourneyMigrationImageConfigDigest({
      contract: handle.sourceContract,
      environment: handle.prepared.queryEnvironment,
      expectedMigrationAssetImageDigest: handle.expectedMigrationAssetImageDigest,
      expectedImagePlatform: handle.expectedImagePlatform,
      ...(handle.expectedMigrationManifestDigest === undefined
        ? {}
        : { expectedMigrationManifestDigest: handle.expectedMigrationManifestDigest }),
      probeNonce: handle.probeNonces.launchMigration,
      runDocker: handle.runDocker,
    }),
  ]);
  if (identitySettlements.some(({ status }) => status === "rejected")) {
    fail("Both verifier-owned image rechecks must settle before cleanup.");
  }
  const identities = [];
  for (const result of identitySettlements) {
    if (result.status === "fulfilled") identities.push(result.value);
  }
  if (identities.length !== 2) fail("Verifier-owned image recheck ledger is incomplete.");
  const [applicationIdentity, migrationIdentity] = identities;
  const currentImageSelectionMode = assertCompatibleImageSelection(
    applicationIdentity,
    migrationIdentity,
  );
  if (applicationIdentity.contractSha256
      !== handle.inputReceipt.applicationImageBindingContractSha256
    || migrationIdentity.contractSha256
      !== handle.inputReceipt.migrationImageBindingContractSha256
    || runtimeImageDigestOf(applicationIdentity)
      !== (handle.expectedApplicationRuntimeImageDigest
        ?? handle.expectedApplicationImageConfigDigest)
    || runtimeImageDigestOf(migrationIdentity) !== handle.expectedMigrationRuntimeImageDigest
    || imageSelectionModeOf(applicationIdentity)
      !== (handle.expectedImageSelectionMode ?? "classic-config")
    || imageSelectionModeOf(migrationIdentity)
      !== (handle.expectedImageSelectionMode ?? "classic-config")
    || currentImageSelectionMode !== (handle.expectedImageSelectionMode ?? "classic-config")
    || handle.inputReceipt.imageProbeOwnershipContractSha256 !== sha256(JSON.stringify({
      initialApplication: probeOwnershipSha256(
        handle.sourceContract.project,
        "application",
        handle.probeNonces.initialApplication,
      ),
      initialMigration: probeOwnershipSha256(
        handle.sourceContract.project,
        "migration",
        handle.probeNonces.initialMigration,
      ),
      launchApplication: applicationIdentity.probeOwnershipSha256,
      launchMigration: migrationIdentity.probeOwnershipSha256,
    }))) {
    fail("Verifier-owned image reference changed after its pre-start receipt.");
  }
  return Object.freeze({
    args: Object.freeze([
      "compose",
      "--project-name", handle.contract.project,
      "--env-file", handle.prepared.authoritativeEnvironmentPath,
      ...handle.prepared.composeFiles.flatMap((file) => ["--file", file]),
      "up", "--detach", "--no-build", "--wait", "--wait-timeout", "240",
    ]),
    environment: handle.prepared.queryEnvironment,
    handle,
    projectSha256: sha256(handle.contract.project),
  });
}

export async function dispatchJourneyOwnedStackPair(handles, plans) {
  if (!Array.isArray(handles) || !Array.isArray(plans)
    || handles.length !== 2 || plans.length !== 2
    || plans.some((plan, index) => plan.handle !== handles[index])) {
    fail("Verifier-owned pair launch plans are invalid or crossed.");
  }
  const inputReceiptContractSha256s = handles.map(({ inputReceipt }) => (
    sha256(JSON.stringify(inputReceipt))
  ));
  const barrierSha256 = sha256(JSON.stringify({
    inputReceiptContractSha256s,
    projects: plans.map(({ projectSha256 }) => projectSha256),
    version: 1,
  }));
  const lifecycleNotBefore = new Date().toISOString();
  const dispatches = [];
  const operations = plans.map((plan, ordinal) => {
    lifecycleBounds.set(plan.handle, lifecycleNotBefore);
    dispatches.push(Object.freeze({
      barrierSha256,
      ordinal,
      projectSha256: plan.projectSha256,
    }));
    // No await occurs in this map: both Compose processes are dispatched from
    // the same JavaScript turn after both immutable plans crossed the barrier.
    return plan.handle.runDocker(
      [...plan.args],
      64 * 1024,
      plan.environment,
    );
  });
  if (dispatches.length !== 2) fail("Verifier-owned pair dispatch ledger is incomplete.");
  const starts = await Promise.allSettled(operations);
  starts.forEach((start, index) => {
    if (start.status === "fulfilled") startedHandles.add(handles[index]);
  });
  if (starts.some(({ status }) => status === "rejected")) {
    fail("Both verifier-owned stacks must start from one completed launch barrier.");
  }
  return Object.freeze({
    barrierSha256,
    dispatches: Object.freeze(dispatches),
    inputReceiptContractSha256s: Object.freeze(inputReceiptContractSha256s),
    lifecycleNotBefore,
    status: "dual-compose-up-dispatched-after-shared-barrier",
  });
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
    expectedApplicationAssetImageDigest: handle.expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest: handle.expectedApplicationImageConfigDigest,
    ...(handle.expectedImageSelectionMode === undefined ? {} : {
      expectedApplicationManifestDigest: handle.expectedApplicationManifestDigest,
      expectedApplicationRuntimeImageDigest: handle.expectedApplicationRuntimeImageDigest,
      expectedImageSelectionMode: handle.expectedImageSelectionMode,
      expectedMigrationManifestDigest: handle.expectedMigrationManifestDigest,
    }),
    expectedApplicationReference: handle.sourceContract.images.application,
    expectedApplicationRepoDigests: handle.expectedApplicationRepoDigests,
    expectedImagePlatform: handle.expectedImagePlatform,
    expectedMigrationAssetImageDigest: handle.expectedMigrationAssetImageDigest,
    expectedMigrationReference: handle.sourceContract.images.migration,
    expectedMigrationRuntimeImageDigest: handle.expectedMigrationRuntimeImageDigest,
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
    await assertPreparedInputsUnchanged(handle, current);
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
  await cleanupExactDirectory(
    handle.directory,
    handle.directoryIdentity,
    handle.createdFiles,
  );
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

export async function deriveJourneyApplicationImageConfigDigest({
  contract,
  environment,
  expectedApplicationAssetImageDigest,
  expectedApplicationImageConfigDigest,
  expectedApplicationManifestDigest = optionalInputValue,
  expectedApplicationRepoDigests,
  expectedImagePlatform = optionalInputValue,
  probeNonce,
  runDocker,
}) {
  exactOptionalKeys(arguments[0], [
    "contract",
    "environment",
    "expectedApplicationAssetImageDigest",
    "expectedApplicationImageConfigDigest",
    "expectedApplicationRepoDigests",
    "probeNonce",
    "runDocker",
  ], ["expectedApplicationManifestDigest", "expectedImagePlatform"]);
  return deriveJourneyImageConfigDigest({
    contract,
    environment,
    expectedAssetImageDigest: expectedApplicationAssetImageDigest,
    expectedConfigDigest: expectedApplicationImageConfigDigest,
    expectedManifestDigest: expectedApplicationManifestDigest,
    expectedRepoDigests: expectedApplicationRepoDigests,
    expectedImagePlatform: expectedImagePlatform === undefined
      ? defaultImagePlatform
      : expectedImagePlatform,
    probeNonce,
    role: "application",
    runDocker,
  });
}

export async function deriveJourneyMigrationImageConfigDigest({
  contract,
  environment,
  expectedMigrationAssetImageDigest,
  expectedMigrationManifestDigest = optionalInputValue,
  expectedImagePlatform = optionalInputValue,
  probeNonce,
  runDocker,
}) {
  exactOptionalKeys(arguments[0], [
    "contract", "environment", "expectedMigrationAssetImageDigest", "probeNonce", "runDocker",
  ], ["expectedImagePlatform", "expectedMigrationManifestDigest"]);
  return deriveJourneyImageConfigDigest({
    contract,
    environment,
    expectedAssetImageDigest: expectedMigrationAssetImageDigest,
    expectedConfigDigest: undefined,
    expectedManifestDigest: expectedMigrationManifestDigest,
    expectedRepoDigests: [expectedMigrationAssetImageDigest],
    expectedImagePlatform: expectedImagePlatform === undefined
      ? defaultImagePlatform
      : expectedImagePlatform,
    probeNonce,
    role: "migration",
    runDocker,
  });
}

async function deriveJourneyImageConfigDigest({
  contract,
  environment,
  expectedAssetImageDigest,
  expectedConfigDigest,
  expectedManifestDigest,
  expectedRepoDigests,
  expectedImagePlatform,
  probeNonce,
  role,
  runDocker,
}) {
  if (typeof runDocker !== "function"
    || !["application", "migration"].includes(role)
    || !/^[a-f0-9]{32}$/.test(probeNonce ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(expectedAssetImageDigest ?? "")
    || (expectedConfigDigest !== undefined
      && !/^sha256:[a-f0-9]{64}$/.test(expectedConfigDigest))
    || (expectedManifestDigest !== undefined
      && !/^sha256:[a-f0-9]{64}$/.test(expectedManifestDigest))) {
    fail("Verifier-owned image derivation input is invalid.");
  }
  const imagePlatform = exactImagePlatform(expectedImagePlatform, `${role} expected image platform`);
  const repoDigests = exactDigestList(expectedRepoDigests, `${role} repository digest set`);
  if (!repoDigests.includes(expectedAssetImageDigest)) {
    fail("Verifier-owned image repository set omits its OCI root digest.");
  }
  const reference = contract?.images?.[role];
  if (typeof reference !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/.test(reference)) {
    fail("Verifier-owned image derivation reference is invalid.");
  }
  assertAssetRootInspection(
    parseSingleInspection(
      await runDocker(["image", "inspect", reference], 512 * 1024, environment),
      `${role} image`,
    ),
    expectedAssetImageDigest,
    reference,
    `${role} image reference`,
  );

  const projectSha256 = sha256(contract.project);
  const probeName = `clean-pay-${role}-config-${projectSha256.slice(0, 12)}-${probeNonce}`;
  const probeOwner = `${projectSha256}:${role}:${probeNonce}`;
  const probeLabel = `io.clean-pay.verifier-probe=${probeOwner}`;
  const filter = `label=${probeLabel}`;
  const absentBefore = splitLines(await runDocker([
    "ps", "--all", "--no-trunc", "--quiet", "--filter", filter,
    "--filter", `name=^/${probeName}$`,
  ], 4 * 1024, environment));
  if (absentBefore.length !== 0) fail("Verifier-owned config probe name is not unique.");

  let probeId;
  let probeIdentity;
  let probeSelectionVerified = false;
  let derivationError;
  try {
    let created;
    try {
      created = splitLines(await runDocker([
        "container", "create",
        "--name", probeName,
        "--label", probeLabel,
        "--entrypoint", "/bin/true",
        reference,
      ], 4 * 1024, environment));
    } catch (createError) {
      let recoveryError;
      try {
        const recovered = splitLines(await runDocker([
          "ps", "--all", "--no-trunc", "--quiet", "--filter", filter,
          "--filter", `name=^/${probeName}$`,
        ], 4 * 1024, environment));
        if (recovered.length > 1
          || (recovered.length === 1 && !/^[a-f0-9]{64}$/.test(recovered[0]))) {
          fail("Verifier-owned config probe recovery returned an invalid identity set.");
        }
        if (recovered.length === 1) probeId = recovered[0];
      } catch (error) {
        recoveryError = error;
      }
      if (recoveryError !== undefined) {
        throw new AggregateError(
          [createError, recoveryError],
          "Config probe creation and exact side-effect recovery both failed.",
        );
      }
      throw createError;
    }
    if (created.length !== 1 || !/^[a-f0-9]{64}$/.test(created[0])) {
      const recovered = splitLines(await runDocker([
        "ps", "--all", "--no-trunc", "--quiet", "--filter", filter,
        "--filter", `name=^/${probeName}$`,
      ], 4 * 1024, environment));
      if (recovered.length === 1 && /^[a-f0-9]{64}$/.test(recovered[0])) {
        probeId = recovered[0];
      }
      fail("Verifier-owned config probe creation did not return one exact identity.");
    }
    probeId = created[0];
    const probe = parseSingleInspection(
      await runDocker(["container", "inspect", probeId], 256 * 1024, environment),
      `${role} config probe`,
    );
    probeIdentity = assertImageConfigProbe(probe, {
      expectedAssetImageDigest,
      expectedManifestDigest,
      expectedImagePlatform: imagePlatform,
      probeId,
      probeName,
      probeOwner,
      reference,
      role,
    });
    if (imageSelectionModeOf(probeIdentity) === "classic-config"
      && expectedConfigDigest !== undefined
      && probeIdentity.configDigest !== expectedConfigDigest) {
      fail(`${role} probe selected a config outside its asset attestation.`);
    }
    if (imageSelectionModeOf(probeIdentity) === containerdImageSelectionMode
      && role === "application"
      && (expectedConfigDigest === undefined
        || expectedConfigDigest === expectedAssetImageDigest
        || expectedConfigDigest === probeIdentity.manifestDigest)) {
      fail("Application containerd config attestation is absent or aliases a runtime image digest.");
    }
    const selectedRuntimeImageDigest = runtimeImageDigestOf(probeIdentity);
    const selectedConfigInspection = parseSingleInspection(
        await runDocker([
          "image", "inspect", selectedRuntimeImageDigest,
        ], 512 * 1024, environment),
        `${role} selected runtime image`,
      );
    if (selectedConfigInspection.Id !== selectedRuntimeImageDigest) {
      fail(`${role} selected runtime inspection returned a different image ID.`);
    }
    assertAssetRootInspection(
      selectedConfigInspection,
      expectedAssetImageDigest,
      reference,
      `${role} selected runtime image`,
      {
        requireContainerdRootDescriptor: imageSelectionModeOf(probeIdentity)
          === containerdImageSelectionMode,
        selectedManifestDigest: probeIdentity.manifestDigest,
      },
    );
    const referenceRecheck = parseSingleInspection(
        await runDocker(["image", "inspect", reference], 512 * 1024, environment),
        `${role} image reference recheck`,
      );
    assertAssetRootInspection(
      referenceRecheck,
      expectedAssetImageDigest,
      reference,
      `${role} image reference recheck`,
      {
        requireContainerdRootDescriptor: imageSelectionModeOf(probeIdentity)
          === containerdImageSelectionMode,
        selectedManifestDigest: probeIdentity.manifestDigest,
      },
    );
    probeSelectionVerified = true;
  } catch (error) {
    derivationError = error;
  }
  let cleanupError;
  if (probeId !== undefined) {
    try {
      const current = parseSingleInspection(
        await runDocker(["container", "inspect", probeId], 256 * 1024, environment),
        `${role} config probe cleanup`,
      );
      const cleanupExpectation = {
        expectedAssetImageDigest,
        expectedManifestDigest,
        expectedImagePlatform: imagePlatform,
        probeId,
        probeName,
        probeOwner,
        reference,
        role,
      };
      assertImageProbeOwnership(current, cleanupExpectation);
      if (probeSelectionVerified) {
        const currentIdentity = assertImageConfigProbe(current, cleanupExpectation);
        if (selectionContractSha256(currentIdentity)
            !== selectionContractSha256(probeIdentity)) {
          fail(`${role} config probe selection changed before exact cleanup.`);
        }
      }
      const removed = splitLines(await runDocker([
        "container", "rm", probeId,
      ], 4 * 1024, environment));
      if (removed.length !== 1 || !new Set([probeId, probeName]).has(removed[0])) {
        fail("Verifier-owned config probe exact cleanup did not identify its container.");
      }
      const absentAfter = splitLines(await runDocker([
        "ps", "--all", "--no-trunc", "--quiet", "--filter", filter,
        "--filter", `name=^/${probeName}$`,
      ], 4 * 1024, environment));
      if (absentAfter.length !== 0) fail("Verifier-owned config probe survived exact cleanup.");
    } catch (error) {
      cleanupError = error;
    }
  }
  if (derivationError !== undefined) {
    if (cleanupError !== undefined) {
      throw new AggregateError(
        [derivationError, cleanupError],
        "Image config derivation and exact probe cleanup both failed.",
      );
    }
    throw derivationError;
  }
  if (cleanupError !== undefined) throw cleanupError;
  if (probeIdentity === undefined) fail("Image probe did not yield one selected runtime identity.");
  const binding = imageSelectionModeOf(probeIdentity) === "classic-config"
    ? {
      assetImageDigest: expectedAssetImageDigest,
      configDigest: probeIdentity.configDigest,
      referenceSha256: sha256(reference),
      repoDigests,
      role,
    }
    : {
      assetImageDigest: expectedAssetImageDigest,
      ...(expectedConfigDigest === undefined ? {} : { configDigest: expectedConfigDigest }),
      imageSelectionMode: probeIdentity.imageSelectionMode,
      manifestDigest: probeIdentity.manifestDigest,
      referenceSha256: sha256(reference),
      repoDigests,
      role,
      runtimeImageDigest: probeIdentity.runtimeImageDigest,
    };
  return Object.freeze({
    ...binding,
    contractSha256: sha256(JSON.stringify(binding)),
    probeOwnershipSha256: sha256(probeOwner),
    status: imageSelectionModeOf(probeIdentity) === "classic-config"
      ? "verifier-owned-unstarted-config-probe-cleaned"
      : "verifier-owned-unstarted-root-manifest-probe-cleaned",
  });
}

export async function attestJourneyOwnedStackPairCoexistence(handles) {
  if (!Array.isArray(handles) || handles.length !== 2) {
    fail("Verifier-owned coexistence handle set is invalid.");
  }
  const rawContainerIdentities = new Set();
  const observations = await Promise.all(handles.map(async (handle) => {
    assertHandle(handle);
    if (!startedHandles.has(handle) || cleanedHandles.has(handle)) {
      fail("Verifier-owned coexistence requires two started live stacks.");
    }
    const output = await handle.runDocker([
      "ps", "--all", "--no-trunc", "--quiet",
      "--filter", `label=com.docker.compose.project=${handle.contract.project}`,
    ], 4 * 1024, handle.prepared.queryEnvironment);
    const identities = splitLines(output);
    if (identities.length !== JOURNEY_COMPOSE_SERVICE_NAMES.length
      || new Set(identities).size !== identities.length
      || identities.some((identity) => !/^[a-f0-9]{64}$/.test(identity))) {
      fail("Verifier-owned coexistence container set is incomplete or invalid.");
    }
    for (const identity of identities) {
      if (rawContainerIdentities.has(identity)) {
        fail("Verifier-owned coexistence reused a container across projects.");
      }
      rawContainerIdentities.add(identity);
    }
    const services = await Promise.all(identities.map(async (identity) => {
      const container = parseSingleInspection(
        await handle.runDocker([
          "container", "inspect", identity,
        ], 256 * 1024, handle.prepared.queryEnvironment),
        "coexisting project container",
      );
      const service = container?.Config?.Labels?.["com.docker.compose.service"];
      if (container?.Id !== identity
        || container?.Config?.Labels?.["com.docker.compose.project"]
          !== handle.contract.project
        || !JOURNEY_COMPOSE_SERVICE_NAMES.includes(service)
        || container?.Name !== `/${handle.contract.project}-${service}-1`
        || Number(container?.RestartCount ?? 0) !== 0) {
        fail("Coexisting project container ownership or identity is invalid.");
      }
      const expectedState = JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[service];
      let state;
      if (expectedState === "exited-zero") {
        if (container?.State?.Status !== "exited" || container?.State?.Running !== false
          || Number(container?.State?.ExitCode) !== 0) {
          fail("Coexisting one-shot service state is invalid.");
        }
        state = "exited-zero";
      } else {
        if (container?.State?.Status !== "running" || container?.State?.Running !== true
          || (expectedState === "running-healthy"
            && container?.State?.Health?.Status !== "healthy")
          || !["running", "running-healthy"].includes(expectedState)) {
          fail("Coexisting long-running service state or health is invalid.");
        }
        state = expectedState;
      }
      return Object.freeze({
        containerIdSha256: sha256(identity),
        service,
        state,
      });
    }));
    services.sort((left, right) => left.service.localeCompare(right.service));
    if (new Set(services.map(({ service }) => service)).size !== services.length
      || JSON.stringify(services.map(({ service }) => service))
        !== JSON.stringify([...JOURNEY_COMPOSE_SERVICE_NAMES].sort())) {
      fail("Coexisting project service set is incomplete or duplicated.");
    }
    return Object.freeze({
      containerSetSha256: sha256(JSON.stringify(services)),
      projectSha256: sha256(handle.contract.project),
      serviceCount: services.length,
      services: Object.freeze(services),
    });
  }));
  if (observations[0].projectSha256 === observations[1].projectSha256
    || observations[0].containerSetSha256 === observations[1].containerSetSha256
    || rawContainerIdentities.size !== JOURNEY_COMPOSE_SERVICE_NAMES.length * 2) {
    fail("Verifier-owned coexistence stacks are not identity-distinct.");
  }
  return Object.freeze({
    observations: Object.freeze(observations),
    status: "both-project-container-sets-coexisted",
  });
}

function probeOwnershipSha256(project, role, probeNonce) {
  if (typeof project !== "string" || project.length < 1
    || !["application", "migration"].includes(role)
    || !/^[a-f0-9]{32}$/.test(probeNonce ?? "")) {
    fail("Verifier-owned probe ownership binding is invalid.");
  }
  return sha256(`${sha256(project)}:${role}:${probeNonce}`);
}

function assertDistinctPairInputs(baseline, candidate) {
  for (const input of [baseline, candidate]) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      fail("Owned stack pair input is invalid.");
    }
  }
  if (baseline.contract?.project === candidate.contract?.project
    || baseline.contractPath === candidate.contractPath
    || baseline.expectedApplicationAssetImageDigest
      === candidate.expectedApplicationAssetImageDigest
    || baseline.expectedApplicationImageConfigDigest
      === candidate.expectedApplicationImageConfigDigest
    || baseline.expectedMigrationAssetImageDigest
      === candidate.expectedMigrationAssetImageDigest) {
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

async function assertPreparedInputsUnchanged(handle, current) {
  const fixture = await readFreshJourneyFixtureContract(handle.repositoryRoot);
  const fixtureMountSubsetContractSha256 = await fixtureHashContract(
    handle.fixtureSourceOverrides,
  );
  const fixtureBindingContractSha256 = sha256(JSON.stringify({
    globalFixtureContractSha256: fixture.sha256,
    mountSubsetContractSha256: fixtureMountSubsetContractSha256,
  }));
  if (current.composeSourceSha256 !== handle.inputReceipt.composeSourceSha256
    || current.renderedComposeSha256 !== handle.inputReceipt.renderedComposeSha256
    || fixture.sha256 !== handle.inputReceipt.globalFixtureContractSha256
    || fixtureMountSubsetContractSha256
      !== handle.inputReceipt.fixtureMountSubsetContractSha256
    || fixtureMountSubsetContractSha256 !== handle.inputReceipt.fixtureSourceContractSha256
    || fixtureBindingContractSha256 !== handle.inputReceipt.fixtureBindingContractSha256
    || current.syntheticEnvironment.fileContractSha256
      !== handle.inputReceipt.roleEnvironmentContractSha256
    || current.syntheticEnvironment.policyContractSha256
      !== handle.inputReceipt.roleEnvironmentPolicySha256) {
    fail("Owned journey inputs changed after their pre-start receipt.");
  }
}

async function assertOwnedInputsUnchanged(handle) {
  const current = await prepareJourneyComposeInputs({
    repositoryRoot: handle.repositoryRoot,
    contractPath: handle.contractPath,
    contract: handle.contract,
    fixtureSourceOverrides: handle.fixtureSourceOverrides,
    runDocker: handle.runDocker,
  });
  await assertPreparedInputsUnchanged(handle, current);
}

async function inspectOwnedResources(project, runDocker, environment) {
  const filter = `label=com.docker.compose.project=${project}`;
  const [containers, networks, volumes] = await Promise.all([
    runDocker(["ps", "--all", "--no-trunc", "--quiet", "--filter", filter], 4 * 1024, environment),
    runDocker(["network", "ls", "--no-trunc", "--quiet", "--filter", filter], 4 * 1024, environment),
    runDocker(["volume", "ls", "--quiet", "--filter", filter], 4 * 1024, environment),
  ]);
  const groups = {
    container: splitLines(containers),
    network: splitLines(networks),
    volume: splitLines(volumes),
  };
  const observedServices = new Set();
  const observedNetworks = new Set();
  const observedVolumes = new Set();
  let count = 0;
  for (const [kind, identities] of Object.entries(groups)) {
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

async function privateWrite(target, bytes, operations = ownedFileSystemOperations) {
  await operations.writeFile(target, bytes, { flag: "wx", mode: 0o600 });
  await enforceJourneySyntheticPrivateMode(target, 0o600, {
    chmodPath: operations.chmod,
    lstatPath: operations.lstat,
  });
  const identity = await captureOwnedPathIdentity(target, "file", operations);
  if (identity.sha256 !== sha256(bytes)) fail("Owned input bytes changed after create-only write.");
  return identity;
}

async function cleanupPartiallyCreatedDirectory(
  directory,
  directoryIdentity,
  begunFiles,
  createdFiles,
  operations,
) {
  const recoveredDirectoryIdentity = directoryIdentity
    ?? await captureOwnedPathIdentity(directory, "directory", operations);
  await assertOwnedPathIdentity(directory, recoveredDirectoryIdentity, operations);
  const observed = (await operations.readdir(directory)).sort();
  if (observed.some((filename) => !begunFiles.has(filename))
    || Object.keys(createdFiles).some((filename) => !observed.includes(filename))) {
    fail("Owned partial input cleanup found an unexpected exact entry.");
  }
  const recoveredFiles = {};
  for (const filename of observed) {
    const target = path.join(directory, filename);
    const expected = createdFiles[filename];
    recoveredFiles[filename] = expected === undefined
      ? await captureOwnedPathIdentity(target, "file", operations)
      : await assertOwnedPathIdentity(target, expected, operations);
  }
  await cleanupExactDirectory(
    directory,
    recoveredDirectoryIdentity,
    recoveredFiles,
    operations,
  );
}

async function cleanupExactDirectory(
  directory,
  directoryIdentity,
  createdFiles,
  operations = ownedFileSystemOperations,
) {
  await assertOwnedPathIdentity(directory, directoryIdentity, operations);
  const expected = Object.keys(createdFiles).sort();
  const observed = (await operations.readdir(directory)).sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail("Owned input snapshot cleanup found an unexpected or missing exact entry.");
  }
  // Validate the complete directory before the first unlink. A missing,
  // substituted, linked, or recreated known file leaves every known file in
  // place for fail-closed diagnosis.
  await Promise.all(expected.map((filename) => assertOwnedPathIdentity(
    path.join(directory, filename),
    createdFiles[filename],
    operations,
  )));
  for (const filename of expected) {
    const target = path.join(directory, filename);
    await assertOwnedPathIdentity(target, createdFiles[filename], operations);
    await operations.unlink(target);
  }
  await assertOwnedPathIdentity(directory, directoryIdentity, operations);
  if ((await operations.readdir(directory)).length !== 0) {
    fail("Owned input snapshot directory changed during exact cleanup.");
  }
  await operations.rmdir(directory);
}

async function readBoundedRegularFile(target, maximumBytes) {
  return (await readStableRegularFile(target, maximumBytes)).bytes;
}

async function readFreshJourneyFixtureContract(repositoryRoot) {
  const root = await realpath(repositoryRoot);
  const fixtureDirectory = path.join(root, "tests", "browser", "journeys");
  const entries = [];
  const byRealPath = new Map();
  const contractHash = createHash("sha256");
  contractHash.update(`${JOURNEY_FIXTURE_CONTRACT_DOMAIN}\0`, "utf8");
  for (const filename of JOURNEY_FIXTURE_FILENAMES) {
    const requested = path.resolve(fixtureDirectory, filename);
    if (!isWithin(root, requested)) fail("Global fixture manifest path escaped the repository.");
    const stable = await readStableRegularFile(requested, 32 * 1024 * 1024);
    if (!isWithin(root, stable.identity.normalizedRealPath)
      || normalizePath(requested) !== stable.identity.normalizedRealPath) {
      fail("Global fixture manifest path is linked or outside the repository.");
    }
    contractHash.update(`${filename}\0${stable.bytes.byteLength}\0`, "utf8");
    contractHash.update(stable.bytes);
    const entry = Object.freeze({
      bytes: stable.bytes,
      filename,
      identity: stable.identity,
      sha256: stable.identity.sha256,
    });
    entries.push(entry);
    byRealPath.set(stable.identity.normalizedRealPath, entry);
  }
  // Re-read identities after the whole ordered byte stream was consumed so a
  // file changed later in the pass cannot yield a mixed manifest snapshot.
  for (const entry of entries) {
    await assertOwnedPathIdentity(
      path.resolve(fixtureDirectory, entry.filename),
      entry.identity,
    );
  }
  const fileContractSha256 = sha256(JSON.stringify(entries.map(({ filename, sha256: digest }) => ({
    filename,
    sha256: digest,
  }))));
  return Object.freeze({
    byRealPath,
    fileContractSha256,
    sha256: contractHash.digest("hex"),
  });
}

async function readStableRegularFile(target, maximumBytes) {
  const before = await captureOwnedPathIdentity(target, "file");
  if (before.size <= 0 || before.size > maximumBytes) {
    fail("Owned input source is outside its bounded regular-file contract.");
  }
  const bytes = await readFile(target);
  const after = await captureOwnedPathIdentity(target, "file");
  if (bytes.byteLength !== before.size || bytes.byteLength > maximumBytes
    || JSON.stringify(after) !== JSON.stringify(before)
    || sha256(bytes) !== before.sha256) {
    fail("Owned input source changed while being read.");
  }
  return Object.freeze({ bytes, identity: before });
}

async function captureOwnedPathIdentity(
  target,
  kind,
  operations = ownedFileSystemOperations,
) {
  const requested = path.resolve(target);
  const requestedDetails = await operations.lstat(requested, { bigint: true });
  const resolved = await operations.realpath(requested);
  const resolvedDetails = await operations.lstat(resolved, { bigint: true });
  const typeMatches = kind === "directory"
    ? requestedDetails.isDirectory() && resolvedDetails.isDirectory()
    : requestedDetails.isFile() && resolvedDetails.isFile();
  if (!typeMatches || requestedDetails.isSymbolicLink()
    || normalizePath(requested) !== normalizePath(resolved)
    || requestedDetails.dev !== resolvedDetails.dev
    || requestedDetails.ino !== resolvedDetails.ino) {
    fail("Owned path identity is linked, substituted, or has the wrong type.");
  }
  const identity = {
    device: String(resolvedDetails.dev),
    inode: String(resolvedDetails.ino),
    kind,
    modifiedNanoseconds: undefined,
    normalizedRealPath: normalizePath(resolved),
    sha256: undefined,
    size: undefined,
  };
  if (kind === "file") {
    const size = Number(resolvedDetails.size);
    if (!Number.isSafeInteger(size) || size < 0 || size > 32 * 1024 * 1024) {
      fail("Owned file size is invalid.");
    }
    identity.size = size;
    identity.modifiedNanoseconds = String(resolvedDetails.mtimeNs);
    identity.sha256 = sha256(await operations.readFile(resolved));
  }
  return Object.freeze(identity);
}

async function assertOwnedPathIdentity(
  target,
  expected,
  operations = ownedFileSystemOperations,
) {
  const observed = await captureOwnedPathIdentity(target, expected.kind, operations);
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    fail("Owned path device, inode, realpath, type, size, or bytes changed.");
  }
  return observed;
}

function publicationPort(publication, host) {
  const match = new RegExp(`^${host.replaceAll(".", "\\.")}:(?<port>\\d{4,5})$`).exec(publication ?? "");
  if (!match || String(Number(match.groups.port)) !== match.groups.port
    || Number(match.groups.port) > 65_535) fail("Owned stack publication is invalid.");
  return match.groups.port;
}

function createImmutableLaunchContract(contract, applicationRuntimeDigest, migrationRuntimeDigest) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)
    || !/^sha256:[a-f0-9]{64}$/.test(applicationRuntimeDigest)
    || !/^sha256:[a-f0-9]{64}$/.test(migrationRuntimeDigest)
    || applicationRuntimeDigest === migrationRuntimeDigest) {
    fail("Immutable launch contract image identities are invalid.");
  }
  return Object.freeze({
    ...contract,
    images: Object.freeze({
      ...contract.images,
      application: applicationRuntimeDigest,
      migration: migrationRuntimeDigest,
    }),
  });
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

function parseSingleInspection(value, label) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || parsed.length !== 1
    || !parsed[0] || typeof parsed[0] !== "object" || Array.isArray(parsed[0])) {
    fail(`${label} inspection is invalid.`);
  }
  return parsed[0];
}

function assertImageConfigProbe(probe, expected) {
  const selectedImageDigest = assertImageProbeOwnership(probe, expected);
  const descriptorPresent = Object.hasOwn(probe, "ImageManifestDescriptor");
  if (!descriptorPresent) {
    if (selectedImageDigest === expected.expectedAssetImageDigest
      || (expected.role === "migration" && expected.expectedManifestDigest !== undefined)) {
      fail(`${expected.role} OCI root selection has no exact platform manifest descriptor.`);
    }
    return Object.freeze({ configDigest: selectedImageDigest });
  }
  const manifestDescriptor = exactImageManifestDescriptor(
    probe.ImageManifestDescriptor,
    `${expected.role} config probe platform manifest`,
    expected.expectedImagePlatform,
  );
  if (selectedImageDigest !== expected.expectedAssetImageDigest) {
    fail(`${expected.role} containerd probe did not select its attested OCI root.`);
  }
  if (expected.role === "application" && expected.expectedManifestDigest === undefined) {
    fail("Application containerd selection is not bound to its asset manifest attestation.");
  }
  if (expected.expectedManifestDigest !== undefined
    && manifestDescriptor.digest !== expected.expectedManifestDigest) {
    fail(`${expected.role} containerd platform manifest differs from its expected digest.`);
  }
  return Object.freeze({
    imageSelectionMode: containerdImageSelectionMode,
    manifestDigest: manifestDescriptor.digest,
    runtimeImageDigest: selectedImageDigest,
  });
}

function assertImageProbeOwnership(probe, expected) {
  const selectedImageDigest = probe?.Image;
  if (probe?.Id !== expected.probeId
    || probe?.Name !== `/${expected.probeName}`
    || probe?.Config?.Image !== expected.reference
    || probe?.Config?.Labels?.["io.clean-pay.verifier-probe"] !== expected.probeOwner
    || JSON.stringify(probe?.Config?.Entrypoint) !== JSON.stringify(["/bin/true"])
    || !/^sha256:[a-f0-9]{64}$/.test(selectedImageDigest ?? "")
    || probe?.State?.Status !== "created"
    || probe?.State?.Running !== false
    || Number(probe?.RestartCount ?? 0) !== 0) {
    fail(`${expected.role} config probe ownership, state, or selected config is invalid.`);
  }
  return selectedImageDigest;
}

function exactImageManifestDescriptor(value, label, expectedPlatform) {
  const platform = exactImagePlatform(expectedPlatform, `${label} expected platform`);
  const observedPlatformKeys = Object.keys(value?.platform ?? {}).sort();
  const platformKeysValid = JSON.stringify(observedPlatformKeys)
      === JSON.stringify(["architecture", "os"])
    || JSON.stringify(observedPlatformKeys)
      === JSON.stringify(["architecture", "os", "variant"]);
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(["digest", "mediaType", "platform", "size"])
    || !platformImageManifestMediaTypes.has(value.mediaType)
    || !/^sha256:[a-f0-9]{64}$/.test(value.digest ?? "")
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > 16 * 1024 * 1024
    || !value.platform || typeof value.platform !== "object" || Array.isArray(value.platform)
    || !platformKeysValid
    || value.platform.architecture !== platform.architecture
    || value.platform.os !== platform.os
    || (value.platform.variant !== undefined
      && (platform.architecture !== "arm64" || value.platform.variant !== "v8"))) {
    fail(`${label} is invalid.`);
  }
  return Object.freeze({
    digest: value.digest,
    mediaType: value.mediaType,
    platform,
    size: value.size,
  });
}

function imageSelectionModeOf(identity) {
  if (identity?.imageSelectionMode === containerdImageSelectionMode) {
    return containerdImageSelectionMode;
  }
  if (/^sha256:[a-f0-9]{64}$/.test(identity?.configDigest ?? "")) {
    return "classic-config";
  }
  fail("Verifier-owned image selection mode is invalid.");
}

function assertCompatibleImageSelection(applicationIdentity, migrationIdentity) {
  const mode = imageSelectionModeOf(applicationIdentity);
  if (mode !== imageSelectionModeOf(migrationIdentity)) {
    fail("Application and migration images use different Docker selection modes.");
  }
  if (mode === "classic-config") return mode;
  if (!applicationIdentity.repoDigests.includes(applicationIdentity.manifestDigest)) {
    fail("Application repository digest set omits its selected platform manifest.");
  }
  if (applicationIdentity.configDigest === applicationIdentity.assetImageDigest
    || applicationIdentity.configDigest === applicationIdentity.manifestDigest) {
    fail("Application containerd config attestation aliases a runtime image digest.");
  }
  const applicationIdentities = new Set([
    applicationIdentity.assetImageDigest,
    applicationIdentity.configDigest,
    applicationIdentity.manifestDigest,
  ]);
  if ([migrationIdentity.assetImageDigest, migrationIdentity.manifestDigest]
    .some((digest) => applicationIdentities.has(digest))) {
    fail("Application and migration containerd image identities overlap.");
  }
  return mode;
}

function exactImagePlatform(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort())
      !== JSON.stringify(["architecture", "os"])
    || value.os !== "linux"
    || !new Set(["amd64", "arm64"]).has(value.architecture)) {
    fail(`${label} is invalid.`);
  }
  return Object.freeze({ architecture: value.architecture, os: value.os });
}

function runtimeImageDigestOf(identity) {
  const mode = imageSelectionModeOf(identity);
  const digest = mode === "classic-config"
    ? identity.configDigest
    : identity.runtimeImageDigest;
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? "")) {
    fail("Verifier-owned runtime image digest is invalid.");
  }
  return digest;
}

function selectionContractSha256(identity) {
  const mode = imageSelectionModeOf(identity);
  return sha256(JSON.stringify(mode === "classic-config" ? {
    configDigest: identity.configDigest,
    imageSelectionMode: mode,
  } : {
    imageSelectionMode: mode,
    manifestDigest: identity.manifestDigest,
    runtimeImageDigest: identity.runtimeImageDigest,
  }));
}

function assertAssetRootInspection(
  inspection,
  expectedDigest,
  reference,
  label,
  {
    requireContainerdRootDescriptor = false,
    selectedManifestDigest = undefined,
  } = {},
) {
  const descriptorAvailable = inspection?.Descriptor !== undefined
    && inspection.Descriptor !== null;
  const descriptorDigest = descriptorAvailable ? inspection.Descriptor?.digest : undefined;
  if (descriptorAvailable
    && (!inspection.Descriptor || typeof inspection.Descriptor !== "object"
      || Array.isArray(inspection.Descriptor)
      || !/^sha256:[a-f0-9]{64}$/.test(descriptorDigest ?? "")
      || descriptorDigest !== expectedDigest)) {
    fail(`${label} authoritative OCI root descriptor differs from its attested root digest.`);
  }
  if (requireContainerdRootDescriptor
    && (!descriptorAvailable
      || !rootImageManifestMediaTypes.has(inspection.Descriptor.mediaType)
      || !Number.isSafeInteger(inspection.Descriptor.size)
      || inspection.Descriptor.size < 1
      || inspection.Descriptor.size > 16 * 1024 * 1024)) {
    fail(`${label} authoritative OCI root descriptor metadata is invalid.`);
  }
  if (requireContainerdRootDescriptor
    && (!/^sha256:[a-f0-9]{64}$/.test(selectedManifestDigest ?? "")
      || (platformImageManifestMediaTypes.has(inspection.Descriptor.mediaType)
        && selectedManifestDigest !== expectedDigest))) {
    fail(`${label} authoritative single-manifest OCI root has a different selected manifest.`);
  }
  if (!Array.isArray(inspection?.RepoDigests ?? [])) {
    fail(`${label} repository digest set is invalid.`);
  }
  const repositories = imageRepositories(reference);
  const repositoryDigests = new Map();
  for (const entry of inspection.RepoDigests ?? []) {
    const match = /^(?<repository>[A-Za-z0-9][A-Za-z0-9._/:\-]{0,240})@(?<digest>sha256:[a-f0-9]{64})$/.exec(
      entry ?? "",
    );
    if (!match) fail(`${label} repository digest is invalid.`);
    if (repositoryDigests.has(match.groups.repository)) {
      fail(`${label} repository digest set repeats one repository identity.`);
    }
    repositoryDigests.set(match.groups.repository, match.groups.digest);
  }
  if (!descriptorAvailable
    && ![...repositories].some((repository) => (
      repositoryDigests.get(repository) === expectedDigest
    ))) {
    fail(`${label} is not bound to its attested OCI root digest.`);
  }
  return inspection;
}

function imageRepositories(reference) {
  if (typeof reference !== "string" || reference.length < 2 || reference.length > 241) {
    fail("Verifier-owned image repository reference is invalid.");
  }
  const withoutDigest = reference.split("@", 1)[0];
  const lastSlash = withoutDigest.lastIndexOf("/");
  const lastColon = withoutDigest.lastIndexOf(":");
  const repository = lastColon > lastSlash
    ? withoutDigest.slice(0, lastColon)
    : withoutDigest;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:\-]{0,240}$/.test(repository)) {
    fail("Verifier-owned image repository reference is invalid.");
  }
  const repositories = new Set([repository]);
  const firstSegment = repository.split("/", 1)[0];
  if (!repository.includes("/")) {
    repositories.add(`docker.io/library/${repository}`);
  } else if (!firstSegment.includes(".") && !firstSegment.includes(":")
    && firstSegment !== "localhost") {
    repositories.add(`docker.io/${repository}`);
  }
  return repositories;
}

function exactDigestList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4
    || value.some((digest) => !/^sha256:[a-f0-9]{64}$/.test(digest))) {
    fail(`${label} is invalid.`);
  }
  return [...new Set(value)].sort();
}

function exactKeys(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail("Owned journey stack input keys are not exact.");
  }
}

function exactOptionalKeys(value, requiredKeys, optionalKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || requiredKeys.some((name) => !Object.hasOwn(value, name))
    || Object.keys(value).some((name) => (
      !requiredKeys.includes(name) && !optionalKeys.includes(name)
    ))) {
    fail("Owned journey stack input keys are not exact.");
  }
}

async function verifyJourneyProcessTerminated(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(value) {
  const resolved = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(parent, child) {
  const relative = path.relative(normalizePath(parent), normalizePath(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function byDestination(left, right) {
  return left.destination.localeCompare(right.destination);
}

function fail(message) {
  throw new Error(message);
}
