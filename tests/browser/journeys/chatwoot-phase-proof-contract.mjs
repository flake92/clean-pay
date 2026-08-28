import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

import {
  CHATWOOT_PHASE_EVIDENCE_CATEGORIES,
  CHATWOOT_PHASE_EVIDENCE_CATEGORY_LIMITS,
} from "./chatwoot-phase-evidence-sealer.mjs";
import {
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import { normalizeProviderOverlapSemanticEntry } from "./provider-overlap-browser-contract.mjs";

export const CHATWOOT_PHASE_PROOF_KIND =
  "clean-pay-dual-image-chatwoot-phase-stability-proof";
export const CHATWOOT_PHASE_PROOF_SCHEMA_VERSION = 1;
export const CHATWOOT_PHASE_PROOF_SCENARIO = "chatwoot-phase-stability-v1";
export const CHATWOOT_PHASE_PROOF_PAIR_COUNT = 3;
export const CHATWOOT_PHASE_SCREENSHOT_QUORUM = 2;
export const CHATWOOT_PHASE_SCREENSHOT_NAMES = Object.freeze([
  "gap",
  "stable",
  "recreated",
]);

export async function readExactChatwootExternalPlan(
  target,
  repositoryRoot,
  maximumBytes = 256 * 1024,
) {
  return readExactExternalPlanFile(target, repositoryRoot, maximumBytes);
}

export async function readExactChatwootExternalPlanForTest(
  target,
  repositoryRoot,
  maximumBytes,
  hooks,
) {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)
    || JSON.stringify(Object.keys(hooks)) !== JSON.stringify(["afterOpen"])
    || typeof hooks.afterOpen !== "function") {
    fail("Chatwoot external plan test hooks are invalid.");
  }
  return readExactExternalPlanFile(target, repositoryRoot, maximumBytes, hooks);
}

const roles = Object.freeze(["baseline", "candidate"]);
const executionEvents = Object.freeze([
  ["pre_start_inputs_validated", 0, 0],
  ["concurrent_pair_started", 2, 0],
  ["runtime_attestation_completed", 2, 0],
  ["concurrent_dual_reset_started", 2, 0],
  ["concurrent_dual_reset_completed", 2, 2],
  ["concurrent_dual_capture_started", 2, 2],
  ["concurrent_dual_capture_completed", 2, 2],
  ["exact_dual_cleanup_completed", 0, 2],
]);
const sha256Pattern = /^[a-f0-9]{64}$/;
const connectAuthorityLedgerSha256 = createHash("sha256").update(JSON.stringify([
  "challenges.cloudflare.com:443",
  "chatwoot.browser.clean-pay.dev:443",
  "oauth.telegram.org:443",
  "pay.ci.clean-pay.dev:443",
])).digest("hex");
const imageDigestPattern = /^sha256:[a-f0-9]{64}$/;
const containerdImageSelectionMode = "containerd-root-manifest";
const fixtureSeed = "clean-pay-browser-journey-v1";
const maximumEventSealCount = 4_096;
const maximumFixtureStorageBytes = 64 * 1024;
const maximumScreenshotBytes = 5 * 1024 * 1024;
const maximumComposeProjectNameLength = 63;

export function createChatwootPhaseProof(pairReports) {
  if (!Array.isArray(pairReports) || pairReports.length !== CHATWOOT_PHASE_PROOF_PAIR_COUNT) {
    fail(`Chatwoot phase proof requires exactly ${CHATWOOT_PHASE_PROOF_PAIR_COUNT} A/B pairs.`);
  }
  const pairs = pairReports.map((pair, index) => assertPairReport(pair, index + 1));
  const stacks = pairs.flatMap((pair) => roles.map((role) => pair.stacks[role]));
  assertGlobalStackContract(stacks);
  assertGlobalExecutionContract(pairs);
  const expectedSemantics = stableJson(stackSemantics(stacks[0]));
  for (const stack of stacks.slice(1)) {
    equal(
      stableJson(stackSemantics(stack)),
      expectedSemantics,
      "all six Chatwoot phase semantic observations",
    );
  }
  const screenshots = Object.fromEntries(CHATWOOT_PHASE_SCREENSHOT_NAMES.map((phase) => {
    const baseline = selectExactScreenshotQuorum(pairs, "baseline", phase);
    const candidate = selectExactScreenshotQuorum(pairs, "candidate", phase);
    equal(
      candidate.selectedSha256,
      baseline.selectedSha256,
      `${phase} selected baseline/candidate PNG bytes`,
    );
    equal(
      candidate.selectedByteLength,
      baseline.selectedByteLength,
      `${phase} selected baseline/candidate PNG length`,
    );
    return [phase, {
      baseline,
      candidate,
      crossImageByteExact: true,
    }];
  }));
  const firstBaseline = pairs[0].stacks.baseline;
  const firstCandidate = pairs[0].stacks.candidate;
  const document = {
    schemaVersion: CHATWOOT_PHASE_PROOF_SCHEMA_VERSION,
    kind: CHATWOOT_PHASE_PROOF_KIND,
    scenario: {
      label: CHATWOOT_PHASE_PROOF_SCENARIO,
      sha256: sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
      seedSha256: sha256(`${fixtureSeed}:${CHATWOOT_PHASE_PROOF_SCENARIO}`),
    },
    execution: {
      mode: "pair-serial-dual-concurrent-v1",
      independentPairCount: CHATWOOT_PHASE_PROOF_PAIR_COUNT,
      peakLiveStackCount: 2,
      chromiumProcessCount: stacks.length,
      chromiumContextCount: stacks.length,
      ledgerEntryCount: pairs.reduce((count, pair) => count + pair.execution.events.length, 0),
      pairSerialCleanupProven: true,
      dualStackConcurrencyProven: true,
    },
    pairs: structuredClone(pairs),
    quorum: {
      independentPairCount: CHATWOOT_PHASE_PROOF_PAIR_COUNT,
      requiredByteIdenticalProcesses: CHATWOOT_PHASE_SCREENSHOT_QUORUM,
      semanticAgreementRequired: CHATWOOT_PHASE_PROOF_PAIR_COUNT * roles.length,
      screenshots,
    },
    comparison: {
      status: "proven",
      distinctComposeProjects: true,
      distinctRuntimeBindings: true,
      distinctApplicationImages: true,
      distinctSourceRevisions: true,
      sameBaselineImageAcrossPairs: true,
      sameCandidateImageAcrossPairs: true,
      samePublicBuildContract: true,
      sameFixtureContract: true,
      sameSyntheticEnvironmentPolicy: true,
      sameScenarioAndSeed: true,
      sameBrowserPolicy: true,
      sameProofHmacScope: true,
      allPhaseSemanticsExact: true,
      allCanonicalPhaseEvidenceExact: true,
      allScreenshotsCrossImageByteExact: true,
      baselineImageDigest: firstBaseline.applicationImage.assetImageDigest,
      candidateImageDigest: firstCandidate.applicationImage.assetImageDigest,
    },
    lifecycle: {
      automaticCleanup: true,
      cleanupMode: "exact-owned-project-v1",
      expectedStackCount: CHATWOOT_PHASE_PROOF_PAIR_COUNT * roles.length,
      cleanedStackCount: stacks.length,
      allOwnedResourcesRemoved: true,
    },
  };
  return Object.freeze(document);
}

export function assertChatwootPhaseProof(value) {
  const proof = record(value, "Chatwoot phase proof");
  exactKeys(proof, [
    "comparison",
    "execution",
    "kind",
    "lifecycle",
    "pairs",
    "quorum",
    "scenario",
    "schemaVersion",
  ], "Chatwoot phase proof");
  equal(proof.schemaVersion, CHATWOOT_PHASE_PROOF_SCHEMA_VERSION, "proof schemaVersion");
  equal(proof.kind, CHATWOOT_PHASE_PROOF_KIND, "proof kind");
  const rebuilt = createChatwootPhaseProof(proof.pairs);
  equal(stableJson(proof), stableJson(rebuilt), "serialized Chatwoot proof invariants");
  return proof;
}

export function assertChatwootPhaseInput(value) {
  const input = record(value, "Chatwoot phase proof input");
  exactKeys(input, ["kind", "pairs", "schemaVersion"], "Chatwoot phase proof input");
  equal(input.schemaVersion, 1, "Chatwoot phase input schemaVersion");
  equal(input.kind, "clean-pay-chatwoot-phase-proof-input", "Chatwoot phase input kind");
  if (!Array.isArray(input.pairs) || input.pairs.length !== CHATWOOT_PHASE_PROOF_PAIR_COUNT) {
    fail("Chatwoot phase input requires exactly three pairs.");
  }
  const pairs = input.pairs.map((pairValue, index) => {
    const pair = record(pairValue, `Chatwoot phase input pair ${index + 1}`);
    exactKeys(pair, ["baseline", "candidate", "pairIndex"], `input pair ${index + 1}`);
    equal(pair.pairIndex, index + 1, `input pair ${index + 1} index`);
    return {
      pairIndex: pair.pairIndex,
      baseline: assertStackInput(pair.baseline, "baseline", pair.pairIndex),
      candidate: assertStackInput(pair.candidate, "candidate", pair.pairIndex),
    };
  });
  const contractPaths = pairs.flatMap((pair) => roles.map((role) => pair[role].contractPath));
  const environmentPaths = pairs.flatMap((pair) => (
    roles.map((role) => pair[role].generatedEnvironmentPath)
  ));
  const endpoints = pairs.flatMap((pair) => roles.map((role) => pair[role].controlUrl));
  const resolvers = pairs.flatMap((pair) => roles.map((role) => pair[role].resolverIp));
  requireUnique(contractPaths, "input contract paths");
  requireUnique(environmentPaths, "input generated environment paths");
  requireUnique(endpoints, "input control endpoints");
  requireUnique(resolvers, "input resolver addresses");
  for (const pair of pairs) {
    if (
      pair.baseline.imageDigest === pair.candidate.imageDigest
      || pair.baseline.migrationImageDigest === pair.candidate.migrationImageDigest
      || pair.baseline.contractPath === pair.candidate.contractPath
      || pair.baseline.assetAttestationPath === pair.candidate.assetAttestationPath
      || pair.baseline.controlUrl === pair.candidate.controlUrl
      || pair.baseline.resolverIp === pair.candidate.resolverIp
    ) {
      fail(`Input pair ${pair.pairIndex} does not identify distinct image stacks.`);
    }
    for (const role of roles) {
      if (pair[role].imageDigest === pair[role].migrationImageDigest) {
        fail(`Input pair ${pair.pairIndex} ${role} aliases application and migration images.`);
      }
    }
  }
  for (const role of roles) {
    requireSame(pairs.map((pair) => pair[role].imageDigest), `${role} input application image`);
    requireSame(
      pairs.map((pair) => pair[role].migrationImageDigest),
      `${role} input migration image`,
    );
  }
  return Object.freeze({
    schemaVersion: 1,
    kind: "clean-pay-chatwoot-phase-proof-input",
    pairs,
  });
}

export async function resolveChatwootPhaseInputPaths(value) {
  const input = assertChatwootPhaseInput(value);
  const resolved = [];
  for (const pair of input.pairs) {
    for (const role of roles) {
      const stack = pair[role];
      const [contractMetadata, assetMetadata, environmentMetadata] = await Promise.all([
        lstat(stack.contractPath),
        lstat(stack.assetAttestationPath),
        lstat(stack.generatedEnvironmentPath),
      ]);
      if (!contractMetadata.isFile() || contractMetadata.isSymbolicLink()) {
        fail(`${role} pair ${pair.pairIndex} contract path is not an exact regular file.`);
      }
      if (!environmentMetadata.isDirectory() || environmentMetadata.isSymbolicLink()) {
        fail(`${role} pair ${pair.pairIndex} environment path is not an exact directory.`);
      }
      if (!assetMetadata.isFile() || assetMetadata.isSymbolicLink()) {
        fail(`${role} pair ${pair.pairIndex} asset path is not an exact regular file.`);
      }
      const [contractRealpath, assetRealpath, environmentRealpath] = await Promise.all([
        realpath(stack.contractPath),
        realpath(stack.assetAttestationPath),
        realpath(stack.generatedEnvironmentPath),
      ]);
      for (const [kind, requested, resolvedPath] of [
        ["contract", stack.contractPath, contractRealpath],
        ["asset", stack.assetAttestationPath, assetRealpath],
        ["environment", stack.generatedEnvironmentPath, environmentRealpath],
      ]) {
        equal(
          normalizeFilesystemPath(path.resolve(requested)),
          normalizeFilesystemPath(path.resolve(resolvedPath)),
          `${role} pair ${pair.pairIndex} ${kind} non-link realpath`,
        );
      }
      equal(
        normalizeFilesystemPath(path.dirname(contractRealpath)),
        normalizeFilesystemPath(environmentRealpath),
        `${role} pair ${pair.pairIndex} contract/environment containment`,
      );
      resolved.push({
        pairIndex: pair.pairIndex,
        role,
        assetRealpath: normalizeFilesystemPath(assetRealpath),
        assetObjectIdentity: `${String(assetMetadata.dev)}:${String(assetMetadata.ino)}`,
        contractRealpath: normalizeFilesystemPath(contractRealpath),
        contractObjectIdentity: `${String(contractMetadata.dev)}:${String(contractMetadata.ino)}`,
        environmentRealpath: normalizeFilesystemPath(environmentRealpath),
        environmentObjectIdentity:
          `${String(environmentMetadata.dev)}:${String(environmentMetadata.ino)}`,
      });
    }
  }
  requireUnique(resolved.map((entry) => entry.contractRealpath), "input contract realpaths");
  requireUnique(resolved.map((entry) => entry.contractObjectIdentity), "input contract identities");
  requireUnique(resolved.map((entry) => entry.environmentRealpath), "input environment realpaths");
  requireUnique(
    resolved.map((entry) => entry.environmentObjectIdentity),
    "input environment identities",
  );
  requireUnique(resolved.map((entry) => entry.assetObjectIdentity), "input asset identities");
  for (const pairIndex of [1, 2, 3]) {
    const assets = resolved.filter((entry) => entry.pairIndex === pairIndex)
      .map((entry) => entry.assetRealpath);
    requireUnique(assets, `input pair ${pairIndex} asset realpaths`);
  }
  return Object.freeze(resolved.map((entry) => Object.freeze({
    pairIndex: entry.pairIndex,
    role: entry.role,
    contractRealpathSha256: sha256(entry.contractRealpath),
    assetAttestationRealpathSha256: sha256(entry.assetRealpath),
    generatedEnvironmentDirectorySha256: sha256(entry.environmentRealpath),
  })));
}

export function assertChatwootJourneyContract(value, role, pairIndex) {
  if (!roles.includes(role) || !integerInRange(pairIndex, 1, CHATWOOT_PHASE_PROOF_PAIR_COUNT)) {
    fail("Chatwoot journey contract role/pair is invalid.");
  }
  const contract = record(value, `${role} pair ${pairIndex} journey contract`);
  exactKeys(contract, [
    "fixtureContract",
    "images",
    "kind",
    "ownedStateReset",
    "project",
    "publicBuildContract",
    "publications",
    "revision",
    "schemaVersion",
    "secretSource",
  ], `${role} journey contract`);
  equal(contract.schemaVersion, 1, `${role} contract schemaVersion`);
  equal(contract.kind, "self-contained-synthetic-browser-journey", `${role} contract kind`);
  stringMatch(
    contract.project,
    new RegExp(
      `^clean-pay-browser-journey-chatwoot-${role}-p${pairIndex}-[a-f0-9]{12}$`,
    ),
    `${role} pair ${pairIndex} compose project`,
  );
  stringMatch(contract.revision, /^[a-f0-9]{40}$/, `${role} revision`);
  const fixture = record(contract.fixtureContract, `${role} fixture contract`);
  exactKeys(fixture, ["domain", "sha256"], `${role} fixture contract`);
  equal(fixture.domain, "clean-pay-browser-journey-fixture-v5", `${role} fixture domain`);
  stringMatch(fixture.sha256, sha256Pattern, `${role} fixture sha256`);
  const images = record(contract.images, `${role} images`);
  exactKeys(images, ["application", "migration"], `${role} images`);
  for (const name of ["application", "migration"]) {
    stringMatch(images[name], /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/, `${role} ${name} image`);
  }
  const build = record(contract.publicBuildContract, `${role} public build contract`);
  exactKeys(build, ["sha256", "version"], `${role} public build contract`);
  equal(build.version, "1", `${role} public build contract version`);
  stringMatch(build.sha256, sha256Pattern, `${role} public build contract sha256`);
  const publications = record(contract.publications, `${role} publications`);
  exactKeys(
    publications,
    ["app", "browserTls", "connectProxy", "providerControl"],
    `${role} publications`,
  );
  stringMatch(publications.app, /^127\.0\.0\.1:\d{4,5}$/, `${role} app publication`);
  stringMatch(
    publications.providerControl,
    /^127\.0\.0\.1:\d{4,5}$/,
    `${role} provider publication`,
  );
  stringMatch(
    publications.connectProxy,
    /^127\.0\.0\.1:\d{4,5}$/,
    `${role} CONNECT publication`,
  );
  stringMatch(
    publications.browserTls,
    /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4]):443$/,
    `${role} browser TLS publication`,
  );
  for (const [name, publication] of Object.entries(publications)) {
    if (name === "browserTls") continue;
    assertPublicationPort(publication, `${role} ${name}`);
  }
  equal(
    contract.secretSource,
    "deterministic synthetic fixture labels; no external env or credential file",
    `${role} secret source`,
  );
  const reset = record(contract.ownedStateReset, `${role} owned reset contract`);
  exactKeys(reset, ["postgres", "redis", "scope"], `${role} owned reset contract`);
  equal(
    reset.postgres,
    "transactional truncate of public application tables; migrations retained; schema has no sequences",
    `${role} postgres reset contract`,
  );
  equal(reset.redis, "flush DB 0 on the project-local redis service", `${role} redis reset`);
  equal(
    reset.scope,
    "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
    `${role} reset scope`,
  );
  return contract;
}

export function createChatwootPhaseComposeProjectName(role, pairIndex, runScope) {
  if (!roles.includes(role)
    || !integerInRange(pairIndex, 1, CHATWOOT_PHASE_PROOF_PAIR_COUNT)
    || typeof runScope !== "string"
    || !/^[a-f0-9]{12}$/.test(runScope)) {
    fail("Chatwoot Compose project identity is invalid.");
  }
  const project = `clean-pay-browser-journey-chatwoot-${role}-p${pairIndex}-${runScope}`;
  if (project.length > maximumComposeProjectNameLength) {
    fail("Chatwoot Compose project exceeds the production environment limit.");
  }
  return project;
}

export function assertChatwootDeterministicReset(value, project, label) {
  const reset = record(value, `${label} reset evidence`);
  exactKeys(reset, [
    "database",
    "oidc",
    "scenario_sha256",
    "seed_sha256",
    "state",
    "status",
  ], `${label} reset evidence`);
  equal(reset.status, "reset", `${label} reset status`);
  equal(
    reset.scenario_sha256,
    sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
    `${label} reset scenario`,
  );
  equal(
    reset.seed_sha256,
    sha256(`${fixtureSeed}:${CHATWOOT_PHASE_PROOF_SCENARIO}`),
    `${label} reset seed`,
  );
  const state = record(reset.state, `${label} reset state`);
  exactKeys(state, [
    "access_owners",
    "consumed_turnstile_tokens",
    "ledger",
    "owner_profiles",
    "payment_disconnect_injection_armed",
    "payment_idempotency",
    "payment_rate_limit_injection_armed",
    "payment_sequence",
    "payments",
    "profiles",
    "refresh_owners",
    "registered_emails",
    "remnawave_users",
    "scenario_telegram_id_format",
    "sequence",
    "subscriptionless_owners",
    "telegram_owner_aliases",
  ], `${label} reset state`);
  for (const name of [
    "access_owners",
    "consumed_turnstile_tokens",
    "ledger",
    "owner_profiles",
    "payment_idempotency",
    "payment_sequence",
    "payments",
    "profiles",
    "refresh_owners",
    "registered_emails",
    "sequence",
    "subscriptionless_owners",
    "telegram_owner_aliases",
  ]) equal(state[name], 0, `${label} reset ${name}`);
  equal(state.remnawave_users, 1, `${label} reset remnawave users`);
  equal(state.payment_disconnect_injection_armed, false, `${label} disconnect injection`);
  equal(state.payment_rate_limit_injection_armed, false, `${label} rate limit injection`);
  equal(state.scenario_telegram_id_format, "9-digit-synthetic", `${label} Telegram format`);
  const oidc = record(reset.oidc, `${label} OIDC reset`);
  exactKeys(oidc, [
    "authorize_sequence",
    "codes",
    "event_count",
    "key_id",
    "scenario_sha256",
    "seed_sha256",
    "status",
    "subject_format",
  ], `${label} OIDC reset`);
  equal(oidc.status, "reset", `${label} OIDC status`);
  for (const name of ["authorize_sequence", "codes", "event_count"]) {
    equal(oidc[name], 0, `${label} OIDC ${name}`);
  }
  equal(oidc.key_id, "clean-pay-browser-journey-oidc-key", `${label} OIDC key id`);
  equal(oidc.seed_sha256, sha256(fixtureSeed), `${label} OIDC seed`);
  equal(
    oidc.scenario_sha256,
    sha256(CHATWOOT_PHASE_PROOF_SCENARIO),
    `${label} OIDC scenario`,
  );
  equal(oidc.subject_format, "9-digit-synthetic", `${label} OIDC subject`);
  const database = record(reset.database, `${label} database reset`);
  exactKeys(database, [
    "redis",
    "resetSequence",
    "schemaSha256",
    "sequenceCount",
    "scopeContract",
    "scopeSha256",
    "status",
    "tableCount",
    "transaction",
  ], `${label} database reset`);
  equal(database.status, "reset", `${label} database status`);
  equal(database.scopeContract, "exact-compose-project-label", `${label} database scope`);
  equal(database.scopeSha256, sha256(project), `${label} database scope digest`);
  stringMatch(database.schemaSha256, sha256Pattern, `${label} database schema`);
  positiveInteger(database.tableCount, `${label} database table count`);
  equal(database.sequenceCount, 0, `${label} database sequence count`);
  equal(database.resetSequence, 1, `${label} database reset sequence`);
  equal(
    database.transaction,
    "truncate-public-application-tables-cascade-no-sequences",
    `${label} database transaction`,
  );
  equal(database.redis, "flush-owned-db-0", `${label} database redis`);
  return Object.freeze({
    scenarioSha256: reset.scenario_sha256,
    seedSha256: reset.seed_sha256,
    database: Object.freeze({
      scopeSha256: database.scopeSha256,
      schemaSha256: database.schemaSha256,
      tableCount: database.tableCount,
      sequenceCount: database.sequenceCount,
      resetSequence: database.resetSequence,
      transaction: database.transaction,
      redis: database.redis,
    }),
  });
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPairReport(value, expectedIndex) {
  const pair = record(value, `Chatwoot phase pair ${expectedIndex}`);
  exactKeys(
    pair,
    ["cleanup", "execution", "pairIndex", "stacks"],
    `Chatwoot phase pair ${expectedIndex}`,
  );
  equal(pair.pairIndex, expectedIndex, `Chatwoot phase pair ${expectedIndex} index`);
  const pairStacks = record(pair.stacks, `Chatwoot phase pair ${expectedIndex} stacks`);
  exactKeys(pairStacks, roles, `Chatwoot phase pair ${expectedIndex} stacks`);
  const stacks = {
    baseline: assertStackReport(pairStacks.baseline, "baseline", expectedIndex),
    candidate: assertStackReport(pairStacks.candidate, "candidate", expectedIndex),
  };
  const cleanup = assertPairCleanup(pair.cleanup, stacks, expectedIndex);
  return {
    pairIndex: expectedIndex,
    cleanup,
    execution: assertPairExecution(pair.execution, expectedIndex, stacks, cleanup),
    stacks,
  };
}

function assertPairExecution(value, pairIndex, stacks, cleanup) {
  const execution = record(value, `Chatwoot phase pair ${pairIndex} execution`);
  exactKeys(execution, [
    "baselineCandidateConcurrent",
    "bindings",
    "cleanupCompletedWithinPair",
    "dualPreflightBeforeMutation",
    "events",
    "launch",
    "pairIndex",
    "peakLiveStackCount",
  ], `Chatwoot phase pair ${pairIndex} execution`);
  equal(execution.pairIndex, pairIndex, `pair ${pairIndex} execution index`);
  equal(execution.baselineCandidateConcurrent, true, `pair ${pairIndex} concurrency`);
  equal(execution.cleanupCompletedWithinPair, true, `pair ${pairIndex} cleanup completion`);
  equal(execution.dualPreflightBeforeMutation, true, `pair ${pairIndex} preflight ordering`);
  equal(execution.peakLiveStackCount, 2, `pair ${pairIndex} live stack bound`);
  const launch = assertPairLaunch(execution.launch, pairIndex, stacks);
  const bindings = assertExecutionBindings(
    execution.bindings,
    pairIndex,
    stacks,
    cleanup,
  );
  if (!isDenseArray(execution.events) || execution.events.length !== executionEvents.length) {
    fail(`Pair ${pairIndex} execution ledger is incomplete.`);
  }
  const events = execution.events.map((eventValue, index) => {
    const event = record(eventValue, `pair ${pairIndex} event ${index + 1}`);
    exactKeys(event, [
      "destructiveResetCount",
      "event",
      "evidenceSha256",
      "globalOrdinal",
      "liveStackCount",
      "pairIndex",
    ], `pair ${pairIndex} event ${index + 1}`);
    const [expectedEvent, liveStackCount, destructiveResetCount] = executionEvents[index];
    equal(event.pairIndex, pairIndex, `pair ${pairIndex} event pair`);
    equal(event.event, expectedEvent, `pair ${pairIndex} event label`);
    stringMatch(event.evidenceSha256, sha256Pattern, `pair ${pairIndex} event evidence`);
    equal(
      event.globalOrdinal,
      ((pairIndex - 1) * executionEvents.length) + index + 1,
      `pair ${pairIndex} event global ordinal`,
    );
    equal(event.liveStackCount, liveStackCount, `pair ${pairIndex} event live stacks`);
    equal(
      event.destructiveResetCount,
      destructiveResetCount,
      `pair ${pairIndex} event destructive reset count`,
    );
    return { ...event };
  });
  const expectedEventEvidence = [
    bindings.inputReceiptContractSha256s,
    launch.dispatches,
    bindings.runtimeAttestationContractSha256s,
    launch.inputReceiptContractSha256s,
    bindings.resetContractSha256s,
    roles.map((role) => stacks[role].runtimeBinding.projectSha256),
    bindings.browserCaptureContractSha256s,
    { cleanup, finalInputContractSha256s: bindings.finalInputContractSha256s },
  ];
  for (const [index, event] of events.entries()) {
    equal(
      event.evidenceSha256,
      sha256(stableJson(expectedEventEvidence[index])),
      `pair ${pairIndex} event ${index + 1} evidence binding`,
    );
  }
  return { ...execution, bindings, events, launch };
}

function assertPairLaunch(value, pairIndex, stacks) {
  const launch = record(value, `pair ${pairIndex} launch receipt`);
  exactKeys(launch, [
    "barrierSha256",
    "coexistence",
    "dispatches",
    "inputReceiptContractSha256s",
    "lifecycleNotBefore",
    "status",
  ], `pair ${pairIndex} launch receipt`);
  equal(
    launch.status,
    "dual-compose-up-dispatched-after-shared-barrier",
    `pair ${pairIndex} launch status`,
  );
  stringMatch(launch.barrierSha256, sha256Pattern, `pair ${pairIndex} launch barrier`);
  stringMatch(
    launch.lifecycleNotBefore,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    `pair ${pairIndex} launch lifecycle bound`,
  );
  try {
    equal(new Date(launch.lifecycleNotBefore).toISOString(), launch.lifecycleNotBefore,
      `pair ${pairIndex} launch lifecycle timestamp`);
  } catch {
    fail(`Pair ${pairIndex} launch lifecycle timestamp is invalid.`);
  }
  if (!isDenseArray(launch.dispatches) || launch.dispatches.length !== roles.length
    || !isDenseArray(launch.inputReceiptContractSha256s)
    || launch.inputReceiptContractSha256s.length !== roles.length) {
    fail(`Pair ${pairIndex} launch ledger is incomplete.`);
  }
  const projects = [];
  const dispatches = launch.dispatches.map((value, index) => {
    const dispatch = record(value, `pair ${pairIndex} dispatch ${index}`);
    exactKeys(dispatch, ["barrierSha256", "ordinal", "projectSha256"],
      `pair ${pairIndex} dispatch ${index}`);
    const role = roles[index];
    equal(dispatch.barrierSha256, launch.barrierSha256,
      `pair ${pairIndex} dispatch barrier`);
    equal(dispatch.ordinal, index, `pair ${pairIndex} dispatch ordinal`);
    equal(dispatch.projectSha256, stacks[role].runtimeBinding.projectSha256,
      `pair ${pairIndex} dispatch project`);
    stringMatch(launch.inputReceiptContractSha256s[index], sha256Pattern,
      `pair ${pairIndex} input receipt launch digest`);
    equal(
      launch.inputReceiptContractSha256s[index],
      sha256(JSON.stringify(stacks[role].inputReceipt)),
      `pair ${pairIndex} input receipt launch binding`,
    );
    projects.push(dispatch.projectSha256);
    return { ...dispatch };
  });
  requireUnique(projects, `pair ${pairIndex} launch projects`);
  equal(
    launch.barrierSha256,
    sha256(JSON.stringify({
      inputReceiptContractSha256s: launch.inputReceiptContractSha256s,
      projects,
      version: 1,
    })),
    `pair ${pairIndex} launch barrier binding`,
  );
  const coexistence = record(launch.coexistence, `pair ${pairIndex} coexistence`);
  exactKeys(coexistence, ["observations", "status"], `pair ${pairIndex} coexistence`);
  equal(coexistence.status, "both-project-container-sets-coexisted",
    `pair ${pairIndex} coexistence status`);
  if (!isDenseArray(coexistence.observations)
    || coexistence.observations.length !== roles.length) {
    fail(`Pair ${pairIndex} coexistence observations are incomplete.`);
  }
  const expectedServices = [...JOURNEY_COMPOSE_SERVICE_NAMES].sort();
  const allContainerIds = new Set();
  const observations = coexistence.observations.map((value, roleIndex) => {
    const observation = record(value, `pair ${pairIndex} coexistence ${roleIndex}`);
    exactKeys(observation, [
      "containerSetSha256", "projectSha256", "serviceCount", "services",
    ], `pair ${pairIndex} coexistence ${roleIndex}`);
    const role = roles[roleIndex];
    equal(observation.projectSha256, stacks[role].runtimeBinding.projectSha256,
      `pair ${pairIndex} coexistence project`);
    equal(observation.serviceCount, expectedServices.length,
      `pair ${pairIndex} coexistence service count`);
    if (!isDenseArray(observation.services)
      || observation.services.length !== expectedServices.length) {
      fail(`Pair ${pairIndex} coexistence services are incomplete.`);
    }
    const services = observation.services.map((value, serviceIndex) => {
      const service = record(value, `pair ${pairIndex} service ${serviceIndex}`);
      exactKeys(service, ["containerIdSha256", "service", "state"],
        `pair ${pairIndex} service ${serviceIndex}`);
      equal(service.service, expectedServices[serviceIndex],
        `pair ${pairIndex} service order`);
      equal(service.state, JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[service.service],
        `pair ${pairIndex} service state`);
      stringMatch(service.containerIdSha256, sha256Pattern,
        `pair ${pairIndex} container identity`);
      if (allContainerIds.has(service.containerIdSha256)) {
        fail(`Pair ${pairIndex} container identities are not isolated.`);
      }
      allContainerIds.add(service.containerIdSha256);
      return { ...service };
    });
    equal(observation.containerSetSha256, sha256(JSON.stringify(services)),
      `pair ${pairIndex} container set binding`);
    return { ...observation, services };
  });
  equal(allContainerIds.size, expectedServices.length * roles.length,
    `pair ${pairIndex} coexistence container count`);
  return {
    ...launch,
    coexistence: { ...coexistence, observations },
    dispatches,
    inputReceiptContractSha256s: [...launch.inputReceiptContractSha256s],
  };
}

function assertExecutionBindings(value, pairIndex, stacks, cleanup) {
  const bindings = record(value, `pair ${pairIndex} execution bindings`);
  exactKeys(bindings, [
    "browserCaptureContractSha256s",
    "cleanupContractSha256",
    "finalInputChecks",
    "finalInputContractSha256s",
    "inputReceiptContractSha256s",
    "resetContractSha256s",
    "runtimeAttestationContractSha256s",
  ], `pair ${pairIndex} execution bindings`);
  const digestArrayNames = [
    "browserCaptureContractSha256s",
    "finalInputContractSha256s",
    "inputReceiptContractSha256s",
    "resetContractSha256s",
    "runtimeAttestationContractSha256s",
  ];
  for (const name of digestArrayNames) {
    if (!isDenseArray(bindings[name]) || bindings[name].length !== roles.length) {
      fail(`Pair ${pairIndex} execution ${name} is incomplete.`);
    }
    for (const digest of bindings[name]) {
      stringMatch(digest, sha256Pattern, `pair ${pairIndex} execution ${name}`);
    }
  }
  stringMatch(bindings.cleanupContractSha256, sha256Pattern,
    `pair ${pairIndex} cleanup contract`);
  equal(bindings.cleanupContractSha256, sha256(JSON.stringify(cleanup)),
    `pair ${pairIndex} cleanup contract binding`);
  if (!isDenseArray(bindings.finalInputChecks)
    || bindings.finalInputChecks.length !== roles.length) {
    fail(`Pair ${pairIndex} final input checks are incomplete.`);
  }
  const finalInputChecks = bindings.finalInputChecks.map((value, index) => {
    const receipt = record(value, `pair ${pairIndex} final input check ${index}`);
    exactKeys(receipt, ["assetFileSha256", "contractFileSha256", "status"],
      `pair ${pairIndex} final input check ${index}`);
    stringMatch(receipt.assetFileSha256, sha256Pattern,
      `pair ${pairIndex} final asset file`);
    stringMatch(receipt.contractFileSha256, sha256Pattern,
      `pair ${pairIndex} final contract file`);
    equal(receipt.status, "post-capture-inputs-unchanged",
      `pair ${pairIndex} final input status`);
    const role = roles[index];
    equal(receipt.contractFileSha256, stacks[role].runtimeBinding.journeyContractSha256,
      `pair ${pairIndex} final contract file binding`);
    equal(receipt.assetFileSha256, stacks[role].runtimeBinding.staticAssetSourceFileSha256,
      `pair ${pairIndex} final asset file binding`);
    equal(bindings.finalInputContractSha256s[index], sha256(stableJson(receipt)),
      `pair ${pairIndex} final input binding`);
    return { ...receipt };
  });
  for (const [index, role] of roles.entries()) {
    equal(bindings.inputReceiptContractSha256s[index],
      sha256(JSON.stringify(stacks[role].inputReceipt)),
      `pair ${pairIndex} input receipt execution binding`);
    equal(bindings.runtimeAttestationContractSha256s[index],
      sha256(JSON.stringify(stacks[role].runtimeAttestation)),
      `pair ${pairIndex} runtime execution binding`);
    equal(bindings.resetContractSha256s[index], sha256(stableJson(stacks[role].reset)),
      `pair ${pairIndex} reset execution binding`);
    equal(bindings.browserCaptureContractSha256s[index], sha256(stableJson({
      browser: stacks[role].browser,
      runScopeSha256: stacks[role].runScopeSha256,
    })), `pair ${pairIndex} browser capture execution binding`);
  }
  return { ...bindings, finalInputChecks };
}

function assertStackReport(value, expectedRole, pairIndex) {
  const stack = record(value, `${expectedRole} pair ${pairIndex} stack report`);
  exactKeys(stack, [
    "applicationImage",
    "browser",
    "cleanup",
    "connectProxy",
    "fixtureContract",
    "inputReceipt",
    "migrationImage",
    "pairIndex",
    "phases",
    "publicBuildContract",
    "reset",
    "role",
    "proofHmacScopeSha256",
    "runScopeSha256",
    "runtimeBinding",
    "runtimeAttestation",
  ], `${expectedRole} pair ${pairIndex} stack report`);
  equal(stack.role, expectedRole, `${expectedRole} stack role`);
  equal(stack.pairIndex, pairIndex, `${expectedRole} stack pair index`);
  stringMatch(stack.proofHmacScopeSha256, sha256Pattern, `${expectedRole} proof HMAC scope`);
  stringMatch(stack.runScopeSha256, sha256Pattern, `${expectedRole} run scope`);
  const image = assertApplicationImage(stack.applicationImage, expectedRole);
  const migrationImage = assertMigrationImage(stack.migrationImage, expectedRole);
  if (image.assetImageDigest === migrationImage.assetImageDigest
    || (migrationImage.configDigest !== undefined
      && image.configDigest === migrationImage.configDigest)
    || image.referenceSha256 === migrationImage.referenceSha256) {
    fail(`${expectedRole} application and migration image identities are conflated.`);
  }
  if (image.manifestDigest !== undefined && migrationImage.manifestDigest !== undefined) {
    const applicationIdentities = new Set([
      image.assetImageDigest,
      image.configDigest,
      image.manifestDigest,
    ]);
    if ([migrationImage.assetImageDigest, migrationImage.manifestDigest]
      .some((digest) => applicationIdentities.has(digest))) {
      fail(`${expectedRole} application and migration containerd image identities overlap.`);
    }
  }
  equal(image.revision, migrationImage.revision,
    `${expectedRole} application/migration source revision`);
  const fixture = assertVersionedDigest(stack.fixtureContract, expectedRole, "fixture");
  const build = assertVersionedDigest(stack.publicBuildContract, expectedRole, "public build");
  const inputReceipt = assertInputReceipt(stack.inputReceipt, expectedRole);
  const runtimeAttestation = assertRuntimeAttestation(
    stack.runtimeAttestation,
    expectedRole,
  );
  const runtime = assertRuntimeBinding(stack.runtimeBinding, expectedRole);
  const imageSelectionMode = selectionModeOf(image, `${expectedRole} application image`);
  for (const [value, valueLabel] of [
    [migrationImage, "migration image"],
    [inputReceipt, "input receipt"],
    [runtimeAttestation, "runtime attestation"],
  ]) {
    equal(
      selectionModeOf(value, `${expectedRole} ${valueLabel}`),
      imageSelectionMode,
      `${expectedRole} ${valueLabel} selection mode`,
    );
  }
  const reset = assertResetReport(stack.reset, expectedRole);
  const browser = assertBrowser(stack.browser, expectedRole);
  const phases = assertPhases(stack.phases, expectedRole);
  const proxy = assertConnectProxy(stack.connectProxy, expectedRole);
  const cleanup = assertCleanup(stack.cleanup, runtime.projectSha256, expectedRole);
  assertReceiptRuntimeBinding(
    inputReceipt,
    runtimeAttestation,
    runtime,
    fixture,
    expectedRole,
  );
  equal(stableJson(image.publicBuildContract), stableJson(build),
    `${expectedRole} application/public build contract`);
  equal(runtime.staticAssetImageDigest, image.assetImageDigest,
    `${expectedRole} application asset image binding`);
  equal(runtime.staticAssetConfigDigest, inputReceipt.applicationImageConfigDigest,
    `${expectedRole} application config image binding`);
  equal(image.configDigest, inputReceipt.applicationImageConfigDigest,
    `${expectedRole} application config receipt binding`);
  if (imageSelectionMode === containerdImageSelectionMode) {
    equal(image.runtimeImageDigest, inputReceipt.applicationImageRuntimeDigest,
      `${expectedRole} application runtime receipt binding`);
    equal(image.manifestDigest, inputReceipt.applicationImageManifestDigest,
      `${expectedRole} application manifest receipt binding`);
  }
  equal(runtime.staticAssetManifestDigest, image.manifestDigest,
    `${expectedRole} application manifest image binding`);
  equal(runtime.applicationRepoDigestContractSha256, image.repoDigestContractSha256,
    `${expectedRole} application repository digest binding`);
  equal(runtime.applicationImageBindingContractSha256, applicationImageBindingSha256(image),
    `${expectedRole} application image binding contract`);
  equal(runtime.migrationAssetImageDigest, migrationImage.assetImageDigest,
    `${expectedRole} migration asset image binding`);
  if (imageSelectionMode === "classic-config") {
    equal(migrationImage.configDigest, inputReceipt.migrationImageConfigDigest,
      `${expectedRole} migration config receipt binding`);
  } else {
    equal(migrationImage.runtimeImageDigest, inputReceipt.migrationImageRuntimeDigest,
      `${expectedRole} migration runtime receipt binding`);
    equal(migrationImage.manifestDigest, inputReceipt.migrationImageManifestDigest,
      `${expectedRole} migration manifest receipt binding`);
  }
  equal(runtime.migrationImageBindingContractSha256, migrationImage.bindingContractSha256,
    `${expectedRole} migration image binding contract`);
  equal(migrationImage.bindingContractSha256, migrationImageBindingSha256(migrationImage),
    `${expectedRole} migration image binding recomputation`);
  return {
    role: expectedRole,
    pairIndex,
    proofHmacScopeSha256: stack.proofHmacScopeSha256,
    runScopeSha256: stack.runScopeSha256,
    applicationImage: image,
    migrationImage,
    fixtureContract: fixture,
    inputReceipt,
    publicBuildContract: build,
    runtimeBinding: runtime,
    runtimeAttestation,
    reset,
    browser,
    phases,
    connectProxy: proxy,
    cleanup,
  };
}

function assertApplicationImage(value, label) {
  const image = record(value, `${label} application image`);
  const mode = selectionModeOf(image, `${label} application image`);
  const classicKeys = [
    "assetImageDigest",
    "configDigest",
    "manifestDigest",
    "publicBuildContract",
    "referenceSha256",
    "repoDigestContractSha256",
    "revision",
    "role",
    "runtimeImageDigest",
  ];
  exactKeys(image, mode === "classic-config"
    ? classicKeys
    : [...classicKeys, "imageSelectionMode"], `${label} application image`);
  for (const name of ["assetImageDigest", "configDigest", "manifestDigest", "runtimeImageDigest"]) {
    stringMatch(image[name], imageDigestPattern, `${label} application ${name}`);
  }
  if (image.configDigest === image.assetImageDigest || image.configDigest === image.manifestDigest) {
    fail(`${label} application config and OCI source digests are conflated.`);
  }
  equal(
    image.runtimeImageDigest,
    mode === "classic-config" ? image.configDigest : image.assetImageDigest,
    `${label} application runtime ${mode === "classic-config" ? "config" : "OCI root"}`,
  );
  stringMatch(image.referenceSha256, sha256Pattern, `${label} application reference`);
  stringMatch(image.repoDigestContractSha256, sha256Pattern,
    `${label} application repository digest contract`);
  stringMatch(image.revision, /^[a-f0-9]{40}$/, `${label} application image revision`);
  equal(image.role, "app", `${label} application image role`);
  const publicBuildContract = assertVersionedDigest(
    image.publicBuildContract,
    label,
    "public build",
  );
  return { ...image, publicBuildContract };
}

function assertMigrationImage(value, label) {
  const image = record(value, `${label} migration image`);
  const mode = selectionModeOf(image, `${label} migration image`);
  const classicKeys = [
    "assetImageDigest",
    "bindingContractSha256",
    "configDigest",
    "referenceSha256",
    "revision",
    "role",
    "runtimeImageDigest",
  ];
  exactKeys(image, mode === "classic-config"
    ? classicKeys
    : [
      "assetImageDigest",
      "bindingContractSha256",
      "imageSelectionMode",
      "manifestDigest",
      "referenceSha256",
      "revision",
      "role",
      "runtimeImageDigest",
    ], `${label} migration image`);
  for (const name of mode === "classic-config"
    ? ["assetImageDigest", "configDigest", "runtimeImageDigest"]
    : ["assetImageDigest", "manifestDigest", "runtimeImageDigest"]) {
    stringMatch(image[name], imageDigestPattern, `${label} migration ${name}`);
  }
  if (mode === "classic-config" && image.configDigest === image.assetImageDigest) {
    fail(`${label} migration config and OCI source digests are conflated.`);
  }
  equal(
    image.runtimeImageDigest,
    mode === "classic-config" ? image.configDigest : image.assetImageDigest,
    `${label} migration runtime ${mode === "classic-config" ? "config" : "OCI root"}`,
  );
  stringMatch(image.bindingContractSha256, sha256Pattern, `${label} migration binding`);
  stringMatch(image.referenceSha256, sha256Pattern, `${label} migration reference`);
  stringMatch(image.revision, /^[a-f0-9]{40}$/, `${label} migration image revision`);
  equal(image.role, "migration", `${label} migration image role`);
  return { ...image };
}

function applicationImageBindingSha256(image) {
  const classic = {
    assetImageDigest: image.assetImageDigest,
    configDigest: image.configDigest,
    referenceSha256: image.referenceSha256,
    repoDigests: [...new Set([image.assetImageDigest, image.manifestDigest])].sort(),
    role: "application",
  };
  return sha256(JSON.stringify(selectionModeOf(image, "application image binding")
    === "classic-config" ? classic : {
      assetImageDigest: image.assetImageDigest,
      configDigest: image.configDigest,
      imageSelectionMode: image.imageSelectionMode,
      manifestDigest: image.manifestDigest,
      referenceSha256: image.referenceSha256,
      repoDigests: classic.repoDigests,
      role: "application",
      runtimeImageDigest: image.runtimeImageDigest,
    }));
}

function migrationImageBindingSha256(image) {
  const classic = {
    assetImageDigest: image.assetImageDigest,
    configDigest: image.configDigest,
    referenceSha256: image.referenceSha256,
    repoDigests: [image.assetImageDigest],
    role: "migration",
  };
  return sha256(JSON.stringify(selectionModeOf(image, "migration image binding")
    === "classic-config" ? classic : {
      assetImageDigest: image.assetImageDigest,
      imageSelectionMode: image.imageSelectionMode,
      manifestDigest: image.manifestDigest,
      referenceSha256: image.referenceSha256,
      repoDigests: classic.repoDigests,
      role: "migration",
      runtimeImageDigest: image.runtimeImageDigest,
    }));
}

function assertVersionedDigest(value, label, kind) {
  const contract = record(value, `${label} ${kind} contract`);
  exactKeys(contract, ["sha256", "version"], `${label} ${kind} contract`);
  equal(contract.version, kind === "fixture" ? "journey-v5" : "1", `${label} ${kind} version`);
  stringMatch(contract.sha256, sha256Pattern, `${label} ${kind} sha256`);
  return { version: contract.version, sha256: contract.sha256 };
}

function assertInputReceipt(value, label) {
  const receipt = record(value, `${label} input receipt`);
  const mode = selectionModeOf(receipt, `${label} input receipt`);
  const sharedKeys = [
    "applicationImageBindingContractSha256",
    "applicationImageConfigDigest",
    "composeSourceSha256",
    "fixtureBindingContractSha256",
    "fixtureMountSubsetContractSha256",
    "fixtureSourceContractSha256",
    "generatedEnvironmentDirectorySha256",
    "globalFixtureContractSha256",
    "imageProbeOwnershipContractSha256",
    "migrationImageBindingContractSha256",
    "projectSha256",
    "renderedComposeSha256",
    "roleEnvironmentContractSha256",
    "roleEnvironmentPolicySha256",
  ];
  exactKeys(receipt, mode === "classic-config"
    ? [...sharedKeys, "migrationImageConfigDigest"]
    : [
      ...sharedKeys,
      "applicationImageManifestDigest",
      "applicationImageRuntimeDigest",
      "imageSelectionMode",
      "migrationImageManifestDigest",
      "migrationImageRuntimeDigest",
    ], `${label} input receipt`);
  for (const [name, digest] of Object.entries(receipt)) {
    if (name === "imageSelectionMode") continue;
    stringMatch(
      digest,
      name.endsWith("ConfigDigest") || name.endsWith("RuntimeDigest")
        || name.endsWith("ManifestDigest") ? imageDigestPattern : sha256Pattern,
      `${label} input receipt ${name}`,
    );
  }
  return { ...receipt };
}

function assertRuntimeAttestation(value, label) {
  const runtime = record(value, `${label} runtime attestation`);
  const mode = selectionModeOf(runtime, `${label} runtime attestation`);
  const sharedKeys = [
    "applicationImageBindingContractSha256",
    "applicationRepoDigestContractSha256",
    "applicationRuntimeImageDigest",
    "composeRuntimeContractSha256",
    "composeSourceSha256",
    "fixtureExecutionContractSha256",
    "fixtureMountContractSha256",
    "migrationImageBindingContractSha256",
    "migrationRuntimeImageDigest",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "renderedComposeSha256",
    "serviceIdentitySha256",
    "syntheticRoleEnvironmentContractSha256",
    "syntheticRoleEnvironmentPolicySha256",
  ];
  exactKeys(runtime, mode === "classic-config"
    ? sharedKeys
    : [...sharedKeys, "applicationManifestDigest", "imageSelectionMode", "migrationManifestDigest"],
  `${label} runtime attestation`);
  for (const [name, digest] of Object.entries(runtime)) {
    if (name === "imageSelectionMode") continue;
    stringMatch(
      digest,
      name.endsWith("ImageDigest") || name.endsWith("ManifestDigest")
        ? imageDigestPattern : sha256Pattern,
      `${label} runtime attestation ${name}`,
    );
  }
  return { ...runtime };
}

function assertRuntimeBinding(value, label) {
  const binding = record(value, `${label} runtime binding`);
  exactKeys(binding, [
    "applicationImageBindingContractSha256",
    "applicationRepoDigestContractSha256",
    "composeRuntimeContractSha256",
    "composeSourceSha256",
    "connectProxyBindingSha256",
    "fixtureMountContractSha256",
    "fixtureBindingContractSha256",
    "fixtureExecutionContractSha256",
    "globalFixtureContractSha256",
    "generatedEnvironmentDirectorySha256",
    "journeyContractSha256",
    "migrationAssetImageDigest",
    "migrationImageBindingContractSha256",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "ownedInputReceiptSha256",
    "projectSha256",
    "publicationsSha256",
    "renderedComposeSha256",
    "serviceIdentitySha256",
    "staticAssetAttestationSha256",
    "staticAssetConfigDigest",
    "staticAssetImageDigest",
    "staticAssetInventorySha256",
    "staticAssetInventoryProjectionSha256",
    "staticAssetRouteGraphSha256",
    "staticAssetManifestDigest",
    "staticAssetSourceFileSha256",
    "status",
    "syntheticRoleEnvironmentContractSha256",
    "syntheticRoleEnvironmentPolicySha256",
  ], `${label} runtime binding`);
  equal(binding.status, "verifier-owned-runtime-bound", `${label} runtime status`);
  for (const name of Object.keys(binding).filter((name) => name !== "status")) {
    stringMatch(
      binding[name],
      name.endsWith("ImageDigest") || name.endsWith("ConfigDigest")
        || name.endsWith("ManifestDigest") ? imageDigestPattern : sha256Pattern,
      `${label} runtime ${name}`,
    );
  }
  return { ...binding };
}

function assertReceiptRuntimeBinding(receipt, attestation, runtime, fixture, label) {
  for (const [receiptName, runtimeName] of [
    ["composeSourceSha256", "composeSourceSha256"],
    ["fixtureSourceContractSha256", "fixtureMountContractSha256"],
    ["renderedComposeSha256", "renderedComposeSha256"],
    ["roleEnvironmentContractSha256", "syntheticRoleEnvironmentContractSha256"],
    ["roleEnvironmentPolicySha256", "syntheticRoleEnvironmentPolicySha256"],
    ["applicationImageBindingContractSha256", "applicationImageBindingContractSha256"],
    ["migrationImageBindingContractSha256", "migrationImageBindingContractSha256"],
  ]) {
    equal(receipt[receiptName], attestation[runtimeName], `${label} receipt/runtime ${receiptName}`);
  }
  const mode = selectionModeOf(receipt, `${label} receipt/runtime binding`);
  if (mode === "classic-config") {
    equal(receipt.applicationImageConfigDigest, attestation.applicationRuntimeImageDigest,
      `${label} receipt/runtime applicationImageConfigDigest`);
    equal(receipt.migrationImageConfigDigest, attestation.migrationRuntimeImageDigest,
      `${label} receipt/runtime migrationImageConfigDigest`);
  } else {
    for (const [receiptName, runtimeName] of [
      ["applicationImageRuntimeDigest", "applicationRuntimeImageDigest"],
      ["applicationImageManifestDigest", "applicationManifestDigest"],
      ["migrationImageRuntimeDigest", "migrationRuntimeImageDigest"],
      ["migrationImageManifestDigest", "migrationManifestDigest"],
    ]) {
      equal(receipt[receiptName], attestation[runtimeName],
        `${label} receipt/runtime ${receiptName}`);
    }
  }
  equal(receipt.fixtureMountSubsetContractSha256, attestation.fixtureMountContractSha256,
    `${label} receipt/runtime fixture subset`);
  equal(receipt.generatedEnvironmentDirectorySha256,
    runtime.generatedEnvironmentDirectorySha256, `${label} receipt/runtime environment`);
  equal(receipt.projectSha256, runtime.projectSha256, `${label} receipt/runtime project`);
  equal(receipt.globalFixtureContractSha256, runtime.globalFixtureContractSha256,
    `${label} receipt/runtime global fixture`);
  equal(receipt.fixtureBindingContractSha256, runtime.fixtureBindingContractSha256,
    `${label} receipt/runtime fixture binding`);
  equal(receipt.globalFixtureContractSha256, fixture.sha256,
    `${label} receipt/global fixture binding`);
  equal(receipt.fixtureBindingContractSha256, sha256(JSON.stringify({
    globalFixtureContractSha256: receipt.globalFixtureContractSha256,
    mountSubsetContractSha256: receipt.fixtureMountSubsetContractSha256,
  })), `${label} receipt fixture binding contract`);
  equal(runtime.fixtureMountContractSha256, attestation.fixtureMountContractSha256,
    `${label} runtime fixture mount`);
  equal(runtime.fixtureExecutionContractSha256, attestation.fixtureExecutionContractSha256,
    `${label} runtime fixture execution`);
  for (const name of [
    "applicationImageBindingContractSha256",
    "applicationRepoDigestContractSha256",
    "composeRuntimeContractSha256",
    "composeSourceSha256",
    "migrationImageBindingContractSha256",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "renderedComposeSha256",
    "serviceIdentitySha256",
    "syntheticRoleEnvironmentContractSha256",
    "syntheticRoleEnvironmentPolicySha256",
  ]) equal(runtime[name], attestation[name], `${label} runtime attestation ${name}`);
  equal(
    runtime.ownedInputReceiptSha256,
    sha256(JSON.stringify(receipt)),
    `${label} owned input receipt digest`,
  );
}

function selectionModeOf(value, label) {
  if (value?.imageSelectionMode === undefined) return "classic-config";
  equal(value.imageSelectionMode, containerdImageSelectionMode, `${label} image selection mode`);
  return containerdImageSelectionMode;
}

function assertResetReport(value, label) {
  const reset = record(value, `${label} reset report`);
  exactKeys(reset, ["database", "scenarioSha256", "seedSha256"], `${label} reset report`);
  equal(reset.scenarioSha256, sha256(CHATWOOT_PHASE_PROOF_SCENARIO), `${label} reset scenario`);
  equal(
    reset.seedSha256,
    sha256(`${fixtureSeed}:${CHATWOOT_PHASE_PROOF_SCENARIO}`),
    `${label} reset seed`,
  );
  const database = record(reset.database, `${label} reset database`);
  exactKeys(database, [
    "redis",
    "resetSequence",
    "schemaSha256",
    "scopeSha256",
    "sequenceCount",
    "tableCount",
    "transaction",
  ], `${label} reset database`);
  stringMatch(database.scopeSha256, sha256Pattern, `${label} reset scope`);
  stringMatch(database.schemaSha256, sha256Pattern, `${label} reset schema`);
  positiveInteger(database.tableCount, `${label} reset table count`);
  equal(database.sequenceCount, 0, `${label} reset sequence count`);
  equal(database.resetSequence, 1, `${label} reset sequence`);
  equal(
    database.transaction,
    "truncate-public-application-tables-cascade-no-sequences",
    `${label} reset transaction`,
  );
  equal(database.redis, "flush-owned-db-0", `${label} reset redis`);
  return { scenarioSha256: reset.scenarioSha256, seedSha256: reset.seedSha256, database: { ...database } };
}

function assertBrowser(value, label) {
  const browser = record(value, `${label} browser`);
  exactKeys(browser, [
    "chromiumVersion",
    "colorScheme",
    "connectProxyBindingSha256",
    "contextScopeSha256",
    "eventSeal",
    "historySemantics",
    "launchPolicySha256",
    "launchScopeSha256",
    "locale",
    "playwrightVersion",
    "serviceWorkers",
    "staticProvenance",
    "processScopeSha256",
    "projectBindingSha256",
    "timezoneId",
    "unexpectedConsoleCount",
    "unexpectedPageErrorCount",
    "unexpectedPageCount",
    "unexpectedRequestCount",
    "userAgentSha256",
    "viewport",
  ], `${label} browser`);
  stringMatch(browser.chromiumVersion, /^\d+\.\d+\.\d+\.\d+$/, `${label} Chromium version`);
  stringMatch(browser.playwrightVersion, /^\d+\.\d+\.\d+$/, `${label} Playwright version`);
  equal(browser.colorScheme, "light", `${label} color scheme`);
  equal(browser.locale, "ru-RU", `${label} locale`);
  equal(browser.timezoneId, "Europe/Moscow", `${label} timezone`);
  equal(browser.serviceWorkers, "block", `${label} service workers`);
  const viewport = record(browser.viewport, `${label} viewport`);
  exactKeys(viewport, ["height", "width"], `${label} viewport`);
  equal(viewport.width, 1440, `${label} viewport width`);
  equal(viewport.height, 900, `${label} viewport height`);
  for (const name of [
    "unexpectedConsoleCount",
    "unexpectedPageErrorCount",
    "unexpectedPageCount",
    "unexpectedRequestCount",
  ]) equal(browser[name], 0, `${label} browser ${name}`);
  stringMatch(browser.userAgentSha256, sha256Pattern, `${label} user agent`);
  for (const name of [
    "connectProxyBindingSha256",
    "contextScopeSha256",
    "launchPolicySha256",
    "launchScopeSha256",
    "processScopeSha256",
    "projectBindingSha256",
  ]) stringMatch(browser[name], sha256Pattern, `${label} browser ${name}`);
  const staticProvenance = assertBrowserStaticProvenance(
    browser.staticProvenance,
    `${label} browser static provenance`,
  );
  const historySemantics = assertBrowserHistorySemantics(
    browser.historySemantics,
    `${label} browser history semantics`,
  );
  const eventSeal = assertBrowserEventSeal(browser.eventSeal, `${label} browser event seal`);
  return {
    ...browser,
    eventSeal,
    historySemantics,
    staticProvenance,
    viewport: { ...viewport },
  };
}

function assertBrowserHistorySemantics(value, label) {
  const semantics = record(value, label);
  exactKeys(semantics, [
    "contractSha256",
    "entryCount",
    "generationBoundaryCount",
    "initialEntryCount",
    "recreatedEntryCount",
  ], label);
  stringMatch(semantics.contractSha256, sha256Pattern, `${label} contract digest`);
  for (const name of ["entryCount", "initialEntryCount", "recreatedEntryCount"]) {
    if (!integerInRange(semantics[name], 1, 256)) {
      fail(`${label} ${name} is outside its exact bound.`);
    }
  }
  equal(semantics.generationBoundaryCount, 1, `${label} generation boundary count`);
  equal(
    semantics.entryCount,
    semantics.initialEntryCount + semantics.recreatedEntryCount,
    `${label} generation partition`,
  );
  return { ...semantics };
}

function assertBrowserEventSeal(value, label) {
  const seal = record(value, label);
  exactKeys(seal, [
    "eventCount",
    "lateEventCount",
    "sourceCounts",
    "sourceDigestsPresent",
    "stateSha256",
    "status",
  ], label);
  equal(seal.status, "sealed-clean", `${label} status`);
  if (!integerInRange(seal.eventCount, 1, maximumEventSealCount)) {
    fail(`${label} aggregate event count is outside its capture bound.`);
  }
  equal(seal.lateEventCount, 0, `${label} late event count`);
  stringMatch(seal.stateSha256, sha256Pattern, `${label} state digest`);
  const names = [
    "boundary",
    "browserRequests",
    "browserResponses",
    "diagnostics",
    "history",
    "network",
    "provider",
  ];
  const counts = record(seal.sourceCounts, `${label} source counts`);
  const present = record(seal.sourceDigestsPresent, `${label} source digests`);
  exactKeys(counts, names, `${label} source counts`);
  exactKeys(present, names, `${label} source digests`);
  for (const name of names) {
    if (!integerInRange(counts[name], 1, maximumEventSealCount)) {
      fail(`${label} ${name} count is outside its exact bound.`);
    }
    equal(present[name], true, `${label} ${name} digest presence`);
  }
  equal(
    Object.values(counts).reduce((sum, count) => sum + count, 0),
    seal.eventCount,
    `${label} aggregate event count completeness`,
  );
  return {
    eventCount: seal.eventCount,
    lateEventCount: 0,
    sourceCounts: { ...counts },
    sourceDigestsPresent: { ...present },
    stateSha256: seal.stateSha256,
    status: seal.status,
  };
}

function assertBrowserStaticProvenance(value, label) {
  const provenance = record(value, label);
  exactKeys(provenance, [
    "assetAttestationSha256",
    "assetInventorySha256",
    "assetInventoryProjectionSha256",
    "assetRouteGraphSha256",
    "initial",
    "recreated",
  ], label);
  for (const name of [
    "assetAttestationSha256",
    "assetInventorySha256",
    "assetInventoryProjectionSha256",
    "assetRouteGraphSha256",
  ]) {
    stringMatch(provenance[name], sha256Pattern, `${label} ${name}`);
  }
  const generation = (name) => {
    const entry = record(provenance[name], `${label} ${name}`);
    exactKeys(entry, [
      "documentGenerationCount",
      "requestContractSha256",
      "requestCount",
      "requestOrderContractSha256",
      "requestOrderLedger",
      "responseDeclarationContractSha256",
      "responseDeclarationLedger",
      "semanticRequestLedger",
      "staticLoadGraph",
      "staticLoadGraphContractSha256",
      "staticRequestContractSha256",
      "staticRequestCount",
      "staticRequestLedger",
      "staticResponseByteLength",
    ], `${label} ${name}`);
    for (const digestName of [
      "requestContractSha256",
      "requestOrderContractSha256",
      "responseDeclarationContractSha256",
      "staticLoadGraphContractSha256",
      "staticRequestContractSha256",
    ]) {
      stringMatch(entry[digestName], sha256Pattern, `${label} ${name} ${digestName}`);
    }
    equal(entry.documentGenerationCount, name === "initial" ? 3 : 2,
      `${label} ${name} document generations`);
    if (!integerInRange(entry.requestCount, 1, 256)
      || !integerInRange(entry.staticRequestCount, 1, entry.requestCount)
      || !integerInRange(entry.staticResponseByteLength, 1, 1024 * 1024 * 1024)) {
      fail(`${label} ${name} bounded provenance count is invalid.`);
    }
    if (!isDenseArray(entry.requestOrderLedger)) {
      fail(`${label} ${name} request order must be a dense own-index array.`);
    }
    const order = entry.requestOrderLedger;
    equal(order.length, entry.requestCount, `${label} ${name} request order count`);
    const occurrences = { semantic: 0, static: 0 };
    for (const [index, raw] of order.entries()) {
      const orderEntry = record(raw, `${label} ${name} request order ${index}`);
      exactKeys(orderEntry, ["kind", "occurrence"], `${label} ${name} request order ${index}`);
      if (!Object.hasOwn(occurrences, orderEntry.kind)) {
        fail(`${label} ${name} request order kind is invalid.`);
      }
      occurrences[orderEntry.kind] += 1;
      equal(orderEntry.occurrence, occurrences[orderEntry.kind],
        `${label} ${name} request order occurrence`);
    }
    equal(occurrences.static, entry.staticRequestCount,
      `${label} ${name} static request order count`);
    equal(entry.requestOrderContractSha256, sha256(JSON.stringify(order)),
      `${label} ${name} request order digest`);
    const responseDeclarationLedger = assertResponseDeclarationLedger(
      entry.responseDeclarationLedger,
      name,
      `${label} ${name} response declarations`,
    );
    equal(
      entry.responseDeclarationContractSha256,
      sha256(JSON.stringify(responseDeclarationLedger)),
      `${label} ${name} response declaration digest`,
    );
    const semanticRequestLedger = assertStaticSemanticLedger(
      entry.semanticRequestLedger,
      name,
      `${label} ${name} semantic requests`,
    );
    const staticRequestLedger = assertStaticRequestLedger(
      entry.staticRequestLedger,
      name,
      `${label} ${name} static requests`,
    );
    equal(semanticRequestLedger.length, occurrences.semantic,
      `${label} ${name} semantic request order count`);
    equal(staticRequestLedger.length, occurrences.static,
      `${label} ${name} static request order count`);
    equal(entry.requestCount, semanticRequestLedger.length + staticRequestLedger.length,
      `${label} ${name} complete request count`);
    equal(entry.staticRequestContractSha256, sha256(JSON.stringify(staticRequestLedger)),
      `${label} ${name} static request digest`);
    equal(entry.staticResponseByteLength, staticRequestLedger.reduce(
      (total, observation) => total + observation.assetBytes,
      0,
    ), `${label} ${name} static response byte total`);
    const summary = name === "initial" ? {
      version: 1,
      semanticLedger: semanticRequestLedger,
      staticClasses: [...new Set(staticRequestLedger.map(({ class: className }) => className))]
        .sort(),
    } : {
      version: 1,
      scenario: CHATWOOT_PHASE_PROOF_SCENARIO,
      semanticLedger: semanticRequestLedger,
      staticClasses: [...new Set(staticRequestLedger.map(({ class: className }) => className))]
        .sort(),
    };
    equal(entry.requestContractSha256, sha256(JSON.stringify(summary)),
      `${label} ${name} semantic request digest`);
    const staticLoadGraph = assertStaticLoadGraph(
      entry.staticLoadGraph,
      name,
      `${label} ${name} static load graph`,
    );
    equal(entry.staticLoadGraphContractSha256, sha256(JSON.stringify(staticLoadGraph)),
      `${label} ${name} static load graph digest`);
    return {
      ...entry,
      requestOrderLedger: order.map((orderEntry) => ({ ...orderEntry })),
      responseDeclarationLedger,
      semanticRequestLedger,
      staticLoadGraph,
      staticRequestLedger,
    };
  };
  const initial = generation("initial");
  const recreated = generation("recreated");
  for (const graph of [initial.staticLoadGraph, recreated.staticLoadGraph]) {
    equal(graph.assetAttestationSha256, provenance.assetAttestationSha256,
      `${label} static graph asset attestation`);
    equal(graph.assetInventorySha256, provenance.assetInventorySha256,
      `${label} static graph asset inventory`);
    equal(graph.inventoryLedgerContractSha256, provenance.assetInventoryProjectionSha256,
      `${label} static graph inventory projection`);
    equal(graph.routeDeclaredPathContractSha256, provenance.assetRouteGraphSha256,
      `${label} static graph route projection`);
  }
  equal(
    recreated.staticLoadGraph.referenceStaticLoadGraphContractSha256,
    initial.staticLoadGraphContractSha256,
    `${label} recreated static reference graph`,
  );
  equal(stableJson(recreated.staticLoadGraph.cssMediaReferenceLedger),
    stableJson(initial.staticLoadGraph.cssMediaReferenceLedger),
    `${label} recreated CSS media closure`);
  equal(
    stableJson(declarationDigestUnion(initial.responseDeclarationLedger)),
    stableJson(initial.staticLoadGraph.declaredPathSha256s),
    `${label} initial per-document response declaration union`,
  );
  equal(
    stableJson(declarationDigestUnion(recreated.responseDeclarationLedger)),
    stableJson(recreated.staticLoadGraph.declaredPathSha256s),
    `${label} recreated per-document response declaration union`,
  );
  equal(
    stableJson(recreated.responseDeclarationLedger),
    stableJson(initial.responseDeclarationLedger.filter(({ documentKey }) => (
      documentKey !== "app-profile-document"
    ))),
    `${label} recreated per-document response declaration closure`,
  );
  const recreatedDocuments = initial.staticLoadGraph.documentLoadLedger.filter(({ documentKey }) => (
    documentKey !== "app-profile-document"
  ));
  equal(stableJson(recreated.staticLoadGraph.documentLoadLedger), stableJson(recreatedDocuments),
    `${label} recreated document load closure`);
  const recreatedStaticRequests = initial.staticRequestLedger.filter(({ documentKey }) => (
    documentKey !== "app-profile-document"
  ));
  equal(stableJson(recreated.staticRequestLedger), stableJson(recreatedStaticRequests),
    `${label} recreated static response occurrence closure`);
  const inventoryByPathSha256 = new Map(initial.staticLoadGraph.inventoryLedger.map((entry) => [
    entry.pathSha256,
    entry,
  ]));
  for (const [generationName, observations] of [
    ["initial", initial.staticRequestLedger],
    ["recreated", recreated.staticRequestLedger],
  ]) {
    for (const observation of observations) {
      const inventory = inventoryByPathSha256.get(observation.pathSha256);
      if (!inventory || observation.assetBytes !== inventory.assetBytes
        || observation.assetSha256 !== inventory.assetSha256
        || observation.class !== staticClassForExtension(inventory.extension)
        || !staticContentTypesForExtension(inventory.extension).includes(
          observation.contentType,
        )) {
        fail(`${label} ${generationName} static response differs from its inventory ledger.`);
      }
    }
  }
  assertSerializedStaticBinding(
    initial,
    initial.staticLoadGraph,
    initial.staticLoadGraph,
    `${label} initial`,
  );
  assertSerializedStaticBinding(
    recreated,
    recreated.staticLoadGraph,
    initial.staticLoadGraph,
    `${label} recreated`,
  );
  return {
    assetAttestationSha256: provenance.assetAttestationSha256,
    assetInventorySha256: provenance.assetInventorySha256,
    assetInventoryProjectionSha256: provenance.assetInventoryProjectionSha256,
    assetRouteGraphSha256: provenance.assetRouteGraphSha256,
    initial,
    recreated,
  };
}

function assertResponseDeclarationLedger(value, generation, label) {
  const documentKeys = generation === "initial"
    ? ["app-login-document", "app-profile-document", "app-cabinet-document"]
    : ["app-login-document", "app-cabinet-document"];
  if (!isDenseArray(value) || value.length !== documentKeys.length) {
    fail(`${label} ledger is invalid.`);
  }
  return value.map((raw, index) => {
    const entry = record(raw, `${label} ${index}`);
    exactKeys(entry, ["documentKey", "pathSha256s"], `${label} ${index}`);
    equal(entry.documentKey, documentKeys[index], `${label} document order`);
    return {
      documentKey: entry.documentKey,
      pathSha256s: assertSortedDigestArray(
        entry.pathSha256s,
        1,
        256,
        `${label} ${entry.documentKey} paths`,
      ),
    };
  });
}

function declarationDigestUnion(ledger) {
  return [...new Set(ledger.flatMap(({ pathSha256s }) => pathSha256s))].sort();
}

function assertStaticSemanticLedger(value, generation, label) {
  if (!isDenseArray(value) || value.length < 1 || value.length > 256) {
    fail(`${label} is outside its exact bound.`);
  }
  const forbiddenDirectKeys = new Set([
    "app-profile-action",
    "app-profile-document",
    "app-profile-rsc",
    "app-root-rsc",
  ]);
  const normalized = value.map((raw, index) => {
    const entry = record(raw, `${label} ${index}`);
    exactKeys(entry, [
      "disposition", "key", "redirectEdge", "responseContentType", "responseStatus",
    ], `${label} ${index}`);
    if (generation === "recreated" && forbiddenDirectKeys.has(entry.key)) {
      fail(`${label} contains a provider-profile request.`);
    }
    const cabinetEdge = generation === "recreated" && entry.key === "app-cabinet-document";
    if (cabinetEdge) {
      equal(entry.redirectEdge, "app-telegram-callback:307->app-cabinet-document",
        `${label} cabinet redirect edge`);
    }
    const normalizable = cabinetEdge ? { ...entry, redirectEdge: null } : entry;
    normalizeProviderOverlapSemanticEntry(normalizable, `${label} ${index}`);
    return { ...entry };
  });
  const navigationKeys = new Set([
    "app-login-document",
    "app-telegram-start",
    "telegram-oidc-authorize",
    "app-telegram-callback",
    "app-profile-document",
    "app-cabinet-document",
  ]);
  const expectedFlow = generation === "initial"
    ? [
      "app-login-document", "app-telegram-start", "telegram-oidc-authorize",
      "app-telegram-callback", "app-profile-document", "app-cabinet-document",
    ]
    : [
      "app-login-document", "app-telegram-start", "telegram-oidc-authorize",
      "app-telegram-callback", "app-cabinet-document",
    ];
  equal(stableJson(normalized.map(({ key }) => key).filter((key) => navigationKeys.has(key))),
    stableJson(expectedFlow), `${label} exact navigation flow`);
  return normalized;
}

function assertStaticRequestLedger(value, generation, label) {
  if (!isDenseArray(value) || value.length < 1 || value.length > 256) {
    fail(`${label} is outside its exact bound.`);
  }
  const documentKeys = generation === "initial"
    ? ["app-login-document", "app-profile-document", "app-cabinet-document"]
    : ["app-login-document", "app-cabinet-document"];
  let aggregateBytes = 0;
  return value.map((raw, index) => {
    const entry = record(raw, `${label} ${index}`);
    exactKeys(entry, [
      "assetBytes", "assetSha256", "class", "contentType", "documentKey", "pathSha256",
    ], `${label} ${index}`);
    if (!integerInRange(entry.assetBytes, 1, 128 * 1024 * 1024)
      || !sha256Pattern.test(entry.assetSha256 ?? "")
      || !new Set(["next-static-css", "next-static-font", "next-static-image", "next-static-js"])
        .has(entry.class)
      || typeof entry.contentType !== "string" || entry.contentType.length > 128
      || !documentKeys.includes(entry.documentKey)
      || !sha256Pattern.test(entry.pathSha256 ?? "")) {
      fail(`${label} ${index} is invalid.`);
    }
    aggregateBytes += entry.assetBytes;
    if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > 1024 * 1024 * 1024) {
      fail(`${label} aggregate bytes exceed their exact bound.`);
    }
    return { ...entry };
  });
}

function assertStaticLoadGraph(value, generation, label) {
  const graph = record(value, label);
  const commonKeys = [
    "assetAttestationSha256",
    "assetInventorySha256",
    "cssMediaReferenceLedger",
    "declaredPathSha256s",
    "documentLoadLedger",
    "inventoryLedgerContractSha256",
    "routeDeclaredPathContractSha256",
  ];
  const keys = generation === "initial"
    ? [...commonKeys, "declaredPathLedger", "expectedChunkPathSha256s", "inventoryLedger",
      "routeDeclaredPathSha256s"]
    : [...commonKeys, "referenceStaticLoadGraphContractSha256"];
  exactKeys(graph, keys, label);
  for (const name of [
    "assetAttestationSha256",
    "assetInventorySha256",
    "inventoryLedgerContractSha256",
    "routeDeclaredPathContractSha256",
    ...(generation === "recreated" ? ["referenceStaticLoadGraphContractSha256"] : []),
  ]) stringMatch(graph[name], sha256Pattern, `${label} ${name}`);
  const cssMediaReferenceLedger = assertCssMediaReferenceLedger(
    graph.cssMediaReferenceLedger,
    `${label} CSS media references`,
  );
  const declaredPathSha256s = assertSortedDigestArray(
    graph.declaredPathSha256s,
    1,
    256,
    `${label} declared paths`,
  );
  const expectedDocuments = generation === "initial"
    ? ["app-login-document", "app-profile-document", "app-cabinet-document"]
    : ["app-login-document", "app-cabinet-document"];
  if (!isDenseArray(graph.documentLoadLedger)
    || graph.documentLoadLedger.length !== expectedDocuments.length) {
    fail(`${label} document load ledger is invalid.`);
  }
  const documentLoadLedger = graph.documentLoadLedger.map((raw, index) => {
    const entry = record(raw, `${label} document ${index}`);
    exactKeys(entry, [
      "documentKey", "expectedChunkPathSha256s", "expectedMediaPathSha256s",
      "routeDeclaredPathSha256s",
    ], `${label} document ${index}`);
    equal(entry.documentKey, expectedDocuments[index], `${label} document order`);
    const document = {
      documentKey: entry.documentKey,
      expectedChunkPathSha256s: assertSortedDigestArray(
        entry.expectedChunkPathSha256s, 1, 256, `${label} document chunks`,
      ),
      expectedMediaPathSha256s: assertSortedDigestArray(
        entry.expectedMediaPathSha256s, 2, 2, `${label} document media`,
      ),
      routeDeclaredPathSha256s: assertSortedDigestArray(
        entry.routeDeclaredPathSha256s, 1, 64, `${label} document route paths`,
      ),
    };
    if (document.routeDeclaredPathSha256s.some((digest) => (
      !document.expectedChunkPathSha256s.includes(digest)
    ))) fail(`${label} document route graph escaped its expected chunks.`);
    return document;
  });
  const negotiatedMedia = documentLoadLedger[0].expectedMediaPathSha256s;
  const sharedResponseChunks = documentLoadLedger[0].expectedChunkPathSha256s.filter((digest) => (
    !documentLoadLedger[0].routeDeclaredPathSha256s.includes(digest)
  ));
  for (const document of documentLoadLedger.slice(1)) {
    equal(stableJson(document.expectedMediaPathSha256s), stableJson(negotiatedMedia),
      `${label} cross-document negotiated media`);
    equal(stableJson(document.expectedChunkPathSha256s.filter((digest) => (
      !document.routeDeclaredPathSha256s.includes(digest)
    ))), stableJson(sharedResponseChunks), `${label} shared response-only chunks`);
  }
  if (generation === "recreated") {
    return {
      assetAttestationSha256: graph.assetAttestationSha256,
      assetInventorySha256: graph.assetInventorySha256,
      cssMediaReferenceLedger,
      declaredPathSha256s,
      documentLoadLedger,
      inventoryLedgerContractSha256: graph.inventoryLedgerContractSha256,
      referenceStaticLoadGraphContractSha256:
        graph.referenceStaticLoadGraphContractSha256,
      routeDeclaredPathContractSha256: graph.routeDeclaredPathContractSha256,
    };
  }
  if (!isDenseArray(graph.declaredPathLedger)
    || graph.declaredPathLedger.length !== declaredPathSha256s.length) {
    fail(`${label} declared path ledger is invalid.`);
  }
  const declaredPathLedger = graph.declaredPathLedger.map((raw, index) => {
    const entry = record(raw, `${label} declared path ${index}`);
    exactKeys(entry, ["class", "pathSha256"], `${label} declared path ${index}`);
    if (!new Set(["chunk", "media"]).has(entry.class)
      || entry.pathSha256 !== declaredPathSha256s[index]) {
      fail(`${label} declared path ${index} is invalid.`);
    }
    return { ...entry };
  });
  const expectedChunkPathSha256s = assertSortedDigestArray(
    graph.expectedChunkPathSha256s, 1, 256, `${label} expected chunks`,
  );
  const routeDeclaredPathSha256s = assertSortedDigestArray(
    graph.routeDeclaredPathSha256s, 1, 256, `${label} route declared paths`,
  );
  equal(stableJson([...new Set(documentLoadLedger.flatMap((entry) => (
    entry.expectedChunkPathSha256s
  )))].sort()), stableJson(expectedChunkPathSha256s),
  `${label} expected document chunk union`);
  equal(stableJson([...new Set(documentLoadLedger.flatMap((entry) => (
    entry.routeDeclaredPathSha256s
  )))].sort()), stableJson(routeDeclaredPathSha256s),
  `${label} route document union`);
  if (routeDeclaredPathSha256s.some((digest) => !expectedChunkPathSha256s.includes(digest))) {
    fail(`${label} route graph escaped its expected chunks.`);
  }
  if (!isDenseArray(graph.inventoryLedger)
    || graph.inventoryLedger.length < 1 || graph.inventoryLedger.length > 4096) {
    fail(`${label} inventory ledger is outside its exact bound.`);
  }
  let inventoryBytes = 0;
  const inventoryLedger = graph.inventoryLedger.map((raw, index) => {
    const entry = record(raw, `${label} inventory ${index}`);
    exactKeys(entry, [
      "assetBytes", "assetSha256", "extension", "pathSha256",
    ], `${label} inventory ${index}`);
    if (!integerInRange(entry.assetBytes, 1, 128 * 1024 * 1024)
      || !sha256Pattern.test(entry.assetSha256 ?? "")
      || !new Set(["css", "eot", "ico", "js", "png", "svg", "ttf", "woff", "woff2"])
        .has(entry.extension)
      || !sha256Pattern.test(entry.pathSha256 ?? "")
      || (index > 0 && entry.pathSha256 <= graph.inventoryLedger[index - 1].pathSha256)) {
      fail(`${label} inventory ${index} is invalid.`);
    }
    inventoryBytes += entry.assetBytes;
    if (!Number.isSafeInteger(inventoryBytes) || inventoryBytes > 1024 * 1024 * 1024) {
      fail(`${label} inventory aggregate bytes exceed their exact bound.`);
    }
    return { ...entry };
  });
  equal(graph.inventoryLedgerContractSha256, sha256(JSON.stringify(inventoryLedger)),
    `${label} inventory ledger digest`);
  equal(graph.routeDeclaredPathContractSha256, sha256(JSON.stringify(
    documentLoadLedger.map((entry) => ({
      documentKey: entry.documentKey,
      routeDeclaredPathSha256s: entry.routeDeclaredPathSha256s,
    })),
  )), `${label} route projection digest`);
  return {
    assetAttestationSha256: graph.assetAttestationSha256,
    assetInventorySha256: graph.assetInventorySha256,
    cssMediaReferenceLedger,
    declaredPathLedger,
    declaredPathSha256s,
    documentLoadLedger,
    expectedChunkPathSha256s,
    inventoryLedger,
    inventoryLedgerContractSha256: graph.inventoryLedgerContractSha256,
    routeDeclaredPathContractSha256: graph.routeDeclaredPathContractSha256,
    routeDeclaredPathSha256s,
  };
}

function assertCssMediaReferenceLedger(value, label) {
  if (!isDenseArray(value) || value.length !== 8) fail(`${label} is not exact.`);
  return value.map((raw, index) => {
    const entry = record(raw, `${label} ${index}`);
    exactKeys(entry, ["occurrence", "sourcePathSha256", "targetPathSha256"], `${label} ${index}`);
    equal(entry.occurrence, index + 1, `${label} occurrence`);
    stringMatch(entry.sourcePathSha256, sha256Pattern, `${label} source path`);
    stringMatch(entry.targetPathSha256, sha256Pattern, `${label} target path`);
    return { ...entry };
  });
}

function assertSortedDigestArray(value, minimum, maximum, label) {
  if (!isDenseArray(value) || value.length < minimum || value.length > maximum
    || value.some((entry) => !sha256Pattern.test(entry ?? ""))
    || new Set(value).size !== value.length
    || stableJson([...value].sort()) !== stableJson(value)) {
    fail(`${label} is not a sorted unique digest array.`);
  }
  return [...value];
}

function assertSerializedStaticBinding(generation, generationGraph, inventoryGraph, label) {
  const documentKeys = new Set(generationGraph.documentLoadLedger.map(({ documentKey }) => (
    documentKey
  )));
  let activeDocumentKey = null;
  for (const order of generation.requestOrderLedger) {
    if (order.kind === "semantic") {
      const semantic = generation.semanticRequestLedger[order.occurrence - 1];
      if (documentKeys.has(semantic.key)) activeDocumentKey = semantic.key;
    } else {
      const observation = generation.staticRequestLedger[order.occurrence - 1];
      if (observation.documentKey !== activeDocumentKey) {
        fail(`${label} static occurrence escaped its active document generation.`);
      }
    }
  }
  const staticClasses = [...new Set(generation.staticRequestLedger.map((entry) => entry.class))]
    .sort();
  for (const required of ["next-static-css", "next-static-font", "next-static-js"]) {
    if (!staticClasses.includes(required)) fail(`${label} static class closure is incomplete.`);
  }
  const semanticCounts = Object.create(null);
  for (const { key } of generation.semanticRequestLedger) {
    semanticCounts[key] = (semanticCounts[key] ?? 0) + 1;
  }
  if ((semanticCounts["turnstile-widget-script"] ?? 0) < 1
    || (semanticCounts["chatwoot-sdk-script"] ?? 0) < 1
    || semanticCounts["chatwoot-widget-frame"] !== semanticCounts["chatwoot-sdk-script"]
    || (semanticCounts["chatwoot-widget-conversation-frame"] ?? 0)
      > semanticCounts["chatwoot-sdk-script"]) {
    fail(`${label} external browser request relation is invalid.`);
  }
  const inventoryByPath = new Map(inventoryGraph.inventoryLedger.map((entry) => [
    entry.pathSha256,
    entry,
  ]));
  const declaredChunkPaths = inventoryGraph.declaredPathLedger
    .filter(({ class: className }) => className === "chunk")
    .map(({ pathSha256 }) => pathSha256);
  const declaredMediaPaths = inventoryGraph.declaredPathLedger
    .filter(({ class: className }) => className === "media")
    .map(({ pathSha256 }) => pathSha256);
  for (const declaration of inventoryGraph.declaredPathLedger) {
    const inventory = inventoryByPath.get(declaration.pathSha256);
    const expectedClass = ["css", "js"].includes(inventory?.extension) ? "chunk" : "media";
    if (!inventory || declaration.class !== expectedClass) {
      fail(`${label} static declaration class differs from its inventory extension.`);
    }
  }
  const responseDeclarationsByDocument = new Map(
    generation.responseDeclarationLedger.map((entry) => [entry.documentKey, entry]),
  );
  const cssMediaTargetPaths = [...new Set(generationGraph.cssMediaReferenceLedger.map(
    ({ targetPathSha256 }) => targetPathSha256,
  ))].sort();
  for (const documentLoad of generationGraph.documentLoadLedger) {
    const responseDeclaration = responseDeclarationsByDocument.get(documentLoad.documentKey);
    if (!responseDeclaration) {
      fail(`${label} response declaration document is absent.`);
    }
    const responseChunkPaths = [];
    const responseMediaPaths = [];
    for (const pathSha256 of responseDeclaration.pathSha256s) {
      const inventory = inventoryByPath.get(pathSha256);
      if (!inventory) {
        fail(`${label} response declaration escaped its inventory.`);
      }
      if (["css", "js"].includes(inventory.extension)) {
        responseChunkPaths.push(pathSha256);
      } else {
        responseMediaPaths.push(pathSha256);
      }
    }
    equal(
      stableJson([...new Set([
        ...documentLoad.routeDeclaredPathSha256s,
        ...responseChunkPaths,
      ])].sort()),
      stableJson(documentLoad.expectedChunkPathSha256s),
      `${label} ${documentLoad.documentKey} response-declared chunk partition`,
    );
    if (documentLoad.expectedMediaPathSha256s.some((pathSha256) => (
      !responseMediaPaths.includes(pathSha256)
    )) || cssMediaTargetPaths.some((pathSha256) => !responseMediaPaths.includes(pathSha256))) {
      fail(`${label} ${documentLoad.documentKey} response-declared media partition is incomplete.`);
    }
  }
  const reachableChunkPaths = new Set([
    ...inventoryGraph.routeDeclaredPathSha256s,
    ...declaredChunkPaths,
  ]);
  equal(stableJson([...reachableChunkPaths].sort()),
    stableJson(inventoryGraph.expectedChunkPathSha256s),
    `${label} route and response-declared chunk closure`);
  const observedByDocument = new Map(generationGraph.documentLoadLedger.map((entry) => [
    entry.documentKey,
    { chunks: new Set(), media: new Set(), paths: new Set() },
  ]));
  for (const observation of generation.staticRequestLedger) {
    const inventory = inventoryByPath.get(observation.pathSha256);
    const document = observedByDocument.get(observation.documentKey);
    if (!inventory || !document || document.paths.has(observation.pathSha256)
      || inventory.assetSha256 !== observation.assetSha256
      || inventory.assetBytes !== observation.assetBytes
      || observation.class !== staticClassForExtension(inventory.extension)
      || !staticContentTypesForExtension(inventory.extension).includes(
        observation.contentType,
      )) {
      fail(`${label} static occurrence differs from its exact inventory/document closure.`);
    }
    document.paths.add(observation.pathSha256);
    if (["next-static-font", "next-static-image"].includes(observation.class)) {
      if (!declaredMediaPaths.includes(observation.pathSha256)) {
        fail(`${label} observed media escaped its declaration closure.`);
      }
      document.media.add(observation.pathSha256);
    } else {
      document.chunks.add(observation.pathSha256);
    }
  }
  for (const documentLoad of generationGraph.documentLoadLedger) {
    const observed = observedByDocument.get(documentLoad.documentKey);
    equal(stableJson([...observed.chunks].sort()),
      stableJson(documentLoad.expectedChunkPathSha256s),
      `${label} document chunk closure`);
    equal(stableJson([...observed.media].sort()),
      stableJson(documentLoad.expectedMediaPathSha256s),
      `${label} document negotiated media closure`);
    if (documentLoad.expectedMediaPathSha256s.some((digest) => (
      inventoryByPath.get(digest)?.extension !== "woff2"
      || !declaredMediaPaths.includes(digest)
    ))) fail(`${label} negotiated media is not an exact declared WOFF2 pair.`);
  }
  const observedCssPaths = new Set(generation.staticRequestLedger
    .filter(({ class: className }) => className === "next-static-css")
    .map(({ pathSha256 }) => pathSha256));
  const extensionCounts = Object.create(null);
  for (const reference of generationGraph.cssMediaReferenceLedger) {
    const source = inventoryByPath.get(reference.sourcePathSha256);
    const target = inventoryByPath.get(reference.targetPathSha256);
    if (!observedCssPaths.has(reference.sourcePathSha256)
      || source?.extension !== "css" || !target
      || !declaredMediaPaths.includes(reference.targetPathSha256)
      || !new Set(["eot", "ico", "png", "svg", "ttf", "woff", "woff2"])
        .has(target.extension)) {
      fail(`${label} CSS media reference escaped its observed inventory closure.`);
    }
    extensionCounts[target.extension] = (extensionCounts[target.extension] ?? 0) + 1;
  }
  equal(stableJson(Object.fromEntries(Object.entries(extensionCounts).sort())),
    stableJson({ eot: 2, svg: 1, ttf: 1, woff: 1, woff2: 3 }),
    `${label} exact CSS fallback extension closure`);
}

function staticClassForExtension(extension) {
  if (["eot", "ttf", "woff", "woff2"].includes(extension)) return "next-static-font";
  if (["ico", "png", "svg"].includes(extension)) return "next-static-image";
  if (extension === "css") return "next-static-css";
  if (extension === "js") return "next-static-js";
  fail("Static inventory extension is invalid.");
}

function staticContentTypesForExtension(extension) {
  const values = {
    css: ["text/css"],
    eot: ["application/vnd.ms-fontobject"],
    ico: ["image/vnd.microsoft.icon", "image/x-icon"],
    js: ["application/javascript", "text/javascript"],
    png: ["image/png"],
    svg: ["image/svg+xml"],
    ttf: ["font/ttf"],
    woff: ["font/woff"],
    woff2: ["font/woff2"],
  };
  return values[extension] ?? [];
}

function assertPhases(value, label) {
  const phases = record(value, `${label} phases`);
  exactKeys(phases, ["cleared", "gap", "recreated", "stable"], `${label} phases`);
  const gap = assertVisiblePhase(phases.gap, "gap", label);
  const stable = assertVisiblePhase(phases.stable, "stable", label);
  const recreated = assertVisiblePhase(phases.recreated, "recreated", label);
  const cleared = assertClearedPhase(phases.cleared, label);

  equal(gap.replacementRequestHeld, true, `${label} gap replacement held`);
  equal(gap.replacementRequestReleased, false, `${label} gap replacement released`);
  equal(gap.pendingWaitingForFrame, true, `${label} gap pending phase`);
  equal(gap.pendingAbsent, false, `${label} gap pending absent`);
  equal(gap.conversationCookieCount, 1, `${label} gap conversation cookie`);
  equal(gap.userCookieCount, 0, `${label} gap user cookie`);
  equal(gap.userCookieByteLength, 0, `${label} gap user cookie bytes`);
  equal(gap.totalCookieCount, 3, `${label} gap total cookies`);
  equal(gap.localStorageKeyCount, 1, `${label} gap local storage`);
  equal(gap.sessionStorageKeyCount, 1, `${label} gap session storage`);
  equal(gap.storedIdentityPresent, false, `${label} gap stored identity`);
  equal(gap.storedOwnershipPresent, true, `${label} gap stored ownership`);
  equal(gap.conversationEqualsInMemoryOwnership, true, `${label} gap ownership relation`);
  equal(gap.ownershipFingerprintMatchesConversation, true, `${label} gap fingerprint relation`);
  equal(gap.sdkIdentifierPresent, false, `${label} gap SDK identifier`);
  equal(gap.conversationEqualsSdkIdentifier, false, `${label} gap SDK relation`);
  equal(gap.conversationSameAsPriorPhase, false, `${label} gap prior conversation`);
  equal(gap.userCookieSameAsPriorSettledPhase, false, `${label} gap prior user cookie`);
  equal(gap.newSetUserObserved, true, `${label} gap setUser causality`);
  equal(gap.finalCabinetRoute, true, `${label} gap route`);
  equal(gap.contactProbeCount, 1, `${label} gap contact-probe count`);

  equal(stable.replacementRequestHeld, false, `${label} stable replacement held`);
  equal(stable.replacementRequestReleased, true, `${label} stable replacement released`);
  equal(stable.pendingWaitingForFrame, false, `${label} stable pending phase`);
  equal(stable.pendingAbsent, true, `${label} stable pending absent`);
  assertSettledVisiblePhase(stable, label, "stable");
  equal(stable.newSetUserObserved, true, `${label} stable setUser causality`);
  equal(stable.finalCabinetRoute, true, `${label} stable route`);
  equal(stable.conversationSameAsPriorPhase, true, `${label} stable conversation relation`);
  equal(stable.userCookieSameAsPriorSettledPhase, false, `${label} stable user relation`);
  equal(stable.setUserCount, gap.setUserCount + 1, `${label} stable setUser delta`);
  equal(stable.frameLoadedCount, gap.frameLoadedCount + 1, `${label} stable frame delta`);
  equal(
    stable.identityConfirmedCount,
    gap.identityConfirmedCount + 1,
    `${label} stable identity-confirmed delta`,
  );
  equal(stable.contactProbeCount, 1, `${label} stable contact-probe count`);

  equal(cleared.exactApplicationOrigin, true, `${label} clear origin`);
  equal(
    cleared.beforeCookieCount,
    stable.totalCookieCount + 1,
    `${label} clear complete cookie jar before clear`,
  );
  equal(cleared.beforeLocalStorageKeyCount, stable.localStorageKeyCount, `${label} clear local before`);
  equal(cleared.beforeSessionStorageKeyCount, stable.sessionStorageKeyCount, `${label} clear session before`);
  equal(cleared.afterCookieCount, 0, `${label} clear afterCookieCount`);
  equal(cleared.afterLocalStorageKeyCount, 0, `${label} clear afterLocalStorageKeyCount`);
  equal(cleared.afterSessionStorageKeyCount, 1, `${label} preserved fixture session storage`);
  equal(
    cleared.afterSessionStorageKeyCount,
    cleared.beforeSessionStorageKeyCount,
    `${label} fixture session-storage count relation`,
  );
  equal(cleared.preservedFixtureStorageByteExact, true, `${label} fixture storage relation`);
  positiveInteger(
    cleared.preservedFixtureStorageByteLength,
    `${label} fixture storage byte length`,
  );
  stringMatch(
    cleared.preservedFixtureStorageHmacSha256,
    sha256Pattern,
    `${label} fixture storage HMAC`,
  );
  equal(cleared.conversationCookieAbsent, true, `${label} cleared conversation`);
  equal(cleared.userCookieAbsent, true, `${label} cleared user cookie`);

  equal(recreated.replacementRequestHeld, false, `${label} recreated replacement held`);
  equal(recreated.replacementRequestReleased, true, `${label} recreated replacement released`);
  equal(recreated.pendingWaitingForFrame, false, `${label} recreated pending phase`);
  equal(recreated.pendingAbsent, true, `${label} recreated pending absent`);
  assertSettledVisiblePhase(recreated, label, "recreated");
  equal(recreated.conversationSameAsPriorPhase, true, `${label} recreated conversation relation`);
  equal(recreated.userCookieSameAsPriorSettledPhase, true, `${label} recreated user relation`);
  equal(recreated.newSetUserObserved, true, `${label} recreated setUser causality`);
  equal(recreated.finalCabinetRoute, true, `${label} recreated route`);
  assertRecreationCausality(recreated.recreationCausality, recreated, label);
  equal(recreated.contactProbeCount, 2, `${label} recreated contact-probe count`);

  equal(stable.hashes.conversationHmacSha256, gap.hashes.conversationHmacSha256, `${label} stable conversation HMAC`);
  equal(recreated.hashes.conversationHmacSha256, stable.hashes.conversationHmacSha256, `${label} recreated conversation HMAC`);
  equal(recreated.hashes.userCookieHmacSha256, stable.hashes.userCookieHmacSha256, `${label} recreated user-cookie HMAC`);
  return { gap, stable, cleared, recreated };
}

function assertVisiblePhase(value, phase, label) {
  const observation = record(value, `${label} ${phase} phase`);
  exactKeys(observation, [
    "authorized",
    "boundaryCallCount",
    "contactProbeCount",
    "cookieDescriptorByteLength",
    "cookieDescriptorCount",
    "cookieValueByteLength",
    "conversationCookieByteLength",
    "conversationCookieCount",
    "conversationEqualsInMemoryOwnership",
    "conversationEqualsSdkIdentifier",
    "conversationSameAsPriorPhase",
    "evidenceCounts",
    "evidenceRanges",
    "finalCabinetRoute",
    "frameLoadedCount",
    "hashes",
    "identityConfirmedCount",
    "localStorageKeyCount",
    "newSetUserObserved",
    "ownershipFingerprintMatchesConversation",
    "pendingAbsent",
    "pendingWaitingForFrame",
    "rejectedContactProbeCount",
    "replacementRequestHeld",
    "replacementRequestReleased",
    "recreationCausality",
    "screenshot",
    "sdkIdentifierPresent",
    "sessionStorageKeyCount",
    "serverActionCount",
    "setUserCount",
    "storedIdentityPresent",
    "storedOwnershipPresent",
    "totalCookieCount",
    "userCookieByteLength",
    "userCookieCount",
    "userCookieSameAsPriorSettledPhase",
  ], `${label} ${phase} phase`);
  for (const name of [
    "authorized",
    "conversationEqualsInMemoryOwnership",
    "conversationEqualsSdkIdentifier",
    "conversationSameAsPriorPhase",
    "finalCabinetRoute",
    "newSetUserObserved",
    "ownershipFingerprintMatchesConversation",
    "pendingAbsent",
    "pendingWaitingForFrame",
    "replacementRequestHeld",
    "replacementRequestReleased",
    "sdkIdentifierPresent",
    "storedIdentityPresent",
    "storedOwnershipPresent",
    "userCookieSameAsPriorSettledPhase",
  ]) boolean(observation[name], `${label} ${phase} ${name}`);
  for (const name of [
    "boundaryCallCount",
    "contactProbeCount",
    "cookieDescriptorByteLength",
    "cookieDescriptorCount",
    "cookieValueByteLength",
    "conversationCookieByteLength",
    "conversationCookieCount",
    "frameLoadedCount",
    "identityConfirmedCount",
    "localStorageKeyCount",
    "rejectedContactProbeCount",
    "sessionStorageKeyCount",
    "serverActionCount",
    "setUserCount",
    "totalCookieCount",
    "userCookieByteLength",
    "userCookieCount",
  ]) nonNegativeInteger(observation[name], `${label} ${phase} ${name}`);
  const visibleCountLimits = {
    boundaryCallCount: 64,
    contactProbeCount: 5_000,
    cookieDescriptorByteLength: 1_048_576,
    cookieDescriptorCount: 32,
    cookieValueByteLength: 131_072,
    conversationCookieByteLength: 4_096,
    conversationCookieCount: 1,
    frameLoadedCount: 64,
    identityConfirmedCount: 64,
    localStorageKeyCount: 128,
    rejectedContactProbeCount: 0,
    serverActionCount: 200,
    sessionStorageKeyCount: 128,
    setUserCount: 64,
    totalCookieCount: 32,
    userCookieByteLength: 4_096,
    userCookieCount: 1,
  };
  for (const [name, maximum] of Object.entries(visibleCountLimits)) {
    if (!integerInRange(observation[name], 0, maximum)) {
      fail(`${label} ${phase} ${name} is outside its producer bound.`);
    }
  }
  if (!integerInRange(observation.cookieDescriptorCount, 1, 32)) {
    fail(`${label} ${phase} cookie descriptor count is outside its exact bound.`);
  }
  equal(observation.authorized, true, `${label} ${phase} authorized`);
  equal(observation.rejectedContactProbeCount, 0, `${label} ${phase} rejected probes`);
  positiveInteger(observation.conversationCookieByteLength, `${label} ${phase} conversation bytes`);
  positiveInteger(observation.cookieDescriptorByteLength, `${label} ${phase} cookie descriptor bytes`);
  positiveInteger(observation.cookieDescriptorCount, `${label} ${phase} cookie descriptor count`);
  positiveInteger(observation.cookieValueByteLength, `${label} ${phase} cookie value bytes`);
  if (observation.conversationCookieByteLength < 21 || observation.conversationCookieByteLength > 41) {
    fail(`${label} ${phase} conversation bytes are outside the synthetic CUID contract.`);
  }
  positiveInteger(observation.setUserCount, `${label} ${phase} setUser count`);
  positiveInteger(observation.frameLoadedCount, `${label} ${phase} frame count`);
  positiveInteger(observation.boundaryCallCount, `${label} ${phase} boundary count`);
  positiveInteger(observation.contactProbeCount, `${label} ${phase} contact probe count`);
  const hashes = assertPhaseHashes(observation.hashes, phase, label);
  const evidenceCounts = assertEvidenceCounts(observation.evidenceCounts, phase, label);
  const evidenceRanges = assertEvidenceRanges(observation.evidenceRanges, phase, label);
  equal(
    evidenceCounts.boundaryCalls,
    observation.boundaryCallCount,
    `${label} ${phase} boundary evidence completeness`,
  );
  equal(
    evidenceCounts.serverActions,
    observation.serverActionCount,
    `${label} ${phase} Server Action evidence completeness`,
  );
  if (phase === "recreated") {
    record(observation.recreationCausality, `${label} recreated causality`);
  } else {
    equal(observation.recreationCausality, null, `${label} ${phase} recreation causality`);
  }
  const screenshot = assertScreenshot(observation.screenshot, phase, label);
  return { ...observation, evidenceCounts, evidenceRanges, hashes, screenshot };
}

function assertRecreationCausality(value, recreated, label) {
  const causality = record(value, `${label} recreated causality`);
  exactKeys(causality, [
    "cabinetConversationCookieObservedAfterSetUser",
    "cabinetIdentityConfirmedConversationCookiePresent",
    "cabinetIdentityConfirmedCount",
    "cabinetIdentityConfirmedObservedAfterSetUser",
    "cabinetIdentityConfirmedUserCookiePresent",
    "cabinetSetUserCount",
    "cabinetUserCookieObservedAfterSetUser",
    "eventOrdinals",
    "finalCookiePairPresent",
    "firstCabinetSetUserBeforeConversationCookiePresent",
    "firstCabinetSetUserBeforeUserCookieAbsent",
    "negativeLoginConversationCookieAbsent",
    "negativeLoginSetUserCount",
    "negativeLoginUserCookieAbsent",
    "postClearCabinetNavigationCount",
    "postClearLoginCount",
    "postClearSetUserCount",
  ], `${label} recreated causality`);
  equal(causality.postClearLoginCount, 1, `${label} post-clear login count`);
  equal(
    causality.postClearCabinetNavigationCount,
    1,
    `${label} post-clear cabinet navigation count`,
  );
  positiveInteger(causality.postClearSetUserCount, `${label} post-clear setUser count`);
  equal(
    causality.postClearSetUserCount,
    recreated.setUserCount,
    `${label} post-clear setUser completeness`,
  );
  equal(causality.cabinetSetUserCount, 1, `${label} cabinet setUser count`);
  equal(causality.cabinetSetUserCount, causality.postClearSetUserCount, `${label} cabinet setUser completeness`);
  equal(causality.cabinetIdentityConfirmedCount, 1, `${label} cabinet identity-confirmed count`);
  equal(causality.negativeLoginSetUserCount, 0, `${label} negative login setUser count`);
  for (const name of [
    "cabinetConversationCookieObservedAfterSetUser",
    "cabinetIdentityConfirmedConversationCookiePresent",
    "cabinetIdentityConfirmedObservedAfterSetUser",
    "cabinetIdentityConfirmedUserCookiePresent",
    "cabinetUserCookieObservedAfterSetUser",
    "finalCookiePairPresent",
    "firstCabinetSetUserBeforeUserCookieAbsent",
    "negativeLoginConversationCookieAbsent",
    "negativeLoginUserCookieAbsent",
  ]) equal(causality[name], true, `${label} recreated ${name}`);
  boolean(
    causality.firstCabinetSetUserBeforeConversationCookiePresent,
    `${label} first cabinet conversation-cookie relation`,
  );
  const ordinals = record(causality.eventOrdinals, `${label} recreated event ordinals`);
  exactKeys(ordinals, [
    "cabinetCompleted",
    "cabinetCookiePairObserved",
    "cabinetDocumentReached",
    "cabinetIdentityConfirmedObserved",
    "cabinetSetUserObserved",
    "clearVerified",
    "finalCookiePairObserved",
    "loginDocumentReached",
    "negativeLoginCheckpoint",
  ], `${label} recreated event ordinals`);
  const ordered = [
    ordinals.clearVerified,
    ordinals.loginDocumentReached,
    ordinals.negativeLoginCheckpoint,
    ordinals.cabinetDocumentReached,
    ordinals.cabinetSetUserObserved,
    ordinals.cabinetIdentityConfirmedObserved,
    ordinals.cabinetCookiePairObserved,
    ordinals.cabinetCompleted,
    ordinals.finalCookiePairObserved,
  ];
  for (const [index, ordinal] of ordered.entries()) {
    positiveInteger(ordinal, `${label} recreated ordinal ${index + 1}`);
    if (index > 0 && ordinal <= ordered[index - 1]) {
      fail(`${label} recreated events are not in strict post-clear causal order.`);
    }
  }
  return { ...causality, eventOrdinals: { ...ordinals } };
}

function assertEvidenceCounts(value, phase, label) {
  const counts = record(value, `${label} ${phase} evidence counts`);
  exactKeys(counts, CHATWOOT_PHASE_EVIDENCE_CATEGORIES, `${label} ${phase} evidence counts`);
  for (const category of CHATWOOT_PHASE_EVIDENCE_CATEGORIES) {
    if (!integerInRange(
      counts[category],
      1,
      CHATWOOT_PHASE_EVIDENCE_CATEGORY_LIMITS[category],
    )) {
      fail(`${label} ${phase} ${category} evidence count is outside its sealer bound.`);
    }
  }
  return { ...counts };
}

function assertEvidenceRanges(value, phase, label) {
  const ranges = record(value, `${label} ${phase} evidence ranges`);
  exactKeys(ranges, CHATWOOT_PHASE_EVIDENCE_CATEGORIES, `${label} ${phase} evidence ranges`);
  return Object.fromEntries(CHATWOOT_PHASE_EVIDENCE_CATEGORIES.map((category) => {
    const range = record(ranges[category], `${label} ${phase} ${category} evidence range`);
    exactKeys(
      range,
      ["firstHmacSha256", "lastHmacSha256"],
      `${label} ${phase} ${category} evidence range`,
    );
    stringMatch(range.firstHmacSha256, sha256Pattern, `${label} ${phase} ${category} first`);
    stringMatch(range.lastHmacSha256, sha256Pattern, `${label} ${phase} ${category} last`);
    return [category, { ...range }];
  }));
}

function assertSettledVisiblePhase(phase, label, name) {
  equal(phase.authorized, true, `${label} ${name} authorized`);
  equal(phase.conversationCookieCount, 1, `${label} ${name} conversation cookie`);
  equal(phase.userCookieCount, 1, `${label} ${name} user cookie`);
  positiveInteger(phase.userCookieByteLength, `${label} ${name} user cookie bytes`);
  equal(phase.totalCookieCount, 4, `${label} ${name} total cookies`);
  equal(phase.localStorageKeyCount, 1, `${label} ${name} local storage`);
  equal(phase.sessionStorageKeyCount, 1, `${label} ${name} session storage`);
  equal(phase.storedIdentityPresent, true, `${label} ${name} identity storage`);
  equal(phase.storedOwnershipPresent, false, `${label} ${name} ownership storage`);
  equal(phase.conversationEqualsInMemoryOwnership, true, `${label} ${name} ownership relation`);
  equal(phase.ownershipFingerprintMatchesConversation, false, `${label} ${name} fingerprint relation`);
  equal(phase.sdkIdentifierPresent, true, `${label} ${name} SDK identifier`);
  equal(phase.conversationEqualsSdkIdentifier, true, `${label} ${name} SDK relation`);
}

function assertClearedPhase(value, label) {
  const cleared = record(value, `${label} cleared phase`);
  exactKeys(cleared, [
    "afterCookieCount",
    "afterLocalStorageKeyCount",
    "afterSessionStorageKeyCount",
    "beforeCookieCount",
    "beforeLocalStorageKeyCount",
    "beforeSessionStorageKeyCount",
    "conversationCookieAbsent",
    "exactApplicationOrigin",
    "preservedFixtureStorageByteExact",
    "preservedFixtureStorageByteLength",
    "preservedFixtureStorageHmacSha256",
    "userCookieAbsent",
  ], `${label} cleared phase`);
  for (const name of [
    "conversationCookieAbsent",
    "exactApplicationOrigin",
    "preservedFixtureStorageByteExact",
    "userCookieAbsent",
  ]) {
    boolean(cleared[name], `${label} cleared ${name}`);
  }
  for (const name of [
    "afterCookieCount",
    "afterLocalStorageKeyCount",
    "afterSessionStorageKeyCount",
    "beforeCookieCount",
    "beforeLocalStorageKeyCount",
    "beforeSessionStorageKeyCount",
  ]) nonNegativeInteger(cleared[name], `${label} cleared ${name}`);
  if (!integerInRange(
    cleared.preservedFixtureStorageByteLength,
    1,
    maximumFixtureStorageBytes,
  )) fail(`${label} cleared fixture bytes are outside the sealer bound.`);
  stringMatch(
    cleared.preservedFixtureStorageHmacSha256,
    sha256Pattern,
    `${label} cleared fixture HMAC`,
  );
  return { ...cleared };
}

function assertPhaseHashes(value, phase, label) {
  const hashes = record(value, `${label} ${phase} hashes`);
  exactKeys(hashes, [
    "accessibilityHmacSha256",
    "boundaryCallsHmacSha256",
    "computedStylesHmacSha256",
    "conversationHmacSha256",
    "cookieDescriptorHmacSha256",
    "cookieJarHmacSha256",
    "domHmacSha256",
    "interactiveHmacSha256",
    "providerEffectsHmacSha256",
    "providerLedgerHmacSha256",
    "requestSequenceHmacSha256",
    "serverActionsHmacSha256",
    "storageHmacSha256",
    "userCookieHmacSha256",
  ], `${label} ${phase} hashes`);
  for (const name of [
    "accessibilityHmacSha256",
    "boundaryCallsHmacSha256",
    "computedStylesHmacSha256",
    "conversationHmacSha256",
    "cookieDescriptorHmacSha256",
    "cookieJarHmacSha256",
    "domHmacSha256",
    "interactiveHmacSha256",
    "providerEffectsHmacSha256",
    "providerLedgerHmacSha256",
    "requestSequenceHmacSha256",
    "serverActionsHmacSha256",
    "storageHmacSha256",
  ]) stringMatch(hashes[name], sha256Pattern, `${label} ${phase} ${name}`);
  if (phase === "gap") {
    equal(hashes.userCookieHmacSha256, null, `${label} gap user cookie HMAC`);
  } else {
    stringMatch(hashes.userCookieHmacSha256, sha256Pattern, `${label} ${phase} user cookie HMAC`);
  }
  return { ...hashes };
}

function assertScreenshot(value, phase, label) {
  const screenshot = record(value, `${label} ${phase} screenshot`);
  exactKeys(screenshot, ["byteLength", "sha256"], `${label} ${phase} screenshot`);
  if (!integerInRange(screenshot.byteLength, 1, maximumScreenshotBytes)) {
    fail(`${label} ${phase} screenshot bytes are outside the writer bound.`);
  }
  stringMatch(screenshot.sha256, sha256Pattern, `${label} ${phase} screenshot sha256`);
  return { ...screenshot };
}

function assertConnectProxy(value, label) {
  const proxy = record(value, `${label} CONNECT proxy evidence`);
  exactKeys(proxy, [
    "authorityLedgerCount",
    "authorityLedgerSha256",
    "bindingSha256",
    "counters",
    "listenSha256",
    "targetSha256",
  ], `${label} CONNECT proxy evidence`);
  equal(proxy.authorityLedgerCount, 4, `${label} CONNECT authority count`);
  for (const name of [
    "authorityLedgerSha256",
    "bindingSha256",
    "listenSha256",
    "targetSha256",
  ]) stringMatch(proxy[name], sha256Pattern, `${label} CONNECT ${name}`);
  equal(
    proxy.authorityLedgerSha256,
    connectAuthorityLedgerSha256,
    `${label} CONNECT authority contract`,
  );
  const counters = record(proxy.counters, `${label} CONNECT proxy counters`);
  exactKeys(counters, [
    "accepted",
    "rejected",
    "upstreamAttempts",
    "upstreamConnected",
    "upstreamFailures",
  ], `${label} CONNECT proxy counters`);
  for (const [name, entry] of Object.entries(counters)) {
    nonNegativeInteger(entry, `${label} CONNECT ${name}`);
  }
  equal(counters.rejected, 0, `${label} CONNECT rejected`);
  equal(counters.upstreamFailures, 0, `${label} CONNECT failures`);
  equal(counters.upstreamAttempts, counters.upstreamConnected, `${label} CONNECT attempts`);
  equal(counters.accepted, counters.upstreamConnected, `${label} CONNECT accepted`);
  equal(counters.accepted, 4, `${label} CONNECT exact accepted cardinality`);
  return { ...proxy, counters: { ...counters } };
}

function assertCleanup(value, projectSha256, label) {
  const cleanup = record(value, `${label} cleanup`);
  exactKeys(
    cleanup,
    ["generatedEnvironmentDirectorySha256", "projectSha256", "role", "status"],
    `${label} cleanup`,
  );
  equal(cleanup.status, "verifier-owned-stack-cleaned", `${label} cleanup status`);
  equal(cleanup.role, label, `${label} cleanup role`);
  equal(cleanup.projectSha256, projectSha256, `${label} cleanup project`);
  stringMatch(
    cleanup.generatedEnvironmentDirectorySha256,
    sha256Pattern,
    `${label} cleanup environment`,
  );
  return { ...cleanup };
}

function assertPairCleanup(value, stacks, pairIndex) {
  const cleanup = record(value, `pair ${pairIndex} cleanup receipt`);
  exactKeys(cleanup, ["stacks", "status"], `pair ${pairIndex} cleanup receipt`);
  equal(
    cleanup.status,
    "verifier-owned-stack-pair-cleaned",
    `pair ${pairIndex} cleanup status`,
  );
  if (!isDenseArray(cleanup.stacks) || cleanup.stacks.length !== roles.length) {
    fail(`Pair ${pairIndex} cleanup stack receipts are incomplete.`);
  }
  const receipts = cleanup.stacks.map((entry, index) => {
    const role = roles[index];
    const receipt = assertCleanup(entry, stacks[role].runtimeBinding.projectSha256, role);
    equal(
      stableJson(receipt),
      stableJson(stacks[role].cleanup),
      `pair ${pairIndex} ${role} duplicated cleanup receipt`,
    );
    return receipt;
  });
  return { status: cleanup.status, stacks: receipts };
}

function assertGlobalStackContract(stacks) {
  const baseline = stacks.filter((stack) => stack.role === "baseline");
  const candidate = stacks.filter((stack) => stack.role === "candidate");
  equal(baseline.length, CHATWOOT_PHASE_PROOF_PAIR_COUNT, "baseline stack count");
  equal(candidate.length, CHATWOOT_PHASE_PROOF_PAIR_COUNT, "candidate stack count");
  requireUnique(stacks.map((stack) => stack.runScopeSha256), "run scopes");
  requireUnique(stacks.map((stack) => stack.browser.processScopeSha256), "Chromium processes");
  requireUnique(stacks.map((stack) => stack.browser.contextScopeSha256), "Chromium contexts");
  requireUnique(stacks.map((stack) => stack.browser.launchScopeSha256), "Chromium launch scopes");
  requireSame(stacks.map((stack) => stack.proofHmacScopeSha256), "proof HMAC scope");
  requireUnique(stacks.map((stack) => stack.runtimeBinding.projectSha256), "compose projects");
  requireUnique(stacks.map((stack) => stack.runtimeBinding.networkSha256), "project networks");
  requireUnique(stacks.map((stack) => stack.runtimeBinding.publicationsSha256), "publications");
  requireUnique(stacks.map((stack) => stack.runtimeBinding.serviceIdentitySha256), "service identities");
  requireUnique(
    stacks.map((stack) => stack.runtimeBinding.generatedEnvironmentDirectorySha256),
    "generated environment directories",
  );
  requireUnique(
    stacks.map((stack) => stack.runtimeBinding.syntheticRoleEnvironmentContractSha256),
    "synthetic role environment contracts",
  );
  requireUnique(
    stacks.map((stack) => stack.runtimeBinding.composeRuntimeContractSha256),
    "Compose runtime contracts",
  );
  requireUnique(
    stacks.map((stack) => stack.runtimeBinding.renderedComposeSha256),
    "rendered Compose contracts",
  );
  requireUnique(
    stacks.map((stack) => stack.inputReceipt.imageProbeOwnershipContractSha256),
    "image probe ownership contracts",
  );
  requireUnique(
    stacks.map((stack) => stack.runtimeAttestation.oneShotLifecycleContractSha256),
    "one-shot lifecycle contracts",
  );
  requireUnique(
    stacks.map((stack) => stack.runtimeAttestation.fixtureExecutionContractSha256),
    "fixture execution contracts",
  );
  requireSame(
    stacks.map((stack) => selectionModeOf(stack.applicationImage, "global application image")),
    "image selection mode",
  );
  const imageSelectionMode = selectionModeOf(
    stacks[0].applicationImage,
    "global application image",
  );
  requireSame(baseline.map((stack) => stack.applicationImage.assetImageDigest), "baseline image digest");
  requireSame(candidate.map((stack) => stack.applicationImage.assetImageDigest), "candidate image digest");
  if (baseline[0].applicationImage.assetImageDigest
    === candidate[0].applicationImage.assetImageDigest) {
    fail("Baseline and candidate application images must be distinct.");
  }
  requireSame(baseline.map((stack) => stack.applicationImage.configDigest), "baseline config digest");
  requireSame(candidate.map((stack) => stack.applicationImage.configDigest), "candidate config digest");
  if (baseline[0].applicationImage.configDigest === candidate[0].applicationImage.configDigest) {
    fail("Baseline and candidate application config digests must be distinct.");
  }
  requireSame(baseline.map((stack) => stack.applicationImage.revision), "baseline revision");
  requireSame(candidate.map((stack) => stack.applicationImage.revision), "candidate revision");
  if (baseline[0].applicationImage.revision === candidate[0].applicationImage.revision) {
    fail("Baseline and candidate source revisions must be distinct.");
  }
  requireSame(baseline.map((stack) => stack.migrationImage.assetImageDigest), "baseline migration digest");
  requireSame(candidate.map((stack) => stack.migrationImage.assetImageDigest), "candidate migration digest");
  if (baseline[0].migrationImage.assetImageDigest
    === candidate[0].migrationImage.assetImageDigest) {
    fail("Baseline and candidate migration images must be distinct.");
  }
  if (imageSelectionMode === "classic-config") {
    requireSame(baseline.map((stack) => stack.migrationImage.configDigest), "baseline migration config");
    requireSame(candidate.map((stack) => stack.migrationImage.configDigest), "candidate migration config");
    if (baseline[0].migrationImage.configDigest === candidate[0].migrationImage.configDigest) {
      fail("Baseline and candidate migration config digests must be distinct.");
    }
  } else {
    requireSame(
      baseline.map((stack) => stack.migrationImage.manifestDigest),
      "baseline migration manifest",
    );
    requireSame(
      candidate.map((stack) => stack.migrationImage.manifestDigest),
      "candidate migration manifest",
    );
    if (baseline[0].migrationImage.manifestDigest
      === candidate[0].migrationImage.manifestDigest) {
      fail("Baseline and candidate migration manifest digests must be distinct.");
    }
  }
  requireSame(baseline.map((stack) => stack.migrationImage.revision), "baseline migration revision");
  requireSame(candidate.map((stack) => stack.migrationImage.revision), "candidate migration revision");
  if (baseline[0].migrationImage.revision === candidate[0].migrationImage.revision) {
    fail("Baseline and candidate migration source revisions must be distinct.");
  }
  for (const selector of [
    (stack) => stableJson(stack.fixtureContract),
    (stack) => stableJson(stack.publicBuildContract),
    (stack) => stack.inputReceipt.composeSourceSha256,
    (stack) => stack.runtimeBinding.fixtureMountContractSha256,
    (stack) => stack.runtimeBinding.syntheticRoleEnvironmentPolicySha256,
    (stack) => stack.reset.scenarioSha256,
    (stack) => stack.reset.seedSha256,
    (stack) => stack.reset.database.schemaSha256,
    (stack) => stack.browser.playwrightVersion,
    (stack) => stack.browser.chromiumVersion,
    (stack) => stack.browser.userAgentSha256,
    (stack) => stack.browser.launchPolicySha256,
    (stack) => stableJson(stack.browser.viewport),
    (stack) => stack.connectProxy.authorityLedgerCount,
    (stack) => stack.connectProxy.authorityLedgerSha256,
    (stack) => stableJson(stack.connectProxy.counters),
  ]) requireSame(stacks.map(selector), "shared six-stack contract");
  for (const stack of stacks) {
    equal(
      stack.browser.projectBindingSha256,
      stack.runtimeBinding.projectSha256,
      `${stack.role} pair ${stack.pairIndex} browser project binding`,
    );
    equal(
      stack.browser.connectProxyBindingSha256,
      stack.runtimeBinding.connectProxyBindingSha256,
      `${stack.role} pair ${stack.pairIndex} browser CONNECT binding`,
    );
    equal(
      stack.connectProxy.bindingSha256,
      stack.runtimeBinding.connectProxyBindingSha256,
      `${stack.role} pair ${stack.pairIndex} CONNECT evidence binding`,
    );
    equal(
      stack.browser.staticProvenance.assetAttestationSha256,
      stack.runtimeBinding.staticAssetAttestationSha256,
      `${stack.role} pair ${stack.pairIndex} browser asset attestation binding`,
    );
    equal(
      stack.browser.staticProvenance.assetInventorySha256,
      stack.runtimeBinding.staticAssetInventorySha256,
      `${stack.role} pair ${stack.pairIndex} browser asset inventory binding`,
    );
    equal(
      stack.browser.staticProvenance.assetInventoryProjectionSha256,
      stack.runtimeBinding.staticAssetInventoryProjectionSha256,
      `${stack.role} pair ${stack.pairIndex} browser asset inventory projection binding`,
    );
    equal(
      stack.browser.staticProvenance.assetRouteGraphSha256,
      stack.runtimeBinding.staticAssetRouteGraphSha256,
      `${stack.role} pair ${stack.pairIndex} browser asset route graph binding`,
    );
    equal(
      stack.cleanup.projectSha256,
      stack.runtimeBinding.projectSha256,
      `${stack.role} pair ${stack.pairIndex} cleanup binding`,
    );
    equal(
      stack.cleanup.generatedEnvironmentDirectorySha256,
      stack.runtimeBinding.generatedEnvironmentDirectorySha256,
      `${stack.role} pair ${stack.pairIndex} cleanup environment binding`,
    );
    equal(
      stack.reset.database.scopeSha256,
      stack.runtimeBinding.projectSha256,
      `${stack.role} pair ${stack.pairIndex} reset scope binding`,
    );
  }
  requireUnique(stacks.map((stack) => stack.connectProxy.listenSha256), "CONNECT listen bindings");
  requireUnique(stacks.map((stack) => stack.connectProxy.targetSha256), "CONNECT target bindings");
  for (const role of roles) {
    const roleStacks = stacks.filter((stack) => stack.role === role);
    for (const selector of [
      (stack) => stack.applicationImage.manifestDigest,
      (stack) => stack.applicationImage.referenceSha256,
      (stack) => stack.applicationImage.repoDigestContractSha256,
      (stack) => stack.applicationImage.runtimeImageDigest,
      (stack) => stack.migrationImage.bindingContractSha256,
      (stack) => stack.migrationImage.referenceSha256,
      (stack) => stack.migrationImage.runtimeImageDigest,
      (stack) => stack.runtimeBinding.applicationImageBindingContractSha256,
      (stack) => stack.runtimeBinding.applicationRepoDigestContractSha256,
      (stack) => stack.runtimeBinding.migrationImageBindingContractSha256,
      (stack) => stack.runtimeBinding.staticAssetAttestationSha256,
      (stack) => stack.runtimeBinding.staticAssetConfigDigest,
      (stack) => stack.runtimeBinding.staticAssetImageDigest,
      (stack) => stack.runtimeBinding.staticAssetInventorySha256,
      (stack) => stack.runtimeBinding.staticAssetInventoryProjectionSha256,
      (stack) => stack.runtimeBinding.staticAssetManifestDigest,
      (stack) => stack.runtimeBinding.staticAssetRouteGraphSha256,
      (stack) => stack.runtimeBinding.staticAssetSourceFileSha256,
      (stack) => stableJson(stack.browser.staticProvenance),
    ]) requireSame(roleStacks.map(selector), `${role} static asset contract`);
  }
  if (baseline[0].runtimeBinding.staticAssetAttestationSha256
    === candidate[0].runtimeBinding.staticAssetAttestationSha256) {
    fail("Baseline and candidate static asset attestations must be distinct.");
  }
  requireSame(
    stacks.map((stack) => stableJson(crossImageBrowserSemanticProjection(stack.browser))),
    "cross-image browser semantic request contract",
  );
}

function crossImageBrowserSemanticProjection(browser) {
  const projectGeneration = (generation) => {
    return {
      documentGenerationCount: generation.documentGenerationCount,
      requestContractSha256: generation.requestContractSha256,
      requestCount: generation.requestCount,
      requestOrderContractSha256: generation.requestOrderContractSha256,
      requestOrderLedger: generation.requestOrderLedger,
      semanticRequestCount: generation.semanticRequestLedger.length,
      semanticRequestLedger: generation.semanticRequestLedger,
      staticRequestCount: generation.staticRequestCount,
      staticRequestLedger: generation.staticRequestLedger.map((entry) => ({
        class: entry.class,
        contentType: entry.contentType,
        documentKey: entry.documentKey,
      })),
    };
  };
  return {
    initial: projectGeneration(browser.staticProvenance.initial),
    recreated: projectGeneration(browser.staticProvenance.recreated),
  };
}

function assertGlobalExecutionContract(pairs) {
  requireUnique(
    pairs.map(({ execution }) => execution.launch.barrierSha256),
    "pair launch barriers",
  );
  const containerIds = pairs.flatMap(({ execution }) => (
    execution.launch.coexistence.observations.flatMap(({ services }) => (
      services.map(({ containerIdSha256 }) => containerIdSha256)
    ))
  ));
  requireUnique(containerIds, "six-stack container identities");
  const lifecycle = pairs.map(({ execution }) => Date.parse(
    execution.launch.lifecycleNotBefore,
  ));
  for (let index = 1; index < lifecycle.length; index += 1) {
    if (lifecycle[index] <= lifecycle[index - 1]) {
      fail("Pair launch lifecycle receipts are not sequential across bounded pairs.");
    }
  }
}

function phaseSemantics(phases) {
  const result = structuredClone(phases);
  for (const phase of CHATWOOT_PHASE_SCREENSHOT_NAMES) {
    delete result[phase].hashes.conversationHmacSha256;
    delete result[phase].hashes.cookieJarHmacSha256;
    delete result[phase].hashes.userCookieHmacSha256;
    delete result[phase].screenshot;
  }
  return result;
}

function stackSemantics(stack) {
  return {
    historySemantics: stack.browser.historySemantics,
    phases: phaseSemantics(stack.phases),
  };
}

function selectExactScreenshotQuorum(pairs, role, phase) {
  const samples = pairs.map((pair) => pair.stacks[role].phases[phase].screenshot);
  const groups = new Map();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const key = `${sample.byteLength}:${sample.sha256}`;
    const indexes = groups.get(key) ?? [];
    indexes.push(index + 1);
    groups.set(key, indexes);
  }
  const exact = [...groups.entries()].filter(([, indexes]) => (
    indexes.length >= CHATWOOT_PHASE_SCREENSHOT_QUORUM
  ));
  if (exact.length !== 1) {
    fail(`${role} ${phase} PNGs have no single exact independent-process 2/3 quorum.`);
  }
  const [key, agreeingPairIndexes] = exact[0];
  const [byteLength, selectedSha256] = key.split(":");
  return {
    selectedSha256,
    selectedByteLength: Number(byteLength),
    agreeingPairIndexes,
    dissentingPairIndexes: [1, 2, 3].filter((index) => !agreeingPairIndexes.includes(index)),
    rawArtifactCount: samples.length,
  };
}

function assertStackInput(value, role, pairIndex) {
  const input = record(value, `${role} input ${pairIndex}`);
  exactKeys(input, [
    "assetAttestationPath",
    "contractPath",
    "controlUrl",
    "generatedEnvironmentPath",
    "imageDigest",
    "migrationImageDigest",
    "resolverIp",
  ], `${role} input`);
  if (
    typeof input.assetAttestationPath !== "string"
    || input.assetAttestationPath !== input.assetAttestationPath.trim()
    || !path.isAbsolute(input.assetAttestationPath)
    || normalizeFilesystemPath(path.normalize(input.assetAttestationPath))
      !== normalizeFilesystemPath(input.assetAttestationPath)
  ) fail(`${role} asset attestation path is invalid.`);
  if (
    typeof input.contractPath !== "string"
    || input.contractPath !== input.contractPath.trim()
    || !path.isAbsolute(input.contractPath)
    || normalizeFilesystemPath(path.normalize(input.contractPath))
      !== normalizeFilesystemPath(input.contractPath)
  ) fail(`${role} contract path is invalid.`);
  if (
    typeof input.generatedEnvironmentPath !== "string"
    || input.generatedEnvironmentPath !== input.generatedEnvironmentPath.trim()
    || !path.isAbsolute(input.generatedEnvironmentPath)
    || normalizeFilesystemPath(path.normalize(input.generatedEnvironmentPath))
      !== normalizeFilesystemPath(input.generatedEnvironmentPath)
  ) fail(`${role} generated environment path is invalid.`);
  equal(
    normalizeFilesystemPath(path.dirname(input.contractPath)),
    normalizeFilesystemPath(input.generatedEnvironmentPath),
    `${role} contract path input containment`,
  );
  stringMatch(input.controlUrl, /^http:\/\/127\.0\.0\.1:\d{4,5}\/$/, `${role} control URL`);
  stringMatch(
    input.resolverIp,
    /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
    `${role} resolver`,
  );
  stringMatch(input.imageDigest, imageDigestPattern, `${role} image digest`);
  stringMatch(input.migrationImageDigest, imageDigestPattern, `${role} migration image digest`);
  return { ...input };
}

async function readExactExternalPlanFile(
  target,
  repositoryRoot,
  maximumBytes,
  hooks = undefined,
) {
  if (typeof target !== "string" || !path.isAbsolute(target)
    || normalizeFilesystemPath(path.normalize(target)) !== normalizeFilesystemPath(target)
    || typeof repositoryRoot !== "string" || !path.isAbsolute(repositoryRoot)
    || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > 1024 * 1024) {
    fail("Chatwoot external plan read contract is invalid.");
  }
  const requested = path.resolve(target);
  const repository = path.resolve(repositoryRoot);
  if (isFilesystemDescendant(repository, requested)) {
    fail("Chatwoot launch plan must remain outside the repository.");
  }
  const beforeMetadata = await lstat(requested);
  if (!beforeMetadata.isFile() || beforeMetadata.isSymbolicLink()
    || beforeMetadata.size < 1 || beforeMetadata.size > maximumBytes) {
    fail("Chatwoot launch plan must be a bounded regular non-link file.");
  }
  const resolved = await realpath(requested);
  if (normalizeFilesystemPath(resolved) !== normalizeFilesystemPath(requested)
    || isFilesystemDescendant(repository, resolved)) {
    fail("Chatwoot launch plan realpath is not its exact external path.");
  }
  const before = planFileIdentity(beforeMetadata, resolved);
  const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW ?? 0);
  const handle = await open(requested, fsConstants.O_RDONLY | noFollow);
  let bytes;
  let handleBefore;
  let handleAfter;
  try {
    handleBefore = planFileIdentity(await handle.stat(), resolved);
    if (!samePlanFileIdentity(before, handleBefore)) {
      fail("Chatwoot launch plan path and FileHandle identities differ.");
    }
    if (hooks) await hooks.afterOpen();
    bytes = await handle.readFile();
    const repeated = await readFileHandleAtPosition(handle, bytes.byteLength);
    if (!bytes.equals(repeated)) {
      fail("Chatwoot launch plan content changed between exact FileHandle reads.");
    }
    handleAfter = planFileIdentity(await handle.stat(), resolved);
  } finally {
    await handle.close();
  }
  const afterMetadata = await lstat(requested);
  const afterResolved = await realpath(requested);
  const after = planFileIdentity(afterMetadata, afterResolved);
  if (!samePlanFileIdentity(before, handleAfter)
    || !samePlanFileIdentity(before, after)
    || bytes.byteLength !== before.size) {
    fail("Chatwoot launch plan changed during its exact FileHandle read.");
  }
  return Buffer.from(bytes);
}

async function readFileHandleAtPosition(handle, size) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await handle.read(bytes, offset, size - offset, offset);
    if (bytesRead < 1) fail("Chatwoot launch plan FileHandle ended before its exact size.");
    offset += bytesRead;
  }
  return bytes;
}

function planFileIdentity(metadata, resolved) {
  if (!metadata.isFile() || !Number.isFinite(metadata.ctimeMs)
    || !Number.isFinite(metadata.mtimeMs) || !Number.isFinite(metadata.size)) {
    fail("Chatwoot launch plan filesystem identity is invalid.");
  }
  return Object.freeze({
    ctimeMs: metadata.ctimeMs,
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mtimeMs: metadata.mtimeMs,
    realpath: path.resolve(resolved),
    size: metadata.size,
  });
}

function samePlanFileIdentity(left, right) {
  return left.ctimeMs === right.ctimeMs
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mtimeMs === right.mtimeMs
    && normalizeFilesystemPath(left.realpath) === normalizeFilesystemPath(right.realpath)
    && left.size === right.size;
}

function isFilesystemDescendant(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeFilesystemPath(value) {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function assertPublicationPort(publication, label) {
  const port = Number(publication.split(":").at(-1));
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535 || port === 443) {
    fail(`${label} publication port is invalid.`);
  }
}

function requireUnique(values, label) {
  if (new Set(values).size !== values.length) fail(`${label} must be pairwise distinct.`);
}

function requireSame(values, label) {
  if (values.length === 0 || values.some((value) => value !== values[0])) {
    fail(`${label} differs across the six exact stacks.`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} is invalid.`);
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(record(value, label)).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(`${label} has unexpected fields.`);
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match its exact contract.`);
}

function stringMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} is invalid.`);
}

function boolean(value, label) {
  if (typeof value !== "boolean") fail(`${label} must be boolean.`);
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) fail(`${label} must be a non-negative integer.`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer.`);
}

function integerInRange(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function fail(message) {
  throw new Error(message);
}
