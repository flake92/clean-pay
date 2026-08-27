import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";

import {
  JOURNEY_COMPOSE_SERVICE_NAMES,
  JOURNEY_COMPOSE_VOLUME_NAMES,
  assertJourneyComposeRuntimeInspection,
  attestJourneyComposeRuntime,
  normalizeJourneyHostPath,
} from "./journey-compose-runtime-attestation.mjs";

type ComposeMountFixture = {
  type: "bind" | "volume";
  source: string;
  target: string;
  read_only?: boolean;
};

type ServiceFixture = Record<string, unknown> & {
  command: string[];
  volumes: ComposeMountFixture[];
};

type ContainerFixture = Record<string, unknown> & {
  Image: string;
  Config: {
    Cmd: string[];
    Env: string[];
    Image: string;
    [name: string]: unknown;
  };
  Mounts: Array<{ Name?: string; [name: string]: unknown }>;
  NetworkSettings: { Networks: Record<string, { Aliases: string[] }>; Ports: object };
  State: { Status: string; Running: boolean; ExitCode: number; [name: string]: unknown };
};

type ImageFixture = Record<string, unknown> & { RepoDigests: string[] };
type VolumeFixture = Record<string, unknown> & { Labels: Record<string, string> };

test("is import-safe and attests the exact full journey Compose runtime", () => {
  expect(typeof attestJourneyComposeRuntime).toBe("function");
  const fixture = runtimeFixture();
  expect(() => assertJourneyComposeRuntimeInspection(fixture)).not.toThrow();
  for (const container of Object.values(fixture.containersByService)) {
    (container.HostConfig as { LogConfig: { Type: string; Config: object } }).LogConfig.Type = "";
  }
  expect(() => assertJourneyComposeRuntimeInspection(fixture)).not.toThrow();
});

test("rejects image, command, mount, data, network, volume, alias, and environment near-misses", () => {
  const mutations: Array<[string, (value: ReturnType<typeof runtimeFixture>) => void]> = [
    ["fake image reference", (value) => {
      value.containersByService["browser-provider-mock"].Config.Image = "fake/provider:latest";
    }],
    ["fake helper image digest", (value) => {
      value.imagesById[value.containersByService.redis.Image].RepoDigests = [];
    }],
    ["unattested application repository digest", (value) => {
      value.imagesById[value.containersByService.app.Image].RepoDigests = [
        `registry.example/clean-pay@sha256:${"9".repeat(64)}`,
      ];
    }],
    ["OCI root masquerading as selected config ID", (value) => {
      value.imagesById[value.containersByService.app.Image].Id
        = value.expectedApplicationAssetImageDigest;
    }],
    ["aliased role image", (value) => {
      value.expectedMigrationRuntimeImageDigest = value.expectedApplicationImageConfigDigest;
    }],
    ["fake command", (value) => {
      value.containersByService["browser-provider-mock"].Config.Cmd = ["node", "/fake.mjs"];
    }],
    ["unused fixture mount", (value) => {
      value.compose.services["browser-provider-mock"].command = ["node", "/fake.mjs"];
      value.containersByService["browser-provider-mock"].Config.Cmd = ["node", "/fake.mjs"];
    }],
    ["wrong postgres data volume", (value) => {
      value.containersByService.postgres.Mounts[0].Name = "attestation_other_postgres-data";
    }],
    ["extra environment", (value) => {
      value.containersByService["browser-provider-mock"].Config.Env.push("TOKEN_SHADOW=unexpected");
    }],
    ["wrong network", (value) => {
      const container = value.containersByService.redis;
      container.NetworkSettings.Networks = {
        attestation_wrong: Object.values(container.NetworkSettings.Networks)[0],
      };
    }],
    ["wrong alias", (value) => {
      const networks = value.containersByService.redis.NetworkSettings.Networks as Record<
        string,
        { Aliases: string[] }
      >;
      Object.values(networks)[0].Aliases
        .push("postgres");
    }],
    ["wrong volume ownership", (value) => {
      value.volumes[0].Labels["com.docker.compose.project"] = "other";
    }],
    ["missing one-shot completion", (value) => {
      value.containersByService.migration.State.ExitCode = 1;
    }],
    ["manual one-shot rerun", (value) => {
      value.oneShotLifecycles.migration.events.push({
        ...value.oneShotLifecycles.migration.events[1],
        timeNano: "1767225600300000000",
      });
    }],
    ["one-shot restart count", (value) => {
      value.containersByService.migration.RestartCount = 1;
    }],
    ["one-shot timestamp inversion", (value) => {
      value.oneShotLifecycles.migration.finishedAt = "2025-12-31T23:59:59.000Z";
    }],
    ["one-shot predates verifier launch", (value) => {
      value.oneShotLifecycles.migration.lifecycleNotBefore = "2026-01-01T00:00:00.050Z";
    }],
  ];
  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(runtimeFixture());
    mutate(nearMiss);
    expect(() => assertJourneyComposeRuntimeInspection(nearMiss), label).toThrow();
  }
});

test("keeps Linux host paths case-sensitive and binds the actual daemon logging default", () => {
  expect(normalizeJourneyHostPath("/Repo/Fixture.mjs", "linux"))
    .not.toBe(normalizeJourneyHostPath("/repo/fixture.mjs", "linux"));
  expect(normalizeJourneyHostPath("C:\\Repo\\Fixture.mjs", "win32"))
    .toBe(normalizeJourneyHostPath("c:/repo/fixture.mjs", "win32"));
  const fixture = runtimeFixture();
  fixture.daemonLoggingDriver = "local";
  for (const container of Object.values(fixture.containersByService)) {
    (container.HostConfig as { LogConfig: { Type: string; Config: object } }).LogConfig = {
      Type: "local",
      Config: {},
    };
  }
  expect(() => assertJourneyComposeRuntimeInspection(fixture)).not.toThrow();
});

test("normalizes a valid single-manifest OCI root without weakening config identity", () => {
  const fixture = runtimeFixture();
  fixture.expectedApplicationRepoDigests = [
    fixture.expectedApplicationAssetImageDigest,
    fixture.expectedApplicationAssetImageDigest,
  ];
  expect(() => assertJourneyComposeRuntimeInspection(fixture)).not.toThrow();
});

function runtimeFixture() {
  const project = "clean-pay-browser-journey-provider-proof-baseline-aaaaaaaaaaaa";
  const appReference = "clean-pay-app:attestation";
  const migrationReference = "clean-pay-migration:attestation";
  const appDigest = `sha256:${"1".repeat(64)}`;
  const migrationAssetDigest = `sha256:${"5".repeat(64)}`;
  const migrationDigest = `sha256:${"2".repeat(64)}`;
  const contract = {
    project,
    revision: "a".repeat(40),
    images: { application: appReference, migration: migrationReference },
    publicBuildContract: { version: "1", sha256: "b".repeat(64) },
  };
  const bindSources: Record<string, string> = {
    "/app/browser-db-observer.mjs": "C:/repo/db-observer.mjs",
    "/etc/caddy/Caddyfile": "C:/repo/Caddyfile",
    "/fixture/db-observer-provision.sh": "C:/repo/db-observer-provision.sh",
    "/mock/oidc-mock.mjs": "C:/repo/oidc-mock.mjs",
    "/mock/provider-mock.mjs": "C:/repo/provider-mock.mjs",
  };
  const bindByService: Record<string, string> = {
    "browser-db-observer": "/app/browser-db-observer.mjs",
    "browser-db-observer-provision": "/fixture/db-observer-provision.sh",
    "browser-oidc-mock": "/mock/oidc-mock.mjs",
    "browser-provider-mock": "/mock/provider-mock.mjs",
    "browser-proxy": "/etc/caddy/Caddyfile",
  };
  const appServices = new Set(["app", "retention-worker"]);
  const migrationServices = new Set([
    "browser-db-observer", "db-grant-sync", "db-role-provision", "migration",
  ]);
  const oneShots = new Set([
    "browser-ca-ready", "browser-db-observer-provision", "db-grant-sync",
    "db-role-provision", "migration",
  ]);
  const createdAt = "2026-01-01T00:00:00.000Z";
  const lifecycleNotBefore = "2025-12-31T23:59:59.000Z";
  const startedAt = "2026-01-01T00:00:00.100Z";
  const finishedAt = "2026-01-01T00:00:00.200Z";
  const attestedAt = "2026-01-01T00:00:01.000Z";
  const helperReferences: Record<string, string> = {};
  for (const service of JOURNEY_COMPOSE_SERVICE_NAMES) {
    if (!appServices.has(service) && !migrationServices.has(service)) {
      helperReferences[service] = `fixture/${service}:v1@sha256:${hexFor(service).repeat(64).slice(0, 64)}`;
    }
  }
  const services: Record<string, ServiceFixture> = {};
  const containersByService: Record<string, ContainerFixture> = {};
  const imagesById: Record<string, ImageFixture> = {};
  const networkContainers: Record<string, { Name: string }> = {};
  for (const [index, serviceName] of JOURNEY_COMPOSE_SERVICE_NAMES.entries()) {
    const imageReference = appServices.has(serviceName)
      ? appReference
      : migrationServices.has(serviceName)
        ? migrationReference
        : helperReferences[serviceName];
    const imageId = appServices.has(serviceName)
      ? appDigest
      : migrationServices.has(serviceName)
        ? migrationDigest
        : `sha256:${String(index + 3).padStart(64, "0")}`;
    const bindTarget = bindByService[serviceName];
    const volumes: ComposeMountFixture[] = [];
    if (bindTarget) {
      volumes.push({ type: "bind", source: bindSources[bindTarget], target: bindTarget, read_only: true });
    }
    if (serviceName === "postgres") {
      volumes.push({ type: "volume", source: "postgres-data", target: "/var/lib/postgresql/data" });
    }
    if (serviceName === "redis") {
      volumes.push({ type: "volume", source: "redis-data", target: "/data" });
    }
    const command = bindTarget ? ["fixture", bindTarget] : ["fixture", serviceName];
    services[serviceName] = {
      image: imageReference,
      command,
      environment: { SERVICE_NAME: serviceName },
      networks: { default: null },
      read_only: true,
      cap_drop: ["ALL"],
      security_opt: ["no-new-privileges:true"],
      volumes,
    };
    const id = String(index + 10).padStart(64, "0");
    const aliases = [`${project}-${serviceName}-1`, serviceName];
    containersByService[serviceName] = {
      Id: id,
      Created: createdAt,
      Image: imageId,
      Name: `/${project}-${serviceName}-1`,
      RestartCount: 0,
      Config: {
        Cmd: command,
        Entrypoint: null,
        Env: [`PATH=/usr/local/bin`, `SERVICE_NAME=${serviceName}`],
        Image: imageReference,
        Labels: {
          "com.docker.compose.project": project,
          "com.docker.compose.service": serviceName,
        },
        User: "",
        WorkingDir: "",
      },
      HostConfig: {
        AutoRemove: false,
        CapAdd: null,
        CapDrop: ["ALL"],
        Init: null,
        LogConfig: { Type: "json-file", Config: {} },
        Memory: 0,
        NanoCpus: 0,
        NetworkMode: `${project}_default`,
        PidsLimit: 0,
        Privileged: false,
        ReadonlyRootfs: true,
        RestartPolicy: { Name: "no", MaximumRetryCount: 0 },
        SecurityOpt: ["no-new-privileges:true"],
        Tmpfs: {},
      },
      Mounts: volumes.map((mount) => ({
        Destination: mount.target,
        Name: mount.type === "volume" ? `${project}_${mount.source}` : undefined,
        RW: !mount.read_only,
        Source: mount.type === "bind" ? mount.source : `/volume/${mount.source}`,
        Type: mount.type,
      })),
      NetworkSettings: {
        Networks: { [`${project}_default`]: { Aliases: aliases } },
        Ports: {},
      },
      State: oneShots.has(serviceName)
        ? {
          Status: "exited", Running: false, ExitCode: 0,
          Dead: false, Paused: false, Restarting: false, OOMKilled: false,
          Pid: 0, Error: "", StartedAt: startedAt, FinishedAt: finishedAt,
        }
        : { Status: "running", Running: true, ExitCode: 0 },
    };
    if (!oneShots.has(serviceName)) {
      networkContainers[id] = { Name: `${project}-${serviceName}-1` };
    }
    if (!imagesById[imageId]) {
      const role = imageReference === appReference ? "app"
        : imageReference === migrationReference ? "migration"
          : undefined;
      imagesById[imageId] = {
        Id: imageId,
        RepoDigests: role === "app"
          ? [`registry.example/clean-pay@sha256:${"3".repeat(64)}`]
          : role === "migration"
            ? [`registry.example/clean-pay-migration@${migrationAssetDigest}`]
            : [imageReference.replace(/:[^/@]+@/, "@")],
        Config: {
          Cmd: null,
          Entrypoint: null,
          Env: ["PATH=/usr/local/bin"],
          Labels: role ? {
            "io.clean-pay.role": role,
            "org.opencontainers.image.revision": contract.revision,
            "io.clean-pay.public-build-contract-version": contract.publicBuildContract.version,
            "io.clean-pay.public-build-contract-sha256": contract.publicBuildContract.sha256,
          } : {},
          User: "",
          WorkingDir: "",
        },
      };
    }
  }
  const volumes: VolumeFixture[] = JOURNEY_COMPOSE_VOLUME_NAMES.map((name) => ({
    Name: `${project}_${name}`,
    Driver: "local",
    Options: null,
    Labels: {
      "com.docker.compose.project": project,
      "com.docker.compose.volume": name,
    },
  }));
  const oneShotLifecycles = Object.fromEntries([...oneShots].map((serviceName) => {
    const id = containersByService[serviceName].Id as string;
    const containerIdSha256 = hash(id);
    return [serviceName, {
      attestedAt,
      createdAt,
      lifecycleNotBefore,
      startedAt,
      finishedAt,
      events: [
        { action: "create", containerIdSha256, timeNano: "1767225600000000000" },
        { action: "start", containerIdSha256, timeNano: "1767225600100000000" },
        { action: "die", containerIdSha256, timeNano: "1767225600200000000" },
      ],
    }];
  }));
  return {
    attestedAt,
    bindSources,
    compose: {
      name: project,
      networks: { default: { name: `${project}_default` } },
      services,
      volumes: Object.fromEntries(JOURNEY_COMPOSE_VOLUME_NAMES.map((name) => [
        name, { name: `${project}_${name}` },
      ])),
    },
    containersByService,
    contract,
    daemonLoggingDriver: "json-file",
    expectedApplicationAssetImageDigest: `sha256:${"3".repeat(64)}`,
    expectedApplicationImageConfigDigest: appDigest,
    expectedApplicationReference: contract.images.application,
    expectedApplicationRepoDigests: [
      `sha256:${"3".repeat(64)}`,
      `sha256:${"4".repeat(64)}`,
    ],
    expectedMigrationAssetImageDigest: migrationAssetDigest,
    expectedMigrationReference: contract.images.migration,
    expectedMigrationRuntimeImageDigest: migrationDigest,
    imagesById,
    network: {
      Name: `${project}_default`,
      Driver: "bridge",
      Internal: false,
      Attachable: false,
      Ingress: false,
      Containers: networkContainers,
      Labels: {
        "com.docker.compose.project": project,
        "com.docker.compose.network": "default",
      },
    },
    oneShotLifecycles,
    lifecycleNotBefore,
    volumes,
  };
}

function hexFor(value: string) {
  return (value.charCodeAt(0) % 16).toString(16);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
