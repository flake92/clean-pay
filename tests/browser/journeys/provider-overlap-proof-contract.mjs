import { createHash } from "node:crypto";
import path from "node:path";

import {
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import { validateProviderOverlapSemanticLedger } from "./provider-overlap-browser-contract.mjs";

export const PROVIDER_OVERLAP_PROOF_KIND = "clean-pay-dual-image-provider-overlap-proof";
export const PROVIDER_OVERLAP_PROOF_SCHEMA_VERSION = 1;
export const PROVIDER_OVERLAP_BROWSER_PROJECT = "provider-overlap-1440x900";
export const PROVIDER_OVERLAP_ACTION = "cabinet_read_overlap_once";
export const PROVIDER_OVERLAP_PROBE = "cabinet-offers-devices-overlap";

export function resolveProviderOverlapOutputPath(raw) {
  if (typeof raw !== "string" || raw !== raw.trim() || !path.isAbsolute(raw)) {
    fail("Provider overlap proof output must be an absolute path before normalization.");
  }
  return path.resolve(raw);
}

const fixtureSeed = "clean-pay-browser-journey-v1";
const emptyBodySha256 = sha256("");
const participantContracts = Object.freeze([
  Object.freeze({
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/devices",
    effect: "read_devices",
  }),
  Object.freeze({
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/offers",
    effect: "read_offers",
  }),
]);

export function assertJourneyStackContract(value, label) {
  if (label !== "baseline" && label !== "candidate") fail("Journey stack role is invalid.");
  const contract = record(value, `${label} journey contract`);
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
  ], `${label} journey contract`);
  equal(contract.schemaVersion, 1, `${label} journey contract schemaVersion`);
  equal(
    contract.kind,
    "self-contained-synthetic-browser-journey",
    `${label} journey contract kind`,
  );
  stringMatch(
    contract.project,
    new RegExp(`^clean-pay-browser-journey-provider-proof-${label}-[a-f0-9]{12}$`),
    `${label} compose project`,
  );
  stringMatch(contract.revision, /^[a-f0-9]{40}$/, `${label} revision`);

  const fixtureContract = record(contract.fixtureContract, `${label} fixture contract`);
  exactKeys(fixtureContract, ["domain", "sha256"], `${label} fixture contract`);
  equal(
    fixtureContract.domain,
    "clean-pay-browser-journey-fixture-v5",
    `${label} fixture contract domain`,
  );
  stringMatch(fixtureContract.sha256, /^[a-f0-9]{64}$/, `${label} fixture contract sha256`);

  const images = record(contract.images, `${label} images`);
  exactKeys(images, ["application", "migration"], `${label} images`);
  for (const role of ["application", "migration"]) {
    stringMatch(
      images[role],
      /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/,
      `${label} ${role} image reference`,
    );
  }

  const publicBuildContract = record(
    contract.publicBuildContract,
    `${label} public build contract`,
  );
  exactKeys(
    publicBuildContract,
    ["sha256", "version"],
    `${label} public build contract`,
  );
  equal(publicBuildContract.version, "1", `${label} public build contract version`);
  stringMatch(
    publicBuildContract.sha256,
    /^[a-f0-9]{64}$/,
    `${label} public build contract sha256`,
  );

  const publications = record(contract.publications, `${label} publications`);
  exactKeys(
    publications,
    ["app", "browserTls", "connectProxy", "providerControl"],
    `${label} publications`,
  );
  stringMatch(publications.app, /^127\.0\.0\.1:\d{4,5}$/, `${label} app publication`);
  stringMatch(
    publications.providerControl,
    /^127\.0\.0\.1:\d{4,5}$/,
    `${label} provider publication`,
  );
  stringMatch(
    publications.connectProxy,
    /^127\.0\.0\.1:\d{4,5}$/,
    `${label} CONNECT publication`,
  );
  stringMatch(
    publications.browserTls,
    /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4]):443$/,
    `${label} browser TLS publication`,
  );
  for (const [name, publication] of Object.entries(publications)) {
    if (name === "browserTls") continue;
    assertPublicationPort(publication, label);
  }

  equal(
    contract.secretSource,
    "deterministic synthetic fixture labels; no external env or credential file",
    `${label} secret source`,
  );
  const ownedStateReset = record(contract.ownedStateReset, `${label} owned reset`);
  exactKeys(
    ownedStateReset,
    ["postgres", "redis", "scope"],
    `${label} owned reset`,
  );
  equal(
    ownedStateReset.postgres,
    "transactional truncate of public application tables; migrations retained; schema has no sequences",
    `${label} postgres reset`,
  );
  equal(ownedStateReset.redis, "flush DB 0 on the project-local redis service", `${label} redis reset`);
  equal(
    ownedStateReset.scope,
    "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
    `${label} reset scope`,
  );
  return contract;
}

export function assertLoopbackControlUrl(raw, expectedPublication, label) {
  const url = exactUrl(raw, label);
  if (
    url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.username
    || url.password
    || url.search
    || url.hash
    || (url.pathname !== "/" && url.pathname !== "")
    || url.host !== expectedPublication
  ) {
    fail(`${label} must be the exact contract-bound loopback HTTP control endpoint.`);
  }
  assertPort(url.port, label);
  return url;
}

export function assertLoopbackResolver(raw, expectedPublication, label) {
  stringMatch(
    raw,
    /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
    label,
  );
  equal(`${raw}:443`, expectedPublication, `${label} contract binding`);
  return raw;
}

export function assertApplicationImageIdentity(value, contract, expected, label) {
  const identity = record(value, `${label} application image identity`);
  exactKeys(
    identity,
    [
      "assetImageDigest",
      "configDigest",
      "manifestDigest",
      "publicBuildContract",
      "reference",
      "repoDigestContractSha256",
      "revision",
      "role",
      "runtimeImageDigest",
    ],
    `${label} application image identity`,
  );
  const expectation = record(expected, `${label} expected application image identity`);
  exactKeys(
    expectation,
    ["assetImageDigest", "configDigest", "manifestDigest"],
    `${label} expected application image identity`,
  );
  for (const [name, digest] of Object.entries(expectation)) {
    stringMatch(digest, /^sha256:[a-f0-9]{64}$/, `${label} expected ${name}`);
    equal(identity[name], digest, `${label} running ${name}`);
  }
  if (identity.configDigest === identity.assetImageDigest
    || identity.configDigest === identity.manifestDigest) {
    fail(`${label} application config and OCI descriptor identities are conflated.`);
  }
  stringMatch(
    identity.runtimeImageDigest,
    /^sha256:[a-f0-9]{64}$/,
    `${label} runtime image digest`,
  );
  equal(
    identity.runtimeImageDigest,
    identity.configDigest,
    `${label} runtime selected config digest`,
  );
  stringMatch(
    identity.repoDigestContractSha256,
    /^[a-f0-9]{64}$/,
    `${label} runtime repository digest contract`,
  );
  equal(identity.reference, contract.images.application, `${label} running image reference`);
  equal(identity.revision, contract.revision, `${label} running image revision`);
  equal(identity.role, "app", `${label} running image role`);
  const publicBuildContract = record(
    identity.publicBuildContract,
    `${label} running image public build contract`,
  );
  exactKeys(
    publicBuildContract,
    ["sha256", "version"],
    `${label} running image public build contract`,
  );
  equal(
    publicBuildContract.version,
    contract.publicBuildContract.version,
    `${label} running image public build contract version`,
  );
  equal(
    publicBuildContract.sha256,
    contract.publicBuildContract.sha256,
    `${label} running image public build contract sha256`,
  );
  return identity;
}

export function assertDeterministicReset(value, scenario, project, label) {
  equal(scenario, "provider-overlap-v1", `${label} scenario`);
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
  equal(reset.scenario_sha256, sha256(scenario), `${label} reset scenario digest`);
  equal(
    reset.seed_sha256,
    sha256(`${fixtureSeed}:${scenario}`),
    `${label} reset seed digest`,
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
  ]) equal(state[name], 0, `${label} reset state ${name}`);
  equal(state.remnawave_users, 1, `${label} reset remnawave fixture`);
  equal(state.payment_disconnect_injection_armed, false, `${label} disconnect injection`);
  equal(state.payment_rate_limit_injection_armed, false, `${label} rate-limit injection`);
  equal(state.scenario_telegram_id_format, "9-digit-synthetic", `${label} telegram format`);

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
  equal(oidc.codes, 0, `${label} OIDC codes`);
  equal(oidc.authorize_sequence, 0, `${label} OIDC authorize sequence`);
  equal(oidc.event_count, 0, `${label} OIDC event count`);
  equal(oidc.key_id, "clean-pay-browser-journey-oidc-key", `${label} OIDC key id`);
  equal(oidc.seed_sha256, sha256(fixtureSeed), `${label} OIDC seed digest`);
  equal(oidc.scenario_sha256, sha256(scenario), `${label} OIDC scenario digest`);
  equal(oidc.subject_format, "9-digit-synthetic", `${label} OIDC subject format`);

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
  equal(database.status, "reset", `${label} database reset status`);
  equal(database.scopeContract, "exact-compose-project-label", `${label} database scope contract`);
  equal(database.scopeSha256, sha256(project), `${label} database scope digest`);
  stringMatch(database.schemaSha256, /^[a-f0-9]{64}$/, `${label} database schema digest`);
  positiveInteger(database.tableCount, `${label} database table count`);
  equal(database.sequenceCount, 0, `${label} database sequence count`);
  equal(database.resetSequence, 1, `${label} database reset sequence`);
  equal(
    database.transaction,
    "truncate-public-application-tables-cascade-no-sequences",
    `${label} database transaction`,
  );
  equal(database.redis, "flush-owned-db-0", `${label} database Redis reset`);

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

export function extractProviderOverlapProof(concurrencyValue, ledgerValue, label) {
  const concurrency = record(concurrencyValue, `${label} concurrency evidence`);
  exactKeys(concurrency, ["active", "contractVersion", "windows"], `${label} concurrency evidence`);
  equal(concurrency.contractVersion, 1, `${label} concurrency contract version`);
  equal(concurrency.active, null, `${label} concurrency active probe`);
  if (!Array.isArray(concurrency.windows) || concurrency.windows.length !== 1) {
    fail(`${label} must contain exactly one completed overlap window.`);
  }
  const window = record(concurrency.windows[0], `${label} overlap window`);
  exactKeys(window, [
    "duplicates",
    "enteredCount",
    "maxInFlight",
    "occurrence",
    "outcome",
    "participants",
    "probe",
    "release",
    "timeoutMs",
  ], `${label} overlap window`);
  equal(window.probe, PROVIDER_OVERLAP_PROBE, `${label} overlap probe`);
  equal(window.occurrence, 1, `${label} overlap occurrence`);
  boundedInteger(window.timeoutMs, 100, 10_000, `${label} overlap timeout`);
  equal(window.enteredCount, 2, `${label} overlap entered count`);
  equal(window.maxInFlight, 2, `${label} overlap max in-flight`);
  equal(window.release, "all-entered", `${label} overlap release`);
  equal(window.outcome, "proven", `${label} overlap outcome`);
  if (!Array.isArray(window.duplicates) || window.duplicates.length !== 0) {
    fail(`${label} overlap evidence contains a duplicate participant.`);
  }
  if (!Array.isArray(window.participants) || window.participants.length !== participantContracts.length) {
    fail(`${label} overlap evidence must contain both exact participants.`);
  }

  const participantSequences = new Map();
  for (const [index, expected] of participantContracts.entries()) {
    const participant = record(window.participants[index], `${label} overlap participant ${index}`);
    exactKeys(
      participant,
      ["entered", "ledgerSequence", "method", "pathname", "service"],
      `${label} overlap participant ${index}`,
    );
    equal(participant.service, expected.service, `${label} participant ${index} service`);
    equal(participant.method, expected.method, `${label} participant ${index} method`);
    equal(participant.pathname, expected.pathname, `${label} participant ${index} pathname`);
    equal(participant.entered, true, `${label} participant ${index} entered`);
    positiveInteger(participant.ledgerSequence, `${label} participant ${index} ledger sequence`);
    participantSequences.set(expected.effect, participant.ledgerSequence);
  }
  if (new Set(participantSequences.values()).size !== participantSequences.size) {
    fail(`${label} overlap participant ledger sequences must be unique.`);
  }

  const ledger = record(ledgerValue, `${label} provider ledger`);
  exactKeys(ledger, ["database", "entries"], `${label} provider ledger`);
  if (!Array.isArray(ledger.entries) || ledger.entries.length < 2) {
    fail(`${label} provider ledger is incomplete.`);
  }
  const entries = ledger.entries.map((entry, index) => {
    const candidate = record(entry, `${label} ledger entry ${index}`);
    positiveInteger(candidate.sequence, `${label} ledger sequence ${index}`);
    equal(candidate.sequence, index + 1, `${label} contiguous ledger sequence ${index}`);
    return candidate;
  });
  const selected = [];
  for (const expected of participantContracts) {
    const sequence = participantSequences.get(expected.effect);
    const entry = entries[sequence - 1];
    if (!entry) fail(`${label} overlap references a missing ledger record.`);
    assertExactReadRecord(entry, expected, label);
    selected.push({ ledgerIndex: sequence - 1, ...entry });
  }
  for (const expected of participantContracts) {
    const matching = entries.filter((entry) => entry.effect === expected.effect);
    if (matching.length !== 1) {
      fail(`${label} ledger must contain exactly one ${expected.effect} record.`);
    }
  }
  const arrival = [...selected].sort((left, right) => left.sequence - right.sequence);
  if (
    Math.abs(arrival[0].sequence - arrival[1].sequence) !== 1
    || Math.abs(arrival[0].ledgerIndex - arrival[1].ledgerIndex) !== 1
  ) {
    fail(`${label} referenced provider records must be adjacent in the enriched ledger.`);
  }

  return Object.freeze({
    contractVersion: concurrency.contractVersion,
    probe: window.probe,
    occurrence: window.occurrence,
    timeoutMs: window.timeoutMs,
    participants: window.participants,
    duplicates: window.duplicates,
    enteredCount: window.enteredCount,
    maxInFlight: window.maxInFlight,
    release: window.release,
    outcome: window.outcome,
    arrivalOrder: arrival.map((entry) => entry.effect),
    ledgerRange: Object.freeze({
      firstSequence: arrival[0].sequence,
      lastSequence: arrival[1].sequence,
      adjacent: true,
    }),
    records: arrival,
  });
}

export function createProviderOverlapStackReport(input) {
  const role = input.role;
  if (role !== "baseline" && role !== "candidate") fail("Stack role must be baseline or candidate.");
  stringMatch(input.fixtureContractSha256, /^[a-f0-9]{64}$/, `${role} fixture contract sha256`);
  const browser = assertBrowserIdentity(input.browser, role);
  const navigation = record(input.navigation, `${role} navigation`);
  exactKeys(
    navigation,
    [
      "finalUrl",
      "headingVisible",
      "eventLifecycle",
      "historyContractSha256",
      "historyCount",
      "historyLedger",
      "requestContractSha256",
      "requestCount",
      "semanticRequestLedger",
      "staticLoadGraph",
      "staticLoadGraphContractSha256",
      "staticRequestContractSha256",
      "staticRequestCount",
      "staticRequestLedger",
      "unexpectedConsoleCount",
      "unexpectedPageErrorCount",
      "unexpectedRequestCount",
    ],
    `${role} navigation`,
  );
  equal(navigation.finalUrl, "https://pay.ci.clean-pay.dev/cabinet", `${role} navigation final URL`);
  equal(navigation.headingVisible, true, `${role} cabinet heading`);
  assertEventLifecycle(navigation.eventLifecycle, role);
  boundedInteger(navigation.requestCount, 1, 256, `${role} browser request count`);
  stringMatch(
    navigation.requestContractSha256,
    /^[a-f0-9]{64}$/,
    `${role} browser request contract sha256`,
  );
  const historyLedger = assertHistoryLedger(navigation.historyLedger, role);
  boundedInteger(navigation.historyCount, 2, 128, `${role} browser history count`);
  equal(navigation.historyCount, historyLedger.length, `${role} browser history ledger count`);
  stringMatch(
    navigation.historyContractSha256,
    /^[a-f0-9]{64}$/,
    `${role} browser history contract sha256`,
  );
  equal(
    navigation.historyContractSha256,
    sha256(JSON.stringify(historyLedger)),
    `${role} browser history contract digest`,
  );
  const staticLedger = assertStaticRequestLedger(navigation.staticRequestLedger, role);
  boundedInteger(navigation.staticRequestCount, 3, 256, `${role} static request count`);
  equal(navigation.staticRequestCount, staticLedger.length, `${role} static request ledger count`);
  stringMatch(
    navigation.staticRequestContractSha256,
    /^[a-f0-9]{64}$/,
    `${role} static request contract sha256`,
  );
  equal(
    navigation.staticRequestContractSha256,
    sha256(JSON.stringify(staticLedger)),
    `${role} static request contract digest`,
  );
  const staticLoadGraph = assertStaticLoadGraph(navigation.staticLoadGraph, role);
  stringMatch(
    navigation.staticLoadGraphContractSha256,
    /^[a-f0-9]{64}$/,
    `${role} static load graph sha256`,
  );
  equal(
    navigation.staticLoadGraphContractSha256,
    sha256(JSON.stringify(staticLoadGraph)),
    `${role} static load graph digest`,
  );
  equal(
    staticLoadGraph.assetAttestationSha256,
    input.runtimeBinding.staticAssetAttestationSha256,
    `${role} static load graph image attestation binding`,
  );
  equal(
    staticLoadGraph.assetInventorySha256,
    input.runtimeBinding.staticAssetInventorySha256,
    `${role} static load graph image inventory binding`,
  );
  equal(
    staticLoadGraph.inventoryLedgerContractSha256,
    input.runtimeBinding.staticAssetInventoryProjectionSha256,
    `${role} static image inventory projection binding`,
  );
  equal(
    staticLoadGraph.routeDeclaredPathContractSha256,
    input.runtimeBinding.staticAssetRouteGraphSha256,
    `${role} static image route graph binding`,
  );
  const semanticLedger = assertSemanticRequestLedger(navigation.semanticRequestLedger, role);
  assertSerializedRequestAndStaticBinding(navigation, semanticLedger, staticLedger, staticLoadGraph, role);
  equal(navigation.unexpectedRequestCount, 0, `${role} unexpected browser requests`);
  equal(navigation.unexpectedConsoleCount, 0, `${role} unexpected browser console`);
  equal(navigation.unexpectedPageErrorCount, 0, `${role} unexpected browser pageerror`);
  stringMatch(input.journeyContractSha256, /^[a-f0-9]{64}$/, `${role} journey contract sha256`);
  const runtimeBinding = assertRuntimeBinding(input.runtimeBinding, role);
  equal(
    runtimeBinding.applicationRepoDigestContractSha256,
    input.imageIdentity.repoDigestContractSha256,
    `${role} runtime repository digest binding`,
  );
  const connectProxyAuthorityLedger = assertConnectProxyAuthorityLedger(
    input.connectProxyAuthorityLedger,
    role,
  );
  const connectProxyCounters = assertConnectProxyCounters(input.connectProxyCounters, role);

  return Object.freeze({
    role,
    composeProject: input.contract.project,
    connectProxyTarget: input.contract.publications.browserTls,
    journeyContractSha256: input.journeyContractSha256,
    fixtureContract: Object.freeze({
      domain: "clean-pay-browser-journey-fixture-v5",
      sha256: input.fixtureContractSha256,
    }),
    scenario: Object.freeze({
      label: input.scenario,
      scenarioSha256: input.reset.scenarioSha256,
      seedSha256: input.reset.seedSha256,
    }),
    browser,
    applicationImage: Object.freeze({
      assetImageDigest: input.imageIdentity.assetImageDigest,
      configDigest: input.imageIdentity.configDigest,
      manifestDigest: input.imageIdentity.manifestDigest,
      referenceSha256: sha256(input.imageIdentity.reference),
      repoDigestContractSha256: input.imageIdentity.repoDigestContractSha256,
      revision: input.imageIdentity.revision,
      role: input.imageIdentity.role,
      runtimeImageDigest: input.imageIdentity.runtimeImageDigest,
      publicBuildContract: input.imageIdentity.publicBuildContract,
    }),
    runtimeBinding,
    connectProxyAuthorityLedger,
    connectProxyCounters,
    reset: Object.freeze({ database: input.reset.database }),
    navigation,
    providerOverlap: input.providerOverlap,
  });
}

export function createDualProviderOverlapProof(
  baseline,
  candidate,
  cleanupReceipt,
  launchReceipt,
) {
  assertStackReport(baseline, "baseline");
  assertStackReport(candidate, "candidate");
  equal(baseline.role, "baseline", "baseline report role");
  equal(candidate.role, "candidate", "candidate report role");
  assertCrossStackInvariants(baseline, candidate);

  const document = {
    schemaVersion: PROVIDER_OVERLAP_PROOF_SCHEMA_VERSION,
    kind: PROVIDER_OVERLAP_PROOF_KIND,
    stacks: { baseline, candidate },
    comparison: expectedComparison(baseline, candidate),
    lifecycle: expectedLifecycle(baseline, candidate, cleanupReceipt, launchReceipt),
  };
  assertDualProviderOverlapProof(document);
  return Object.freeze(document);
}

export function assertDualProviderOverlapProof(value) {
  const document = record(value, "dual provider overlap proof");
  exactKeys(
    document,
    ["comparison", "kind", "lifecycle", "schemaVersion", "stacks"],
    "dual provider overlap proof",
  );
  equal(document.schemaVersion, PROVIDER_OVERLAP_PROOF_SCHEMA_VERSION, "proof schema version");
  equal(document.kind, PROVIDER_OVERLAP_PROOF_KIND, "proof kind");
  const stacks = record(document.stacks, "proof stacks");
  exactKeys(stacks, ["baseline", "candidate"], "proof stacks");
  assertStackReport(stacks.baseline, "baseline");
  assertStackReport(stacks.candidate, "candidate");
  assertCrossStackInvariants(stacks.baseline, stacks.candidate);
  const comparison = record(document.comparison, "proof comparison");
  exactKeys(comparison, [
    "arrivalOrderRelationship",
    "distinctApplicationImages",
    "distinctComposeProjects",
    "distinctSourceRevisions",
    "eachOneShotOverlapProven",
    "sameBrowserProject",
    "sameConnectProxyCounters",
    "sameFixtureContract",
    "sameHistoryContract",
    "sameOwnedResetContract",
    "sameProviderRecordSet",
    "samePublicBuildContract",
    "sameScenarioAndSeed",
    "status",
  ], "proof comparison");
  equal(comparison.status, "proven", "proof comparison status");
  for (const [name, result] of Object.entries(comparison)) {
    if (name === "status" || name === "arrivalOrderRelationship") continue;
    equal(result, true, `proof comparison ${name}`);
  }
  if (!new Set(["same", "reordered"]).has(comparison.arrivalOrderRelationship)) {
    fail("Proof arrival order relationship is invalid.");
  }
  deepEqual(comparison, expectedComparison(stacks.baseline, stacks.candidate), "proof comparison");
  const lifecycle = record(document.lifecycle, "proof lifecycle");
  deepEqual(
    lifecycle,
    expectedLifecycle(
      stacks.baseline,
      stacks.candidate,
      lifecycle.cleanup,
      lifecycle.launch,
    ),
    "proof lifecycle",
  );
  return document;
}

function assertCrossStackInvariants(baseline, candidate) {
  if (baseline.composeProject === candidate.composeProject) {
    fail("Dual-image proof requires distinct isolated Compose projects.");
  }
  if (baseline.journeyContractSha256 === candidate.journeyContractSha256) {
    fail("Dual-image proof requires distinct role-bound journey contracts.");
  }
  if (baseline.applicationImage.assetImageDigest === candidate.applicationImage.assetImageDigest
    || baseline.applicationImage.configDigest === candidate.applicationImage.configDigest) {
    fail("Dual-image proof requires distinct OCI source and config image digests.");
  }
  if (baseline.applicationImage.revision === candidate.applicationImage.revision) {
    fail("Dual-image proof requires distinct source revisions.");
  }
  for (const name of [
    "applicationImageBindingContractSha256",
    "projectSha256",
    "networkSha256",
    "publicationsSha256",
    "serviceIdentitySha256",
    "composeRuntimeContractSha256",
    "connectProxyTargetSha256",
    "fixtureExecutionContractSha256",
    "migrationImageBindingContractSha256",
    "oneShotLifecycleContractSha256",
    "generatedEnvironmentDirectorySha256",
    "ownedInputReceiptSha256",
    "staticAssetAttestationSha256",
    "syntheticRoleEnvironmentContractSha256",
  ]) {
    if (baseline.runtimeBinding[name] === candidate.runtimeBinding[name]) {
      fail(`Dual-image proof requires distinct ${name} runtime bindings.`);
    }
  }
  deepEqual(baseline.fixtureContract, candidate.fixtureContract, "fixture contract binding");
  deepEqual(baseline.scenario, candidate.scenario, "scenario and seed binding");
  deepEqual(baseline.browser, candidate.browser, "browser project binding");
  equal(
    baseline.navigation.requestContractSha256,
    candidate.navigation.requestContractSha256,
    "browser request contract binding",
  );
  deepEqual(
    baseline.navigation.historyLedger,
    candidate.navigation.historyLedger,
    "browser history operation sequence",
  );
  equal(
    baseline.navigation.historyContractSha256,
    candidate.navigation.historyContractSha256,
    "browser history contract binding",
  );
  deepEqual(
    baseline.connectProxyAuthorityLedger,
    candidate.connectProxyAuthorityLedger,
    "exact CONNECT authority classification ledger",
  );
  deepEqual(
    baseline.connectProxyCounters,
    candidate.connectProxyCounters,
    "normalized CONNECT proxy counters",
  );
  equal(
    baseline.runtimeBinding.pairLaunchContractSha256,
    candidate.runtimeBinding.pairLaunchContractSha256,
    "shared pair launch barrier binding",
  );
  equal(
    baseline.runtimeBinding.pairCoexistenceContractSha256,
    candidate.runtimeBinding.pairCoexistenceContractSha256,
    "shared pair coexistence binding",
  );
  deepEqual(
    normalizedReset(baseline.reset),
    normalizedReset(candidate.reset),
    "owned reset contract binding",
  );
  deepEqual(
    baseline.applicationImage.publicBuildContract,
    candidate.applicationImage.publicBuildContract,
    "public build contract binding",
  );
  deepEqual(
    baseline.runtimeBinding.fixtureMountContractSha256,
    candidate.runtimeBinding.fixtureMountContractSha256,
    "live fixture mount binding",
  );
  deepEqual(
    baseline.runtimeBinding.fixtureBindingContractSha256,
    candidate.runtimeBinding.fixtureBindingContractSha256,
    "global fixture and mounted subset binding",
  );
  deepEqual(
    baseline.runtimeBinding.globalFixtureContractSha256,
    candidate.runtimeBinding.globalFixtureContractSha256,
    "fresh global fixture binding",
  );
  deepEqual(
    baseline.runtimeBinding.syntheticEnvironmentContractSha256,
    candidate.runtimeBinding.syntheticEnvironmentContractSha256,
    "synthetic application environment binding",
  );
  deepEqual(
    baseline.runtimeBinding.syntheticRoleEnvironmentPolicySha256,
    candidate.runtimeBinding.syntheticRoleEnvironmentPolicySha256,
    "synthetic role environment policy binding",
  );
  deepEqual(
    normalizedOverlap(baseline.providerOverlap),
    normalizedOverlap(candidate.providerOverlap),
    "provider overlap semantics",
  );
  deepEqual(
    normalizedRecords(baseline.providerOverlap.records),
    normalizedRecords(candidate.providerOverlap.records),
    "provider read record set",
  );
}

function expectedComparison(baseline, candidate) {
  return {
    status: "proven",
    distinctComposeProjects: true,
    distinctApplicationImages: true,
    distinctSourceRevisions: true,
    samePublicBuildContract: true,
    sameFixtureContract: true,
    sameScenarioAndSeed: true,
    sameBrowserProject: true,
    sameConnectProxyCounters: true,
    sameHistoryContract: true,
    sameOwnedResetContract: true,
    sameProviderRecordSet: true,
    eachOneShotOverlapProven: true,
    arrivalOrderRelationship: deepJson(
      baseline.providerOverlap.arrivalOrder,
      candidate.providerOverlap.arrivalOrder,
    ) ? "same" : "reordered",
  };
}

function expectedLifecycle(baseline, candidate, cleanupReceipt, launchReceipt) {
  const cleanup = normalizeCleanupReceipt(cleanupReceipt, baseline, candidate);
  const launch = normalizeLaunchReceipt(launchReceipt, baseline, candidate);
  return {
    status: "verifier-owned-cleanup-completed-before-evidence-write",
    automaticCleanup: true,
    cleanupMode: "exact-verifier-owned-stack-pair-v1",
    cleanupHelper: "tests/browser/journeys/journey-owned-stack-orchestrator.mjs",
    ownershipGate: "absence-before-up-and-compose-project-labels-before-down-volumes",
    cleanup,
    launch,
    projects: [
      {
        role: "baseline",
        composeProject: baseline.composeProject,
        projectSha256: baseline.runtimeBinding.projectSha256,
        journeyContractSha256: baseline.journeyContractSha256,
        generatedEnvironmentDirectorySha256:
          baseline.runtimeBinding.generatedEnvironmentDirectorySha256,
      },
      {
        role: "candidate",
        composeProject: candidate.composeProject,
        projectSha256: candidate.runtimeBinding.projectSha256,
        journeyContractSha256: candidate.journeyContractSha256,
        generatedEnvironmentDirectorySha256:
          candidate.runtimeBinding.generatedEnvironmentDirectorySha256,
      },
    ],
  };
}

function normalizeCleanupReceipt(value, baseline, candidate) {
  const cleanup = record(value, "verifier-owned cleanup receipt");
  exactKeys(cleanup, ["stacks", "status"], "verifier-owned cleanup receipt");
  equal(cleanup.status, "verifier-owned-stack-pair-cleaned", "cleanup receipt status");
  if (!Array.isArray(cleanup.stacks) || cleanup.stacks.length !== 2) {
    fail("Verifier-owned cleanup receipt stack set is invalid.");
  }
  const reports = [baseline, candidate];
  const stacks = cleanup.stacks.map((entry, index) => {
    const role = index === 0 ? "baseline" : "candidate";
    const receipt = record(entry, `${role} cleanup receipt`);
    exactKeys(
      receipt,
      ["generatedEnvironmentDirectorySha256", "projectSha256", "role", "status"],
      `${role} cleanup receipt`,
    );
    equal(receipt.role, role, `${role} cleanup receipt role`);
    equal(receipt.status, "verifier-owned-stack-cleaned", `${role} cleanup receipt status`);
    equal(
      receipt.projectSha256,
      reports[index].runtimeBinding.projectSha256,
      `${role} cleanup project binding`,
    );
    equal(
      receipt.generatedEnvironmentDirectorySha256,
      reports[index].runtimeBinding.generatedEnvironmentDirectorySha256,
      `${role} cleanup environment binding`,
    );
    return {
      role,
      generatedEnvironmentDirectorySha256: receipt.generatedEnvironmentDirectorySha256,
      projectSha256: receipt.projectSha256,
      status: receipt.status,
    };
  });
  return { stacks, status: cleanup.status };
}

function normalizeLaunchReceipt(value, baseline, candidate) {
  const launch = record(value, "verifier-owned pair launch receipt");
  exactKeys(launch, [
    "barrierSha256", "coexistence", "dispatches", "inputReceiptContractSha256s",
    "lifecycleNotBefore", "status",
  ], "verifier-owned pair launch receipt");
  equal(
    launch.status,
    "dual-compose-up-dispatched-after-shared-barrier",
    "pair launch status",
  );
  stringMatch(launch.barrierSha256, /^[a-f0-9]{64}$/, "pair launch barrier sha256");
  exactTimestamp(launch.lifecycleNotBefore, "pair launch lifecycle lower bound");
  if (!Array.isArray(launch.dispatches) || launch.dispatches.length !== 2) {
    fail("Pair launch dispatch ledger is invalid.");
  }
  const reports = [baseline, candidate];
  if (!Array.isArray(launch.inputReceiptContractSha256s)
    || launch.inputReceiptContractSha256s.length !== 2
    || launch.inputReceiptContractSha256s.some((digest) => !/^[a-f0-9]{64}$/.test(digest))) {
    fail("Pair launch input receipt ledger is invalid.");
  }
  deepEqual(
    launch.inputReceiptContractSha256s,
    reports.map(({ runtimeBinding }) => runtimeBinding.ownedInputReceiptSha256),
    "pair launch input receipt association",
  );
  const dispatches = launch.dispatches.map((entry, index) => {
    const dispatch = record(entry, `pair launch dispatch ${index}`);
    exactKeys(
      dispatch,
      ["barrierSha256", "ordinal", "projectSha256"],
      `pair launch dispatch ${index}`,
    );
    equal(dispatch.barrierSha256, launch.barrierSha256, `pair launch barrier ${index}`);
    equal(dispatch.ordinal, index, `pair launch ordinal ${index}`);
    equal(
      dispatch.projectSha256,
      reports[index].runtimeBinding.projectSha256,
      `pair launch project ${index}`,
    );
    return {
      barrierSha256: dispatch.barrierSha256,
      ordinal: dispatch.ordinal,
      projectSha256: dispatch.projectSha256,
    };
  });
  equal(
    launch.barrierSha256,
    sha256(JSON.stringify({
      inputReceiptContractSha256s: launch.inputReceiptContractSha256s,
      projects: dispatches.map(({ projectSha256 }) => projectSha256),
      version: 1,
    })),
    "pair launch canonical barrier digest",
  );
  const coexistence = record(launch.coexistence, "pair coexistence receipt");
  exactKeys(coexistence, ["observations", "status"], "pair coexistence receipt");
  equal(
    coexistence.status,
    "both-project-container-sets-coexisted",
    "pair coexistence status",
  );
  if (!Array.isArray(coexistence.observations) || coexistence.observations.length !== 2) {
    fail("Pair coexistence observations are invalid.");
  }
  const containerSets = new Set();
  const crossProjectContainerIds = new Set();
  const observations = coexistence.observations.map((entry, index) => {
    const observation = record(entry, `pair coexistence observation ${index}`);
    exactKeys(
      observation,
      ["containerSetSha256", "projectSha256", "serviceCount", "services"],
      `pair coexistence observation ${index}`,
    );
    stringMatch(
      observation.containerSetSha256,
      /^[a-f0-9]{64}$/,
      `pair coexistence container set ${index}`,
    );
    equal(
      observation.serviceCount,
      JOURNEY_COMPOSE_SERVICE_NAMES.length,
      `pair coexistence service count ${index}`,
    );
    equal(
      observation.projectSha256,
      reports[index].runtimeBinding.projectSha256,
      `pair coexistence project ${index}`,
    );
    if (containerSets.has(observation.containerSetSha256)) {
      fail("Pair coexistence container sets are aliased.");
    }
    if (!Array.isArray(observation.services)
      || observation.services.length !== JOURNEY_COMPOSE_SERVICE_NAMES.length) {
      fail("Pair coexistence service ledger is invalid.");
    }
    const seenContainerIds = new Set();
    const services = observation.services.map((entry, serviceIndex) => {
      const service = record(entry, `pair coexistence service ${index}:${serviceIndex}`);
      exactKeys(
        service,
        ["containerIdSha256", "service", "state"],
        `pair coexistence service ${index}:${serviceIndex}`,
      );
      stringMatch(
        service.containerIdSha256,
        /^[a-f0-9]{64}$/,
        `pair coexistence container identity ${index}:${serviceIndex}`,
      );
      if (seenContainerIds.has(service.containerIdSha256)
        || crossProjectContainerIds.has(service.containerIdSha256)) {
        fail("Pair coexistence container identity is duplicated or shared across projects.");
      }
      seenContainerIds.add(service.containerIdSha256);
      crossProjectContainerIds.add(service.containerIdSha256);
      const expectedService = [...JOURNEY_COMPOSE_SERVICE_NAMES].sort()[serviceIndex];
      equal(service.service, expectedService, `pair coexistence service name ${serviceIndex}`);
      const expectedState = JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[service.service];
      const oneShot = JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES.includes(service.service);
      if ((oneShot !== (expectedState === "exited-zero"))
        || service.state !== expectedState) {
        fail("Pair coexistence service state is invalid.");
      }
      return {
        containerIdSha256: service.containerIdSha256,
        service: service.service,
        state: service.state,
      };
    });
    equal(
      observation.containerSetSha256,
      sha256(JSON.stringify(services)),
      `pair coexistence canonical container set ${index}`,
    );
    containerSets.add(observation.containerSetSha256);
    return {
      containerSetSha256: observation.containerSetSha256,
      projectSha256: observation.projectSha256,
      serviceCount: observation.serviceCount,
      services,
    };
  });
  equal(
    crossProjectContainerIds.size,
    JOURNEY_COMPOSE_SERVICE_NAMES.length * 2,
    "pair coexistence globally distinct container identities",
  );
  const normalized = {
    barrierSha256: launch.barrierSha256,
    coexistence: { observations, status: coexistence.status },
    dispatches,
    inputReceiptContractSha256s: [...launch.inputReceiptContractSha256s],
    lifecycleNotBefore: launch.lifecycleNotBefore,
    status: launch.status,
  };
  const launchSha256 = sha256(JSON.stringify(normalized));
  const coexistenceSha256 = sha256(JSON.stringify(normalized.coexistence));
  for (const report of reports) {
    equal(
      report.runtimeBinding.pairLaunchContractSha256,
      launchSha256,
      `${report.role} pair launch runtime binding`,
    );
    equal(
      report.runtimeBinding.pairCoexistenceContractSha256,
      coexistenceSha256,
      `${report.role} pair coexistence runtime binding`,
    );
  }
  return normalized;
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function assertStackReport(value, label) {
  const report = record(value, `${label} stack report`);
  exactKeys(report, [
    "applicationImage",
    "browser",
    "composeProject",
    "connectProxyAuthorityLedger",
    "connectProxyTarget",
    "connectProxyCounters",
    "fixtureContract",
    "journeyContractSha256",
    "navigation",
    "providerOverlap",
    "reset",
    "role",
    "runtimeBinding",
    "scenario",
  ], `${label} stack report`);
  equal(report.role, label, `${label} stack report role`);
  stringMatch(
    report.composeProject,
    new RegExp(`^clean-pay-browser-journey-provider-proof-${label}-[a-f0-9]{12}$`),
    `${label} compose project`,
  );
  stringMatch(
    report.connectProxyTarget,
    /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4]):443$/,
    `${label} CONNECT proxy target`,
  );
  stringMatch(
    report.journeyContractSha256,
    /^[a-f0-9]{64}$/,
    `${label} journey contract sha256`,
  );
  const fixtureContract = record(report.fixtureContract, `${label} fixture contract`);
  exactKeys(fixtureContract, ["domain", "sha256"], `${label} fixture contract`);
  equal(
    fixtureContract.domain,
    "clean-pay-browser-journey-fixture-v5",
    `${label} fixture contract domain`,
  );
  stringMatch(fixtureContract.sha256, /^[a-f0-9]{64}$/, `${label} fixture contract sha256`);

  const scenario = record(report.scenario, `${label} scenario evidence`);
  exactKeys(
    scenario,
    ["label", "scenarioSha256", "seedSha256"],
    `${label} scenario evidence`,
  );
  equal(scenario.label, "provider-overlap-v1", `${label} scenario label`);
  equal(scenario.scenarioSha256, sha256(scenario.label), `${label} scenario sha256`);
  equal(
    scenario.seedSha256,
    sha256(`${fixtureSeed}:${scenario.label}`),
    `${label} scenario seed sha256`,
  );

  assertBrowserIdentity(report.browser, label);

  const image = record(report.applicationImage, `${label} application image`);
  exactKeys(
    image,
    [
      "assetImageDigest",
      "configDigest",
      "manifestDigest",
      "publicBuildContract",
      "referenceSha256",
      "repoDigestContractSha256",
      "revision",
      "role",
      "runtimeImageDigest",
    ],
    `${label} application image`,
  );
  for (const name of ["assetImageDigest", "configDigest", "manifestDigest"]) {
    stringMatch(image[name], /^sha256:[a-f0-9]{64}$/, `${label} application ${name}`);
  }
  if (image.configDigest === image.assetImageDigest || image.configDigest === image.manifestDigest) {
    fail(`${label} application config and OCI source digests are conflated.`);
  }
  stringMatch(image.runtimeImageDigest, /^sha256:[a-f0-9]{64}$/, `${label} runtime image digest`);
  equal(image.runtimeImageDigest, image.configDigest, `${label} runtime selected config digest`);
  stringMatch(
    image.repoDigestContractSha256,
    /^[a-f0-9]{64}$/,
    `${label} application repository digest contract`,
  );
  stringMatch(image.referenceSha256, /^[a-f0-9]{64}$/, `${label} image reference sha256`);
  stringMatch(image.revision, /^[a-f0-9]{40}$/, `${label} application image revision`);
  equal(image.role, "app", `${label} application image role`);
  const publicBuildContract = record(
    image.publicBuildContract,
    `${label} application public build contract`,
  );
  exactKeys(
    publicBuildContract,
    ["sha256", "version"],
    `${label} application public build contract`,
  );
  equal(publicBuildContract.version, "1", `${label} public build contract version`);
  stringMatch(
    publicBuildContract.sha256,
    /^[a-f0-9]{64}$/,
    `${label} public build contract sha256`,
  );

  const reset = record(report.reset, `${label} reset report`);
  exactKeys(reset, ["database"], `${label} reset report`);
  const database = record(reset.database, `${label} database reset report`);
  exactKeys(database, [
    "redis",
    "resetSequence",
    "schemaSha256",
    "sequenceCount",
    "scopeSha256",
    "tableCount",
    "transaction",
  ], `${label} database reset report`);
  stringMatch(database.scopeSha256, /^[a-f0-9]{64}$/, `${label} database scope sha256`);
  equal(
    database.scopeSha256,
    sha256(report.composeProject),
    `${label} database project scope binding`,
  );
  stringMatch(database.schemaSha256, /^[a-f0-9]{64}$/, `${label} database schema sha256`);
  positiveInteger(database.tableCount, `${label} database table count`);
  equal(database.sequenceCount, 0, `${label} database sequence count`);
  equal(database.resetSequence, 1, `${label} database reset sequence`);
  equal(
    database.transaction,
    "truncate-public-application-tables-cascade-no-sequences",
    `${label} database reset transaction`,
  );
  equal(database.redis, "flush-owned-db-0", `${label} database Redis reset`);

  const navigation = record(report.navigation, `${label} navigation report`);
  exactKeys(
    navigation,
    [
      "finalUrl",
      "headingVisible",
      "eventLifecycle",
      "historyContractSha256",
      "historyCount",
      "historyLedger",
      "requestContractSha256",
      "requestCount",
      "semanticRequestLedger",
      "staticLoadGraph",
      "staticLoadGraphContractSha256",
      "staticRequestContractSha256",
      "staticRequestCount",
      "staticRequestLedger",
      "unexpectedConsoleCount",
      "unexpectedPageErrorCount",
      "unexpectedRequestCount",
    ],
    `${label} navigation report`,
  );
  equal(
    navigation.finalUrl,
    "https://pay.ci.clean-pay.dev/cabinet",
    `${label} final navigation URL`,
  );
  equal(navigation.headingVisible, true, `${label} cabinet heading visibility`);
  assertEventLifecycle(navigation.eventLifecycle, label);
  boundedInteger(navigation.requestCount, 1, 256, `${label} browser request count`);
  stringMatch(
    navigation.requestContractSha256,
    /^[a-f0-9]{64}$/,
    `${label} browser request contract sha256`,
  );
  const historyLedger = assertHistoryLedger(navigation.historyLedger, label);
  equal(navigation.historyCount, historyLedger.length, `${label} browser history count`);
  equal(
    navigation.historyContractSha256,
    sha256(JSON.stringify(historyLedger)),
    `${label} browser history digest`,
  );
  const staticLedger = assertStaticRequestLedger(navigation.staticRequestLedger, label);
  equal(navigation.staticRequestCount, staticLedger.length, `${label} static request count`);
  equal(
    navigation.staticRequestContractSha256,
    sha256(JSON.stringify(staticLedger)),
    `${label} static request digest`,
  );
  const staticLoadGraph = assertStaticLoadGraph(navigation.staticLoadGraph, label);
  equal(
    navigation.staticLoadGraphContractSha256,
    sha256(JSON.stringify(staticLoadGraph)),
    `${label} static load graph digest`,
  );
  equal(
    staticLoadGraph.assetAttestationSha256,
    report.runtimeBinding.staticAssetAttestationSha256,
    `${label} static load graph image binding`,
  );
  equal(
    staticLoadGraph.assetInventorySha256,
    report.runtimeBinding.staticAssetInventorySha256,
    `${label} static load graph inventory binding`,
  );
  equal(
    staticLoadGraph.inventoryLedgerContractSha256,
    report.runtimeBinding.staticAssetInventoryProjectionSha256,
    `${label} serialized static inventory projection binding`,
  );
  equal(
    staticLoadGraph.routeDeclaredPathContractSha256,
    report.runtimeBinding.staticAssetRouteGraphSha256,
    `${label} serialized static route graph binding`,
  );
  const semanticLedger = assertSemanticRequestLedger(navigation.semanticRequestLedger, label);
  assertSerializedRequestAndStaticBinding(
    navigation,
    semanticLedger,
    staticLedger,
    staticLoadGraph,
    label,
  );
  equal(navigation.unexpectedRequestCount, 0, `${label} unexpected browser requests`);
  equal(navigation.unexpectedConsoleCount, 0, `${label} unexpected browser console`);
  equal(navigation.unexpectedPageErrorCount, 0, `${label} unexpected browser pageerror`);

  assertRuntimeBinding(report.runtimeBinding, label, report);
  assertConnectProxyAuthorityLedger(report.connectProxyAuthorityLedger, label);
  assertConnectProxyCounters(report.connectProxyCounters, label);
  assertOverlapReport(report.providerOverlap, label);
  return report;
}

function assertRuntimeBinding(value, label, report) {
  const binding = record(value, `${label} runtime binding`);
  exactKeys(binding, [
    "applicationImageBindingContractSha256",
    "applicationRepoDigestContractSha256",
    "composeRuntimeContractSha256",
    "connectProxyTargetSha256",
    "fixtureExecutionContractSha256",
    "fixtureBindingContractSha256",
    "fixtureMountContractSha256",
    "generatedEnvironmentDirectorySha256",
    "globalFixtureContractSha256",
    "journeyContractSha256",
    "migrationImageBindingContractSha256",
    "networkSha256",
    "oneShotLifecycleContractSha256",
    "ownedInputReceiptSha256",
    "pairCoexistenceContractSha256",
    "pairLaunchContractSha256",
    "projectSha256",
    "publicationsSha256",
    "serviceIdentitySha256",
    "staticAssetAttestationSha256",
    "staticAssetInventoryProjectionSha256",
    "staticAssetInventorySha256",
    "staticAssetRouteGraphSha256",
    "status",
    "syntheticEnvironmentContractSha256",
    "syntheticRoleEnvironmentContractSha256",
    "syntheticRoleEnvironmentPolicySha256",
  ], `${label} runtime binding`);
  equal(binding.status, "preflight-proven", `${label} runtime preflight status`);
  for (const name of Object.keys(binding).filter((name) => name !== "status")) {
    stringMatch(binding[name], /^[a-f0-9]{64}$/, `${label} runtime ${name}`);
  }
  if (report) {
    equal(binding.projectSha256, sha256(report.composeProject), `${label} live project binding`);
    equal(
      binding.journeyContractSha256,
      report.journeyContractSha256,
      `${label} live journey contract binding`,
    );
    equal(
      binding.globalFixtureContractSha256,
      report.fixtureContract.sha256,
      `${label} fresh global fixture binding`,
    );
    equal(
      binding.fixtureBindingContractSha256,
      sha256(JSON.stringify({
        globalFixtureContractSha256: binding.globalFixtureContractSha256,
        mountSubsetContractSha256: binding.fixtureMountContractSha256,
      })),
      `${label} global fixture mounted subset digest`,
    );
    equal(
      binding.networkSha256,
      sha256(`${report.composeProject}_default`),
      `${label} live network binding`,
    );
    equal(
      binding.connectProxyTargetSha256,
      sha256(report.connectProxyTarget),
      `${label} CONNECT proxy target binding`,
    );
    equal(
      binding.applicationRepoDigestContractSha256,
      report.applicationImage.repoDigestContractSha256,
      `${label} live repository digest binding`,
    );
    equal(
      binding.applicationImageBindingContractSha256,
      sha256(JSON.stringify({
        assetImageDigest: report.applicationImage.assetImageDigest,
        configDigest: report.applicationImage.configDigest,
        referenceSha256: report.applicationImage.referenceSha256,
        repoDigests: [...new Set([
          report.applicationImage.assetImageDigest,
          report.applicationImage.manifestDigest,
        ])].sort(),
        role: "application",
      })),
      `${label} pre-start application image binding`,
    );
  }
  return binding;
}

function assertHistoryLedger(value, label) {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(`${label} browser history ledger is invalid.`);
  }
  for (const entry of value) {
    exactKeys(entry, ["kind", "location"], `${label} browser history entry`);
  }
  const projected = value.map(({ kind, location }) => ({ kind, location }));
  deepEqual(projected, [
    { kind: "checkpoint", location: "app-profile" },
    { kind: "frame-navigation", location: "app-cabinet" },
  ], `${label} exact browser history transition`);
  return projected;
}

function assertStaticRequestLedger(value, label) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 256) {
    fail(`${label} static request ledger is invalid.`);
  }
  const classes = new Set([
    "next-static-css", "next-static-font", "next-static-image", "next-static-js",
  ]);
  const paths = new Set();
  for (const entry of value) {
    exactKeys(entry, ["assetSha256", "class", "pathSha256"], `${label} static request entry`);
    if (!classes.has(entry.class) || !/^[a-f0-9]{64}$/.test(entry.pathSha256 ?? "")
      || paths.has(entry.pathSha256)
      || (entry.assetSha256 !== null && !/^[a-f0-9]{64}$/.test(entry.assetSha256 ?? ""))
      || (["next-static-css", "next-static-js"].includes(entry.class)
        && entry.assetSha256 === null)) {
      fail(`${label} static request entry is invalid, duplicated, or unbound.`);
    }
    paths.add(entry.pathSha256);
  }
  return value.map(({ assetSha256, class: resourceClass, pathSha256 }) => ({
    assetSha256,
    class: resourceClass,
    pathSha256,
  }));
}

function assertStaticLoadGraph(value, label) {
  const graph = record(value, `${label} static load graph`);
  exactKeys(
    graph,
    [
      "assetAttestationSha256",
      "assetInventorySha256",
      "declaredPathLedger",
      "declaredPathSha256s",
      "expectedChunkPathSha256s",
      "inventoryLedger",
      "inventoryLedgerContractSha256",
      "routeDeclaredPathContractSha256",
      "routeDeclaredPathSha256s",
    ],
    `${label} static load graph`,
  );
  stringMatch(graph.assetAttestationSha256, /^[a-f0-9]{64}$/, `${label} asset attestation`);
  stringMatch(graph.assetInventorySha256, /^[a-f0-9]{64}$/, `${label} asset inventory`);
  for (const [name, values] of [
    ["declared", graph.declaredPathSha256s],
    ["expected chunk", graph.expectedChunkPathSha256s],
    ["route-declared", graph.routeDeclaredPathSha256s],
  ]) {
    if (!Array.isArray(values) || values.length < 1 || values.length > 256
      || values.some((digest) => !/^[a-f0-9]{64}$/.test(digest))
      || new Set(values).size !== values.length) {
      fail(`${label} static ${name} graph is invalid.`);
    }
  }
  if (!Array.isArray(graph.inventoryLedger) || graph.inventoryLedger.length < 1
    || graph.inventoryLedger.length > 4_096) {
    fail(`${label} static inventory ledger is invalid.`);
  }
  const inventoryPaths = new Set();
  const inventory = graph.inventoryLedger.map((entry) => {
    exactKeys(entry, ["assetSha256", "pathSha256"], `${label} static inventory entry`);
    if (!/^[a-f0-9]{64}$/.test(entry.assetSha256 ?? "")
      || !/^[a-f0-9]{64}$/.test(entry.pathSha256 ?? "")
      || inventoryPaths.has(entry.pathSha256)) {
      fail(`${label} static inventory entry is invalid or duplicated.`);
    }
    inventoryPaths.add(entry.pathSha256);
    return { assetSha256: entry.assetSha256, pathSha256: entry.pathSha256 };
  });
  const sortedInventory = [...inventory].sort((left, right) => (
    left.pathSha256.localeCompare(right.pathSha256)
  ));
  deepEqual(inventory, sortedInventory, `${label} static inventory ordering`);
  if (!Array.isArray(graph.declaredPathLedger)
    || graph.declaredPathLedger.length !== graph.declaredPathSha256s.length
    || graph.declaredPathLedger.length < 1 || graph.declaredPathLedger.length > 256) {
    fail(`${label} static declaration ledger is invalid.`);
  }
  const declarationPaths = new Set();
  const declarations = graph.declaredPathLedger.map((entry) => {
    exactKeys(entry, ["class", "pathSha256"], `${label} static declaration entry`);
    if (!["chunk", "media"].includes(entry.class)
      || !/^[a-f0-9]{64}$/.test(entry.pathSha256 ?? "")
      || declarationPaths.has(entry.pathSha256)) {
      fail(`${label} static declaration entry is invalid or duplicated.`);
    }
    declarationPaths.add(entry.pathSha256);
    return { class: entry.class, pathSha256: entry.pathSha256 };
  });
  deepEqual(
    declarations,
    [...declarations].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256)),
    `${label} static declaration ordering`,
  );
  deepEqual(
    declarations.map(({ pathSha256 }) => pathSha256).sort(),
    [...graph.declaredPathSha256s].sort(),
    `${label} static declaration digest association`,
  );
  equal(
    graph.inventoryLedgerContractSha256,
    sha256(JSON.stringify(inventory)),
    `${label} static inventory projection digest`,
  );
  equal(
    graph.routeDeclaredPathContractSha256,
    sha256(JSON.stringify(graph.routeDeclaredPathSha256s)),
    `${label} static route projection digest`,
  );
  if (graph.routeDeclaredPathSha256s.some((digest) => (
    !graph.expectedChunkPathSha256s.includes(digest)
  ))) fail(`${label} attested route graph escaped the expected chunk closure.`);
  return {
    assetAttestationSha256: graph.assetAttestationSha256,
    assetInventorySha256: graph.assetInventorySha256,
    declaredPathLedger: declarations,
    declaredPathSha256s: [...graph.declaredPathSha256s],
    expectedChunkPathSha256s: [...graph.expectedChunkPathSha256s],
    inventoryLedger: inventory,
    inventoryLedgerContractSha256: graph.inventoryLedgerContractSha256,
    routeDeclaredPathContractSha256: graph.routeDeclaredPathContractSha256,
    routeDeclaredPathSha256s: [...graph.routeDeclaredPathSha256s],
  };
}

function assertEventLifecycle(value, label) {
  const lifecycle = record(value, `${label} browser event lifecycle`);
  exactKeys(
    lifecycle,
    ["drainedEventCount", "lateEventCount", "status"],
    `${label} browser event lifecycle`,
  );
  boundedInteger(lifecycle.drainedEventCount, 1, 4_096, `${label} drained browser events`);
  equal(lifecycle.lateEventCount, 0, `${label} late browser events`);
  equal(lifecycle.status, "sealed-clean", `${label} browser event lifecycle status`);
  return lifecycle;
}

function assertSemanticRequestLedger(value, label) {
  return validateProviderOverlapSemanticLedger(value, `${label} semantic browser request ledger`);
}

function assertSerializedRequestAndStaticBinding(
  navigation,
  semanticLedger,
  staticLedger,
  staticLoadGraph,
  label,
) {
  equal(
    navigation.requestCount,
    semanticLedger.length + staticLedger.length,
    `${label} total browser request count`,
  );
  const staticClasses = [...new Set(staticLedger.map((entry) => entry.class))].sort();
  for (const required of ["next-static-css", "next-static-font", "next-static-js"]) {
    if (!staticClasses.includes(required)) fail(`${label} static class closure is incomplete.`);
  }
  const summary = { version: 1, semanticLedger, staticClasses };
  equal(
    navigation.requestContractSha256,
    sha256(JSON.stringify(summary)),
    `${label} serialized browser request contract digest`,
  );
  const navigationKeys = new Set([
    "app-login-document", "app-telegram-start", "telegram-oidc-authorize",
    "app-telegram-callback", "app-profile-document", "app-cabinet-document",
  ]);
  deepEqual(
    semanticLedger.map(({ key }) => key).filter((key) => navigationKeys.has(key)),
    [...navigationKeys],
    `${label} serialized browser navigation flow`,
  );
  const counts = Object.create(null);
  for (const { key } of semanticLedger) counts[key] = (counts[key] ?? 0) + 1;
  if ((counts["turnstile-widget-script"] ?? 0) < 1
    || (counts["chatwoot-sdk-script"] ?? 0) < 1
    || counts["chatwoot-widget-frame"] !== counts["chatwoot-sdk-script"]
    || (counts["chatwoot-widget-conversation-frame"] ?? 0)
      > counts["chatwoot-sdk-script"]) {
    fail(`${label} serialized external browser request relation is invalid.`);
  }
  const inventoryByPath = new Map(staticLoadGraph.inventoryLedger.map((entry) => [
    entry.pathSha256,
    entry.assetSha256,
  ]));
  const declaredChunkPaths = staticLoadGraph.declaredPathLedger
    .filter(({ class: resourceClass }) => resourceClass === "chunk")
    .map(({ pathSha256 }) => pathSha256);
  const declaredMediaPaths = staticLoadGraph.declaredPathLedger
    .filter(({ class: resourceClass }) => resourceClass === "media")
    .map(({ pathSha256 }) => pathSha256);
  if (declaredChunkPaths.some((digest) => !inventoryByPath.has(digest))) {
    fail(`${label} declared static chunk escaped its attested image inventory.`);
  }
  const reachableChunkPaths = new Set([
    ...staticLoadGraph.routeDeclaredPathSha256s,
    ...declaredChunkPaths,
  ]);
  deepEqual(
    [...staticLoadGraph.expectedChunkPathSha256s].sort(),
    [...reachableChunkPaths].sort(),
    `${label} exact serialized route and response-declared static closure`,
  );
  const observedChunkPaths = [];
  const observedMediaPaths = [];
  for (const entry of staticLedger) {
    if (entry.assetSha256 === null) {
      if (!declaredMediaPaths.includes(entry.pathSha256)) {
        fail(`${label} static media is unreachable from the sealed response graph.`);
      }
      observedMediaPaths.push(entry.pathSha256);
      continue;
    }
    if (inventoryByPath.get(entry.pathSha256) !== entry.assetSha256) {
      fail(`${label} static request differs from the attested image inventory.`);
    }
    observedChunkPaths.push(entry.pathSha256);
  }
  deepEqual(
    [...observedChunkPaths].sort(),
    [...staticLoadGraph.expectedChunkPathSha256s].sort(),
    `${label} exact serialized static chunk closure`,
  );
  deepEqual(
    [...observedMediaPaths].sort(),
    [...declaredMediaPaths].sort(),
    `${label} exact serialized static media declaration closure`,
  );
}

function assertConnectProxyCounters(value, label) {
  const counters = record(value, `${label} CONNECT proxy counters`);
  exactKeys(counters, [
    "accepted",
    "rejected",
    "upstreamAttempts",
    "upstreamConnected",
    "upstreamFailures",
  ], `${label} CONNECT proxy counters`);
  for (const [name, count] of Object.entries(counters)) {
    boundedInteger(count, 0, Number.MAX_SAFE_INTEGER, `${label} CONNECT proxy ${name}`);
  }
  equal(counters.accepted, 4, `${label} CONNECT proxy exact accepted cardinality`);
  equal(counters.rejected, 0, `${label} CONNECT proxy rejected`);
  equal(counters.upstreamFailures, 0, `${label} CONNECT proxy failures`);
  equal(counters.upstreamAttempts, counters.upstreamConnected, `${label} CONNECT upstream attempts`);
  equal(counters.accepted, counters.upstreamConnected, `${label} CONNECT accepted`);
  equal(counters.upstreamAttempts, 4, `${label} CONNECT exact upstream attempts`);
  return counters;
}

function assertConnectProxyAuthorityLedger(value, label) {
  const expected = [
    "challenges.cloudflare.com:443",
    "chatwoot.browser.clean-pay.dev:443",
    "oauth.telegram.org:443",
    "pay.ci.clean-pay.dev:443",
  ].sort();
  if (!Array.isArray(value) || value.length !== expected.length
    || JSON.stringify(value) !== JSON.stringify(expected)) {
    fail(`${label} CONNECT authority ledger is not exact.`);
  }
  return Object.freeze([...value]);
}

function assertOverlapReport(value, label) {
  const overlap = record(value, `${label} provider overlap report`);
  exactKeys(overlap, [
    "arrivalOrder",
    "contractVersion",
    "duplicates",
    "enteredCount",
    "ledgerRange",
    "maxInFlight",
    "occurrence",
    "outcome",
    "participants",
    "probe",
    "records",
    "release",
    "timeoutMs",
  ], `${label} provider overlap report`);
  equal(overlap.contractVersion, 1, `${label} overlap contract version`);
  equal(overlap.probe, PROVIDER_OVERLAP_PROBE, `${label} overlap probe`);
  equal(overlap.occurrence, 1, `${label} overlap occurrence`);
  boundedInteger(overlap.timeoutMs, 100, 10_000, `${label} overlap timeout`);
  equal(overlap.enteredCount, 2, `${label} overlap entered count`);
  equal(overlap.maxInFlight, 2, `${label} overlap max in-flight`);
  equal(overlap.release, "all-entered", `${label} overlap release`);
  equal(overlap.outcome, "proven", `${label} overlap outcome`);
  if (!Array.isArray(overlap.duplicates) || overlap.duplicates.length !== 0) {
    fail(`${label} overlap report contains duplicates.`);
  }
  if (!Array.isArray(overlap.participants) || overlap.participants.length !== 2) {
    fail(`${label} overlap report must contain both participants.`);
  }
  const participantSequences = new Map();
  for (const [index, expected] of participantContracts.entries()) {
    const participant = record(overlap.participants[index], `${label} report participant ${index}`);
    exactKeys(
      participant,
      ["entered", "ledgerSequence", "method", "pathname", "service"],
      `${label} report participant ${index}`,
    );
    equal(participant.service, expected.service, `${label} report participant service ${index}`);
    equal(participant.method, expected.method, `${label} report participant method ${index}`);
    equal(participant.pathname, expected.pathname, `${label} report participant path ${index}`);
    equal(participant.entered, true, `${label} report participant entered ${index}`);
    positiveInteger(participant.ledgerSequence, `${label} report participant sequence ${index}`);
    participantSequences.set(expected.effect, participant.ledgerSequence);
  }
  if (new Set(participantSequences.values()).size !== 2) {
    fail(`${label} report participant sequences must be distinct.`);
  }
  if (!Array.isArray(overlap.records) || overlap.records.length !== 2) {
    fail(`${label} overlap report must contain exactly two referenced records.`);
  }
  const records = overlap.records.map((entry, index) => {
    const ledgerEntry = record(entry, `${label} overlap report record ${index}`);
    exactKeys(ledgerEntry, [
      "body_bytes",
      "body_contract",
      "body_sha256",
      "credential_contract",
      "effect",
      "idempotency_key_contract",
      "idempotency_key_present",
      "idempotency_key_sha256",
      "ledgerIndex",
      "method",
      "pathname",
      "query_keys",
      "sequence",
      "service",
    ], `${label} overlap report record ${index}`);
    const expected = participantContracts.find(({ effect }) => effect === ledgerEntry.effect);
    if (!expected) fail(`${label} overlap report record effect is invalid.`);
    boundedInteger(ledgerEntry.ledgerIndex, 0, Number.MAX_SAFE_INTEGER, `${label} record ledger index`);
    positiveInteger(ledgerEntry.sequence, `${label} record sequence`);
    equal(ledgerEntry.ledgerIndex, ledgerEntry.sequence - 1, `${label} record ledger index binding`);
    assertExactReadRecord(
      Object.fromEntries(Object.entries(ledgerEntry).filter(([name]) => name !== "ledgerIndex")),
      expected,
      label,
    );
    equal(
      participantSequences.get(expected.effect),
      ledgerEntry.sequence,
      `${label} participant record reference`,
    );
    return ledgerEntry;
  });
  const orderedRecords = [...records].sort((left, right) => left.sequence - right.sequence);
  const arrivalOrder = orderedRecords.map(({ effect }) => effect);
  deepEqual(overlap.arrivalOrder, arrivalOrder, `${label} overlap arrival order`);
  if (new Set(arrivalOrder).size !== 2 || orderedRecords[1].sequence - orderedRecords[0].sequence !== 1) {
    fail(`${label} overlap report records are not the exact adjacent pair.`);
  }
  const ledgerRange = record(overlap.ledgerRange, `${label} overlap ledger range`);
  exactKeys(
    ledgerRange,
    ["adjacent", "firstSequence", "lastSequence"],
    `${label} overlap ledger range`,
  );
  equal(ledgerRange.firstSequence, orderedRecords[0].sequence, `${label} first ledger sequence`);
  equal(ledgerRange.lastSequence, orderedRecords[1].sequence, `${label} last ledger sequence`);
  equal(ledgerRange.adjacent, true, `${label} ledger adjacency`);
}

function assertBrowserIdentity(value, label) {
  const browser = record(value, `${label} browser identity`);
  exactKeys(browser, [
    "chromiumVersion",
    "colorScheme",
    "locale",
    "playwrightVersion",
    "project",
    "timezoneId",
    "userAgentSha256",
    "viewport",
  ], `${label} browser identity`);
  equal(browser.project, PROVIDER_OVERLAP_BROWSER_PROJECT, `${label} browser project`);
  stringMatch(browser.playwrightVersion, /^\d+\.\d+\.\d+$/, `${label} Playwright version`);
  stringMatch(browser.chromiumVersion, /^\d+\.\d+\.\d+\.\d+$/, `${label} Chromium version`);
  stringMatch(browser.userAgentSha256, /^[a-f0-9]{64}$/, `${label} browser user-agent digest`);
  deepEqual(browser.viewport, { width: 1440, height: 900 }, `${label} browser viewport`);
  equal(browser.locale, "ru-RU", `${label} browser locale`);
  equal(browser.timezoneId, "Europe/Moscow", `${label} browser timezone`);
  equal(browser.colorScheme, "light", `${label} browser color scheme`);
  return browser;
}

function assertExactReadRecord(entry, expected, label) {
  exactKeys(entry, [
    "body_bytes",
    "body_contract",
    "body_sha256",
    "credential_contract",
    "effect",
    "idempotency_key_contract",
    "idempotency_key_present",
    "idempotency_key_sha256",
    "method",
    "pathname",
    "query_keys",
    "sequence",
    "service",
  ], `${label} ${expected.effect} ledger record`);
  deepEqual(entry, {
    sequence: entry.sequence,
    service: expected.service,
    method: expected.method,
    pathname: expected.pathname,
    query_keys: [],
    body_bytes: 0,
    body_sha256: emptyBodySha256,
    body_contract: null,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      header_names: [],
      authorization_scheme: null,
      cookie_names: ["access_token", "refresh_token"],
    },
    effect: expected.effect,
  }, `${label} ${expected.effect} ledger record`);
}

function normalizedOverlap(value) {
  return {
    contractVersion: value.contractVersion,
    probe: value.probe,
    occurrence: value.occurrence,
    timeoutMs: value.timeoutMs,
    participants: value.participants.map((participant) => ({
      service: participant.service,
      method: participant.method,
      pathname: participant.pathname,
      entered: participant.entered,
    })),
    duplicates: value.duplicates,
    enteredCount: value.enteredCount,
    maxInFlight: value.maxInFlight,
    release: value.release,
    outcome: value.outcome,
  };
}

function normalizedRecords(records) {
  return records.map((entry) => ({
    service: entry.service,
    method: entry.method,
    pathname: entry.pathname,
    query_keys: entry.query_keys,
    body_bytes: entry.body_bytes,
    body_sha256: entry.body_sha256,
    body_contract: entry.body_contract,
    idempotency_key_present: entry.idempotency_key_present,
    idempotency_key_sha256: entry.idempotency_key_sha256,
    idempotency_key_contract: entry.idempotency_key_contract,
    credential_contract: entry.credential_contract,
    effect: entry.effect,
  }))
    .sort((left, right) => left.effect.localeCompare(right.effect));
}

function normalizedReset(reset) {
  return {
    schemaSha256: reset.database.schemaSha256,
    tableCount: reset.database.tableCount,
    sequenceCount: reset.database.sequenceCount,
    transaction: reset.database.transaction,
    redis: reset.database.redis,
  };
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (!deepJson(actual, wanted)) fail(`${label} has an invalid exact field set.`);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object.`);
  }
  return value;
}

function exactUrl(raw, label) {
  if (typeof raw !== "string" || raw !== raw.trim()) fail(`${label} must be an exact URL.`);
  try {
    return new URL(raw);
  } catch {
    fail(`${label} must be an exact URL.`);
  }
}

function assertPublicationPort(publication, label) {
  const port = String(publication).slice(String(publication).lastIndexOf(":") + 1);
  assertPort(port, `${label} publication`);
}

function assertPort(value, label) {
  if (!/^\d{2,5}$/.test(value)) fail(`${label} has an invalid port.`);
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    fail(`${label} has an invalid port.`);
  }
}

function stringMatch(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) fail(`${label} is invalid.`);
}

function positiveInteger(value, label) {
  boundedInteger(value, 1, Number.MAX_SAFE_INTEGER, label);
}

function boundedInteger(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`${label} is outside its bounded integer contract.`);
  }
}

function exactTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value) {
    fail(`${label} is invalid.`);
  }
  return value;
}

function equal(actual, expected, label) {
  if (actual !== expected) fail(`${label} does not match its exact contract.`);
}

function deepEqual(actual, expected, label) {
  if (!deepJson(actual, expected)) fail(`${label} does not match its exact contract.`);
}

function deepJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @returns {never} */
function fail(message) {
  throw new Error(message);
}
