import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  JOURNEY_COMPOSE_SERVICE_NAMES,
  JOURNEY_COMPOSE_VOLUME_NAMES,
  assertJourneyComposeRuntimeInspection,
  assertJourneyOneShotLifecycle,
  attestJourneyComposeRuntime,
  collectJourneyOneShotLifecycleFailureEvidence,
  normalizeJourneyHostPath,
} from "./journey-compose-runtime-attestation.mjs";
import {
  attestJourneyCapturedLifecycle,
  dockerEventNanosecondsToIso,
} from "./journey-compose-lifecycle-capture.mjs";

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
  ImageManifestDescriptor?: {
    digest: string;
    mediaType: string;
    platform: { architecture: string; os: string };
    size: number;
    [name: string]: unknown;
  };
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

type ImageFixture = Record<string, unknown> & {
  Descriptor?: {
    digest: string;
    mediaType?: string;
    size?: number;
    [name: string]: unknown;
  };
  Id?: string;
  RepoDigests: string[];
};
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

test("matches multiple tmpfs entries by target and rejects an option near-miss", () => {
  const fixture = runtimeFixture();
  fixture.compose.services["browser-proxy"].tmpfs = [
    "/tmp:rw,noexec,size=16m",
    "/config:rw,size=8m",
  ];
  (fixture.containersByService["browser-proxy"].HostConfig as {
    Tmpfs: Record<string, string>;
  }).Tmpfs = {
    "/config": "rw,size=8388608",
    "/tmp": "size=16777216,noexec,rw",
  };

  expect(() => assertJourneyComposeRuntimeInspection(fixture)).not.toThrow();

  const nearMiss = structuredClone(fixture);
  (nearMiss.containersByService["browser-proxy"].HostConfig as {
    Tmpfs: Record<string, string>;
  }).Tmpfs["/config"] = "rw,size=16777216";
  expect(() => assertJourneyComposeRuntimeInspection(nearMiss)).toThrow();
});

test("emits bounded sanitized evidence when retrospective one-shot events are incomplete", () => {
  const fixture = runtimeFixture();
  const container = fixture.containersByService.migration;
  const lifecycle = structuredClone(fixture.oneShotLifecycles.migration);
  lifecycle.events.shift();
  let failure: unknown;
  try {
    assertJourneyOneShotLifecycle(lifecycle, container);
  } catch (error) {
    failure = new AggregateError([new AggregateError([error])]);
  }
  expect(collectJourneyOneShotLifecycleFailureEvidence(failure)).toEqual([{
    actions: ["start", "die"],
    eventCountTruncated: false,
    exitCode: 0,
    observedEventCount: 2,
    restartCount: 0,
    service: "migration",
    stateStatus: "exited",
  }]);
  expect(JSON.stringify(collectJourneyOneShotLifecycleFailureEvidence(failure)))
    .not.toContain(container.Id);

  const revoked = Proxy.revocable(new Error("secret"), {});
  revoked.revoke();
  expect(collectJourneyOneShotLifecycleFailureEvidence(revoked.proxy)).toEqual([]);

  let proxyTraps = 0;
  const trapped = new Proxy(new Error("secret"), {
    getOwnPropertyDescriptor: () => {
      proxyTraps += 1;
      return undefined;
    },
  });
  expect(collectJourneyOneShotLifecycleFailureEvidence(new AggregateError([trapped])))
    .toEqual([]);
  expect(proxyTraps).toBe(0);

  let accessorReads = 0;
  const accessorChildren: unknown[] = [];
  Object.defineProperty(accessorChildren, "0", {
    configurable: true,
    get: () => {
      accessorReads += 1;
      return new Error("secret");
    },
  });
  const accessorAggregate = new AggregateError([]);
  Object.defineProperty(accessorAggregate, "errors", { value: accessorChildren });
  expect(collectJourneyOneShotLifecycleFailureEvidence(accessorAggregate)).toEqual([]);
  expect(accessorReads).toBe(0);

  let poisonedEventTraps = 0;
  const poisonedEvent = new Proxy({}, {
    getOwnPropertyDescriptor: () => {
      poisonedEventTraps += 1;
      return undefined;
    },
  });
  lifecycle.events = [poisonedEvent as never];
  let poisonedFailure: unknown;
  try {
    assertJourneyOneShotLifecycle(lifecycle, container);
  } catch (error) {
    poisonedFailure = error;
  }
  expect((poisonedFailure as Error).message)
    .toBe("Journey one-shot event history is missing, truncated, or repeated.");
  expect(collectJourneyOneShotLifecycleFailureEvidence(poisonedFailure)).toEqual([{
    actions: [],
    eventCountTruncated: false,
    exitCode: null,
    observedEventCount: -1,
    restartCount: null,
    service: "unknown",
    stateStatus: "invalid",
  }]);
  expect(poisonedEventTraps).toBe(0);
});

test("binds a live lifecycle stream to exact barriers, current IDs and service transitions", () => {
  const startReceipt = Object.freeze({
    containerId: "a".repeat(64),
    nonce: "1".repeat(32),
    phase: "start",
    timeNano: "1767225599000000000",
  });
  const endReceipt = Object.freeze({
    containerId: "b".repeat(64),
    nonce: "2".repeat(32),
    phase: "end",
    timeNano: "1767225601000000000",
  });
  const jobId = "c".repeat(64);
  const webId = "d".repeat(64);
  const validLines = [
    `${startReceipt.timeNano}|create|${startReceipt.containerId}|journey-event-barrier|${startReceipt.nonce}`,
    `1767225600000000001|create|${jobId}|job|-`,
    `1767225600100000001|start|${jobId}|job|-`,
    `1767225600200000001|die|${jobId}|job|-`,
    `1767225600300000001|create|${webId}|web|-`,
    `1767225600400000001|start|${webId}|web|-`,
    `${endReceipt.timeNano}|create|${endReceipt.containerId}|journey-event-barrier|${endReceipt.nonce}`,
  ];
  const input = (lines = validLines, sealedOverrides: Record<string, unknown> = {}) => ({
    containersByService: { job: { Id: jobId }, web: { Id: webId } },
    lifecycleNotBefore: "2025-12-31T23:59:59.000Z",
    oneShotServiceNames: new Set(["job"]),
    sealed: Object.freeze({
      endReceipt,
      output: lines.join("\n"),
      startReceipt,
      ...sealedOverrides,
    }),
    serviceNames: ["job", "web"],
  });

  const result = attestJourneyCapturedLifecycle(input());
  expect(result.attestedAt).toBe("2026-01-01T00:00:01.000Z");
  expect(result.eventsByContainer.get(jobId)?.map((line: string) => line.split(" ")[1]))
    .toEqual(["create", "start", "die"]);
  expect(result.eventsByContainer.get(webId)?.map((line: string) => line.split(" ")[1]))
    .toEqual(["create", "start"]);

  const invalidStreams = [
    validLines.filter((line) => !line.includes(`|die|${jobId}|`)),
    validLines.toSpliced(5, 0, `1767225600350000001|restart|${webId}|web|-`),
    validLines.toSpliced(5, 0, `1767225600350000001|start|${webId}|web|-`),
    validLines.map((line) => line.includes(`|create|${jobId}|job|`)
      ? line.replace(jobId, "e".repeat(64)) : line),
    validLines.map((line) => line.includes(`|start|${jobId}|job|`)
      ? line.replace("1767225600100000001", "1767225598000000001") : line),
    validLines.toSpliced(3, 0, `1767225600150000001|create|${"f".repeat(64)}|journey-event-barrier|${"3".repeat(32)}`),
  ];
  for (const lines of invalidStreams) {
    expect(() => attestJourneyCapturedLifecycle(input(lines))).toThrow();
  }
  expect(() => attestJourneyCapturedLifecycle(input(
    validLines.map((line) => `${line}\r`),
  ))).toThrow(/line boundary/);
  expect(() => attestJourneyCapturedLifecycle(input(validLines, {
    output: "x".repeat(64 * 1024 + 1),
  }))).toThrow(/bounded/);

  let proxyTraps = 0;
  const poisoned = new Proxy({}, {
    ownKeys: () => {
      proxyTraps += 1;
      return [];
    },
  });
  expect(() => attestJourneyCapturedLifecycle(input(validLines, {
    startReceipt: poisoned,
  }))).toThrow(/invalid/);
  expect(proxyTraps).toBe(0);
  expect(() => dockerEventNanosecondsToIso("8640000000000001000000"))
    .toThrow(/date range/);
});

test("keeps the classic config-selection output and binding hashes byte-for-byte stable", () => {
  const fixture = runtimeFixture();
  const result = assertJourneyComposeRuntimeInspection(fixture);
  expect(Object.keys(result).sort()).toEqual([
    "applicationImageBindingContractSha256",
    "applicationRepoDigestContractSha256",
    "migrationImageBindingContractSha256",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "serviceIdentitySha256",
  ]);
  expect(result.applicationImageBindingContractSha256).toBe(hash(JSON.stringify({
    assetImageDigest: fixture.expectedApplicationAssetImageDigest,
    configDigest: fixture.expectedApplicationImageConfigDigest,
    referenceSha256: hash(fixture.expectedApplicationReference),
    repoDigests: [...new Set(fixture.expectedApplicationRepoDigests)].sort(),
    role: "application",
  })));
  expect(result.migrationImageBindingContractSha256).toBe(hash(JSON.stringify({
    assetImageDigest: fixture.expectedMigrationAssetImageDigest,
    configDigest: fixture.expectedMigrationRuntimeImageDigest,
    referenceSha256: hash(fixture.expectedMigrationReference),
    repoDigests: [fixture.expectedMigrationAssetImageDigest],
    role: "migration",
  })));

  const legacyDescriptorFixture = runtimeFixture();
  legacyDescriptorFixture.imagesById[
    legacyDescriptorFixture.containersByService.app.Image
  ].Descriptor = { digest: legacyDescriptorFixture.expectedApplicationAssetImageDigest };
  legacyDescriptorFixture.imagesById[
    legacyDescriptorFixture.containersByService.migration.Image
  ].Descriptor = { digest: legacyDescriptorFixture.expectedMigrationAssetImageDigest };
  const helperReference = legacyDescriptorFixture.compose.services.redis.image;
  if (typeof helperReference !== "string") {
    throw new Error("Synthetic helper reference is not a string.");
  }
  const helperDigest = /@(sha256:[a-f0-9]{64})$/.exec(helperReference)?.[1];
  if (!helperDigest) throw new Error("Synthetic helper reference is not digest-pinned.");
  legacyDescriptorFixture.imagesById[
    legacyDescriptorFixture.containersByService.redis.Image
  ].Descriptor = { digest: helperDigest };
  expect(assertJourneyComposeRuntimeInspection(legacyDescriptorFixture)).toEqual(result);
});

test("attests containerd OCI roots and exact platform manifests without child references", () => {
  const fixture = containerdRuntimeFixture();
  const result = assertJourneyComposeRuntimeInspection(fixture);
  expect(result).toMatchObject({
    applicationManifestDigest: fixture.expectedApplicationManifestDigest,
    applicationRuntimeImageDigest: fixture.expectedApplicationRuntimeImageDigest,
    imageSelectionMode: "containerd-root-manifest",
    migrationManifestDigest: fixture.expectedMigrationManifestDigest,
    migrationRuntimeImageDigest: fixture.expectedMigrationRuntimeImageDigest,
  });
  expect(Object.keys(result).sort()).toEqual([
    "applicationImageBindingContractSha256",
    "applicationManifestDigest",
    "applicationRepoDigestContractSha256",
    "applicationRuntimeImageDigest",
    "imageSelectionMode",
    "migrationImageBindingContractSha256",
    "migrationManifestDigest",
    "migrationRuntimeImageDigest",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "serviceIdentitySha256",
  ]);
  expect(result.applicationImageBindingContractSha256).toBe(hash(JSON.stringify({
    assetImageDigest: fixture.expectedApplicationAssetImageDigest,
    configDigest: fixture.expectedApplicationImageConfigDigest,
    imageSelectionMode: "containerd-root-manifest",
    manifestDigest: fixture.expectedApplicationManifestDigest,
    referenceSha256: hash(fixture.expectedApplicationReference),
    repoDigests: [...new Set(fixture.expectedApplicationRepoDigests)].sort(),
    role: "application",
    runtimeImageDigest: fixture.expectedApplicationRuntimeImageDigest,
  })));
  expect(result.migrationImageBindingContractSha256).toBe(hash(JSON.stringify({
    assetImageDigest: fixture.expectedMigrationAssetImageDigest,
    imageSelectionMode: "containerd-root-manifest",
    manifestDigest: fixture.expectedMigrationManifestDigest,
    referenceSha256: hash(fixture.expectedMigrationReference),
    repoDigests: [fixture.expectedMigrationAssetImageDigest],
    role: "migration",
    runtimeImageDigest: fixture.expectedMigrationRuntimeImageDigest,
  })));
});

test("attests a containerd single-manifest root with one identical root and manifest digest", () => {
  const fixture = containerdRuntimeFixture();
  const applicationRoot = fixture.expectedApplicationAssetImageDigest;
  fixture.expectedApplicationManifestDigest = applicationRoot;
  fixture.expectedApplicationRepoDigests = [applicationRoot];
  fixture.imagesById[applicationRoot].Descriptor!.mediaType =
    "application/vnd.oci.image.manifest.v1+json";
  for (const serviceName of ["app", "retention-worker"]) {
    fixture.containersByService[serviceName].ImageManifestDescriptor!.digest = applicationRoot;
  }
  expect(assertJourneyComposeRuntimeInspection(fixture)).toMatchObject({
    applicationManifestDigest: applicationRoot,
    applicationRuntimeImageDigest: applicationRoot,
  });
});

test("accepts exact single-manifest config annotations without exposing them in the result", () => {
  const fixture = containerdRuntimeFixture();
  const applicationContainers = makeContainerdRoleSingleManifest(
    fixture,
    "application",
    "application/vnd.oci.image.manifest.v1+json",
  );
  const migrationContainers = makeContainerdRoleSingleManifest(
    fixture,
    "migration",
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  const redisContainer = matchContainerdRootAndSelectedDescriptor(fixture, "redis");
  const expected = assertJourneyComposeRuntimeInspection(fixture);

  fixture.imagesById[fixture.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
    "config.digest": fixture.expectedApplicationImageConfigDigest,
  };
  for (const container of applicationContainers) {
    container.ImageManifestDescriptor!.annotations = {
      "config.digest": fixture.expectedApplicationImageConfigDigest,
    };
  }
  fixture.imagesById[fixture.expectedMigrationAssetImageDigest].Descriptor!.annotations = {
    "config.digest": `sha256:${"7".repeat(64)}`,
  };
  for (const container of migrationContainers) {
    container.ImageManifestDescriptor!.annotations = {
      "config.digest": `sha256:${"7".repeat(64)}`,
    };
  }
  fixture.imagesById[redisContainer.Image].Descriptor!.annotations = {
    "config.digest": `sha256:${"8".repeat(64)}`,
  };
  redisContainer.ImageManifestDescriptor!.annotations = {
    "config.digest": `sha256:${"8".repeat(64)}`,
  };

  const actual = assertJourneyComposeRuntimeInspection(fixture);
  expect(actual).toEqual(expected);
  expect(Object.keys(actual)).toEqual(Object.keys(expected));
});

test("accepts one-sided exact root or selected annotations without changing the result", () => {
  const fixture = containerdRuntimeFixture();
  makeContainerdRoleSingleManifest(
    fixture,
    "application",
    "application/vnd.oci.image.manifest.v1+json",
  );
  const migrationContainers = makeContainerdRoleSingleManifest(
    fixture,
    "migration",
    "application/vnd.docker.distribution.manifest.v2+json",
  );
  const redisContainer = matchContainerdRootAndSelectedDescriptor(fixture, "redis");
  const expected = assertJourneyComposeRuntimeInspection(fixture);

  fixture.imagesById[fixture.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
    "config.digest": fixture.expectedApplicationImageConfigDigest,
  };
  migrationContainers[0].ImageManifestDescriptor!.annotations = {
    "config.digest": `sha256:${"7".repeat(64)}`,
  };
  fixture.imagesById[redisContainer.Image].Descriptor!.annotations = {
    "config.digest": `sha256:${"8".repeat(64)}`,
  };

  expect(assertJourneyComposeRuntimeInspection(fixture)).toEqual(expected);
});

test("rejects an unannotated platform media type that differs from its single root", () => {
  const fixture = containerdRuntimeFixture();
  const [container] = makeContainerdRoleSingleManifest(
    fixture,
    "application",
    "application/vnd.oci.image.manifest.v1+json",
  );
  container.ImageManifestDescriptor!.mediaType =
    "application/vnd.docker.distribution.manifest.v2+json";
  expect(() => assertJourneyComposeRuntimeInspection(fixture))
    .toThrow(/differs from its single-manifest root/);
});

test("rejects config annotations outside the exact single-manifest root contract", () => {
  const mutations: Array<[
    string,
    (value: ReturnType<typeof containerdRuntimeFixture>) => void,
  ]> = [
    ["application index root", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.annotations = {
        "config.digest": value.expectedApplicationImageConfigDigest,
      };
    }],
    ["annotated application index root", (value) => {
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
        "config.digest": value.expectedApplicationImageConfigDigest,
      };
    }],
    ["wrong application config digest", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      container.ImageManifestDescriptor!.annotations = {
        "config.digest": `sha256:${"9".repeat(64)}`,
      };
    }],
    ["wrong application root config digest", (value) => {
      makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
        "config.digest": `sha256:${"9".repeat(64)}`,
      };
    }],
    ["extra annotation", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      container.ImageManifestDescriptor!.annotations = {
        "config.digest": value.expectedApplicationImageConfigDigest,
        unexpected: `sha256:${"9".repeat(64)}`,
      };
    }],
    ["extra root annotation", (value) => {
      makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
        "config.digest": value.expectedApplicationImageConfigDigest,
        unexpected: `sha256:${"9".repeat(64)}`,
      };
    }],
    ["malformed annotation object", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      container.ImageManifestDescriptor!.annotations = null;
    }],
    ["malformed root annotation object", (value) => {
      makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = null;
    }],
    ["array root annotation object", (value) => {
      makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations =
        [] as never;
    }],
    ["empty root annotation object", (value) => {
      makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = {};
    }],
    ["malformed root annotation digest", (value) => {
      makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
        "config.digest": "not-a-digest",
      };
    }],
    ["malformed annotation digest", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      container.ImageManifestDescriptor!.annotations = { "config.digest": "not-a-digest" };
    }],
    ["single-manifest media type mismatch", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      container.ImageManifestDescriptor!.mediaType =
        "application/vnd.docker.distribution.manifest.v2+json";
      container.ImageManifestDescriptor!.annotations = {
        "config.digest": value.expectedApplicationImageConfigDigest,
      };
    }],
    ["annotated descriptor size mismatch", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "application",
        "application/vnd.oci.image.manifest.v1+json",
      );
      value.imagesById[value.expectedApplicationAssetImageDigest].Descriptor!.annotations = {
        "config.digest": value.expectedApplicationImageConfigDigest,
      };
      container.ImageManifestDescriptor!.size += 1;
    }],
    ["root and selected config mismatch", (value) => {
      const [container] = makeContainerdRoleSingleManifest(
        value,
        "migration",
        "application/vnd.docker.distribution.manifest.v2+json",
      );
      value.imagesById[value.expectedMigrationAssetImageDigest].Descriptor!.annotations = {
        "config.digest": `sha256:${"7".repeat(64)}`,
      };
      container.ImageManifestDescriptor!.annotations = {
        "config.digest": `sha256:${"8".repeat(64)}`,
      };
    }],
    ["helper index root", (value) => {
      const container = value.containersByService.redis;
      const rootDigest = container.Image;
      value.imagesById[rootDigest].Descriptor!.mediaType =
        "application/vnd.oci.image.index.v1+json";
      container.ImageManifestDescriptor!.digest = `sha256:${"e".repeat(64)}`;
      container.ImageManifestDescriptor!.annotations = {
        "config.digest": `sha256:${"8".repeat(64)}`,
      };
    }],
  ];
  for (const [label, mutate] of mutations) {
    const nearMiss = containerdRuntimeFixture();
    mutate(nearMiss);
    expect(() => assertJourneyComposeRuntimeInspection(nearMiss), label).toThrow();
  }
});

test("requires index and list roots to select a distinct platform manifest digest", () => {
  for (const serviceName of ["app", "migration"] as const) {
    const fixture = containerdRuntimeFixture();
    const container = fixture.containersByService[serviceName];
    container.ImageManifestDescriptor!.digest = container.Image;
    expect(
      () => assertJourneyComposeRuntimeInspection(fixture),
      serviceName,
    ).toThrow(/index\/list OCI root aliases/);
  }
});

test("attests containerd descriptors for an exact linux arm64 platform", () => {
  const fixture = Object.assign(containerdRuntimeFixture(), {
    expectedImagePlatform: { architecture: "arm64", os: "linux" },
  });
  for (const container of Object.values(fixture.containersByService)) {
    if (container.ImageManifestDescriptor) {
      container.ImageManifestDescriptor.platform.architecture = "arm64";
      Object.assign(container.ImageManifestDescriptor.platform, { variant: "v8" });
    }
  }
  expect(() => assertJourneyComposeRuntimeInspection(fixture)).not.toThrow();
});

test("rejects malformed, unbound, third-digest, or mixed containerd selections", () => {
  const mutations: Array<[string, (value: ReturnType<typeof containerdRuntimeFixture>) => void]> = [
    ["missing role manifest", (value) => {
      delete value.containersByService.app.ImageManifestDescriptor;
    }],
    ["wrong role manifest", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.digest = `sha256:${"e".repeat(64)}`;
    }],
    ["malformed manifest media type", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.mediaType = "application/json";
    }],
    ["malformed manifest size", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.size = 0;
    }],
    ["oversized manifest", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.size = 16 * 1024 * 1024 + 1;
    }],
    ["malformed manifest platform", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.platform.architecture = "arm64";
    }],
    ["extended manifest descriptor", (value) => {
      value.containersByService.app.ImageManifestDescriptor!.unexpected = true;
    }],
    ["wrong authoritative root", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor!.digest
        = `sha256:${"e".repeat(64)}`;
    }],
    ["wrong authoritative root media type", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor!.mediaType
        = "application/json";
    }],
    ["single-manifest root with a different selected manifest", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor!.mediaType
        = "application/vnd.oci.image.manifest.v1+json";
    }],
    ["empty authoritative root", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor!.size = 0;
    }],
    ["oversized authoritative root", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor!.size
        = 16 * 1024 * 1024 + 1;
    }],
    ["extended authoritative root", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor!.unexpected = true;
    }],
    ["missing authoritative root", (value) => {
      delete value.imagesById[value.containersByService.app.Image].Descriptor;
    }],
    ["malformed authoritative root", (value) => {
      value.imagesById[value.containersByService.app.Image].Descriptor = [] as never;
    }],
    ["wrong inspected root ID", (value) => {
      value.imagesById[value.containersByService.app.Image].Id = `sha256:${"e".repeat(64)}`;
    }],
    ["third runtime digest", (value) => {
      const root = value.containersByService.app.Image;
      const third = `sha256:${"e".repeat(64)}`;
      value.imagesById[third] = structuredClone(value.imagesById[root]);
      value.imagesById[third].Id = third;
      value.imagesById[third].Descriptor = {
        digest: third,
        mediaType: "application/vnd.oci.image.index.v1+json",
        size: 1024,
      };
      value.containersByService.app.Image = third;
    }],
    ["mixed classic helper", (value) => {
      const helper = Object.entries(value.containersByService)
        .find(([name]) => !new Set(["app", "retention-worker", "browser-db-observer",
          "db-grant-sync", "db-role-provision", "migration"]).has(name))?.[1];
      if (!helper) throw new Error("Synthetic helper container is absent.");
      delete helper.ImageManifestDescriptor;
    }],
    ["missing expected manifest", (value) => {
      delete (value as Partial<typeof value>).expectedMigrationManifestDigest;
    }],
    ["application config aliases root", (value) => {
      value.expectedApplicationImageConfigDigest = value.expectedApplicationAssetImageDigest;
    }],
    ["application config aliases manifest", (value) => {
      value.expectedApplicationImageConfigDigest = value.expectedApplicationManifestDigest;
    }],
  ];
  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(containerdRuntimeFixture());
    mutate(nearMiss);
    expect(() => assertJourneyComposeRuntimeInspection(nearMiss), label).toThrow();
  }
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
    ["mixed containerd manifest descriptor", (value) => {
      value.containersByService.app.ImageManifestDescriptor = {
        digest: `sha256:${"4".repeat(64)}`,
        mediaType: "application/vnd.oci.image.manifest.v1+json",
        platform: { architecture: "amd64", os: "linux" },
        size: 512,
      };
    }],
    ["wrong classic root descriptor", (value) => {
      const selectedConfigDigest = value.containersByService.app.Image;
      value.imagesById[selectedConfigDigest].Descriptor = {
        digest: selectedConfigDigest,
      };
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

test("keeps the Compose Docker environment allowlist exact and deny-by-default", () => {
  const source = readFileSync(
    pathForRuntimeAttestationSource(),
    "utf8",
  );
  const match = /function composeQueryEnvironment[\s\S]*?for \(const name of \[([\s\S]*?)\]\)/
    .exec(source);
  expect(match).not.toBeNull();
  const names = [...(match?.[1] ?? "").matchAll(/"([A-Za-z0-9_]+)"/g)]
    .map((entry) => entry[1]);
  expect(names).toEqual([
    "APPDATA", "DOCKER_CERT_PATH", "DOCKER_CONFIG", "DOCKER_CONTEXT",
    "DOCKER_HOST", "DOCKER_TLS_VERIFY", "HOME", "LANG",
    "LC_ALL", "LOCALAPPDATA", "PATH", "Path", "PATHEXT", "SYSTEMROOT",
    "ProgramFiles", "ProgramW6432", "SystemRoot", "TEMP", "TMP", "USERPROFILE",
    "WINDIR", "XDG_CONFIG_HOME",
  ]);
  expect(names).not.toContain("COMPOSE_PROJECT_NAME");
  expect(names).not.toContain("DOCKER_API_VERSION");
  expect(names).not.toContain("CLEAN_PAY_IMAGE");
  expect(names).not.toContain("TOKEN");
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

function containerdRuntimeFixture() {
  const fixture = runtimeFixture();
  const originalApplicationReference = fixture.contract.images.application;
  const originalMigrationReference = fixture.contract.images.migration;
  const applicationRoot = fixture.expectedApplicationAssetImageDigest;
  const applicationManifest = `sha256:${"4".repeat(64)}`;
  const migrationRoot = fixture.expectedMigrationAssetImageDigest;
  const migrationManifest = `sha256:${"6".repeat(64)}`;
  fixture.contract.images.application = applicationRoot;
  fixture.contract.images.migration = migrationRoot;

  const imagesById: Record<string, ImageFixture> = {};
  for (const [index, [serviceName, service]] of Object.entries(fixture.compose.services).entries()) {
    const container = fixture.containersByService[serviceName];
    const originalImage = fixture.imagesById[container.Image];
    if (!originalImage) throw new Error(`Synthetic source image is absent for ${serviceName}.`);
    let manifestDigest;
    let rootDigest;
    let rootMediaType;
    let immutableReference;
    if (service.image === originalApplicationReference) {
      manifestDigest = applicationManifest;
      rootDigest = applicationRoot;
      rootMediaType = "application/vnd.oci.image.index.v1+json";
      immutableReference = applicationRoot;
    } else if (service.image === originalMigrationReference) {
      manifestDigest = migrationManifest;
      rootDigest = migrationRoot;
      rootMediaType = "application/vnd.docker.distribution.manifest.list.v2+json";
      immutableReference = migrationRoot;
    } else {
      rootDigest = `sha256:${hash(`containerd-helper-root:${index}:${serviceName}`)}`;
      rootMediaType = index % 2 === 0
        ? "application/vnd.oci.image.manifest.v1+json"
        : "application/vnd.docker.distribution.manifest.v2+json";
      manifestDigest = rootDigest;
      immutableReference = `fixture/${serviceName}@${rootDigest}`;
    }
    service.image = immutableReference;
    container.Config.Image = immutableReference;
    container.Image = rootDigest;
    container.ImageManifestDescriptor = {
      digest: manifestDigest,
      mediaType: index % 2 === 0
        ? "application/vnd.oci.image.manifest.v1+json"
        : "application/vnd.docker.distribution.manifest.v2+json",
      platform: { architecture: "amd64", os: "linux" },
      size: 512 + index,
    };
    if (!imagesById[rootDigest]) {
      imagesById[rootDigest] = {
        ...structuredClone(originalImage),
        Descriptor: { digest: rootDigest, mediaType: rootMediaType, size: 768 + index },
        Id: rootDigest,
        RepoDigests: immutableReference.includes("@")
          ? [immutableReference]
          : [...originalImage.RepoDigests],
      };
    }
  }
  fixture.imagesById = imagesById;
  fixture.expectedMigrationRuntimeImageDigest = migrationRoot;
  return Object.assign(fixture, {
    expectedApplicationManifestDigest: applicationManifest,
    expectedApplicationRuntimeImageDigest: applicationRoot,
    expectedImageSelectionMode: "containerd-root-manifest" as const,
    expectedMigrationManifestDigest: migrationManifest,
  });
}

function makeContainerdRoleSingleManifest(
  fixture: ReturnType<typeof containerdRuntimeFixture>,
  role: "application" | "migration",
  mediaType:
    | "application/vnd.docker.distribution.manifest.v2+json"
    | "application/vnd.oci.image.manifest.v1+json",
) {
  const reference = fixture.contract.images[role];
  const rootDigest = role === "application"
    ? fixture.expectedApplicationAssetImageDigest
    : fixture.expectedMigrationAssetImageDigest;
  const image = fixture.imagesById[rootDigest];
  if (!image?.Descriptor) throw new Error(`Synthetic ${role} root descriptor is absent.`);
  image.Descriptor.mediaType = mediaType;
  const rootSize = image.Descriptor.size;
  if (typeof rootSize !== "number") throw new Error(`Synthetic ${role} root size is absent.`);
  if (role === "application") {
    fixture.expectedApplicationManifestDigest = rootDigest;
    fixture.expectedApplicationRepoDigests = [rootDigest];
  } else {
    fixture.expectedMigrationManifestDigest = rootDigest;
  }
  const containers = Object.values(fixture.containersByService).filter(
    (container) => container.Config.Image === reference,
  );
  if (containers.length === 0) throw new Error(`Synthetic ${role} containers are absent.`);
  for (const container of containers) {
    if (!container.ImageManifestDescriptor) {
      throw new Error(`Synthetic ${role} manifest descriptor is absent.`);
    }
    container.ImageManifestDescriptor.digest = rootDigest;
    container.ImageManifestDescriptor.mediaType = mediaType;
    container.ImageManifestDescriptor.size = rootSize;
  }
  return containers;
}

function matchContainerdRootAndSelectedDescriptor(
  fixture: ReturnType<typeof containerdRuntimeFixture>,
  serviceName: keyof ReturnType<typeof containerdRuntimeFixture>["containersByService"],
) {
  const container = fixture.containersByService[serviceName];
  const rootDescriptor = fixture.imagesById[container.Image]?.Descriptor;
  const selectedDescriptor = container.ImageManifestDescriptor;
  if (!rootDescriptor || !selectedDescriptor
    || typeof rootDescriptor.mediaType !== "string"
    || typeof rootDescriptor.size !== "number") {
    throw new Error(`Synthetic ${String(serviceName)} descriptor identity is incomplete.`);
  }
  selectedDescriptor.digest = rootDescriptor.digest;
  selectedDescriptor.mediaType = rootDescriptor.mediaType;
  selectedDescriptor.size = rootDescriptor.size;
  return container;
}

function hexFor(value: string) {
  return (value.charCodeAt(0) % 16).toString(16);
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pathForRuntimeAttestationSource() {
  return path.resolve(
    process.cwd(),
    "tests/browser/journeys/journey-compose-runtime-attestation.mjs",
  );
}
