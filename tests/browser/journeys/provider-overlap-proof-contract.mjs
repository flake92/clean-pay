import { createHash } from "node:crypto";

export const PROVIDER_OVERLAP_PROOF_KIND = "clean-pay-dual-image-provider-overlap-proof";
export const PROVIDER_OVERLAP_PROOF_SCHEMA_VERSION = 1;
export const PROVIDER_OVERLAP_BROWSER_PROJECT = "provider-overlap-1440x900";
export const PROVIDER_OVERLAP_ACTION = "cabinet_read_overlap_once";
export const PROVIDER_OVERLAP_PROBE = "cabinet-offers-devices-overlap";

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
  const contract = record(value, `${label} journey contract`);
  exactKeys(contract, [
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
    /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/,
    `${label} compose project`,
  );
  stringMatch(contract.revision, /^[a-f0-9]{40}$/, `${label} revision`);

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

export function assertApplicationImageIdentity(value, contract, expectedDigest, label) {
  const identity = record(value, `${label} application image identity`);
  exactKeys(
    identity,
    ["digest", "reference", "revision", "role", "publicBuildContract"],
    `${label} application image identity`,
  );
  stringMatch(expectedDigest, /^sha256:[a-f0-9]{64}$/, `${label} expected image digest`);
  equal(identity.digest, expectedDigest, `${label} running image digest`);
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
  stringMatch(scenario, /^[a-z0-9][a-z0-9:-]{1,180}$/, `${label} scenario`);
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
  positiveInteger(database.resetSequence, `${label} database reset sequence`);
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
    ["finalPath", "headingVisible", "unexpectedRequestCount"],
    `${role} navigation`,
  );
  equal(navigation.finalPath, "/cabinet", `${role} navigation final path`);
  equal(navigation.headingVisible, true, `${role} cabinet heading`);
  equal(navigation.unexpectedRequestCount, 0, `${role} unexpected browser requests`);

  return Object.freeze({
    role,
    composeProject: input.contract.project,
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
      digest: input.imageIdentity.digest,
      referenceSha256: sha256(input.imageIdentity.reference),
      revision: input.imageIdentity.revision,
      role: input.imageIdentity.role,
      publicBuildContract: input.imageIdentity.publicBuildContract,
    }),
    reset: Object.freeze({ database: input.reset.database }),
    navigation,
    providerOverlap: input.providerOverlap,
  });
}

export function createDualProviderOverlapProof(baseline, candidate) {
  assertStackReport(baseline, "baseline");
  assertStackReport(candidate, "candidate");
  equal(baseline.role, "baseline", "baseline report role");
  equal(candidate.role, "candidate", "candidate report role");
  if (baseline.composeProject === candidate.composeProject) {
    fail("Dual-image proof requires distinct isolated Compose projects.");
  }
  if (baseline.applicationImage.digest === candidate.applicationImage.digest) {
    fail("Dual-image proof requires distinct application image digests.");
  }
  if (baseline.applicationImage.revision === candidate.applicationImage.revision) {
    fail("Dual-image proof requires distinct source revisions.");
  }
  deepEqual(
    baseline.fixtureContract,
    candidate.fixtureContract,
    "fixture contract binding",
  );
  deepEqual(baseline.scenario, candidate.scenario, "scenario and seed binding");
  deepEqual(baseline.browser, candidate.browser, "browser project binding");
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
    normalizedOverlap(baseline.providerOverlap),
    normalizedOverlap(candidate.providerOverlap),
    "provider overlap semantics",
  );
  deepEqual(
    normalizedRecords(baseline.providerOverlap.records),
    normalizedRecords(candidate.providerOverlap.records),
    "provider read record set",
  );

  const document = {
    schemaVersion: PROVIDER_OVERLAP_PROOF_SCHEMA_VERSION,
    kind: PROVIDER_OVERLAP_PROOF_KIND,
    stacks: { baseline, candidate },
    comparison: {
      status: "proven",
      distinctComposeProjects: true,
      distinctApplicationImages: true,
      distinctSourceRevisions: true,
      samePublicBuildContract: true,
      sameFixtureContract: true,
      sameScenarioAndSeed: true,
      sameBrowserProject: true,
      sameOwnedResetContract: true,
      sameProviderRecordSet: true,
      eachOneShotOverlapProven: true,
      arrivalOrderRelationship: deepJson(
        baseline.providerOverlap.arrivalOrder,
        candidate.providerOverlap.arrivalOrder,
      ) ? "same" : "reordered",
    },
  };
  assertDualProviderOverlapProof(document);
  return Object.freeze(document);
}

export function assertDualProviderOverlapProof(value) {
  const document = record(value, "dual provider overlap proof");
  exactKeys(document, ["comparison", "kind", "schemaVersion", "stacks"], "dual provider overlap proof");
  equal(document.schemaVersion, PROVIDER_OVERLAP_PROOF_SCHEMA_VERSION, "proof schema version");
  equal(document.kind, PROVIDER_OVERLAP_PROOF_KIND, "proof kind");
  const stacks = record(document.stacks, "proof stacks");
  exactKeys(stacks, ["baseline", "candidate"], "proof stacks");
  assertStackReport(stacks.baseline, "baseline");
  assertStackReport(stacks.candidate, "candidate");
  const comparison = record(document.comparison, "proof comparison");
  exactKeys(comparison, [
    "arrivalOrderRelationship",
    "distinctApplicationImages",
    "distinctComposeProjects",
    "distinctSourceRevisions",
    "eachOneShotOverlapProven",
    "sameBrowserProject",
    "sameFixtureContract",
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
  return document;
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
    "fixtureContract",
    "navigation",
    "providerOverlap",
    "reset",
    "role",
    "scenario",
  ], `${label} stack report`);
  equal(report.role, label, `${label} stack report role`);
  stringMatch(
    report.composeProject,
    /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/,
    `${label} compose project`,
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
  stringMatch(scenario.label, /^[a-z0-9][a-z0-9:-]{1,180}$/, `${label} scenario label`);
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
    ["digest", "publicBuildContract", "referenceSha256", "revision", "role"],
    `${label} application image`,
  );
  stringMatch(image.digest, /^sha256:[a-f0-9]{64}$/, `${label} application image digest`);
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
  stringMatch(database.schemaSha256, /^[a-f0-9]{64}$/, `${label} database schema sha256`);
  positiveInteger(database.tableCount, `${label} database table count`);
  equal(database.sequenceCount, 0, `${label} database sequence count`);
  positiveInteger(database.resetSequence, `${label} database reset sequence`);
  equal(
    database.transaction,
    "truncate-public-application-tables-cascade-no-sequences",
    `${label} database reset transaction`,
  );
  equal(database.redis, "flush-owned-db-0", `${label} database Redis reset`);

  const navigation = record(report.navigation, `${label} navigation report`);
  exactKeys(
    navigation,
    ["finalPath", "headingVisible", "unexpectedRequestCount"],
    `${label} navigation report`,
  );
  equal(navigation.finalPath, "/cabinet", `${label} final navigation path`);
  equal(navigation.headingVisible, true, `${label} cabinet heading visibility`);
  equal(navigation.unexpectedRequestCount, 0, `${label} unexpected browser requests`);

  assertOverlapReport(report.providerOverlap, label);
  return report;
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
