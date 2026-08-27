#!/usr/bin/env node

import { createHash } from "node:crypto";
import { open, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSET_ATTESTATION_KIND = "clean-pay-production-image-static-asset-attestation";
const ASSET_ATTESTATION_SCHEMA_VERSION = 1;
const PROOF_KIND = "clean-pay-served-cabinet-route-asset-proof";
const PROOF_SCHEMA_VERSION = 1;
const CABINET_ROUTE = "/cabinet/page";
const CABINET_CLIENT_MODULE_COUNT = 16;
const MAX_ATTESTATION_BYTES = 32 * 1024 * 1024;
const MAX_INVENTORY_ASSETS = 4_096;
const MAX_INVENTORY_ASSET_BYTES = 128 * 1024 * 1024;
const MAX_INVENTORY_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_ROUTE_CHUNKS = 64;
const MAX_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_ROUTE_BYTES = 256 * 1024 * 1024;
const OBSERVATION_TIMEOUT_MS = 30_000;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA256_DIGEST = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const SAFE_VERSION = /^[A-Za-z0-9._-]{1,32}$/;
const STATIC_CHUNK = /^\/_next\/static\/chunks\/[A-Za-z0-9._/-]+$/;
const STATIC_MEDIA = /^\/_next\/static\/media\/[A-Za-z0-9._-]{1,200}\.(?:eot|ico|png|svg|ttf|woff|woff2)$/;

export async function proveServedCabinetAssets({ baseline, candidate, fetchImpl = fetch }) {
  const baselineInput = validateSideInput(baseline, "baseline");
  const candidateInput = validateSideInput(candidate, "candidate");
  if (baselineInput.baseUrl.origin === candidateInput.baseUrl.origin) {
    throw new Error("Baseline and candidate observations must use distinct loopback origins.");
  }
  if (
    baselineInput.expected.publicBuildContract.version
      !== candidateInput.expected.publicBuildContract.version
    || baselineInput.expected.publicBuildContract.sha256
      !== candidateInput.expected.publicBuildContract.sha256
  ) {
    throw new Error("Baseline and candidate must use the same exact public build contract.");
  }
  if (baselineInput.expected.fixtureContract.version
    !== candidateInput.expected.fixtureContract.version) {
    throw new Error("Baseline and candidate browser fixture versions must match.");
  }

  const baselineAttestation = validateProductionImageAssetAttestation(
    baselineInput.attestation,
    baselineInput.expected,
    "baseline",
  );
  const candidateAttestation = validateProductionImageAssetAttestation(
    candidateInput.attestation,
    candidateInput.expected,
    "candidate",
  );
  if (baselineAttestation.source.imageDigest === candidateAttestation.source.imageDigest) {
    throw new Error("Baseline and candidate production image digests must be distinct.");
  }
  if (baselineAttestation.source.revision === candidateAttestation.source.revision) {
    throw new Error("Baseline and candidate source revisions must be distinct.");
  }

  const baselineRoute = exactCabinetRoute(baselineAttestation, "baseline");
  const candidateRoute = exactCabinetRoute(candidateAttestation, "candidate");
  assertIdenticalClientModuleClosure(baselineRoute, candidateRoute);
  if (baselineRoute.moduleChunkAssignmentSha256 === candidateRoute.moduleChunkAssignmentSha256) {
    throw new Error("The exact cabinet module-to-chunk assignments do not differ.");
  }
  if (baselineRoute.declaredStaticChunkSetSha256 === candidateRoute.declaredStaticChunkSetSha256) {
    throw new Error("The exact cabinet declared chunk partitions do not differ.");
  }

  const [baselineObservations, candidateObservations] = await Promise.all([
    observeDeclaredChunks({
      attestation: baselineAttestation,
      baseUrl: baselineInput.baseUrl,
      fetchImpl,
      label: "baseline",
      route: baselineRoute,
    }),
    observeDeclaredChunks({
      attestation: candidateAttestation,
      baseUrl: candidateInput.baseUrl,
      fetchImpl,
      label: "candidate",
      route: candidateRoute,
    }),
  ]);

  const sides = {
    baseline: buildProofSide(
      baselineAttestation,
      baselineInput,
      baselineRoute,
      baselineObservations,
    ),
    candidate: buildProofSide(
      candidateAttestation,
      candidateInput,
      candidateRoute,
      candidateObservations,
    ),
  };
  const unsigned = {
    kind: PROOF_KIND,
    schemaVersion: PROOF_SCHEMA_VERSION,
    route: CABINET_ROUTE,
    sides,
    assertions: {
      allDeclaredChunksObservedAndImageMatched: true,
      clientModuleCount: CABINET_CLIENT_MODULE_COUNT,
      clientModuleSetSha256: baselineRoute.clientModuleSetSha256,
      declaredChunkPartitionsDiffer: true,
      moduleChunkAssignmentsDiffer: true,
      publicBuildContractIdentical: true,
    },
  };
  const proof = { ...unsigned, proofSha256: digestCanonical(unsigned) };
  validateServedCabinetAssetProof(proof, {
    baseline: baselineInput.expected,
    candidate: candidateInput.expected,
  });
  return proof;
}

export function validateProductionImageAssetAttestation(value, expected, label = "image") {
  assertExactKeys(value, [
    "attestationSha256",
    "correlation",
    "inventory",
    "kind",
    "schemaVersion",
    "source",
  ], `${label} asset attestation`);
  if (
    value.kind !== ASSET_ATTESTATION_KIND
    || value.schemaVersion !== ASSET_ATTESTATION_SCHEMA_VERSION
    || !SHA256.test(value.attestationSha256 ?? "")
  ) throw new Error(`${label} asset attestation identity is invalid.`);
  const unsigned = {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    source: value.source,
    inventory: value.inventory,
    correlation: value.correlation,
  };
  if (digestCanonical(unsigned) !== value.attestationSha256) {
    throw new Error(`${label} asset attestation canonical SHA-256 does not match.`);
  }

  validateExpectedBinding(expected, label);
  validateAttestationSource(value.source, expected, label);
  const inventory = validateInventory(value.inventory, label);
  assertExactKeys(value.correlation, [
    "bodyDigestAlgorithm",
    "bodyDigestInput",
    "key",
    "staticChunkCount",
  ], `${label} asset attestation correlation`);
  if (
    value.correlation.bodyDigestAlgorithm !== "sha256"
    || value.correlation.bodyDigestInput !== "decoded response body bytes"
    || value.correlation.key !== "servedPath"
    || value.correlation.staticChunkCount !== inventory.staticChunks.length
  ) throw new Error(`${label} asset attestation correlation contract is invalid.`);
  return value;
}

export function validateServedCabinetAssetProof(value, expected) {
  assertExactKeys(value, [
    "assertions",
    "kind",
    "proofSha256",
    "route",
    "schemaVersion",
    "sides",
  ], "served cabinet asset proof");
  if (
    value.kind !== PROOF_KIND
    || value.schemaVersion !== PROOF_SCHEMA_VERSION
    || value.route !== CABINET_ROUTE
    || !SHA256.test(value.proofSha256 ?? "")
  ) throw new Error("Served cabinet asset proof identity is invalid.");
  const unsigned = {
    kind: value.kind,
    schemaVersion: value.schemaVersion,
    route: value.route,
    sides: value.sides,
    assertions: value.assertions,
  };
  if (digestCanonical(unsigned) !== value.proofSha256) {
    throw new Error("Served cabinet asset proof canonical SHA-256 does not match.");
  }
  assertExactKeys(expected, ["baseline", "candidate"], "served cabinet proof expectation");
  assertExactKeys(value.sides, ["baseline", "candidate"], "served cabinet proof sides");
  const baseline = validateProofSide(value.sides.baseline, expected.baseline, "baseline");
  const candidate = validateProofSide(value.sides.candidate, expected.candidate, "candidate");
  if (baseline.httpOrigin === candidate.httpOrigin) {
    throw new Error("Served cabinet proof origins are not distinct.");
  }
  if (
    baseline.source.publicBuildContract.version !== candidate.source.publicBuildContract.version
    || baseline.source.publicBuildContract.sha256 !== candidate.source.publicBuildContract.sha256
  ) throw new Error("Served cabinet proof public build contracts differ.");
  if (baseline.fixtureContract.version !== candidate.fixtureContract.version) {
    throw new Error("Served cabinet proof fixture versions differ.");
  }
  if (baseline.source.imageDigest === candidate.source.imageDigest) {
    throw new Error("Served cabinet proof image digests are not distinct.");
  }
  if (baseline.source.revision === candidate.source.revision) {
    throw new Error("Served cabinet proof revisions are not distinct.");
  }
  if (
    baseline.routeInventory.clientModuleSetSha256
      !== candidate.routeInventory.clientModuleSetSha256
    || baseline.routeInventory.clientModuleCount !== CABINET_CLIENT_MODULE_COUNT
    || candidate.routeInventory.clientModuleCount !== CABINET_CLIENT_MODULE_COUNT
  ) throw new Error("Served cabinet proof does not establish the identical 16-module closure.");
  if (
    baseline.routeInventory.moduleChunkAssignmentSha256
      === candidate.routeInventory.moduleChunkAssignmentSha256
    || baseline.routeInventory.declaredStaticChunkSetSha256
      === candidate.routeInventory.declaredStaticChunkSetSha256
  ) throw new Error("Served cabinet proof does not establish different chunk partitions.");
  assertExactKeys(value.assertions, [
    "allDeclaredChunksObservedAndImageMatched",
    "clientModuleCount",
    "clientModuleSetSha256",
    "declaredChunkPartitionsDiffer",
    "moduleChunkAssignmentsDiffer",
    "publicBuildContractIdentical",
  ], "served cabinet proof assertions");
  if (
    value.assertions.allDeclaredChunksObservedAndImageMatched !== true
    || value.assertions.clientModuleCount !== CABINET_CLIENT_MODULE_COUNT
    || value.assertions.clientModuleSetSha256
      !== baseline.routeInventory.clientModuleSetSha256
    || value.assertions.declaredChunkPartitionsDiffer !== true
    || value.assertions.moduleChunkAssignmentsDiffer !== true
    || value.assertions.publicBuildContractIdentical !== true
  ) throw new Error("Served cabinet proof assertions are invalid.");
  return value;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [baselineAttestation, candidateAttestation] = await Promise.all([
    readBoundedJson(options.baselineAttestation, "baseline asset attestation"),
    readBoundedJson(options.candidateAttestation, "candidate asset attestation"),
  ]);
  const publicBuildContract = {
    version: options.publicBuildContractVersion,
    sha256: options.publicBuildContractSha256,
  };
  const platform = parsePlatform(options.platform);
  const result = await proveServedCabinetAssets({
    baseline: {
      attestation: baselineAttestation,
      baseUrl: options.baselineBaseUrl,
      expected: {
        fixtureContract: {
          version: options.fixtureVersion,
          sha256: options.baselineFixtureSha256,
        },
        imageDigest: options.baselineImageDigest,
        platform,
        publicBuildContract,
        revision: options.baselineRevision,
      },
    },
    candidate: {
      attestation: candidateAttestation,
      baseUrl: options.candidateBaseUrl,
      expected: {
        fixtureContract: {
          version: options.fixtureVersion,
          sha256: options.candidateFixtureSha256,
        },
        imageDigest: options.candidateImageDigest,
        platform,
        publicBuildContract,
        revision: options.candidateRevision,
      },
    },
  });
  await writeFile(path.resolve(options.output), `${JSON.stringify(result, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  process.stdout.write(`${JSON.stringify({
    baselineChunkCount: result.sides.baseline.observations.length,
    candidateChunkCount: result.sides.candidate.observations.length,
    clientModuleCount: result.assertions.clientModuleCount,
    proofSha256: result.proofSha256,
    status: "served_cabinet_assets_proved",
  })}\n`);
}

function parseArguments(args) {
  const names = [
    "--baseline-attestation",
    "--baseline-base-url",
    "--baseline-fixture-sha256",
    "--baseline-image-digest",
    "--baseline-revision",
    "--candidate-attestation",
    "--candidate-base-url",
    "--candidate-fixture-sha256",
    "--candidate-image-digest",
    "--candidate-revision",
    "--fixture-version",
    "--output",
    "--platform",
    "--public-build-contract-sha256",
    "--public-build-contract-version",
  ];
  const allowed = new Set(names);
  const values = new Map();
  if (args.length !== names.length * 2) throw new Error(usage());
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!allowed.has(name) || typeof value !== "string" || value.length === 0 || values.has(name)) {
      throw new Error(usage());
    }
    values.set(name, value);
  }
  return Object.fromEntries(names.map((name) => [
    name.slice(2).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()),
    values.get(name),
  ]));
}

function usage() {
  return "usage: prove-served-cabinet-assets.mjs "
    + "--baseline-attestation <report.json> --baseline-base-url <loopback-url> "
    + "--baseline-image-digest <sha256:...> --baseline-revision <40-hex> "
    + "--baseline-fixture-sha256 <64-hex> "
    + "--candidate-attestation <report.json> --candidate-base-url <loopback-url> "
    + "--candidate-image-digest <sha256:...> --candidate-revision <40-hex> "
    + "--candidate-fixture-sha256 <64-hex> --fixture-version <version> "
    + "--public-build-contract-version <version> "
    + "--public-build-contract-sha256 <64-hex> --platform <linux/amd64|linux/arm64> "
    + "--output <new-proof.json>";
}

function validateSideInput(value, label) {
  assertExactKeys(value, ["attestation", "baseUrl", "expected"], `${label} proof input`);
  validateExpectedBinding(value.expected, label);
  return {
    ...value,
    baseUrl: parseLoopbackBaseUrl(value.baseUrl, label),
  };
}

function validateExpectedBinding(value, label) {
  assertExactKeys(value, [
    "fixtureContract",
    "imageDigest",
    "platform",
    "publicBuildContract",
    "revision",
  ], `${label} expected binding`);
  assertExactKeys(value.fixtureContract, ["sha256", "version"], `${label} fixture contract`);
  assertExactKeys(value.publicBuildContract, ["sha256", "version"], `${label} public build contract`);
  assertExactKeys(value.platform, ["architecture", "os"], `${label} platform`);
  if (
    !SHA256_DIGEST.test(value.imageDigest ?? "")
    || !REVISION.test(value.revision ?? "")
    || !SAFE_VERSION.test(value.fixtureContract.version ?? "")
    || !SHA256.test(value.fixtureContract.sha256 ?? "")
    || !SAFE_VERSION.test(value.publicBuildContract.version ?? "")
    || !SHA256.test(value.publicBuildContract.sha256 ?? "")
    || value.platform.os !== "linux"
    || !["amd64", "arm64"].includes(value.platform.architecture)
  ) throw new Error(`${label} expected binding is invalid.`);
}

function validateAttestationSource(value, expected, label) {
  assertExactKeys(value, [
    "configDigest",
    "imageDigest",
    "manifestDigest",
    "platform",
    "publicBuildContract",
    "revision",
    "role",
  ], `${label} asset attestation source`);
  assertExactKeys(value.platform, ["architecture", "os"], `${label} attested platform`);
  assertExactKeys(value.publicBuildContract, ["sha256", "version"], `${label} attested build contract`);
  if (
    !SHA256_DIGEST.test(value.configDigest ?? "")
    || !SHA256_DIGEST.test(value.manifestDigest ?? "")
    || value.imageDigest !== expected.imageDigest
    || value.revision !== expected.revision
    || value.role !== "app"
    || value.platform.os !== expected.platform.os
    || value.platform.architecture !== expected.platform.architecture
    || value.publicBuildContract.version !== expected.publicBuildContract.version
    || value.publicBuildContract.sha256 !== expected.publicBuildContract.sha256
  ) throw new Error(`${label} asset attestation source does not match its exact binding.`);
}

function validateInventory(value, label) {
  assertExactKeys(value, [
    "clientReferenceCount",
    "clientReferences",
    "inventorySha256",
    "manifestCount",
    "manifests",
    "staticChunkCount",
    "staticChunkSetSha256",
    "staticChunks",
  ], `${label} asset inventory`);
  if (
    !Array.isArray(value.clientReferences)
    || !Array.isArray(value.manifests)
    || !Array.isArray(value.staticChunks)
    || value.staticChunks.length < 1
    || value.staticChunks.length > MAX_INVENTORY_ASSETS
    || value.clientReferenceCount !== value.clientReferences.length
    || value.manifestCount !== value.manifests.length
    || value.staticChunkCount !== value.staticChunks.length
    || !SHA256.test(value.inventorySha256 ?? "")
    || !SHA256.test(value.staticChunkSetSha256 ?? "")
  ) throw new Error(`${label} asset inventory shape is invalid.`);

  const staticPaths = new Set();
  let staticAssetBytes = 0;
  for (const entry of value.staticChunks) {
    assertExactKeys(entry, ["imagePath", "servedPath", "sha256", "size"], `${label} static chunk`);
    if (
      !safeStaticInventoryPath(entry.servedPath)
      || entry.imagePath !== `/app/.next${entry.servedPath.slice("/_next".length)}`
      || !SHA256.test(entry.sha256 ?? "")
      || !boundedSize(entry.size, MAX_INVENTORY_ASSET_BYTES)
      || staticPaths.has(entry.servedPath)
    ) throw new Error(`${label} static chunk inventory is invalid.`);
    staticPaths.add(entry.servedPath);
    staticAssetBytes += entry.size;
  }
  if (!Number.isSafeInteger(staticAssetBytes)
    || staticAssetBytes > MAX_INVENTORY_TOTAL_BYTES) {
    throw new Error(`${label} static asset inventory exceeds its aggregate byte limit.`);
  }
  assertSorted(value.staticChunks.map((entry) => entry.servedPath), `${label} static chunks`);

  const manifestByPath = new Map();
  for (const entry of value.manifests) {
    assertExactKeys(entry, ["imagePath", "kind", "sha256", "size"], `${label} manifest`);
    if (
      typeof entry.imagePath !== "string"
      || !entry.imagePath.startsWith("/app/.next/")
      || entry.imagePath.includes("..")
      || !["client-reference", "next-json"].includes(entry.kind)
      || !SHA256.test(entry.sha256 ?? "")
      || !boundedSize(entry.size, 32 * 1024 * 1024)
      || manifestByPath.has(entry.imagePath)
    ) throw new Error(`${label} manifest inventory is invalid.`);
    manifestByPath.set(entry.imagePath, entry);
  }
  assertSorted(value.manifests.map((entry) => entry.imagePath), `${label} manifests`);

  const routes = new Set();
  for (const entry of value.clientReferences) {
    validateClientReference(entry, { label, manifestByPath, staticPaths });
    if (routes.has(entry.route)) throw new Error(`${label} repeats client-reference route ${entry.route}.`);
    routes.add(entry.route);
  }
  assertSorted(value.clientReferences.map((entry) => entry.route), `${label} client references`);
  const core = {
    clientReferences: value.clientReferences,
    manifests: value.manifests,
    staticChunks: value.staticChunks,
  };
  if (
    digestCanonical(core) !== value.inventorySha256
    || digestCanonical(value.staticChunks.map(({ servedPath, sha256, size }) => ({
      servedPath,
      sha256,
      size,
    }))) !== value.staticChunkSetSha256
  ) throw new Error(`${label} asset inventory digest does not match.`);
  return value;
}

function validateClientReference(value, { label, manifestByPath, staticPaths }) {
  assertExactKeys(value, [
    "clientModuleChunkBindings",
    "clientModuleCount",
    "clientModuleSetSha256",
    "declaredStaticChunkSetSha256",
    "declaredStaticChunks",
    "entrypointStaticChunks",
    "manifestPath",
    "manifestSha256",
    "moduleChunkAssignmentSha256",
    "route",
  ], `${label} client reference`);
  if (
    typeof value.route !== "string"
    || !/^\/[\x20-\x7e]{0,511}$/.test(value.route)
    || !Array.isArray(value.clientModuleChunkBindings)
    || value.clientModuleCount !== value.clientModuleChunkBindings.length
    || !SHA256.test(value.clientModuleSetSha256 ?? "")
    || !SHA256.test(value.declaredStaticChunkSetSha256 ?? "")
    || !SHA256.test(value.manifestSha256 ?? "")
    || !SHA256.test(value.moduleChunkAssignmentSha256 ?? "")
    || !Array.isArray(value.declaredStaticChunks)
    || !Array.isArray(value.entrypointStaticChunks)
  ) throw new Error(`${label} client-reference shape is invalid.`);
  const manifest = manifestByPath.get(value.manifestPath);
  if (!manifest || manifest.kind !== "client-reference" || manifest.sha256 !== value.manifestSha256) {
    throw new Error(`${label} client-reference manifest binding is invalid.`);
  }
  const moduleIds = new Set();
  for (const binding of value.clientModuleChunkBindings) {
    assertExactKeys(binding, ["chunks", "moduleIdentitySha256"], `${label} client module binding`);
    if (
      !SHA256.test(binding.moduleIdentitySha256 ?? "")
      || moduleIds.has(binding.moduleIdentitySha256)
      || !Array.isArray(binding.chunks)
      || binding.chunks.some((servedPath) => !safeStaticChunk(servedPath))
    ) throw new Error(`${label} client module binding is invalid.`);
    moduleIds.add(binding.moduleIdentitySha256);
  }
  assertSorted(
    value.clientModuleChunkBindings.map((entry) => entry.moduleIdentitySha256),
    `${label} client module bindings`,
  );
  assertUniqueSortedStaticChunks(value.declaredStaticChunks, `${label} declared chunks`);
  assertUniqueSortedStaticChunks(value.entrypointStaticChunks, `${label} entrypoint chunks`);
  if (
    value.declaredStaticChunks.some((servedPath) => !staticPaths.has(servedPath))
    || value.entrypointStaticChunks.some((servedPath) => !staticPaths.has(servedPath))
    || digestCanonical(value.clientModuleChunkBindings.map(({ moduleIdentitySha256 }) => (
      moduleIdentitySha256
    ))) !== value.clientModuleSetSha256
    || digestCanonical(value.clientModuleChunkBindings) !== value.moduleChunkAssignmentSha256
    || digestCanonical(value.declaredStaticChunks) !== value.declaredStaticChunkSetSha256
  ) throw new Error(`${label} client-reference digest or chunk binding is invalid.`);
}

function exactCabinetRoute(attestation, label) {
  const matches = attestation.inventory.clientReferences.filter((entry) => entry.route === CABINET_ROUTE);
  if (matches.length !== 1) throw new Error(`${label} attestation must contain exactly one ${CABINET_ROUTE}.`);
  const route = matches[0];
  if (route.clientModuleCount !== CABINET_CLIENT_MODULE_COUNT) {
    throw new Error(`${label} ${CABINET_ROUTE} does not contain exactly 16 client modules.`);
  }
  if (route.declaredStaticChunks.some((servedPath) => !safeStaticChunk(servedPath))) {
    throw new Error(`${label} ${CABINET_ROUTE} declares an unsupported static chunk extension.`);
  }
  if (route.declaredStaticChunks.length === 0 || route.declaredStaticChunks.length > MAX_ROUTE_CHUNKS) {
    throw new Error(`${label} ${CABINET_ROUTE} violates the bounded chunk-count contract.`);
  }
  return route;
}

function assertIdenticalClientModuleClosure(baseline, candidate) {
  const baselineModules = baseline.clientModuleChunkBindings.map((entry) => entry.moduleIdentitySha256);
  const candidateModules = candidate.clientModuleChunkBindings.map((entry) => entry.moduleIdentitySha256);
  if (
    baseline.clientModuleSetSha256 !== candidate.clientModuleSetSha256
    || JSON.stringify(baselineModules) !== JSON.stringify(candidateModules)
  ) throw new Error("Baseline and candidate cabinet client-module closures differ.");
}

async function observeDeclaredChunks({ attestation, baseUrl, fetchImpl, label, route }) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const staticByPath = new Map(attestation.inventory.staticChunks.map((entry) => [entry.servedPath, entry]));
  const expected = route.declaredStaticChunks.map((servedPath) => staticByPath.get(servedPath));
  if (expected.some((entry) => !entry)) throw new Error(`${label} cabinet route references an absent image chunk.`);
  const expectedBytes = expected.reduce((total, entry) => total + entry.size, 0);
  if (
    expected.some((entry) => entry.size > MAX_CHUNK_BYTES)
    || expectedBytes > MAX_ROUTE_BYTES
  ) throw new Error(`${label} cabinet route violates the bounded body-size contract.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OBSERVATION_TIMEOUT_MS);
  try {
    const observations = [];
    let observedBytes = 0;
    for (const inventory of expected) {
      const observation = await observeChunk({
        baseUrl,
        fetchImpl,
        inventory,
        label,
        signal: controller.signal,
      });
      observedBytes += observation.size;
      if (observedBytes > MAX_ROUTE_BYTES) {
        throw new Error(`${label} cabinet responses exceed the bounded aggregate size contract.`);
      }
      observations.push(observation);
    }
    return observations;
  } finally {
    clearTimeout(timeout);
  }
}

async function observeChunk({ baseUrl, fetchImpl, inventory, label, signal }) {
  const requestUrl = new URL(inventory.servedPath, baseUrl);
  if (requestUrl.origin !== baseUrl.origin || requestUrl.search || requestUrl.hash) {
    throw new Error(`${label} cabinet chunk escaped its exact origin.`);
  }
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method: "GET",
      redirect: "error",
      credentials: "omit",
      headers: {
        accept: expectedAccept(inventory.servedPath),
        "accept-encoding": "identity",
        "cache-control": "no-store",
      },
      signal,
    });
  } catch {
    throw new Error(`${label} cabinet chunk request failed for ${inventory.servedPath}.`);
  }
  if (
    !response
    || response.status !== 200
    || response.url !== requestUrl.href
    || !response.body
  ) throw new Error(`${label} cabinet chunk response contract failed for ${inventory.servedPath}.`);
  const contentType = validateContentType(
    response.headers.get("content-type"),
    inventory.servedPath,
    label,
  );
  const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  if (contentEncoding && contentEncoding !== "identity") {
    throw new Error(`${label} cabinet chunk used an unexpected content encoding.`);
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^(?:0|[1-9]\d{0,9})$/.test(declaredLength) || Number(declaredLength) !== inventory.size) {
      throw new Error(`${label} cabinet chunk content length does not match its image inventory.`);
    }
  }
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const rawChunk of response.body) {
      const chunk = Buffer.from(rawChunk);
      size += chunk.length;
      if (size > MAX_CHUNK_BYTES || size > inventory.size) {
        throw new Error("bounded response body exceeded");
      }
      hash.update(chunk);
    }
  } catch {
    throw new Error(`${label} cabinet chunk body read failed for ${inventory.servedPath}.`);
  }
  const sha256 = hash.digest("hex");
  if (size !== inventory.size || sha256 !== inventory.sha256) {
    throw new Error(`${label} cabinet chunk body does not match its image inventory.`);
  }
  return {
    servedPath: inventory.servedPath,
    status: response.status,
    contentType,
    size,
    sha256,
  };
}

function buildProofSide(attestation, input, route, observations) {
  return {
    source: {
      configDigest: attestation.source.configDigest,
      imageDigest: attestation.source.imageDigest,
      manifestDigest: attestation.source.manifestDigest,
      platform: attestation.source.platform,
      publicBuildContract: attestation.source.publicBuildContract,
      revision: attestation.source.revision,
    },
    fixtureContract: input.expected.fixtureContract,
    attestation: {
      inventorySha256: attestation.inventory.inventorySha256,
      sha256: attestation.attestationSha256,
    },
    httpOrigin: input.baseUrl.origin,
    routeInventory: {
      clientModuleCount: route.clientModuleCount,
      clientModuleSetSha256: route.clientModuleSetSha256,
      declaredStaticChunkCount: route.declaredStaticChunks.length,
      declaredStaticChunkSetSha256: route.declaredStaticChunkSetSha256,
      manifestPath: route.manifestPath,
      manifestSha256: route.manifestSha256,
      moduleChunkAssignmentSha256: route.moduleChunkAssignmentSha256,
    },
    observations,
    observationSetSha256: digestCanonical(observations),
  };
}

function validateProofSide(value, expected, label) {
  assertExactKeys(value, [
    "attestation",
    "fixtureContract",
    "httpOrigin",
    "observations",
    "observationSetSha256",
    "routeInventory",
    "source",
  ], `${label} served cabinet proof side`);
  validateExpectedBinding(expected, label);
  assertExactKeys(value.source, [
    "configDigest",
    "imageDigest",
    "manifestDigest",
    "platform",
    "publicBuildContract",
    "revision",
  ], `${label} proof source`);
  assertExactKeys(value.source.platform, ["architecture", "os"], `${label} proof platform`);
  assertExactKeys(
    value.source.publicBuildContract,
    ["sha256", "version"],
    `${label} proof public build contract`,
  );
  assertExactKeys(value.fixtureContract, ["sha256", "version"], `${label} proof fixture`);
  assertExactKeys(value.attestation, ["inventorySha256", "sha256"], `${label} proof attestation`);
  assertExactKeys(value.routeInventory, [
    "clientModuleCount",
    "clientModuleSetSha256",
    "declaredStaticChunkCount",
    "declaredStaticChunkSetSha256",
    "manifestPath",
    "manifestSha256",
    "moduleChunkAssignmentSha256",
  ], `${label} proof route inventory`);
  if (
    value.source.imageDigest !== expected.imageDigest
    || value.source.revision !== expected.revision
    || value.source.platform.os !== expected.platform.os
    || value.source.platform.architecture !== expected.platform.architecture
    || value.source.publicBuildContract.version !== expected.publicBuildContract.version
    || value.source.publicBuildContract.sha256 !== expected.publicBuildContract.sha256
    || value.fixtureContract.version !== expected.fixtureContract.version
    || value.fixtureContract.sha256 !== expected.fixtureContract.sha256
    || !SHA256_DIGEST.test(value.source.configDigest ?? "")
    || !SHA256_DIGEST.test(value.source.manifestDigest ?? "")
    || !SHA256.test(value.attestation.inventorySha256 ?? "")
    || !SHA256.test(value.attestation.sha256 ?? "")
    || !SHA256.test(value.observationSetSha256 ?? "")
    || !SHA256.test(value.routeInventory.clientModuleSetSha256 ?? "")
    || !SHA256.test(value.routeInventory.declaredStaticChunkSetSha256 ?? "")
    || !SHA256.test(value.routeInventory.manifestSha256 ?? "")
    || !SHA256.test(value.routeInventory.moduleChunkAssignmentSha256 ?? "")
    || typeof value.routeInventory.manifestPath !== "string"
    || !value.routeInventory.manifestPath.endsWith("/cabinet/page_client-reference-manifest.js")
    || !Array.isArray(value.observations)
    || value.routeInventory.declaredStaticChunkCount !== value.observations.length
    || value.observations.length === 0
    || value.observations.length > MAX_ROUTE_CHUNKS
  ) throw new Error(`${label} served cabinet proof binding is invalid.`);
  const origin = parseLoopbackBaseUrl(value.httpOrigin, `${label} proof`);
  if (origin.origin !== value.httpOrigin) throw new Error(`${label} proof origin is not canonical.`);
  let aggregateSize = 0;
  for (const observation of value.observations) {
    assertExactKeys(observation, [
      "contentType",
      "servedPath",
      "sha256",
      "size",
      "status",
    ], `${label} chunk observation`);
    if (
      !safeStaticChunk(observation.servedPath)
      || observation.status !== 200
      || !validNormalizedContentType(observation.contentType, observation.servedPath)
      || !SHA256.test(observation.sha256 ?? "")
      || !boundedSize(observation.size, MAX_CHUNK_BYTES)
    ) throw new Error(`${label} chunk observation is invalid.`);
    aggregateSize += observation.size;
  }
  assertSorted(value.observations.map((entry) => entry.servedPath), `${label} chunk observations`);
  if (
    aggregateSize > MAX_ROUTE_BYTES
    || digestCanonical(value.observations) !== value.observationSetSha256
    || digestCanonical(value.observations.map((entry) => entry.servedPath))
      !== value.routeInventory.declaredStaticChunkSetSha256
  ) throw new Error(`${label} served cabinet observation digest is invalid.`);
  return value;
}

function validateContentType(value, servedPath, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new Error(`${label} cabinet chunk content type is missing or oversized.`);
  }
  const normalized = value.split(";").map((part) => part.trim().toLowerCase()).join("; ");
  if (!validNormalizedContentType(normalized, servedPath)) {
    throw new Error(`${label} cabinet chunk content type is invalid for ${servedPath}.`);
  }
  return normalized;
}

function validNormalizedContentType(value, servedPath) {
  if (typeof value !== "string" || /[\r\n]/.test(value)) return false;
  const [mediaType, ...parameters] = value.split("; ");
  const allowedMediaTypes = servedPath.endsWith(".css")
    ? new Set(["text/css"])
    : servedPath.endsWith(".js")
      ? new Set(["application/javascript", "text/javascript"])
      : new Set();
  return allowedMediaTypes.has(mediaType)
    && parameters.length <= 1
    && parameters.every((parameter) => parameter === "charset=utf-8");
}

function expectedAccept(servedPath) {
  if (servedPath.endsWith(".css")) return "text/css";
  if (servedPath.endsWith(".js")) return "application/javascript, text/javascript;q=0.9";
  throw new Error("Cabinet route declares an unsupported static chunk extension.");
}

function assertUniqueSortedStaticChunks(values, label) {
  if (values.some((value) => !safeStaticChunk(value)) || new Set(values).size !== values.length) {
    throw new Error(`${label} are invalid or repeated.`);
  }
  assertSorted(values, label);
}

function safeStaticChunk(value) {
  return safeStaticChunkPath(value)
    && (value.endsWith(".js") || value.endsWith(".css"));
}

function safeStaticInventoryPath(value) {
  return safeStaticChunk(value)
    || (typeof value === "string" && STATIC_MEDIA.test(value)
      && !value.includes("..") && !value.includes("//"));
}

function safeStaticChunkPath(value) {
  return typeof value === "string"
    && STATIC_CHUNK.test(value)
    && !value.includes("..")
    && !value.includes("//");
}

function parseLoopbackBaseUrl(value, label) {
  let url;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value);
  } catch {
    throw new Error(`${label} base URL is invalid.`);
  }
  if (
    !["http:", "https:"].includes(url.protocol)
    || url.hostname !== "127.0.0.1"
    || !url.port
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) throw new Error(`${label} base URL must be an exact loopback origin with an explicit port.`);
  return url;
}

function parsePlatform(value) {
  const match = /^(linux)\/(amd64|arm64)$/.exec(value ?? "");
  if (!match) throw new Error("Production image platform is invalid.");
  return { os: match[1], architecture: match[2] };
}

async function readBoundedJson(file, label) {
  const resolved = path.resolve(file);
  let handle;
  try {
    handle = await open(resolved, "r");
  } catch {
    throw new Error(`${label} is unavailable.`);
  }
  let bytes;
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size <= 0 || details.size > MAX_ATTESTATION_BYTES) {
      throw new Error(`${label} violates its bounded file-size contract.`);
    }
    bytes = Buffer.alloc(details.size);
    await readExactly(handle, bytes);
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, details.size)).bytesRead !== 0) {
      throw new Error(`${label} changed beyond its bounded file-size contract while being read.`);
    }
  } catch {
    throw new Error(`${label} could not be read within its bounded contract.`);
  } finally {
    await handle.close();
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
}

async function readExactly(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) throw new Error("Unexpected end of attestation report.");
    offset += bytesRead;
  }
}

function boundedSize(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

function assertSorted(values, label) {
  if (values.some((value, index) => index > 0 && values[index - 1] >= value)) {
    throw new Error(`${label} are not strictly sorted and unique.`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!isRecord(value)) throw new Error(`${label} is not an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${label} does not have its exact expected fields.`);
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestCanonical(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value) {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value) {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortRecursively(value[key])]));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Cannot prove served cabinet assets: ${message.replace(/\s+/g, " ").slice(0, 2_000)}\n`);
    process.exitCode = 1;
  }
}
