import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
  buildJourneySyntheticEnvironment,
  parseJourneyEnvironmentAssignments,
} from "./journey-synthetic-environment-contract.mjs";

export const JOURNEY_COMPOSE_SERVICE_NAMES = Object.freeze([
  "app",
  "browser-ca-ready",
  "browser-db-observer",
  "browser-db-observer-provision",
  "browser-oidc-mock",
  "browser-provider-mock",
  "browser-proxy",
  "db-grant-sync",
  "db-role-provision",
  "migration",
  "postgres",
  "redis",
  "retention-worker",
]);

export const JOURNEY_COMPOSE_VOLUME_NAMES = Object.freeze([
  "journey-caddy-data",
  "journey-trusted-ca",
  "postgres-data",
  "redis-data",
]);

const composeFileRelativePaths = Object.freeze([
  ["deploy", "prod", "docker-compose.yml"],
  ["tests", "browser", "journeys", "docker-compose.journey.yml"],
]);

const fixtureBindSources = Object.freeze({
  "/app/browser-db-observer.mjs": ["tests", "browser", "journeys", "db-observer.mjs"],
  "/etc/caddy/Caddyfile": ["tests", "browser", "journeys", "Caddyfile"],
  "/fixture/db-observer-provision.sh": [
    "tests", "browser", "journeys", "db-observer-provision.sh",
  ],
  "/mock/oidc-mock.mjs": ["tests", "browser", "journeys", "oidc-mock.mjs"],
  "/mock/provider-mock.mjs": ["tests", "browser", "journeys", "provider-mock.mjs"],
});

const oneShotServices = new Set([
  "browser-ca-ready",
  "browser-db-observer-provision",
  "db-grant-sync",
  "db-role-provision",
  "migration",
]);
const oneShotLifecycleFailureEvidenceByError = new WeakMap();
const oneShotLifecycleFailureTraversalMaximumDepth = 8;
const oneShotLifecycleFailureTraversalMaximumNodes = 64;
const defaultImagePlatform = Object.freeze({ architecture: "amd64", os: "linux" });
const platformImageManifestMediaTypes = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
const indexImageManifestMediaTypes = new Set([
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.index.v1+json",
]);
const rootImageManifestMediaTypes = new Set([
  ...indexImageManifestMediaTypes,
  ...platformImageManifestMediaTypes,
]);
export const JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES = Object.freeze(
  [...oneShotServices].sort(),
);

export function collectJourneyOneShotLifecycleFailureEvidence(error) {
  try {
    const evidence = [];
    const pending = [{ depth: 0, value: error }];
    const seen = new Set();
    let visited = 0;
    while (pending.length > 0 && evidence.length < 16
      && visited < oneShotLifecycleFailureTraversalMaximumNodes) {
      const { depth, value } = pending.shift();
      if (value === null || (typeof value !== "object" && typeof value !== "function")
        || seen.has(value)) {
        continue;
      }
      seen.add(value);
      visited += 1;
      const direct = oneShotLifecycleFailureEvidenceByError.get(value);
      if (direct) evidence.push(direct);
      if (depth >= oneShotLifecycleFailureTraversalMaximumDepth) continue;
      const errors = Object.getOwnPropertyDescriptor(value, "errors");
      if (errors && Object.hasOwn(errors, "value") && Array.isArray(errors.value)) {
        for (const child of errors.value.slice(0, 8)) {
          pending.push({ depth: depth + 1, value: child });
        }
      }
      const cause = Object.getOwnPropertyDescriptor(value, "cause");
      if (cause && Object.hasOwn(cause, "value")) {
        pending.push({ depth: depth + 1, value: cause.value });
      }
    }
    return Object.freeze(evidence);
  } catch {
    return Object.freeze([]);
  }
}
export const JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES = Object.freeze({
  app: "running-healthy",
  "browser-ca-ready": "exited-zero",
  "browser-db-observer": "running-healthy",
  "browser-db-observer-provision": "exited-zero",
  "browser-oidc-mock": "running-healthy",
  "browser-provider-mock": "running-healthy",
  "browser-proxy": "running",
  "db-grant-sync": "exited-zero",
  "db-role-provision": "exited-zero",
  migration: "exited-zero",
  postgres: "running-healthy",
  redis: "running-healthy",
  "retention-worker": "running-healthy",
});

const fixtureEnvironmentNames = Object.freeze({
  CLEAN_PAY_BROWSER_CADDYFILE: "/etc/caddy/Caddyfile",
  CLEAN_PAY_BROWSER_DB_OBSERVER_FILE: "/app/browser-db-observer.mjs",
  CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_FILE: "/fixture/db-observer-provision.sh",
  CLEAN_PAY_BROWSER_OIDC_MOCK_FILE: "/mock/oidc-mock.mjs",
  CLEAN_PAY_BROWSER_PROVIDER_MOCK_FILE: "/mock/provider-mock.mjs",
});

export async function prepareJourneyComposeInputs({
  repositoryRoot,
  contractPath,
  contract,
  fixtureSourceOverrides,
  runDocker,
}) {
  exactOptionalObjectKeys(arguments[0], [
    "contract", "contractPath", "repositoryRoot", "runDocker",
  ], ["fixtureSourceOverrides"], "journey Compose preparation input");
  if (typeof runDocker !== "function") fail("Journey runtime Docker reader is invalid.");
  const root = await realpath(repositoryRoot);
  const authoritativeEnvironmentPath = await exactExternalFile(
    path.join(path.dirname(contractPath), ".env"),
    root,
    "authoritative journey environment",
  );
  const syntheticEnvironment = await assertSyntheticRoleEnvironment(
    authoritativeEnvironmentPath,
    root,
    contract,
  );
  if (fixtureSourceOverrides !== undefined) {
    exactObjectKeys(
      fixtureSourceOverrides,
      Object.keys(fixtureBindSources),
      "journey fixture source overrides",
    );
  }
  const bindSources = {};
  for (const [destination, relativeParts] of Object.entries(fixtureBindSources)) {
    const requested = fixtureSourceOverrides?.[destination] ?? path.join(root, ...relativeParts);
    const requestedMetadata = await lstat(requested);
    const source = await realpath(requested);
    const metadata = await lstat(source);
    const expectedContainment = fixtureSourceOverrides === undefined
      ? isWithin(root, source)
      : !isWithin(root, source) && isWithin(path.dirname(authoritativeEnvironmentPath), source);
    if (!metadata.isFile() || requestedMetadata.isSymbolicLink() || !expectedContainment) {
      fail("Journey fixture source is not an exact repository-contained regular file.");
    }
    bindSources[destination] = source;
  }
  const queryEnvironment = composeQueryEnvironment(
    syntheticEnvironment.environment,
    contract.project,
    bindSources,
  );
  const composeFiles = await Promise.all(composeFileRelativePaths.map(async (parts) => {
    const file = await realpath(path.join(root, ...parts));
    if (!isWithin(root, file)) fail("Journey Compose source escaped the repository.");
    return file;
  }));
  const composeSourceSha256 = hashJson(await Promise.all(composeFiles.map(async (file) => ({
    relative: path.relative(root, file).replace(/\\/g, "/"),
    sha256: sha256(await readBoundedBytes(file, 512 * 1024)),
  }))));
  const composeOutput = await runDocker([
    "compose",
    "--project-name", contract.project,
    "--env-file", authoritativeEnvironmentPath,
    ...composeFiles.flatMap((file) => ["--file", file]),
    "config",
    "--format", "json",
  ], 2 * 1024 * 1024, queryEnvironment);
  const compose = parseJson(composeOutput, "rendered journey Compose model");
  assertJourneyComposeModel(compose, contract);
  return Object.freeze({
    authoritativeEnvironmentPath,
    bindSources: Object.freeze({ ...bindSources }),
    compose,
    composeFiles: Object.freeze([...composeFiles]),
    composeSourceSha256,
    renderedComposeSha256: hashJson(compose),
    queryEnvironment: Object.freeze({ ...queryEnvironment }),
    repositoryRoot: root,
    syntheticEnvironment,
  });
}

/**
 * Build the exact journey Compose model from its authoritative external env,
 * then bind every project-owned container, image, network, volume and fixture
 * mount to that model. The caller supplies a bounded, read-only Docker runner.
 */
export async function attestJourneyComposeRuntime({
  repositoryRoot,
  contractPath,
  contract,
  expectedApplicationAssetImageDigest,
  expectedApplicationImageConfigDigest,
  expectedApplicationManifestDigest,
  expectedApplicationReference,
  expectedApplicationRepoDigests,
  expectedApplicationRuntimeImageDigest,
  expectedImageSelectionMode,
  expectedImagePlatform = defaultImagePlatform,
  expectedMigrationAssetImageDigest,
  expectedMigrationManifestDigest,
  expectedMigrationReference,
  expectedMigrationRuntimeImageDigest,
  fixtureSourceOverrides,
  lifecycleNotBefore,
  runDocker,
}) {
  exactOptionalObjectKeys(arguments[0], [
    "contract",
    "contractPath",
    "expectedApplicationAssetImageDigest",
    "expectedApplicationImageConfigDigest",
    "expectedApplicationReference",
    "expectedApplicationRepoDigests",
    "expectedMigrationAssetImageDigest",
    "expectedMigrationReference",
    "expectedMigrationRuntimeImageDigest",
    "repositoryRoot",
    "runDocker",
  ], [
    "expectedApplicationManifestDigest",
    "expectedApplicationRuntimeImageDigest",
    "expectedImageSelectionMode",
    "expectedImagePlatform",
    "expectedMigrationManifestDigest",
    "fixtureSourceOverrides",
    "lifecycleNotBefore",
  ], "journey runtime attestation input");
  if (typeof runDocker !== "function") fail("Journey runtime Docker reader is invalid.");
  exactImageReference(expectedApplicationReference, "expected application image reference");
  exactImageReference(expectedMigrationReference, "expected migration image reference");
  exactDigest(expectedApplicationAssetImageDigest, "expected application asset image digest");
  exactDigest(expectedApplicationImageConfigDigest, "expected application image config digest");
  const imagePlatform = exactImagePlatform(expectedImagePlatform, "expected image platform");
  const applicationRepoDigests = exactRepoDigestSet(expectedApplicationRepoDigests);
  if (!applicationRepoDigests.includes(expectedApplicationAssetImageDigest)) {
    fail("Expected application repository digests omit the attested OCI root.");
  }
  exactDigest(expectedMigrationAssetImageDigest, "expected migration asset image digest");
  exactDigest(expectedMigrationRuntimeImageDigest, "expected migration runtime image digest");
  const imageSelection = assertExpectedImageSelection({
    contract,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest,
    expectedApplicationRepoDigests: applicationRepoDigests,
    expectedApplicationRuntimeImageDigest,
    expectedImageSelectionMode,
    expectedMigrationAssetImageDigest,
    expectedMigrationManifestDigest,
    expectedMigrationRuntimeImageDigest,
  });
  if (
    contract.images?.application === contract.images?.migration
    || [expectedApplicationImageConfigDigest, ...applicationRepoDigests]
      .some((digest) => [expectedMigrationAssetImageDigest, expectedMigrationRuntimeImageDigest]
        .includes(digest))
  ) fail("Journey application and migration image identities must be distinct.");

  const prepared = await prepareJourneyComposeInputs({
    repositoryRoot,
    contractPath,
    contract,
    fixtureSourceOverrides,
    runDocker,
  });
  const {
    bindSources,
    compose,
    composeSourceSha256,
    syntheticEnvironment,
  } = prepared;
  if (lifecycleNotBefore !== undefined) {
    exactTimestamp(lifecycleNotBefore, "journey lifecycle lower bound");
  }

  const containerIds = exactDockerIds(await runDocker([
    "ps", "--all", "--no-trunc", "--quiet",
    "--filter", `label=com.docker.compose.project=${contract.project}`,
  ], 4 * 1024), JOURNEY_COMPOSE_SERVICE_NAMES.length, "journey containers");
  const containers = await inspectMany(runDocker, "container", containerIds, 512 * 1024);
  const containersByService = indexProjectContainers(containers, contract.project);

  const imageReferencesByRuntimeDigest = runtimeImageReferences(containers);
  const imagesById = Object.fromEntries(await Promise.all(
    [...imageReferencesByRuntimeDigest.entries()].map(async ([runtimeDigest, reference]) => [
      runtimeDigest,
      (await inspectMany(runDocker, "image", [reference], 512 * 1024))[0],
    ]),
  ));

  const networkIds = exactDockerIds(await runDocker([
    "network", "ls", "--no-trunc", "--quiet",
    "--filter", `label=com.docker.compose.project=${contract.project}`,
  ], 4 * 1024), 1, "journey networks");
  const [network] = await inspectMany(runDocker, "network", networkIds, 512 * 1024);

  const volumeIds = exactDockerNames(await runDocker([
    "volume", "ls", "--quiet",
    "--filter", `label=com.docker.compose.project=${contract.project}`,
  ], 4 * 1024), JOURNEY_COMPOSE_VOLUME_NAMES.length, "journey volumes");
  const volumes = await inspectMany(runDocker, "volume", volumeIds, 256 * 1024);
  const daemonLoggingDriver = String(await runDocker([
    "info", "--format", "{{.LoggingDriver}}",
  ], 128, composeQueryEnvironment({}, contract.project, {}))).trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(daemonLoggingDriver)) {
    fail("Docker daemon logging driver is invalid.");
  }
  const attestedAt = new Date().toISOString();
  const oneShotLifecycles = {};
  await Promise.all([...oneShotServices].map(async (serviceName) => {
    const container = containersByService[serviceName];
    const since = lifecycleSince(container.Created);
    const output = await runDocker([
      "events",
      "--since", since,
      "--until", attestedAt,
      "--filter", "type=container",
      "--filter", `container=${container.Id}`,
      "--filter", "event=create",
      "--filter", "event=start",
      "--filter", "event=die",
      "--filter", "event=restart",
      "--format", "{{.TimeNano}} {{.Action}} {{.Actor.ID}}",
    ], 4 * 1024, composeQueryEnvironment({}, contract.project, {}));
    oneShotLifecycles[serviceName] = parseOneShotLifecycleEvents(
      output,
      container,
      attestedAt,
      lifecycleNotBefore,
    );
  }));

  const runtime = assertJourneyComposeRuntimeInspection({
    attestedAt,
    bindSources,
    compose,
    containersByService,
    contract,
    daemonLoggingDriver,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    ...(imageSelection.mode === "containerd-root-manifest" ? {
      expectedApplicationManifestDigest: imageSelection.applicationManifestDigest,
      expectedImageSelectionMode: imageSelection.mode,
      expectedApplicationRuntimeImageDigest: imageSelection.applicationRuntimeImageDigest,
    } : {}),
    expectedApplicationReference,
    expectedApplicationRepoDigests: applicationRepoDigests,
    expectedImagePlatform: imagePlatform,
    expectedMigrationAssetImageDigest,
    ...(imageSelection.mode === "containerd-root-manifest" ? {
      expectedMigrationManifestDigest: imageSelection.migrationManifestDigest,
    } : {}),
    expectedMigrationReference,
    expectedMigrationRuntimeImageDigest,
    imagesById,
    network,
    oneShotLifecycles,
    lifecycleNotBefore,
    volumes,
  });

  const liveFixtureMounts = [];
  const fixtureExecutions = [];
  for (const [destination, source] of Object.entries(bindSources)) {
    const expectedSha256 = sha256(await readBoundedBytes(source, 512 * 1024));
    const service = serviceForBindDestination(compose, destination);
    const container = containersByService[service];
    if (container.State?.Status === "running") {
      const observed = await runDocker([
        "container", "exec", container.Id, "sha256sum", destination,
      ], 4 * 1024);
      const match = /^([a-f0-9]{64})\s+/.exec(observed);
      if (!match || match[1] !== expectedSha256) {
        fail("Live journey fixture bytes differ from their current source.");
      }
      fixtureExecutions.push({
        commandSha256: hashJson([
          ...(container.Config?.Entrypoint ?? []),
          ...(container.Config?.Cmd ?? []),
        ]),
        destination,
        mode: "running-live-sha256sum",
        service,
        sourceSha256: expectedSha256,
      });
    } else if (!commandConsumesDestination(container, destination)) {
      fail("Completed journey fixture service did not execute its mounted source.");
    } else {
      const lifecycle = oneShotLifecycles[service];
      if (!oneShotServices.has(service) || lifecycle === undefined) {
        fail("Completed journey fixture is not bound to an exact one-shot lifecycle.");
      }
      fixtureExecutions.push({
        commandSha256: hashJson([
          ...(container.Config?.Entrypoint ?? []),
          ...(container.Config?.Cmd ?? []),
        ]),
        destination,
        lifecycleSha256: hashJson(lifecycle),
        mode: "immutable-source-readonly-mount-exact-one-shot",
        service,
        sourceSha256: expectedSha256,
      });
    }
    liveFixtureMounts.push({ destination, sha256: expectedSha256 });
  }

  return Object.freeze({
    applicationRuntimeImageDigest: imageSelection.applicationRuntimeImageDigest,
    applicationRepoDigestContractSha256: runtime.applicationRepoDigestContractSha256,
    composeSourceSha256,
    composeRuntimeContractSha256: hashJson({
      composeSourceSha256,
      renderedComposeSha256: hashJson(compose),
      runtime,
      syntheticRoleEnvironmentContractSha256: syntheticEnvironment.fileContractSha256,
    }),
    fixtureMountContractSha256: hashJson(liveFixtureMounts.sort(byDestination)),
    fixtureExecutionContractSha256: hashJson(fixtureExecutions.sort(byDestination)),
    applicationImageBindingContractSha256: runtime.applicationImageBindingContractSha256,
    ...(imageSelection.mode === "containerd-root-manifest" ? {
      applicationManifestDigest: imageSelection.applicationManifestDigest,
      imageSelectionMode: imageSelection.mode,
    } : {}),
    migrationImageBindingContractSha256: runtime.migrationImageBindingContractSha256,
    ...(imageSelection.mode === "containerd-root-manifest" ? {
      migrationManifestDigest: imageSelection.migrationManifestDigest,
    } : {}),
    migrationRuntimeImageDigest: imageSelection.migrationRuntimeImageDigest,
    serviceIdentitySha256: runtime.serviceIdentitySha256,
    networkSha256: runtime.networkSha256,
    oneShotLifecycleContractSha256: hashJson(oneShotLifecycles),
    renderedComposeSha256: hashJson(compose),
    syntheticRoleEnvironmentContractSha256: syntheticEnvironment.fileContractSha256,
    syntheticRoleEnvironmentPolicySha256: syntheticEnvironment.policyContractSha256,
  });
}

export function assertJourneyComposeModel(compose, contract) {
  if (!compose || typeof compose !== "object" || Array.isArray(compose)) {
    fail("Rendered journey Compose model is invalid.");
  }
  if (compose.name !== contract.project) fail("Rendered Compose project name differs.");
  exactObjectKeys(compose.services, JOURNEY_COMPOSE_SERVICE_NAMES, "journey Compose services");
  exactObjectKeys(compose.volumes, JOURNEY_COMPOSE_VOLUME_NAMES, "journey Compose volumes");
  exactObjectKeys(compose.networks, ["default"], "journey Compose networks");
  for (const [serviceName, service] of Object.entries(compose.services)) {
    if (!service || typeof service !== "object" || typeof service.image !== "string") {
      fail("Journey Compose service image is invalid.");
    }
    if (
      ![contract.images.application, contract.images.migration].includes(service.image)
      && !/@sha256:[a-f0-9]{64}$/.test(service.image)
    ) {
      fail("Journey helper image is not digest-pinned.");
    }
    const networks = Object.keys(service.networks ?? { default: null });
    if (JSON.stringify(networks) !== JSON.stringify(["default"])) {
      fail(`Journey Compose service ${serviceName} escaped its project network.`);
    }
  }
  for (const name of JOURNEY_COMPOSE_VOLUME_NAMES) {
    const expected = `${contract.project}_${name}`;
    if ((compose.volumes[name]?.name ?? expected) !== expected) {
      fail("Journey Compose volume name differs from its project-owned contract.");
    }
    if (compose.volumes[name]?.external === true) fail("Journey Compose volume is external.");
  }
  const expectedNetwork = `${contract.project}_default`;
  if ((compose.networks.default?.name ?? expectedNetwork) !== expectedNetwork) {
    fail("Journey Compose network name differs from its project-owned contract.");
  }
  if (compose.networks.default?.external === true) fail("Journey Compose network is external.");
  return compose;
}

export function assertJourneyComposeRuntimeInspection(input) {
  exactOptionalObjectKeys(input, [
    "attestedAt",
    "bindSources",
    "compose",
    "containersByService",
    "contract",
    "daemonLoggingDriver",
    "expectedApplicationAssetImageDigest",
    "expectedApplicationImageConfigDigest",
    "expectedApplicationReference",
    "expectedApplicationRepoDigests",
    "expectedMigrationAssetImageDigest",
    "expectedMigrationReference",
    "expectedMigrationRuntimeImageDigest",
    "imagesById",
    "network",
    "oneShotLifecycles",
    "lifecycleNotBefore",
    "volumes",
  ], [
    "expectedApplicationManifestDigest",
    "expectedApplicationRuntimeImageDigest",
    "expectedImageSelectionMode",
    "expectedImagePlatform",
    "expectedMigrationManifestDigest",
  ], "journey runtime inspection input");
  const {
    attestedAt,
    bindSources,
    compose,
    containersByService,
    contract,
    daemonLoggingDriver,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest,
    expectedApplicationReference,
    expectedApplicationRepoDigests,
    expectedApplicationRuntimeImageDigest,
    expectedImageSelectionMode,
    expectedImagePlatform = defaultImagePlatform,
    expectedMigrationAssetImageDigest,
    expectedMigrationManifestDigest,
    expectedMigrationReference,
    expectedMigrationRuntimeImageDigest,
    imagesById,
    network,
    oneShotLifecycles,
    lifecycleNotBefore,
    volumes,
  } = input;
  exactDigest(expectedApplicationAssetImageDigest, "expected application asset image digest");
  exactDigest(expectedApplicationImageConfigDigest, "expected application image config digest");
  const imagePlatform = exactImagePlatform(expectedImagePlatform, "expected image platform");
  exactImageReference(expectedApplicationReference, "expected application image reference");
  exactImageReference(expectedMigrationReference, "expected migration image reference");
  const applicationRepoDigests = exactRepoDigestSet(expectedApplicationRepoDigests);
  if (!applicationRepoDigests.includes(expectedApplicationAssetImageDigest)) {
    fail("Expected application repository digests omit the attested OCI root.");
  }
  exactDigest(expectedMigrationAssetImageDigest, "expected migration asset image digest");
  exactDigest(expectedMigrationRuntimeImageDigest, "expected migration runtime image digest");
  const imageSelection = assertExpectedImageSelection({
    contract,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest,
    expectedApplicationRepoDigests: applicationRepoDigests,
    expectedApplicationRuntimeImageDigest,
    expectedImageSelectionMode,
    expectedMigrationAssetImageDigest,
    expectedMigrationManifestDigest,
    expectedMigrationRuntimeImageDigest,
  });
  exactTimestamp(attestedAt, "runtime attestation timestamp");
  if (lifecycleNotBefore !== undefined) {
    exactTimestamp(lifecycleNotBefore, "journey lifecycle lower bound");
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(daemonLoggingDriver)) {
    fail("Docker daemon logging driver is invalid.");
  }
  if (
    contract.images?.application === contract.images?.migration
    || [expectedApplicationImageConfigDigest, ...applicationRepoDigests]
      .some((digest) => [expectedMigrationAssetImageDigest, expectedMigrationRuntimeImageDigest]
        .includes(digest))
  ) fail("Journey application and migration image identities must be distinct.");
  assertJourneyComposeModel(compose, contract);
  exactObjectKeys(
    containersByService,
    JOURNEY_COMPOSE_SERVICE_NAMES,
    "project-owned journey containers",
  );
  exactObjectKeys(bindSources, Object.keys(fixtureBindSources), "journey fixture bind sources");
  exactObjectKeys(oneShotLifecycles, [...oneShotServices], "journey one-shot lifecycles");

  const expectedNetworkName = compose.networks.default?.name ?? `${contract.project}_default`;
  const expectedVolumeNames = Object.fromEntries(JOURNEY_COMPOSE_VOLUME_NAMES.map((name) => [
    name,
    compose.volumes[name]?.name ?? `${contract.project}_${name}`,
  ]));
  const serviceIdentity = [];
  for (const serviceName of JOURNEY_COMPOSE_SERVICE_NAMES) {
    const service = compose.services[serviceName];
    const container = containersByService[serviceName];
    const image = imagesById[container?.Image];
    assertServiceRuntime({
      bindSources,
      container,
      contract,
      daemonLoggingDriver,
      expectedApplicationAssetImageDigest,
      expectedApplicationImageConfigDigest,
      expectedApplicationManifestDigest: imageSelection.applicationManifestDigest,
      expectedApplicationReference,
      expectedApplicationRepoDigests: applicationRepoDigests,
      expectedApplicationRuntimeImageDigest: imageSelection.applicationRuntimeImageDigest,
      expectedImageSelectionMode: imageSelection.mode,
      expectedImagePlatform: imagePlatform,
      expectedMigrationAssetImageDigest,
      expectedMigrationManifestDigest: imageSelection.migrationManifestDigest,
      expectedMigrationReference,
      expectedMigrationRuntimeImageDigest: imageSelection.migrationRuntimeImageDigest,
      expectedNetworkName,
      expectedVolumeNames,
      image,
      lifecycleNotBefore,
      oneShotLifecycle: oneShotLifecycles[serviceName],
      service,
      serviceName,
    });
    serviceIdentity.push({
      service: serviceName,
      containerIdSha256: sha256(container.Id),
      imageDigest: container.Image,
    });
  }
  assertNetworkRuntime(
    network,
    contract.project,
    expectedNetworkName,
    containersByService,
    compose,
  );
  assertVolumeRuntime(volumes, contract.project, expectedVolumeNames);
  const applicationRepoDigestContractSha256 = assertRuntimeRepoDigests(
    imagesById[containersByService.app.Image]?.RepoDigests,
    applicationRepoDigests,
  );

  const classicApplicationBinding = {
    assetImageDigest: expectedApplicationAssetImageDigest,
    configDigest: expectedApplicationImageConfigDigest,
    referenceSha256: sha256(expectedApplicationReference),
    repoDigests: applicationRepoDigests,
    role: "application",
  };
  const classicMigrationBinding = {
    assetImageDigest: expectedMigrationAssetImageDigest,
    configDigest: expectedMigrationRuntimeImageDigest,
    referenceSha256: sha256(expectedMigrationReference),
    repoDigests: [expectedMigrationAssetImageDigest],
    role: "migration",
  };
  const applicationBinding = imageSelection.mode === "containerd-root-manifest" ? {
    assetImageDigest: expectedApplicationAssetImageDigest,
    configDigest: expectedApplicationImageConfigDigest,
    imageSelectionMode: imageSelection.mode,
    manifestDigest: imageSelection.applicationManifestDigest,
    referenceSha256: sha256(expectedApplicationReference),
    repoDigests: applicationRepoDigests,
    role: "application",
    runtimeImageDigest: imageSelection.applicationRuntimeImageDigest,
  } : classicApplicationBinding;
  const migrationBinding = imageSelection.mode === "containerd-root-manifest" ? {
    assetImageDigest: expectedMigrationAssetImageDigest,
    imageSelectionMode: imageSelection.mode,
    manifestDigest: imageSelection.migrationManifestDigest,
    referenceSha256: sha256(expectedMigrationReference),
    repoDigests: [expectedMigrationAssetImageDigest],
    role: "migration",
    runtimeImageDigest: imageSelection.migrationRuntimeImageDigest,
  } : classicMigrationBinding;
  return Object.freeze({
    applicationRepoDigestContractSha256,
    applicationImageBindingContractSha256: hashJson(applicationBinding),
    ...(imageSelection.mode === "containerd-root-manifest" ? {
      applicationManifestDigest: imageSelection.applicationManifestDigest,
      applicationRuntimeImageDigest: imageSelection.applicationRuntimeImageDigest,
      imageSelectionMode: imageSelection.mode,
    } : {}),
    migrationImageBindingContractSha256: hashJson(migrationBinding),
    ...(imageSelection.mode === "containerd-root-manifest" ? {
      migrationManifestDigest: imageSelection.migrationManifestDigest,
      migrationRuntimeImageDigest: imageSelection.migrationRuntimeImageDigest,
    } : {}),
    networkSha256: sha256(expectedNetworkName),
    oneShotLifecycleContractSha256: hashJson(oneShotLifecycles),
    serviceIdentitySha256: hashJson(serviceIdentity),
  });
}

function assertServiceRuntime(input) {
  const {
    bindSources,
    container,
    contract,
    daemonLoggingDriver,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest,
    expectedApplicationRepoDigests,
    expectedApplicationRuntimeImageDigest,
    expectedImageSelectionMode,
    expectedImagePlatform,
    expectedMigrationAssetImageDigest,
    expectedMigrationManifestDigest,
    expectedMigrationRuntimeImageDigest,
    expectedNetworkName,
    expectedVolumeNames,
    image,
    lifecycleNotBefore,
    oneShotLifecycle,
    service,
    serviceName,
  } = input;
  if (!container || !image) fail("Journey service image is unbound.");
  if (
    container.Id?.length !== 64
    || container.Name !== `/${contract.project}-${serviceName}-1`
    || container.Config?.Labels?.["com.docker.compose.project"] !== contract.project
    || container.Config?.Labels?.["com.docker.compose.service"] !== serviceName
    || container.Config?.Image !== service.image
  ) {
    fail("Journey service ownership or image reference differs.");
  }
  assertImageIdentity(
    image,
    container,
    service.image,
    contract,
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest,
    expectedApplicationRepoDigests,
    expectedApplicationRuntimeImageDigest,
    expectedImageSelectionMode,
    expectedImagePlatform,
    expectedMigrationAssetImageDigest,
    expectedMigrationManifestDigest,
    expectedMigrationRuntimeImageDigest,
  );
  assertExactEnvironment(container.Config.Env, effectiveEnvironment(image, service));
  exactJson(container.Config.Entrypoint ?? null, effectiveList(service.entrypoint, image.Config?.Entrypoint));
  exactJson(container.Config.Cmd ?? null, effectiveList(service.command, image.Config?.Cmd));
  exactValue(container.Config.User ?? "", service.user ?? image.Config?.User ?? "");
  exactValue(container.Config.WorkingDir ?? "", service.working_dir ?? image.Config?.WorkingDir ?? "");
  assertHealthcheck(container.Config.Healthcheck, service.healthcheck, image.Config?.Healthcheck);
  if (service.stop_grace_period !== undefined) {
    exactValue(Number(container.Config.StopTimeout), durationSeconds(service.stop_grace_period));
  }

  const host = container.HostConfig ?? {};
  exactValue(Boolean(host.ReadonlyRootfs), Boolean(service.read_only));
  exactJson(normalizeCaps(host.CapAdd), normalizeCaps(service.cap_add));
  exactJson(normalizeCaps(host.CapDrop), normalizeCaps(service.cap_drop));
  exactJson(normalizeSecurity(host.SecurityOpt), normalizeSecurity(service.security_opt));
  exactValue(Boolean(host.Privileged), false);
  exactValue(Boolean(host.AutoRemove), false);
  exactValue(Boolean(host.OomKillDisable), false);
  exactJson(host.Devices ?? [], []);
  exactJson(host.DeviceRequests ?? [], []);
  exactJson(host.GroupAdd ?? [], service.group_add ?? []);
  exactJson(host.Sysctls ?? {}, service.sysctls ?? {});
  exactJson(host.ExtraHosts ?? [], service.extra_hosts ?? []);
  exactJson(host.Links ?? [], []);
  exactJson(host.Dns ?? [], service.dns ?? []);
  exactJson(host.DnsOptions ?? [], service.dns_opt ?? []);
  exactJson(host.DnsSearch ?? [], service.dns_search ?? []);
  exactValue(host.PidMode ?? "", service.pid ?? "");
  exactValue(host.UTSMode ?? "", service.uts ?? "");
  exactValue(host.UsernsMode ?? "", service.userns_mode ?? "");
  exactValue(Number(host.PidsLimit ?? 0), Number(service.pids_limit ?? 0));
  exactValue(Number(host.Memory ?? 0), numericBytes(service.mem_limit));
  exactValue(Number(host.NanoCpus ?? 0), Math.round(Number(service.cpus ?? 0) * 1e9));
  exactValue(Boolean(host.Init), Boolean(service.init));
  exactValue(host.NetworkMode, expectedNetworkName);
  exactValue(host.RestartPolicy?.Name ?? "", normalizeRestart(service.restart));
  exactValue(Number(host.RestartPolicy?.MaximumRetryCount ?? 0), 0);
  assertLogging(host.LogConfig, service.logging, daemonLoggingDriver);
  assertTmpfs(host.Tmpfs, service.tmpfs);
  assertMounts(container.Mounts, service.volumes, bindSources, expectedVolumeNames);
  assertPublishedPorts(container.NetworkSettings?.Ports, service.ports);
  assertServiceNetwork(container, service, serviceName, contract.project, expectedNetworkName);
  assertServiceState(container, service, serviceName, oneShotLifecycle, lifecycleNotBefore);

  for (const destination of Object.keys(bindSources)) {
    if ((service.volumes ?? []).some((mount) => mount.target === destination)
      && !commandConsumesDestination(container, destination)) {
      fail("Journey fixture bind is not consumed by its exact service command.");
    }
  }
}

function assertImageIdentity(
  image,
  container,
  reference,
  contract,
  expectedApplicationAssetImageDigest,
  expectedApplicationImageConfigDigest,
  expectedApplicationManifestDigest,
  expectedApplicationRepoDigests,
  expectedApplicationRuntimeImageDigest,
  expectedImageSelectionMode,
  expectedImagePlatform,
  expectedMigrationAssetImageDigest,
  expectedMigrationManifestDigest,
  expectedMigrationRuntimeImageDigest,
) {
  const runtimeImageDigest = container.Image;
  let role;
  let containerdRootDescriptor;
  if (image?.Id !== runtimeImageDigest) {
    fail("Journey image inspection ID differs from the container-selected runtime digest.");
  }
  if (expectedImageSelectionMode === "containerd-root-manifest") {
    containerdRootDescriptor = assertContainerdRootInspection(
      image,
      runtimeImageDigest,
      container.ImageManifestDescriptor?.digest,
      reference === contract.images.application
        ? expectedApplicationImageConfigDigest
        : undefined,
    );
  } else if (Object.hasOwn(container, "ImageManifestDescriptor")) {
    fail("Classic image selection contains mixed containerd descriptor state.");
  }
  if (reference === contract.images.application) {
    if (expectedImageSelectionMode === "containerd-root-manifest") {
      if (runtimeImageDigest !== expectedApplicationAssetImageDigest
        || runtimeImageDigest !== expectedApplicationRuntimeImageDigest) {
        fail("Journey application container is not bound to its attested OCI root.");
      }
      assertContainerdManifestDescriptor(
        container.ImageManifestDescriptor,
        expectedApplicationManifestDigest,
        "application",
        expectedImagePlatform,
        {
          expectedAnnotationConfigDigest: expectedApplicationImageConfigDigest,
          expectedRootDigest: runtimeImageDigest,
          rootDescriptor: containerdRootDescriptor,
        },
      );
    } else {
      if (runtimeImageDigest !== expectedApplicationImageConfigDigest) {
        fail("Journey application container is not bound to the attested selected config digest.");
      }
      assertClassicRootDescriptor(image, expectedApplicationAssetImageDigest, "application");
    }
    role = "app";
  } else if (reference === contract.images.migration) {
    if (expectedImageSelectionMode === "containerd-root-manifest") {
      if (runtimeImageDigest !== expectedMigrationAssetImageDigest
        || runtimeImageDigest !== expectedMigrationRuntimeImageDigest) {
        fail("Journey migration container is not bound to its attested OCI root.");
      }
      assertContainerdManifestDescriptor(
        container.ImageManifestDescriptor,
        expectedMigrationManifestDigest,
        "migration",
        expectedImagePlatform,
        {
          expectedRootDigest: runtimeImageDigest,
          rootDescriptor: containerdRootDescriptor,
        },
      );
    } else {
      if (runtimeImageDigest !== expectedMigrationRuntimeImageDigest) {
        fail("Journey migration container is not bound to the verifier-derived config digest.");
      }
      assertClassicRootDescriptor(image, expectedMigrationAssetImageDigest, "migration");
    }
    role = "migration";
  } else {
    const match = /@(?<digest>sha256:[a-f0-9]{64})$/.exec(reference);
    if (!match) fail("Journey helper image is not digest-pinned.");
    if (expectedImageSelectionMode === "containerd-root-manifest") {
      if (runtimeImageDigest !== match.groups.digest) {
        fail("Journey helper container is not bound to its digest-pinned OCI root.");
      }
      assertContainerdManifestDescriptor(
        container.ImageManifestDescriptor,
        undefined,
        "helper",
        expectedImagePlatform,
        {
          expectedRootDigest: runtimeImageDigest,
          rootDescriptor: containerdRootDescriptor,
        },
      );
    } else {
      assertClassicRootDescriptor(image, match.groups.digest, "helper");
    }
    const expectedRepoDigest = canonicalRepoDigest(reference);
    if (!(image.RepoDigests ?? []).includes(expectedRepoDigest)) {
      fail("Journey helper image digest reference differs from Compose.");
    }
    return;
  }
  if (role === "app") assertRuntimeRepoDigests(image.RepoDigests, expectedApplicationRepoDigests);
  if (role === "migration") {
    assertRuntimeRepoDigests(image.RepoDigests, [expectedMigrationAssetImageDigest]);
  }
  if (
    image.Config?.Labels?.["io.clean-pay.role"] !== role
    || image.Config?.Labels?.["org.opencontainers.image.revision"] !== contract.revision
  ) {
    fail("Journey role image OCI identity differs.");
  }
  if (
    image.Config?.Labels?.["io.clean-pay.public-build-contract-version"]
      !== contract.publicBuildContract.version
    || image.Config?.Labels?.["io.clean-pay.public-build-contract-sha256"]
      !== contract.publicBuildContract.sha256
  ) {
    fail("Journey role image public-build identity differs.");
  }
}

function assertExpectedImageSelection({
  contract,
  expectedApplicationAssetImageDigest,
  expectedApplicationImageConfigDigest,
  expectedApplicationManifestDigest,
  expectedApplicationRepoDigests,
  expectedApplicationRuntimeImageDigest,
  expectedImageSelectionMode,
  expectedMigrationAssetImageDigest,
  expectedMigrationManifestDigest,
  expectedMigrationRuntimeImageDigest,
}) {
  if (expectedImageSelectionMode === undefined) {
    if (expectedApplicationManifestDigest !== undefined
      || expectedApplicationRuntimeImageDigest !== undefined
      || expectedMigrationManifestDigest !== undefined) {
      fail("Classic image selection cannot carry containerd-only identities.");
    }
    return Object.freeze({
      applicationManifestDigest: undefined,
      applicationRuntimeImageDigest: expectedApplicationImageConfigDigest,
      migrationManifestDigest: undefined,
      migrationRuntimeImageDigest: expectedMigrationRuntimeImageDigest,
      mode: "classic-config",
    });
  }
  if (expectedImageSelectionMode !== "containerd-root-manifest") {
    fail("Journey image selection mode is invalid.");
  }
  exactDigest(expectedApplicationManifestDigest, "expected application platform manifest digest");
  exactDigest(expectedApplicationRuntimeImageDigest, "expected application runtime image digest");
  exactDigest(expectedMigrationManifestDigest, "expected migration platform manifest digest");
  if (expectedApplicationRuntimeImageDigest !== expectedApplicationAssetImageDigest
    || expectedMigrationRuntimeImageDigest !== expectedMigrationAssetImageDigest
    || contract.images?.application !== expectedApplicationAssetImageDigest
    || contract.images?.migration !== expectedMigrationAssetImageDigest) {
    fail("Containerd journey images are not bound to their attested OCI roots.");
  }
  if (!expectedApplicationRepoDigests.includes(expectedApplicationManifestDigest)) {
    fail("Expected application repository digests omit its platform manifest.");
  }
  if (expectedApplicationImageConfigDigest === expectedApplicationAssetImageDigest
    || expectedApplicationImageConfigDigest === expectedApplicationManifestDigest) {
    fail("Expected application config digest aliases a containerd runtime image identity.");
  }
  const applicationIdentities = new Set([
    expectedApplicationAssetImageDigest,
    expectedApplicationImageConfigDigest,
    expectedApplicationManifestDigest,
  ]);
  if ([
    expectedMigrationAssetImageDigest,
    expectedMigrationManifestDigest,
  ].some((digest) => applicationIdentities.has(digest))) {
    fail("Containerd application and migration image identities overlap.");
  }
  return Object.freeze({
    applicationManifestDigest: expectedApplicationManifestDigest,
    applicationRuntimeImageDigest: expectedApplicationRuntimeImageDigest,
    migrationManifestDigest: expectedMigrationManifestDigest,
    migrationRuntimeImageDigest: expectedMigrationRuntimeImageDigest,
    mode: expectedImageSelectionMode,
  });
}

function assertContainerdRootInspection(
  image,
  expectedRootDigest,
  selectedManifestDigest,
  expectedAnnotationConfigDigest,
) {
  const descriptor = image?.Descriptor;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
    || descriptor.digest !== expectedRootDigest) {
    fail("Containerd image inspection is not bound to its authoritative OCI root descriptor.");
  }
  const annotationsPresent = Object.hasOwn(descriptor, "annotations");
  exactObjectKeys(
    descriptor,
    annotationsPresent
      ? ["annotations", "digest", "mediaType", "size"]
      : ["digest", "mediaType", "size"],
    "containerd authoritative OCI root descriptor",
  );
  if (!rootImageManifestMediaTypes.has(descriptor.mediaType)
    || !Number.isSafeInteger(descriptor.size)
    || descriptor.size <= 0
    || descriptor.size > 16 * 1024 * 1024) {
    fail("Containerd authoritative OCI root descriptor differs from its exact contract.");
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(selectedManifestDigest ?? "")
    || (platformImageManifestMediaTypes.has(descriptor.mediaType)
      && selectedManifestDigest !== expectedRootDigest)) {
    fail("Containerd single-manifest OCI root differs from its selected platform manifest.");
  }
  if (indexImageManifestMediaTypes.has(descriptor.mediaType)
    && selectedManifestDigest === expectedRootDigest) {
    fail("Containerd index/list OCI root aliases its selected platform manifest.");
  }
  if (annotationsPresent) {
    exactObjectKeys(
      descriptor.annotations,
      ["config.digest"],
      "containerd authoritative OCI root annotations",
    );
    const configDigest = descriptor.annotations["config.digest"];
    if (!/^sha256:[a-f0-9]{64}$/.test(configDigest ?? "")
      || !platformImageManifestMediaTypes.has(descriptor.mediaType)
      || selectedManifestDigest !== expectedRootDigest
      || (expectedAnnotationConfigDigest !== undefined
        && configDigest !== expectedAnnotationConfigDigest)) {
      fail("Containerd authoritative OCI root annotations differ from their exact contract.");
    }
  }
  return descriptor;
}

function assertClassicRootDescriptor(image, expectedRootDigest, role) {
  if (!Object.hasOwn(image, "Descriptor")) return;
  const descriptor = image.Descriptor;
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)
    || descriptor.digest !== expectedRootDigest) {
    fail(`Classic ${role} image root descriptor differs from its attested asset digest.`);
  }
}

function assertContainerdManifestDescriptor(
  descriptor,
  expectedDigest,
  role,
  expectedPlatform,
  {
    expectedAnnotationConfigDigest = undefined,
    expectedRootDigest,
    rootDescriptor,
  },
) {
  const platform = exactImagePlatform(
    expectedPlatform,
    `containerd ${role} expected image platform`,
  );
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    fail(`Containerd ${role} platform manifest descriptor is missing or malformed.`);
  }
  const annotationsPresent = Object.hasOwn(descriptor, "annotations");
  exactObjectKeys(
    descriptor,
    annotationsPresent
      ? ["annotations", "digest", "mediaType", "platform", "size"]
      : ["digest", "mediaType", "platform", "size"],
    `containerd ${role} platform manifest descriptor`,
  );
  const observedPlatformKeys = Object.keys(descriptor.platform ?? {}).sort();
  if (JSON.stringify(observedPlatformKeys) !== JSON.stringify(["architecture", "os"])
    && JSON.stringify(observedPlatformKeys)
      !== JSON.stringify(["architecture", "os", "variant"])) {
    fail(`Containerd ${role} platform manifest platform keys are invalid.`);
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(descriptor.digest ?? "")
    || (expectedDigest !== undefined && descriptor.digest !== expectedDigest)
    || !new Set([
      "application/vnd.docker.distribution.manifest.v2+json",
      "application/vnd.oci.image.manifest.v1+json",
    ]).has(descriptor.mediaType)
    || !Number.isSafeInteger(descriptor.size)
    || descriptor.size <= 0
    || descriptor.size > 16 * 1024 * 1024
    || descriptor.platform.architecture !== platform.architecture
    || descriptor.platform.os !== platform.os
    || (descriptor.platform.variant !== undefined
      && (platform.architecture !== "arm64" || descriptor.platform.variant !== "v8"))) {
    fail(`Containerd ${role} platform manifest descriptor differs from its exact contract.`);
  }
  if (platformImageManifestMediaTypes.has(rootDescriptor?.mediaType)
    && (rootDescriptor.digest !== expectedRootDigest
      || descriptor.digest !== expectedRootDigest
      || descriptor.mediaType !== rootDescriptor.mediaType)) {
    fail(`Containerd ${role} platform manifest differs from its single-manifest root.`);
  }
  if (annotationsPresent) {
    exactObjectKeys(
      descriptor.annotations,
      ["config.digest"],
      `containerd ${role} platform manifest annotations`,
    );
    const configDigest = descriptor.annotations["config.digest"];
    if (!/^sha256:[a-f0-9]{64}$/.test(configDigest ?? "")
      || (expectedAnnotationConfigDigest !== undefined
        && configDigest !== expectedAnnotationConfigDigest)) {
      fail(`Containerd ${role} platform manifest annotations differ from their exact contract.`);
    }
  }
  const rootAnnotationsPresent = Object.hasOwn(rootDescriptor ?? {}, "annotations");
  if ((rootAnnotationsPresent || annotationsPresent)
    && (!rootDescriptor || typeof rootDescriptor !== "object" || Array.isArray(rootDescriptor)
      || !platformImageManifestMediaTypes.has(rootDescriptor.mediaType)
      || rootDescriptor.digest !== expectedRootDigest
      || descriptor.digest !== expectedRootDigest
      || descriptor.mediaType !== rootDescriptor.mediaType
      || descriptor.size !== rootDescriptor.size
      || (rootAnnotationsPresent && annotationsPresent
        && rootDescriptor.annotations["config.digest"]
          !== descriptor.annotations["config.digest"]))) {
    fail(`Containerd ${role} root and platform manifest annotations are not consistently bound.`);
  }
  return descriptor;
}

function exactImagePlatform(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} is invalid.`);
  }
  exactObjectKeys(value, ["architecture", "os"], label);
  if (value.os !== "linux" || !new Set(["amd64", "arm64"]).has(value.architecture)) {
    fail(`${label} is invalid.`);
  }
  return Object.freeze({ architecture: value.architecture, os: value.os });
}

function runtimeImageReferences(containers) {
  const references = new Map();
  for (const container of containers) {
    const runtimeDigest = container?.Image;
    const reference = container?.Config?.Image;
    if (!/^sha256:[a-f0-9]{64}$/.test(runtimeDigest ?? "")
      || typeof reference !== "string" || reference.length < 2 || reference.length > 512) {
      fail("Journey runtime image selection is invalid.");
    }
    const current = references.get(runtimeDigest);
    if (current !== undefined && current !== reference) {
      fail("Journey runtime digest maps to multiple immutable image references.");
    }
    references.set(runtimeDigest, reference);
  }
  return new Map([...references].sort(([left], [right]) => left.localeCompare(right)));
}

function effectiveEnvironment(image, service) {
  const result = parseEnvironmentList(image.Config?.Env ?? []);
  for (const [name, value] of Object.entries(service.environment ?? {})) {
    if (typeof value !== "string") fail("Rendered Compose environment value is invalid.");
    result.set(name, value);
  }
  return [...result].map(([name, value]) => `${name}=${value}`);
}

function assertExactEnvironment(actual, expected) {
  const left = [...parseEnvironmentList(actual ?? [])].sort(byName);
  const right = [...parseEnvironmentList(expected ?? [])].sort(byName);
  exactJson(left, right);
}

function parseEnvironmentList(assignments) {
  const result = new Map();
  for (const assignment of assignments) {
    if (typeof assignment !== "string") fail("Journey environment assignment is invalid.");
    const separator = assignment.indexOf("=");
    const name = assignment.slice(0, separator);
    if (separator < 1 || result.has(name)) fail("Journey environment contains an extra or duplicate key.");
    result.set(name, assignment.slice(separator + 1));
  }
  return result;
}

function assertMounts(actualMounts, expectedMounts, bindSources, expectedVolumeNames) {
  const actual = (actualMounts ?? []).map((mount) => ({
    destination: mount.Destination,
    name: mount.Name ?? "",
    readOnly: mount.RW === false,
    source: mount.Type === "bind" ? normalizeHostPath(mount.Source) : "",
    type: mount.Type,
  })).sort(byDestination);
  const expected = (expectedMounts ?? []).map((mount) => {
    if (!mount || !["bind", "volume"].includes(mount.type)) fail("Compose mount is invalid.");
    const source = mount.type === "bind" ? bindSources[mount.target] : "";
    if (mount.type === "bind" && !source) fail("Compose contains an unexpected bind source.");
    return {
      destination: mount.target,
      name: mount.type === "volume" ? expectedVolumeNames[mount.source] ?? "" : "",
      readOnly: Boolean(mount.read_only),
      source: mount.type === "bind" ? normalizeHostPath(source) : "",
      type: mount.type,
    };
  }).sort(byDestination);
  exactJson(actual, expected);
}

function assertTmpfs(actualTmpfs, expectedTmpfs) {
  const actual = Object.entries(actualTmpfs ?? {}).map(([target, options]) => ({
    options: normalizeTmpfsOptions(options),
    target,
  })).sort(byDestination);
  const expected = (expectedTmpfs ?? []).map((entry) => {
    const [target, ...options] = String(entry).split(":");
    return { options: normalizeTmpfsOptions(options.join(":")), target };
  }).sort(byDestination);
  exactJson(actual, expected);
}

function normalizeTmpfsOptions(raw) {
  return String(raw ?? "").split(",").filter(Boolean).map((option) => {
    const [name, value] = option.split("=");
    if (name === "size") return `${name}=${parseBytes(value)}`;
    return value === undefined ? name : `${name}=${value}`;
  }).sort();
}

function assertPublishedPorts(actualPorts, expectedPorts) {
  const actual = Object.entries(actualPorts ?? {}).flatMap(([target, bindings]) => (
    (bindings ?? []).map((binding) => ({
      hostIp: binding.HostIp,
      published: String(binding.HostPort),
      target,
    }))
  )).sort(byPort);
  const expected = (expectedPorts ?? []).map((port) => ({
    hostIp: port.host_ip,
    published: String(port.published),
    target: `${port.target}/${port.protocol ?? "tcp"}`,
  })).sort(byPort);
  exactJson(actual, expected);
  if (actual.some(({ hostIp }) => !/^127\.0\.0\.\d+$/.test(hostIp))) {
    fail("Journey service publication is not loopback-only.");
  }
}

function assertServiceNetwork(container, service, serviceName, project, networkName) {
  const attachments = container.NetworkSettings?.Networks ?? {};
  exactObjectKeys(attachments, [networkName], "journey service network attachments");
  const configured = service.networks?.default;
  const explicitAliases = configured && typeof configured === "object"
    ? configured.aliases ?? []
    : [];
  const expectedAliases = [`${project}-${serviceName}-1`, serviceName, ...explicitAliases].sort();
  const actualAliases = [...new Set(attachments[networkName]?.Aliases ?? [])].sort();
  exactJson(actualAliases, [...new Set(expectedAliases)].sort());
}

function assertServiceState(container, service, serviceName, oneShotLifecycle, lifecycleNotBefore) {
  const oneShot = oneShotServices.has(serviceName);
  if (oneShot) {
    if (
      container.State?.Status !== "exited"
      || container.State?.Running !== false
      || container.State?.ExitCode !== 0
      || Number(container.RestartCount ?? 0) !== 0
      || container.State?.Dead !== false
      || container.State?.Paused !== false
      || container.State?.Restarting !== false
      || container.State?.OOMKilled !== false
      || Number(container.State?.Pid ?? 0) !== 0
      || (container.State?.Error ?? "") !== ""
    ) fail("Journey one-shot service did not complete exactly once.");
    assertOneShotLifecycleRecord(oneShotLifecycle, container, lifecycleNotBefore);
  } else if (
    oneShotLifecycle !== undefined
    || container.State?.Status !== "running"
    || container.State?.Running !== true
    || Number(container.RestartCount ?? 0) !== 0
    || (service.healthcheck && container.State?.Health?.Status !== "healthy")
  ) {
    fail("Journey long-running service is not exactly healthy and unrestarted.");
  }
}

function assertNetworkRuntime(network, project, expectedName, containersByService, compose) {
  if (
    network?.Name !== expectedName
    || network?.Labels?.["com.docker.compose.project"] !== project
    || network?.Labels?.["com.docker.compose.network"] !== "default"
    || network?.Driver !== (compose.networks.default?.driver ?? "bridge")
    || Boolean(network?.Internal) !== Boolean(compose.networks.default?.internal)
    || Boolean(network?.Attachable) !== Boolean(compose.networks.default?.attachable)
    || Boolean(network?.Ingress) !== false
  ) fail("Journey project network differs from exact Compose ownership.");
  const expectedIds = Object.values(containersByService)
    .filter((container) => container.State?.Running === true)
    .map(({ Id }) => Id)
    .sort();
  const actualIds = Object.keys(network.Containers ?? {}).sort();
  exactJson(actualIds, expectedIds);
}

function assertVolumeRuntime(volumes, project, expectedNames) {
  const byName = Object.fromEntries(volumes.map((volume) => [volume.Name, volume]));
  exactObjectKeys(byName, Object.values(expectedNames), "project-owned journey volumes");
  for (const [logicalName, expectedName] of Object.entries(expectedNames)) {
    const volume = byName[expectedName];
    if (
      volume?.Labels?.["com.docker.compose.project"] !== project
      || volume?.Labels?.["com.docker.compose.volume"] !== logicalName
      || volume?.Driver !== "local"
      || Object.keys(volume?.Options ?? {}).length !== 0
    ) fail("Journey project volume differs from exact Compose ownership.");
  }
}

function assertLogging(actual, expected, daemonLoggingDriver) {
  exactValue(actual?.Type || daemonLoggingDriver, expected?.driver ?? daemonLoggingDriver);
  exactJson(actual?.Config ?? {}, expected?.options ?? {});
}

function assertHealthcheck(actual, override, inherited) {
  const expected = override === undefined || override === null ? inherited : {
    Test: override.test,
    Interval: durationNanoseconds(override.interval),
    Timeout: durationNanoseconds(override.timeout),
    Retries: Number(override.retries ?? 0),
    StartPeriod: durationNanoseconds(override.start_period),
    StartInterval: durationNanoseconds(override.start_interval),
  };
  const normalize = (value) => value ? {
    Test: value.Test ?? null,
    Interval: Number(value.Interval ?? 0),
    Timeout: Number(value.Timeout ?? 0),
    Retries: Number(value.Retries ?? 0),
    StartPeriod: Number(value.StartPeriod ?? 0),
    StartInterval: Number(value.StartInterval ?? 0),
  } : null;
  exactJson(normalize(actual), normalize(expected));
}

function composeQueryEnvironment(assignments, project, bindSources) {
  const environment = {};
  for (const name of [
    "APPDATA", "DOCKER_CERT_PATH", "DOCKER_CONFIG", "DOCKER_CONTEXT",
    "DOCKER_HOST", "DOCKER_TLS_VERIFY", "HOME", "LANG",
    "LC_ALL", "LOCALAPPDATA", "PATH", "Path", "PATHEXT", "SYSTEMROOT",
    "ProgramFiles", "ProgramW6432", "SystemRoot", "TEMP", "TMP", "USERPROFILE",
    "WINDIR", "XDG_CONFIG_HOME",
  ]) {
    if (typeof process.env[name] === "string") environment[name] = process.env[name];
  }
  for (const [name, destination] of Object.entries(fixtureEnvironmentNames)) {
    if (bindSources[destination] !== undefined) environment[name] = bindSources[destination];
  }
  for (const [name, value] of Object.entries(assignments)) {
    if (name === "COMPOSE_PROJECT_NAME") {
      if (value !== project) {
        fail("Synthetic Compose project assignment differs from the exact project.");
      }
      // --project-name is authoritative. Do not copy this assignment into the
      // child environment where it would outrank the already-validated env file.
      continue;
    }
    if (name.startsWith("COMPOSE_") || Object.hasOwn(environment, name)) {
      fail("Synthetic Compose render environment contains a forbidden override.");
    }
    // Values are supplied only by --env-file. Keeping them out of the child
    // environment prevents an inherited or caller-added value from winning
    // Compose interpolation precedence.
    void value;
  }
  return environment;
}

async function assertSyntheticRoleEnvironment(authoritativePath, repositoryRoot, contract) {
  const directory = await realpath(path.dirname(authoritativePath));
  if (isWithin(repositoryRoot, directory)) {
    fail("Synthetic role environment directory must stay outside the repository.");
  }
  const authoritativeBytes = await readBoundedBytes(authoritativePath, 128 * 1024);
  const observed = parseJourneyEnvironmentAssignments(authoritativeBytes);
  const publications = exactSyntheticPublications(contract.publications);
  const expected = buildJourneySyntheticEnvironment({
    appImage: contract.images.application,
    appPort: publications.appPort,
    connectProxyPort: publications.connectProxyPort,
    directory,
    migrationImage: contract.images.migration,
    project: contract.project,
    providerPort: publications.providerPort,
    proxyBind: publications.proxyBind,
    revision: contract.revision,
    turnstileSiteKey: observed.TURNSTILE_SITE_KEY,
  });
  if (expected.publicBuildContractSha256 !== contract.publicBuildContract?.sha256) {
    fail("Synthetic public build environment differs from its contract.");
  }
  const observedFileHashes = [];
  for (const filename of JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES) {
    const requested = path.join(directory, filename);
    const resolved = await realpath(requested);
    if (normalizeHostPath(resolved) !== normalizeHostPath(requested)) {
      fail("Synthetic role environment realpath differs from its exact destination.");
    }
    const metadata = await lstat(resolved);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail("Synthetic role environment is not an exact regular file.");
    }
    const bytes = await readBoundedBytes(resolved, 128 * 1024);
    if (!bytes.equals(Buffer.from(expected.files[filename], "utf8"))) {
      fail("Synthetic role environment bytes differ from the deterministic contract.");
    }
    observedFileHashes.push({ name: filename, sha256: sha256(bytes) });
  }
  if (hashJson(observedFileHashes) !== expected.fileContractSha256) {
    fail("Synthetic role environment hash contract differs.");
  }
  for (const [name, value] of Object.entries(observed)) {
    if (expected.environment[name] !== value) {
      fail("Authoritative synthetic environment contains an unexpected assignment.");
    }
  }
  exactObjectKeys(observed, Object.keys(expected.environment), "authoritative synthetic environment");
  return expected;
}

function exactSyntheticPublications(publications) {
  exactObjectKeys(
    publications,
    ["app", "browserTls", "connectProxy", "providerControl"],
    "synthetic publications",
  );
  const split = (value, hostPattern, label) => {
    const match = new RegExp(`^(?<host>${hostPattern}):(?<port>\\d{1,5})$`).exec(value ?? "");
    if (!match || String(Number(match.groups.port)) !== match.groups.port
      || Number(match.groups.port) < 1 || Number(match.groups.port) > 65_535) {
      fail(`${label} publication is invalid.`);
    }
    return match.groups;
  };
  const app = split(publications.app, "127\\.0\\.0\\.1", "application");
  const provider = split(publications.providerControl, "127\\.0\\.0\\.1", "provider");
  const connect = split(publications.connectProxy, "127\\.0\\.0\\.1", "CONNECT proxy");
  const tls = split(
    publications.browserTls,
    "127\\.0\\.0\\.(?:[2-9]|[1-9]\\d|1\\d\\d|2[0-4]\\d|25[0-4])",
    "browser TLS",
  );
  if (tls.port !== "443") fail("Browser TLS publication port differs.");
  return {
    appPort: app.port,
    connectProxyPort: connect.port,
    providerPort: provider.port,
    proxyBind: tls.host,
  };
}

async function inspectMany(runDocker, kind, ids, maximumBytes) {
  return Promise.all(ids.map(async (id) => {
    const value = parseJson(
      await runDocker([kind, "inspect", id], maximumBytes),
      `${kind} inspection`,
    );
    if (!Array.isArray(value) || value.length !== 1) fail(`${kind} inspection is invalid.`);
    return value[0];
  }));
}

function indexProjectContainers(containers, project) {
  const result = {};
  for (const container of containers) {
    const service = container?.Config?.Labels?.["com.docker.compose.service"];
    if (
      container?.Config?.Labels?.["com.docker.compose.project"] !== project
      || !JOURNEY_COMPOSE_SERVICE_NAMES.includes(service)
      || Object.hasOwn(result, service)
    ) fail("Project contains an unexpected or duplicate Compose container.");
    result[service] = container;
  }
  exactObjectKeys(result, JOURNEY_COMPOSE_SERVICE_NAMES, "project-owned journey containers");
  return result;
}

function serviceForBindDestination(compose, destination) {
  const matches = Object.entries(compose.services).filter(([, service]) => (
    (service.volumes ?? []).some((mount) => mount.target === destination)
  ));
  if (matches.length !== 1) fail("Journey fixture bind destination is not unique.");
  return matches[0][0];
}

function commandConsumesDestination(container, destination) {
  return JSON.stringify([
    ...(container.Config?.Entrypoint ?? []),
    ...(container.Config?.Cmd ?? []),
  ]).includes(destination);
}

async function exactExternalFile(target, repositoryRoot, label) {
  const requested = path.resolve(target);
  const requestedMetadata = await lstat(requested);
  const resolved = await realpath(target);
  if (isWithin(repositoryRoot, resolved)) fail(`${label} must stay outside the repository.`);
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || requestedMetadata.isSymbolicLink()) {
    fail(`${label} must be a regular file.`);
  }
  return resolved;
}

async function readBoundedBytes(target, maximumBytes) {
  const before = await stat(target);
  if (!before.isFile() || before.size <= 0 || before.size > maximumBytes) {
    fail("Journey attestation input exceeds its bounded file contract.");
  }
  const bytes = await readFile(target);
  const after = await stat(target);
  if (bytes.byteLength !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    fail("Journey attestation input changed while being read.");
  }
  return bytes;
}

export function assertJourneyOneShotLifecycle(value, container) {
  return assertOneShotLifecycleRecord(value, container);
}

function parseOneShotLifecycleEvents(output, container, attestedAt, lifecycleNotBefore) {
  const events = splitLines(output).map((line) => {
    const match = /^(?<timeNano>[1-9]\d{15,24}) (?<action>create|start|die|restart) (?<id>[a-f0-9]{64})$/.exec(line);
    if (!match || match.groups.id !== container.Id) {
      fail("Journey one-shot Docker event is invalid or unbound.");
    }
    return {
      action: match.groups.action,
      containerIdSha256: sha256(match.groups.id),
      timeNano: match.groups.timeNano,
    };
  });
  const record = {
    attestedAt,
    createdAt: container.Created,
    events,
    finishedAt: container.State?.FinishedAt,
    lifecycleNotBefore: lifecycleNotBefore ?? container.Created,
    startedAt: container.State?.StartedAt,
  };
  assertOneShotLifecycleRecord(record, container, lifecycleNotBefore);
  return Object.freeze(record);
}

function assertOneShotLifecycleRecord(value, container, expectedLifecycleNotBefore) {
  exactObjectKeys(
    value,
    ["attestedAt", "createdAt", "events", "finishedAt", "lifecycleNotBefore", "startedAt"],
    "journey one-shot lifecycle",
  );
  const lifecycleNotBefore = exactTimestamp(
    value.lifecycleNotBefore,
    "one-shot lifecycle lower bound",
  );
  const createdAt = exactTimestamp(value.createdAt, "one-shot created timestamp");
  const startedAt = exactTimestamp(value.startedAt, "one-shot started timestamp");
  const finishedAt = exactTimestamp(value.finishedAt, "one-shot finished timestamp");
  const attestedAt = exactTimestamp(value.attestedAt, "one-shot attested timestamp");
  if (!(lifecycleNotBefore <= createdAt
    && createdAt <= startedAt && startedAt <= finishedAt && finishedAt <= attestedAt)) {
    fail("Journey one-shot state timestamp order is invalid.");
  }
  if (expectedLifecycleNotBefore !== undefined
    && value.lifecycleNotBefore !== expectedLifecycleNotBefore) {
    fail("Journey one-shot lifecycle lower bound differs from its verifier launch receipt.");
  }
  if (!Array.isArray(value.events) || value.events.length !== 3) {
    const error = new Error("Journey one-shot event history is missing, truncated, or repeated.");
    oneShotLifecycleFailureEvidenceByError.set(
      error,
      createOneShotLifecycleFailureEvidence(value, container),
    );
    throw error;
  }
  const expectedActions = ["create", "start", "die"];
  const idSha256 = sha256(container.Id);
  let previous = 0n;
  for (const [index, event] of value.events.entries()) {
    exactObjectKeys(
      event,
      ["action", "containerIdSha256", "timeNano"],
      "journey one-shot event",
    );
    if (event.action !== expectedActions[index] || event.containerIdSha256 !== idSha256
      || !/^[1-9]\d{15,24}$/.test(event.timeNano)) {
      fail("Journey one-shot event sequence differs from create-start-die exactly once.");
    }
    const current = BigInt(event.timeNano);
    if (current <= previous) fail("Journey one-shot event timestamps are not strictly ordered.");
    previous = current;
  }
  const startEventMs = Number(BigInt(value.events[1].timeNano) / 1_000_000n);
  const dieEventMs = Number(BigInt(value.events[2].timeNano) / 1_000_000n);
  if (Math.abs(startEventMs - startedAt) > 10_000 || Math.abs(dieEventMs - finishedAt) > 10_000) {
    fail("Journey one-shot event history differs from inspected state timestamps.");
  }
  return value;
}

function lifecycleSince(createdAt) {
  const created = exactTimestamp(createdAt, "container created timestamp");
  return new Date(created - 1_000).toISOString();
}

function createOneShotLifecycleFailureEvidence(value, container) {
  const events = Array.isArray(value.events) ? value.events : [];
  const labels = container?.Config?.Labels;
  const rawService = labels && typeof labels === "object"
    ? labels["com.docker.compose.service"]
    : undefined;
  const service = oneShotServices.has(rawService) ? rawService : "unknown";
  const actionSet = new Set(["create", "die", "restart", "start"]);
  const actions = events.slice(0, 8).map((event) => (
    actionSet.has(event?.action) ? event.action : "invalid"
  ));
  const observedEventCount = Number.isSafeInteger(events.length) && events.length >= 0
    ? Math.min(events.length, 9)
    : -1;
  const exitCode = Number.isSafeInteger(container?.State?.ExitCode)
    ? container.State.ExitCode
    : null;
  const restartCount = Number.isSafeInteger(container?.RestartCount)
    ? container.RestartCount
    : null;
  const allowedStates = new Set([
    "created", "dead", "exited", "paused", "removing", "restarting", "running",
  ]);
  const stateStatus = allowedStates.has(container?.State?.Status)
    ? container.State.Status
    : "invalid";
  return Object.freeze({
    actions: Object.freeze(actions),
    eventCountTruncated: events.length > 8,
    exitCode,
    observedEventCount,
    restartCount,
    service,
    stateStatus,
  });
}

function exactTimestamp(value, label) {
  if (typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    fail(`${label} is invalid.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) fail(`${label} is invalid.`);
  return milliseconds;
}

function exactDockerIds(value, expectedCount, label) {
  const values = splitLines(value);
  if (values.length !== expectedCount || values.some((id) => !/^[a-f0-9]{64}$/.test(id))) {
    fail(`${label} do not match the exact bounded ownership set.`);
  }
  return [...new Set(values)].sort();
}

function exactDockerNames(value, expectedCount, label) {
  const values = splitLines(value);
  if (
    values.length !== expectedCount
    || new Set(values).size !== values.length
    || values.some((name) => !/^[a-z0-9][a-z0-9_.-]{1,200}$/.test(name))
  ) fail(`${label} do not match the exact bounded ownership set.`);
  return values.sort();
}

function splitLines(value) {
  return String(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function effectiveList(override, inherited) {
  const value = override === undefined || override === null ? inherited : override;
  if (value === undefined || value === null) return null;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  fail("Journey service command or entrypoint is invalid.");
}

function normalizeRestart(value) {
  return value === undefined || value === null ? "no" : String(value);
}

function normalizeCaps(value) {
  return (value ?? []).map((capability) => String(capability).replace(/^CAP_/, "")).sort();
}

function normalizeSecurity(value) {
  return (value ?? []).map((option) => (
    option === "no-new-privileges" ? "no-new-privileges:true" : option
  )).sort();
}

export function normalizeJourneyHostPath(value, platform = process.platform) {
  let normalized = String(value);
  if (platform === "win32") {
    normalized = normalized.replace(/\\/g, "/");
    normalized = normalized.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i, "$1:/");
    return normalized.replace(/\/$/, "").toLowerCase();
  }
  return normalized.length > 1 ? normalized.replace(/\/$/, "") : normalized;
}

function normalizeHostPath(value) {
  return normalizeJourneyHostPath(value);
}

function parseBytes(value) {
  const match = /^(\d+)([kmgt])?$/i.exec(String(value));
  if (!match) fail("Journey tmpfs size is invalid.");
  const power = { undefined: 0, k: 1, m: 2, g: 3, t: 4 }[match[2]?.toLowerCase()];
  return Number(match[1]) * (1024 ** power);
}

function numericBytes(value) {
  if (value === undefined || value === null) return 0;
  if (Number.isFinite(Number(value))) return Number(value);
  return parseBytes(value);
}

function canonicalRepoDigest(reference) {
  const [named, digest] = reference.split("@");
  const lastSlash = named.lastIndexOf("/");
  const lastColon = named.lastIndexOf(":");
  const repository = lastColon > lastSlash ? named.slice(0, lastColon) : named;
  return `${repository}@${digest}`;
}

function exactRepoDigestSet(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2
    || value.some((digest) => !/^sha256:[a-f0-9]{64}$/.test(digest))) {
    fail("Expected application repository digest set is invalid.");
  }
  return [...new Set(value)].sort();
}

function assertRuntimeRepoDigests(value, expectedDigests) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) {
    fail("Runtime application repository digest set is invalid.");
  }
  const observed = value.map((entry) => {
    const match = /@(?<digest>sha256:[a-f0-9]{64})$/.exec(entry ?? "");
    if (!match || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$/.test(entry)) {
      fail("Runtime application repository digest is invalid.");
    }
    if (!expectedDigests.includes(match.groups.digest)) {
      fail("Runtime application repository digest escaped the attested OCI source.");
    }
    return entry;
  }).sort();
  if (new Set(observed).size !== observed.length) {
    fail("Runtime application repository digest is duplicated.");
  }
  return hashJson(observed);
}

function durationSeconds(value) {
  if (Number.isFinite(Number(value))) return Number(value) / 1e9;
  return durationNanoseconds(value) / 1e9;
}

function durationNanoseconds(value) {
  if (value === undefined || value === null || value === "") return 0;
  if (Number.isFinite(Number(value))) return Number(value);
  const source = String(value);
  const unitNanoseconds = {
    h: 3_600_000_000_000,
    m: 60_000_000_000,
    s: 1_000_000_000,
    ms: 1_000_000,
    us: 1_000,
    "µs": 1_000,
    ns: 1,
  };
  let total = 0;
  let cursor = 0;
  for (const match of source.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)) {
    if (match.index !== cursor) fail("Journey duration is invalid.");
    total += Number(match[1]) * unitNanoseconds[match[2]];
    cursor += match[0].length;
  }
  if (cursor !== source.length || !Number.isSafeInteger(total)) fail("Journey duration is invalid.");
  return total;
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    fail(`${label} is not valid JSON.`);
  }
}

function exactObjectKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`);
  exactJson(Object.keys(value).sort(), [...keys].sort());
}

function exactOptionalObjectKeys(value, required, optional, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`);
  const actual = Object.keys(value).filter((name) => value[name] !== undefined).sort();
  if (required.some((name) => !actual.includes(name))
    || actual.some((name) => !required.includes(name) && !optional.includes(name))) {
    fail(`${label} keys are not exact.`);
  }
}

function exactDigest(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) fail(`${label} is invalid.`);
}

function exactImageReference(value, label) {
  if (typeof value !== "string"
    || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/.test(value)) fail(`${label} is invalid.`);
}

function exactJson(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("Journey runtime value differs.");
}

function exactValue(actual, expected) {
  if (actual !== expected) fail("Journey runtime value differs.");
}

function isWithin(parent, child) {
  const relative = path.relative(normalizeHostPath(parent), normalizeHostPath(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashJson(value) {
  return sha256(Buffer.from(JSON.stringify(value), "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function byDestination(left, right) {
  return left.destination.localeCompare(right.destination);
}

function byName(left, right) {
  return left[0].localeCompare(right[0]);
}

function byPort(left, right) {
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

/** @returns {never} */
function fail(message) {
  throw new Error(message);
}
