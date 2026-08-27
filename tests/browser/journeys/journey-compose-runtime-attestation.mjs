import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

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

const fixtureEnvironmentNames = Object.freeze({
  CLEAN_PAY_BROWSER_CADDYFILE: "/etc/caddy/Caddyfile",
  CLEAN_PAY_BROWSER_DB_OBSERVER_FILE: "/app/browser-db-observer.mjs",
  CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_FILE: "/fixture/db-observer-provision.sh",
  CLEAN_PAY_BROWSER_OIDC_MOCK_FILE: "/mock/oidc-mock.mjs",
  CLEAN_PAY_BROWSER_PROVIDER_MOCK_FILE: "/mock/provider-mock.mjs",
});

/**
 * Build the exact journey Compose model from its authoritative external env,
 * then bind every project-owned container, image, network, volume and fixture
 * mount to that model. The caller supplies a bounded, read-only Docker runner.
 */
export async function attestJourneyComposeRuntime({
  repositoryRoot,
  contractPath,
  contract,
  expectedApplicationImageDigest,
  expectedMigrationImageDigest,
  runDocker,
}) {
  exactObjectKeys(arguments[0], [
    "contract",
    "contractPath",
    "expectedApplicationImageDigest",
    "expectedMigrationImageDigest",
    "repositoryRoot",
    "runDocker",
  ], "journey runtime attestation input");
  if (typeof runDocker !== "function") fail("Journey runtime Docker reader is invalid.");
  exactDigest(expectedApplicationImageDigest, "expected application image digest");
  exactDigest(expectedMigrationImageDigest, "expected migration image digest");
  if (
    contract.images?.application === contract.images?.migration
    || expectedApplicationImageDigest === expectedMigrationImageDigest
  ) fail("Journey application and migration image identities must be distinct.");

  const root = await realpath(repositoryRoot);
  const authoritativeEnvironmentPath = await exactExternalFile(
    path.join(path.dirname(contractPath), ".env"),
    root,
    "authoritative journey environment",
  );
  const assignments = parseEnvironmentAssignments(
    await readBoundedBytes(authoritativeEnvironmentPath, 128 * 1024),
  );
  assertAuthoritativeEnvironment(assignments, contract);

  const bindSources = {};
  for (const [destination, relativeParts] of Object.entries(fixtureBindSources)) {
    const source = await realpath(path.join(root, ...relativeParts));
    const metadata = await lstat(source);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      fail("Journey fixture source is not an exact regular file.");
    }
    bindSources[destination] = source;
  }
  const queryEnvironment = composeQueryEnvironment(
    assignments,
    contract.project,
    bindSources,
  );
  const composeFiles = await Promise.all(composeFileRelativePaths.map((parts) => (
    realpath(path.join(root, ...parts))
  )));
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

  const containerIds = exactDockerIds(await runDocker([
    "ps", "--all", "--no-trunc", "--quiet",
    "--filter", `label=com.docker.compose.project=${contract.project}`,
  ], 4 * 1024), JOURNEY_COMPOSE_SERVICE_NAMES.length, "journey containers");
  const containers = await inspectMany(runDocker, "container", containerIds, 512 * 1024);
  const containersByService = indexProjectContainers(containers, contract.project);

  const imageIds = [...new Set(containers.map((container) => container.Image))].sort();
  const images = await inspectMany(runDocker, "image", imageIds, 512 * 1024);
  const imagesById = Object.fromEntries(images.map((image) => [image.Id, image]));

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

  const runtime = assertJourneyComposeRuntimeInspection({
    bindSources,
    compose,
    containersByService,
    contract,
    expectedApplicationImageDigest,
    expectedMigrationImageDigest,
    imagesById,
    network,
    volumes,
  });

  const liveFixtureMounts = [];
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
    } else if (!commandConsumesDestination(container, destination)) {
      fail("Completed journey fixture service did not execute its mounted source.");
    }
    liveFixtureMounts.push({ destination, sha256: expectedSha256 });
  }

  return Object.freeze({
    composeRuntimeContractSha256: hashJson({
      composeSourceSha256,
      renderedComposeSha256: hashJson(compose),
      runtime,
    }),
    fixtureMountContractSha256: hashJson(liveFixtureMounts.sort(byDestination)),
    serviceIdentitySha256: runtime.serviceIdentitySha256,
    networkSha256: runtime.networkSha256,
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
  exactObjectKeys(input, [
    "bindSources",
    "compose",
    "containersByService",
    "contract",
    "expectedApplicationImageDigest",
    "expectedMigrationImageDigest",
    "imagesById",
    "network",
    "volumes",
  ], "journey runtime inspection input");
  const {
    bindSources,
    compose,
    containersByService,
    contract,
    expectedApplicationImageDigest,
    expectedMigrationImageDigest,
    imagesById,
    network,
    volumes,
  } = input;
  exactDigest(expectedApplicationImageDigest, "expected application image digest");
  exactDigest(expectedMigrationImageDigest, "expected migration image digest");
  if (
    contract.images?.application === contract.images?.migration
    || expectedApplicationImageDigest === expectedMigrationImageDigest
  ) fail("Journey application and migration image identities must be distinct.");
  assertJourneyComposeModel(compose, contract);
  exactObjectKeys(
    containersByService,
    JOURNEY_COMPOSE_SERVICE_NAMES,
    "project-owned journey containers",
  );
  exactObjectKeys(bindSources, Object.keys(fixtureBindSources), "journey fixture bind sources");

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
      expectedApplicationImageDigest,
      expectedMigrationImageDigest,
      expectedNetworkName,
      expectedVolumeNames,
      image,
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

  return Object.freeze({
    networkSha256: sha256(expectedNetworkName),
    serviceIdentitySha256: hashJson(serviceIdentity),
  });
}

function assertServiceRuntime(input) {
  const {
    bindSources,
    container,
    contract,
    expectedApplicationImageDigest,
    expectedMigrationImageDigest,
    expectedNetworkName,
    expectedVolumeNames,
    image,
    service,
    serviceName,
  } = input;
  if (!container || !image || container.Image !== image.Id) fail("Journey service image is unbound.");
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
    service.image,
    contract,
    expectedApplicationImageDigest,
    expectedMigrationImageDigest,
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
  assertLogging(host.LogConfig, service.logging);
  assertTmpfs(host.Tmpfs, service.tmpfs);
  assertMounts(container.Mounts, service.volumes, bindSources, expectedVolumeNames);
  assertPublishedPorts(container.NetworkSettings?.Ports, service.ports);
  assertServiceNetwork(container, service, serviceName, contract.project, expectedNetworkName);
  assertServiceState(container, service, serviceName);

  for (const destination of Object.keys(bindSources)) {
    if ((service.volumes ?? []).some((mount) => mount.target === destination)
      && !commandConsumesDestination(container, destination)) {
      fail("Journey fixture bind is not consumed by its exact service command.");
    }
  }
}

function assertImageIdentity(
  image,
  reference,
  contract,
  expectedApplicationImageDigest,
  expectedMigrationImageDigest,
) {
  let expectedDigest;
  let role;
  if (reference === contract.images.application) {
    expectedDigest = expectedApplicationImageDigest;
    role = "app";
  } else if (reference === contract.images.migration) {
    expectedDigest = expectedMigrationImageDigest;
    role = "migration";
  } else {
    const match = /@(?<digest>sha256:[a-f0-9]{64})$/.exec(reference);
    if (!match) fail("Journey helper image is not digest-pinned.");
    const expectedRepoDigest = canonicalRepoDigest(reference);
    if (!(image.RepoDigests ?? []).includes(expectedRepoDigest)) {
      fail("Journey helper image digest reference differs from Compose.");
    }
    return;
  }
  if (image.Id !== expectedDigest) fail("Journey role image digest differs from its explicit input.");
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

function assertServiceState(container, service, serviceName) {
  const oneShot = oneShotServices.has(serviceName);
  if (oneShot) {
    if (
      container.State?.Status !== "exited"
      || container.State?.Running !== false
      || container.State?.ExitCode !== 0
    ) fail("Journey one-shot service did not complete exactly once.");
  } else if (
    container.State?.Status !== "running"
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

function assertLogging(actual, expected) {
  exactValue(actual?.Type ?? "json-file", expected?.driver ?? "json-file");
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

function assertAuthoritativeEnvironment(environment, contract) {
  const expected = {
    CLEAN_PAY_IMAGE: contract.images.application,
    CLEAN_PAY_MIGRATION_IMAGE: contract.images.migration,
    CLEAN_PAY_REVISION: contract.revision,
    COMPOSE_PROJECT_NAME: contract.project,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (environment[name] !== value) fail("Authoritative journey environment differs from contract.");
  }
}

function composeQueryEnvironment(assignments, project, bindSources) {
  const environment = { ...process.env };
  for (const name of Object.keys(environment)) {
    if (name.startsWith("COMPOSE_") || Object.hasOwn(assignments, name)) delete environment[name];
  }
  environment.COMPOSE_PROJECT_NAME = project;
  for (const [name, destination] of Object.entries(fixtureEnvironmentNames)) {
    environment[name] = bindSources[destination];
  }
  return environment;
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
  const resolved = await realpath(target);
  if (isWithin(repositoryRoot, resolved)) fail(`${label} must stay outside the repository.`);
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) fail(`${label} must be a regular file.`);
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

function parseEnvironmentAssignments(bytes) {
  const source = bytes.toString("utf8");
  if (!source.endsWith("\n") || source.includes("\r") || source.startsWith("\uFEFF")) {
    fail("Authoritative journey environment has non-canonical bytes.");
  }
  const result = {};
  for (const line of source.slice(0, -1).split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1])) {
      fail("Authoritative journey environment contains an invalid assignment.");
    }
    result[match[1]] = match[2];
  }
  return result;
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

function normalizeHostPath(value) {
  let normalized = String(value).replace(/\\/g, "/");
  normalized = normalized.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//i, "$1:/");
  return normalized.replace(/\/$/, "").toLowerCase();
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

function exactDigest(value, label) {
  if (!/^sha256:[a-f0-9]{64}$/.test(value)) fail(`${label} is invalid.`);
}

function exactJson(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("Journey runtime value differs.");
}

function exactValue(actual, expected) {
  if (actual !== expected) fail("Journey runtime value differs.");
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
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
