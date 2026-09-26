import path from "node:path";

import {
  assertChatwootPhaseInput,
  createChatwootPhaseComposeProjectName,
} from "./chatwoot-phase-proof-contract.mjs";

const roles = Object.freeze(["baseline", "candidate"]);
const pairIndexes = Object.freeze([1, 2, 3]);
const livePlanKind = "clean-pay-chatwoot-live-proof-plan";
const cliPlanKind = "clean-pay-chatwoot-phase-proof-input";
const projectPattern =
  /^clean-pay-browser-journey-chatwoot-(baseline|candidate)-p([1-3])-[a-f0-9]{12}$/;
const captureIdPattern = /^[a-f0-9]{16}$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const imageTagPattern = /^[A-Za-z0-9][A-Za-z0-9._/:-]{1,240}$/;

export function createChatwootLiveProofPlan(input) {
  const value = plainRecord(input, "Chatwoot live-plan input");
  exactKeys(value, ["baseline", "candidate", "captureId", "ownedRoot"], "live-plan input");
  assertCaptureId(value.captureId);
  assertExactOwnedRoot(value.ownedRoot);
  if (value.baseline === value.candidate) {
    fail("Chatwoot live-plan role inputs alias each other.");
  }

  const sources = Object.fromEntries(roles.map((role) => [
    role,
    assertRoleSource(value[role], role),
  ]));
  assertDistinctRoleSources(sources);

  const pairs = pairIndexes.map((pairIndex) => Object.freeze({
    pairIndex,
    baseline: createStackPlan({
      captureId: value.captureId,
      ownedRoot: value.ownedRoot,
      pairIndex,
      role: "baseline",
      source: sources.baseline,
    }),
    candidate: createStackPlan({
      captureId: value.captureId,
      ownedRoot: value.ownedRoot,
      pairIndex,
      role: "candidate",
      source: sources.candidate,
    }),
  }));
  const plan = {
    schemaVersion: 1,
    kind: livePlanKind,
    captureId: value.captureId,
    ownedRoot: value.ownedRoot,
    pairs,
  };
  assertChatwootLiveProofPlan(plan);
  return deepFreeze(plan);
}

export function assertChatwootLiveProofPlan(input) {
  const plan = plainRecord(input, "Chatwoot live proof plan");
  exactKeys(
    plan,
    ["captureId", "kind", "ownedRoot", "pairs", "schemaVersion"],
    "Chatwoot live proof plan",
  );
  equal(plan.schemaVersion, 1, "Chatwoot live proof plan schemaVersion");
  equal(plan.kind, livePlanKind, "Chatwoot live proof plan kind");
  assertCaptureId(plan.captureId);
  assertExactOwnedRoot(plan.ownedRoot);
  if (!Array.isArray(plan.pairs) || plan.pairs.length !== pairIndexes.length) {
    fail("Chatwoot live proof plan requires exactly three pairs.");
  }

  const pairObjects = new Set();
  const stackObjects = new Set();
  const imageObjects = new Set();
  const projects = [];
  const ports = [];
  const resolvers = [];
  const environmentPaths = [];
  const contractPaths = [];
  const attestationPaths = [];
  const sources = { baseline: [], candidate: [] };

  for (const [pairOffset, pairValue] of plan.pairs.entries()) {
    const pairIndex = pairOffset + 1;
    const pair = plainRecord(pairValue, `Chatwoot live pair ${pairIndex}`);
    exactKeys(pair, ["baseline", "candidate", "pairIndex"], `live pair ${pairIndex}`);
    equal(pair.pairIndex, pairIndex, `Chatwoot live pair ${pairIndex} index`);
    requireUnaliasedObject(pairObjects, pair, "Chatwoot live pair objects");
    if (pair.baseline === pair.candidate) {
      fail(`Chatwoot live pair ${pairIndex} role objects alias each other.`);
    }

    for (const role of roles) {
      const ordinal = stackOrdinal(pairIndex, role);
      const stack = plainRecord(pair[role], `${role} live stack ${pairIndex}`);
      exactKeys(stack, [
        "appPort",
        "assetAttestationPath",
        "connectProxyPort",
        "contractPath",
        "generatedEnvironmentPath",
        "images",
        "project",
        "providerPort",
        "resolverIp",
        "revision",
      ], `${role} live stack ${pairIndex}`);
      requireUnaliasedObject(stackObjects, stack, "Chatwoot live stack objects");
      requireUnaliasedObject(imageObjects, stack.images, "Chatwoot live image ledgers");
      const imageLedger = plainRecord(
        stack.images,
        `${role} pair ${pairIndex} image ledger`,
      );
      requireUnaliasedObject(
        imageObjects,
        imageLedger.application,
        "Chatwoot application image inputs",
      );
      requireUnaliasedObject(
        imageObjects,
        imageLedger.migration,
        "Chatwoot migration image inputs",
      );

      const expectedPaths = stackPaths(plan.ownedRoot, pairIndex, role);
      equal(stack.appPort, String(42_300 + ordinal), `${role} pair ${pairIndex} app port`);
      equal(
        stack.providerPort,
        String(43_300 + ordinal),
        `${role} pair ${pairIndex} provider port`,
      );
      equal(
        stack.connectProxyPort,
        String(44_300 + ordinal),
        `${role} pair ${pairIndex} CONNECT port`,
      );
      equal(
        stack.resolverIp,
        `127.0.0.${31 + ordinal}`,
        `${role} pair ${pairIndex} resolver`,
      );
      const expectedProject = createChatwootPhaseComposeProjectName(
        role,
        pairIndex,
        plan.captureId.slice(0, 12),
      );
      equal(stack.project, expectedProject, `${role} pair ${pairIndex} project`);
      if (!projectPattern.test(stack.project)) {
        fail(`${role} pair ${pairIndex} project does not match the exact contract.`);
      }
      equal(
        stack.generatedEnvironmentPath,
        expectedPaths.generatedEnvironmentPath,
        `${role} pair ${pairIndex} environment path`,
      );
      equal(
        stack.contractPath,
        expectedPaths.contractPath,
        `${role} pair ${pairIndex} contract path`,
      );
      equal(
        stack.assetAttestationPath,
        expectedPaths.assetAttestationPath,
        `${role} pair ${pairIndex} attestation path`,
      );
      for (const [label, target] of Object.entries(expectedPaths)) {
        assertExactAbsolutePath(target, `${role} pair ${pairIndex} ${label}`);
        if (!isFilesystemDescendant(plan.ownedRoot, target)) {
          fail(`${role} pair ${pairIndex} planned path escaped the owned root.`);
        }
      }
      equal(
        normalizeFilesystemPath(path.dirname(stack.contractPath)),
        normalizeFilesystemPath(stack.generatedEnvironmentPath),
        `${role} pair ${pairIndex} contract containment`,
      );

      const source = assertRoleSource({
        images: stack.images,
        revision: stack.revision,
      }, `${role} pair ${pairIndex}`);
      sources[role].push(source);
      projects.push(stack.project);
      ports.push(stack.appPort, stack.providerPort, stack.connectProxyPort);
      resolvers.push(stack.resolverIp);
      environmentPaths.push(stack.generatedEnvironmentPath);
      contractPaths.push(stack.contractPath);
      attestationPaths.push(stack.assetAttestationPath);
    }
  }

  for (const role of roles) {
    const canonical = stableJson(sources[role][0]);
    for (const source of sources[role].slice(1)) {
      equal(stableJson(source), canonical, `${role} image/revision input across pairs`);
    }
  }
  assertDistinctRoleSources({
    baseline: sources.baseline[0],
    candidate: sources.candidate[0],
  });
  requireUnique(projects, "Chatwoot Compose projects");
  requireUnique(ports, "Chatwoot published ports");
  requireUnique(resolvers, "Chatwoot resolver addresses");
  requireUnique(environmentPaths, "Chatwoot generated environment paths");
  requireUnique(contractPaths, "Chatwoot contract paths");
  requireUnique(attestationPaths, "Chatwoot asset attestation paths");
  requireUnique(
    [...environmentPaths, ...contractPaths, ...attestationPaths],
    "Chatwoot external input paths",
  );
  return plan;
}

// This remains a pure projection. The caller invokes it only after all six
// planned external environment, contract and attestation inputs are prepared;
// the proof reader subsequently verifies their exact filesystem identities.
export function createChatwootLiveProofCliPlanAfterPreparation(livePlan) {
  const plan = assertChatwootLiveProofPlan(livePlan);
  const cliPlan = {
    schemaVersion: 1,
    kind: cliPlanKind,
    pairs: plan.pairs.map((pair) => ({
      pairIndex: pair.pairIndex,
      baseline: createCliStackInput(pair.baseline),
      candidate: createCliStackInput(pair.candidate),
    })),
  };
  assertChatwootPhaseInput(cliPlan);
  return deepFreeze(cliPlan);
}

function createStackPlan({ captureId, ownedRoot, pairIndex, role, source }) {
  const ordinal = stackOrdinal(pairIndex, role);
  return Object.freeze({
    appPort: String(42_300 + ordinal),
    assetAttestationPath: stackPaths(ownedRoot, pairIndex, role).assetAttestationPath,
    connectProxyPort: String(44_300 + ordinal),
    contractPath: stackPaths(ownedRoot, pairIndex, role).contractPath,
    generatedEnvironmentPath:
      stackPaths(ownedRoot, pairIndex, role).generatedEnvironmentPath,
    images: deepFreeze(structuredClone(source.images)),
    project: createChatwootPhaseComposeProjectName(
      role,
      pairIndex,
      captureId.slice(0, 12),
    ),
    providerPort: String(43_300 + ordinal),
    resolverIp: `127.0.0.${31 + ordinal}`,
    revision: source.revision,
  });
}

function createCliStackInput(stack) {
  return {
    assetAttestationPath: stack.assetAttestationPath,
    contractPath: stack.contractPath,
    controlUrl: `http://127.0.0.1:${stack.providerPort}/`,
    generatedEnvironmentPath: stack.generatedEnvironmentPath,
    imageDigest: stack.images.application.digest,
    migrationImageDigest: stack.images.migration.digest,
    resolverIp: stack.resolverIp,
  };
}

function assertRoleSource(input, label) {
  const source = plainRecord(input, `${label} image source`);
  exactKeys(source, ["images", "revision"], `${label} image source`);
  const images = plainRecord(source.images, `${label} images`);
  exactKeys(images, ["application", "migration"], `${label} images`);
  if (images.application === images.migration) {
    fail(`${label} application and migration image inputs alias each other.`);
  }
  const application = assertImage(images.application, `${label} application image`);
  const migration = assertImage(images.migration, `${label} migration image`);
  stringMatch(source.revision, revisionPattern, `${label} revision`);
  if (
    application.tag === migration.tag
    || application.digest === migration.digest
  ) {
    fail(`${label} application and migration images alias each other.`);
  }
  return {
    images: { application, migration },
    revision: source.revision,
  };
}

function assertImage(input, label) {
  const image = plainRecord(input, label);
  exactKeys(image, ["digest", "tag"], label);
  stringMatch(image.tag, imageTagPattern, `${label} tag`);
  stringMatch(image.digest, imageDigestPattern, `${label} digest`);
  return { digest: image.digest, tag: image.tag };
}

function assertDistinctRoleSources(sources) {
  const baseline = sources.baseline;
  const candidate = sources.candidate;
  if (!baseline || !candidate) fail("Chatwoot role image sources are incomplete.");
  if (baseline.revision === candidate.revision) {
    fail("Chatwoot baseline and candidate revisions alias each other.");
  }
  const images = [
    baseline.images.application,
    baseline.images.migration,
    candidate.images.application,
    candidate.images.migration,
  ];
  requireUnique(images.map((image) => image.tag), "Chatwoot image tags");
  requireUnique(images.map((image) => image.digest), "Chatwoot image digests");
}

function stackOrdinal(pairIndex, role) {
  return (pairIndex - 1) * roles.length + (role === "baseline" ? 0 : 1);
}

function stackPaths(ownedRoot, pairIndex, role) {
  const stackRoot = path.join(
    ownedRoot,
    "chatwoot-live-proof",
    `pair-${pairIndex}`,
    role,
  );
  const generatedEnvironmentPath = path.join(stackRoot, "environment");
  return {
    generatedEnvironmentPath,
    contractPath: path.join(generatedEnvironmentPath, "browser-journey-contract.json"),
    assetAttestationPath: path.join(stackRoot, "production-image-assets.json"),
  };
}

function assertCaptureId(value) {
  stringMatch(value, captureIdPattern, "Chatwoot live capture id");
}

function assertExactOwnedRoot(value) {
  assertExactAbsolutePath(value, "Chatwoot live owned root");
  const repositoryRoot = path.resolve(process.cwd());
  if (
    normalizeFilesystemPath(value)
    === normalizeFilesystemPath(path.parse(value).root)
  ) {
    fail("Chatwoot live owned root cannot be a filesystem root.");
  }
  if (
    normalizeFilesystemPath(value) === normalizeFilesystemPath(repositoryRoot)
    || isFilesystemDescendant(repositoryRoot, value)
    || isFilesystemDescendant(value, repositoryRoot)
  ) {
    fail("Chatwoot live owned root must remain external to the repository.");
  }
}

function assertExactAbsolutePath(value, label) {
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length === 0
    || !path.isAbsolute(value)
    || normalizeFilesystemPath(path.normalize(value))
      !== normalizeFilesystemPath(value)
  ) {
    fail(`${label} is not an exact absolute path.`);
  }
}

function isFilesystemDescendant(parent, child) {
  const relative = path.relative(parent, child);
  return relative.length > 0
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function normalizeFilesystemPath(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function plainRecord(value, label) {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.getOwnPropertySymbols(value).length !== 0
  ) {
    fail(`${label} must be an exact plain object.`);
  }
  return value;
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const exact = [...expected].sort();
  if (stableJson(actual) !== stableJson(exact)) {
    fail(`${label} fields do not match the exact contract.`);
  }
}

function stringMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    fail(`${label} is invalid.`);
  }
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} differs from the exact contract.`);
}

function requireUnique(values, label) {
  if (new Set(values.map(normalizeComparable)).size !== values.length) {
    fail(`${label} must be globally distinct.`);
  }
}

function requireUnaliasedObject(seen, value, label) {
  if (seen.has(value)) fail(`${label} must not alias.`);
  seen.add(value);
}

function normalizeComparable(value) {
  return typeof value === "string" ? normalizeFilesystemPath(value) : value;
}

function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [
      key,
      stableValue(value[key]),
    ]));
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function fail(message) {
  throw new Error(message);
}
