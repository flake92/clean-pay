import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

import {
  PROVIDER_OVERLAP_BROWSER_PROJECT,
  assertApplicationImageIdentity,
  assertDeterministicReset,
  assertDualProviderOverlapProof,
  assertJourneyStackContract,
  assertLoopbackControlUrl,
  assertLoopbackResolver,
  createDualProviderOverlapProof,
  extractProviderOverlapProof,
  sha256,
} from "./provider-overlap-proof-contract.mjs";

const baselineRevision = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const candidateRevision = "6edb677dafbb16bb49899ae40cc406d3c71e1a1b";
const publicBuildContractSha256 = "5dc1c21d1db2b433736d50c008065d9dfa3adc1ff338fb403569913881b80673";
const fixtureContractSha256 = "7b62f993647d20582018297505f8557d201962a9bd768a5438dd3b8fa06cb5f9";

test("compares two exact one-shot overlap reports while retaining observed arrival order", () => {
  const baselineOverlap = extractedOverlap("offers-first");
  const candidateOverlap = extractedOverlap("devices-first");
  const proof = createDualProviderOverlapProof(
    stackReport("baseline", baselineOverlap),
    stackReport("candidate", candidateOverlap),
  );

  expect(proof.comparison).toEqual({
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
    arrivalOrderRelationship: "reordered",
  });
  expect(proof.stacks.baseline.providerOverlap.arrivalOrder)
    .toEqual(["read_offers", "read_devices"]);
  expect(proof.stacks.candidate.providerOverlap.arrivalOrder)
    .toEqual(["read_devices", "read_offers"]);
  const serialized = JSON.stringify(proof);
  expect(serialized).not.toContain("synthetic.browser@clean-pay.dev");
  expect(serialized).not.toContain("access_token=");
  expect(serialized).not.toContain("refresh_token=");
  expect(serialized).not.toContain("clean-pay:baseline");
  expect(serialized).not.toContain("clean-pay:candidate");
});

test("rejects concurrency and adjacent-ledger near misses without broadening the proof", () => {
  const exact = rawOverlap("offers-first");
  const mutations: Array<[string, (value: ReturnType<typeof rawOverlap>) => void]> = [
    ["a second window", (value) => { value.concurrency.windows.push(structuredClone(value.concurrency.windows[0])); }],
    ["an active probe", (value) => { value.concurrency.active = {}; }],
    ["a sequential max-in-flight value", (value) => { value.concurrency.windows[0].maxInFlight = 1; }],
    ["a timeout outcome", (value) => { value.concurrency.windows[0].outcome = "timeout"; }],
    ["an adjacent field", (value) => {
      (value.concurrency.windows[0] as unknown as Record<string, unknown>).project = "broadened";
    }],
    ["a duplicate participant", (value) => {
      value.concurrency.windows[0].duplicates.push({
        service: "remnashop",
        method: "GET",
        pathname: "/api/v1/public/subscription/offers",
        ledgerSequence: 4,
      });
    }],
    ["a participant reorder", (value) => { value.concurrency.windows[0].participants.reverse(); }],
    ["a participant path mutation", (value) => {
      value.concurrency.windows[0].participants[0].pathname += "/adjacent";
    }],
    ["a non-adjacent ledger reference", (value) => {
      value.ledger.entries.splice(2, 0, fillerRecord(3));
      value.ledger.entries[3].sequence = 4;
      value.concurrency.windows[0].participants[0].ledgerSequence = 4;
    }],
    ["an extra ledger field", (value) => {
      (value.ledger.entries[1] as unknown as Record<string, unknown>).authorization = "redacted";
    }],
    ["a duplicate offers effect", (value) => {
      const duplicate = structuredClone(value.ledger.entries[1]);
      duplicate.sequence = value.ledger.entries.length + 1;
      value.ledger.entries.push(duplicate);
    }],
    ["a missing cookie-name contract", (value) => {
      value.ledger.entries[1].credential_contract.cookie_names = ["access_token"];
    }],
  ];

  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(exact);
    mutate(nearMiss);
    expect(
      () => extractProviderOverlapProof(nearMiss.concurrency, nearMiss.ledger, label),
      label,
    ).toThrow();
  }
});

test("rejects dual-image identity, fixture, browser, and semantic comparison near misses", () => {
  const baseline = stackReport("baseline", extractedOverlap("offers-first"));
  const candidate = stackReport("candidate", extractedOverlap("devices-first"));
  const mutations: Array<[string, (value: typeof candidate) => void]> = [
    ["same image", (value) => { value.applicationImage.digest = baseline.applicationImage.digest; }],
    ["same revision", (value) => { value.applicationImage.revision = baseline.applicationImage.revision; }],
    ["different fixture", (value) => { value.fixtureContract.sha256 = "a".repeat(64); }],
    ["different scenario", (value) => { value.scenario.seedSha256 = "b".repeat(64); }],
    ["different browser", (value) => { value.browser.chromiumVersion = "151.0.7922.35"; }],
    ["different public build", (value) => {
      value.applicationImage.publicBuildContract.sha256 = "c".repeat(64);
    }],
    ["different reset schema", (value) => { value.reset.database.schemaSha256 = "e".repeat(64); }],
    ["sequential overlap", (value) => {
      (value.providerOverlap as unknown as { maxInFlight: number }).maxInFlight = 1;
    }],
    ["changed provider record", (value) => { value.providerOverlap.records[0].body_bytes = 1; }],
  ];

  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(candidate);
    mutate(nearMiss);
    expect(() => createDualProviderOverlapProof(baseline, nearMiss), label).toThrow();
  }
});

test("recomputes serialized cross-stack, lifecycle, and runtime invariants", () => {
  const exact = createDualProviderOverlapProof(
    stackReport("baseline", extractedOverlap("offers-first")),
    stackReport("candidate", extractedOverlap("devices-first")),
  );
  expect(assertDualProviderOverlapProof(structuredClone(exact))).toEqual(exact);
  const mutations: Array<[string, (value: typeof exact) => void]> = [
    ["claimed comparison", (value) => { value.comparison.arrivalOrderRelationship = "same"; }],
    ["same project", (value) => {
      value.stacks.candidate.composeProject = value.stacks.baseline.composeProject;
      value.stacks.candidate.runtimeBinding.projectSha256 = value.stacks.baseline.runtimeBinding.projectSha256;
      value.stacks.candidate.runtimeBinding.networkSha256 = value.stacks.baseline.runtimeBinding.networkSha256;
    }],
    ["same image", (value) => {
      value.stacks.candidate.applicationImage.digest = value.stacks.baseline.applicationImage.digest;
    }],
    ["fixture mismatch", (value) => {
      value.stacks.candidate.fixtureContract.sha256 = "0".repeat(64);
    }],
    ["runtime contract mismatch", (value) => {
      value.stacks.candidate.runtimeBinding.fixtureMountContractSha256 = "0".repeat(64);
    }],
    ["journey contract mismatch", (value) => {
      value.stacks.candidate.runtimeBinding.journeyContractSha256 = "0".repeat(64);
    }],
    ["proxy failure", (value) => { value.stacks.candidate.connectProxyCounters.rejected = 1; }],
    ["reset scope", (value) => { value.stacks.candidate.reset.database.scopeSha256 = "0".repeat(64); }],
    ["reset sequence", (value) => { value.stacks.candidate.reset.database.resetSequence = 2; }],
    ["navigation query", (value) => {
      value.stacks.candidate.navigation.finalUrl = "https://pay.ci.clean-pay.dev/cabinet?adjacent=1";
    }],
    ["role swap", (value) => { value.stacks.baseline.role = "candidate"; }],
    ["cleanup association", (value) => {
      value.lifecycle.projects[0].projectSha256 = "0".repeat(64);
    }],
  ];
  for (const [label, mutate] of mutations) {
    const nearMiss = structuredClone(exact);
    mutate(nearMiss);
    expect(() => assertDualProviderOverlapProof(nearMiss), label).toThrow();
  }
});

test("binds contracts to exact loopback endpoints and rejects adjacent inputs", () => {
  const contract = stackContract("baseline");
  assertJourneyStackContract(contract, "baseline");
  expect(assertLoopbackControlUrl(
    "http://127.0.0.1:13100/",
    contract.publications.providerControl,
    "baseline control",
  ).href).toBe("http://127.0.0.1:13100/");
  expect(assertLoopbackResolver(
    "127.0.0.2",
    contract.publications.browserTls,
    "baseline resolver",
  )).toBe("127.0.0.2");

  for (const nearMiss of [
    "http://localhost:13100/",
    "http://127.0.0.1:13101/",
    "https://127.0.0.1:13100/",
    "http://user@127.0.0.1:13100/",
    "http://127.0.0.1:13100/?extra=1",
    "http://127.0.0.1:13100/__ledger",
  ]) {
    expect(() => assertLoopbackControlUrl(
      nearMiss,
      contract.publications.providerControl,
      "near-miss control",
    )).toThrow();
  }
  for (const nearMiss of ["127.0.0.1", "127.0.0.3", "0.0.0.0", "localhost"]) {
    expect(() => assertLoopbackResolver(
      nearMiss,
      contract.publications.browserTls,
      "near-miss resolver",
    )).toThrow();
  }
  const adjacentContract = structuredClone(contract) as typeof contract & {
    credentials?: string;
  };
  adjacentContract.credentials = "forbidden";
  expect(() => assertJourneyStackContract(adjacentContract, "near-miss")).toThrow();
});

test("binds exact running image labels and a pristine deterministic reset", () => {
  const contract = stackContract("baseline");
  assertJourneyStackContract(contract, "baseline");
  const imageIdentity = {
    digest: `sha256:${"1".repeat(64)}`,
    reference: contract.images.application,
    revision: contract.revision,
    role: "app",
    publicBuildContract: { ...contract.publicBuildContract },
  };
  expect(assertApplicationImageIdentity(
    imageIdentity,
    contract,
    imageIdentity.digest,
    "baseline",
  )).toEqual(imageIdentity);
  for (const mutate of [
    (value: typeof imageIdentity) => { value.digest = `sha256:${"2".repeat(64)}`; },
    (value: typeof imageIdentity) => { value.revision = candidateRevision; },
    (value: typeof imageIdentity) => { value.role = "migration"; },
    (value: typeof imageIdentity) => { value.publicBuildContract.sha256 = "3".repeat(64); },
  ]) {
    const nearMiss = structuredClone(imageIdentity);
    mutate(nearMiss);
    expect(() => assertApplicationImageIdentity(
      nearMiss,
      contract,
      imageIdentity.digest,
      "near-miss",
    )).toThrow();
  }

  const scenario = "provider-overlap-v1";
  const reset = resetEvidence(scenario, contract.project);
  expect(assertDeterministicReset(reset, scenario, contract.project, "baseline")).toMatchObject({
    scenarioSha256: sha256(scenario),
    seedSha256: sha256(`clean-pay-browser-journey-v1:${scenario}`),
    database: {
      scopeSha256: sha256(contract.project),
      sequenceCount: 0,
      resetSequence: 1,
    },
  });
  const resetMutations: Array<[string, (value: ReturnType<typeof resetEvidence>) => void]> = [
    ["scenario digest", (value) => { value.scenario_sha256 = "4".repeat(64); }],
    ["non-pristine ledger", (value) => { value.state.ledger = 1; }],
    ["armed injection", (value) => { value.state.payment_disconnect_injection_armed = true; }],
    ["wrong DB scope", (value) => { value.database.scopeSha256 = "5".repeat(64); }],
    ["DB sequence", (value) => { value.database.sequenceCount = 1; }],
  ];
  for (const [label, mutate] of resetMutations) {
    const nearMiss = structuredClone(reset);
    mutate(nearMiss);
    expect(() => assertDeterministicReset(nearMiss, scenario, contract.project, label)).toThrow();
  }
});

test("keeps the schema write-once sidecar-only and free of comparison projection", async () => {
  const directory = path.resolve(__dirname);
  const [
    schemaSource,
    scriptSource,
    documentation,
    connectProxyController,
    browserPolicy,
    renderPolicy,
  ] = await Promise.all([
    readFile(path.join(directory, "provider-overlap-proof.schema.json"), "utf8"),
    readFile(path.join(directory, "prove-provider-overlap.mjs"), "utf8"),
    readFile(path.join(directory, "PROVIDER_OVERLAP_PROOF.md"), "utf8"),
    readFile(path.join(directory, "journey-connect-proxy-controller.mjs"), "utf8"),
    readFile(path.join(directory, "journey-browser-policy.mjs"), "utf8"),
    readFile(path.join(directory, "..", "render-policy.mjs"), "utf8"),
  ]);
  const schema = JSON.parse(schemaSource);
  expect(schema).toMatchObject({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    properties: {
      schemaVersion: { const: 1 },
      kind: { const: "clean-pay-dual-image-provider-overlap-proof" },
      lifecycle: { $ref: "#/$defs/lifecycle" },
      stacks: {
        properties: {
          baseline: { $ref: "#/$defs/baselineStack" },
          candidate: { $ref: "#/$defs/candidateStack" },
        },
      },
    },
  });
  expect(schema.additionalProperties).toBe(false);
  expect(schema.required).toEqual(["schemaVersion", "kind", "stacks", "comparison", "lifecycle"]);
  expect(schema.$defs.stack.required).toEqual(expect.arrayContaining([
    "journeyContractSha256",
    "runtimeBinding",
    "connectProxyCounters",
  ]));
  expect(schema.$defs.navigation.properties).toMatchObject({
    finalUrl: { const: "https://pay.ci.clean-pay.dev/cabinet" },
    unexpectedConsoleCount: { const: 0 },
    unexpectedPageErrorCount: { const: 0 },
  });
  expect(schema.$defs.lifecycle.properties).toMatchObject({
    automaticCleanup: { const: false },
    cleanupMode: { const: "exact-owned-project-handoff-v1" },
  });
  expect(schema.$defs.baselineStack.allOf[1].properties).toMatchObject({
    role: { const: "baseline" },
    composeProject: {
      pattern: "^clean-pay-browser-journey-provider-proof-baseline-[a-f0-9]{12}$",
    },
  });
  expect(schema.$defs.candidateStack.allOf[1].properties).toMatchObject({
    role: { const: "candidate" },
    composeProject: {
      pattern: "^clean-pay-browser-journey-provider-proof-candidate-[a-f0-9]{12}$",
    },
  });
  expect(schema.$defs.stack.properties.scenario.properties.label)
    .toEqual({ const: "provider-overlap-v1" });
  expect(schema.$defs.databaseReset.properties.resetSequence).toEqual({ const: 1 });
  expect(schema.$defs.baselineLifecycleProject.allOf[1].properties.composeProject)
    .toEqual({
      pattern: "^clean-pay-browser-journey-provider-proof-baseline-[a-f0-9]{12}$",
    });
  expect(schema.$defs.candidateLifecycleProject.allOf[1].properties.composeProject)
    .toEqual({
      pattern: "^clean-pay-browser-journey-provider-proof-candidate-[a-f0-9]{12}$",
    });
  expect(scriptSource).toContain('flag: "wx"');
  expect(scriptSource).toContain('mode: 0o600');
  expect(scriptSource).toContain('redirect: "error"');
  expect(scriptSource).toContain('"container", "inspect"');
  expect(scriptSource).toContain('"image", "inspect"');
  expect(scriptSource.indexOf("try {")).toBeLessThan(scriptSource.indexOf("parseArguments(process.argv.slice(2))"));
  const dualPreflight = scriptSource.indexOf("assertDualPreflight(baselinePreflight, candidatePreflight);");
  const proxyReadiness = scriptSource.indexOf("await startBothConnectProxies");
  const parallelProof = scriptSource.indexOf("runs = await Promise.all([");
  const firstControlPost = scriptSource.indexOf('await controlJson(input.controlUrl, "/__reset"');
  const browserLaunch = scriptSource.indexOf("await chromium.launch");
  expect(dualPreflight).toBeGreaterThanOrEqual(0);
  expect(proxyReadiness).toBeGreaterThan(dualPreflight);
  expect(parallelProof).toBeGreaterThan(proxyReadiness);
  expect(firstControlPost).toBeGreaterThan(parallelProof);
  expect(browserLaunch).toBeGreaterThan(firstControlPost);
  for (const service of [
    "app",
    "browser-provider-mock",
    "browser-proxy",
    "browser-oidc-mock",
    "browser-db-observer",
  ]) {
    expect(scriptSource).toContain(`"${service}"`);
  }
  expect(scriptSource).toContain('path.join(path.dirname(contractPath), ".env.app")');
  expect(scriptSource).toContain("containers.app.Config.Env");
  expect(scriptSource).toContain("sameHostPath(mounts[0].Source, expectedRealpath)");
  expect(scriptSource).toContain('"container", "exec", container.Id, "sha256sum"');
  expect(scriptSource).toContain("Buffer.byteLength(chunk, \"utf8\")");
  expect(scriptSource).toContain("maximumUnexpectedEvents = 32");
  expect(scriptSource).toContain('await context.route("**/*"');
  expect(scriptSource).toContain('context.on("page"');
  const exactProfileNavigation = scriptSource.indexOf(
    'url.href === "https://pay.ci.clean-pay.dev/profile"',
  );
  expect(exactProfileNavigation).toBeGreaterThanOrEqual(0);
  expect(exactProfileNavigation).toBeLessThan(scriptSource.indexOf("await armOverlap();"));
  expect(scriptSource.indexOf("await armOverlap();"))
    .toBeLessThan(scriptSource.indexOf('page.goto("https://pay.ci.clean-pay.dev/cabinet"'));
  expect(scriptSource).toContain("cabinetDocumentConsumed");
  expect(connectProxyController).toContain("maximumOutputBytes = 8_192");
  expect(connectProxyController).toContain("counters.accepted <= 0");
  expect(connectProxyController).toContain('targetPort !== "443"');
  expect(browserPolicy).toContain("DETERMINISTIC_CHROMIUM_LAUNCH_ARGS");
  expect(browserPolicy).toContain("!url.username");
  expect(browserPolicy).toContain("!url.password");
  expect(renderPolicy).toContain('"--disable-gpu"');
  expect(scriptSource).not.toContain("tests/browser/baselines/");
  expect(scriptSource).not.toContain("comparison-projection");
  const normalizedDocumentation = documentation.replace(/\s+/g, " ");
  expect(normalizedDocumentation).toContain("does not make a provider-ledger order difference acceptable");
  expect(normalizedDocumentation).toContain("does not prove every scheduler interleaving");
});

function extractedOverlap(order: "offers-first" | "devices-first") {
  const value = rawOverlap(order);
  return extractProviderOverlapProof(value.concurrency, value.ledger, order);
}

function rawOverlap(order: "offers-first" | "devices-first") {
  const offersSequence = order === "offers-first" ? 2 : 3;
  const devicesSequence = order === "devices-first" ? 2 : 3;
  const entries = [
    fillerRecord(1),
    order === "offers-first"
      ? readRecord("read_offers", offersSequence)
      : readRecord("read_devices", devicesSequence),
    order === "offers-first"
      ? readRecord("read_devices", devicesSequence)
      : readRecord("read_offers", offersSequence),
  ];
  return {
    concurrency: {
      contractVersion: 1,
      active: null as Record<string, never> | null,
      windows: [{
        probe: "cabinet-offers-devices-overlap",
        occurrence: 1,
        timeoutMs: 5_000,
        participants: [
          {
            service: "remnashop",
            method: "GET",
            pathname: "/api/v1/public/subscription/devices",
            entered: true,
            ledgerSequence: devicesSequence,
          },
          {
            service: "remnashop",
            method: "GET",
            pathname: "/api/v1/public/subscription/offers",
            entered: true,
            ledgerSequence: offersSequence,
          },
        ],
        duplicates: [] as Array<Record<string, unknown>>,
        enteredCount: 2,
        maxInFlight: 2,
        release: "all-entered",
        outcome: "proven",
      }],
    },
    ledger: { entries, database: {} },
  };
}

function readRecord(effect: "read_offers" | "read_devices", sequence: number) {
  const devices = effect === "read_devices";
  return {
    sequence,
    service: "remnashop",
    method: "GET",
    pathname: `/api/v1/public/subscription/${devices ? "devices" : "offers"}`,
    query_keys: [],
    body_bytes: 0,
    body_sha256: sha256(""),
    body_contract: null,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      header_names: [],
      authorization_scheme: null,
      cookie_names: ["access_token", "refresh_token"],
    },
    effect,
  };
}

function fillerRecord(sequence: number) {
  return {
    sequence,
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/current",
    query_keys: [],
    body_bytes: 0,
    body_sha256: sha256(""),
    body_contract: null,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      header_names: [],
      authorization_scheme: null,
      cookie_names: ["access_token", "refresh_token"],
    },
    effect: "read_subscription",
  };
}

function stackReport(role: "baseline" | "candidate", providerOverlap: ReturnType<typeof extractedOverlap>) {
  const baseline = role === "baseline";
  const revision = baseline ? baselineRevision : candidateRevision;
  const composeProject = `clean-pay-browser-journey-provider-proof-${role}-${(baseline ? "1" : "2").repeat(12)}`;
  const journeyContractSha256 = baseline ? "8".repeat(64) : "9".repeat(64);
  return {
    role,
    composeProject,
    journeyContractSha256,
    fixtureContract: {
      domain: "clean-pay-browser-journey-fixture-v5",
      sha256: fixtureContractSha256,
    },
    scenario: {
      label: "provider-overlap-v1",
      scenarioSha256: sha256("provider-overlap-v1"),
      seedSha256: sha256("clean-pay-browser-journey-v1:provider-overlap-v1"),
    },
    browser: {
      project: PROVIDER_OVERLAP_BROWSER_PROJECT,
      playwrightVersion: "1.62.1",
      chromiumVersion: "151.0.7922.34",
      userAgentSha256: "d".repeat(64),
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      colorScheme: "light",
    },
    applicationImage: {
      digest: `sha256:${baseline ? "1" : "2"}`.padEnd(71, baseline ? "1" : "2"),
      referenceSha256: baseline ? "3".repeat(64) : "4".repeat(64),
      revision,
      role: "app",
      publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
    },
    runtimeBinding: {
      status: "preflight-proven",
      projectSha256: sha256(composeProject),
      journeyContractSha256,
      networkSha256: sha256(`${composeProject}_default`),
      publicationsSha256: baseline ? "a".repeat(64) : "b".repeat(64),
      serviceIdentitySha256: baseline ? "c".repeat(64) : "d".repeat(64),
      fixtureMountContractSha256: "e".repeat(64),
      syntheticEnvironmentContractSha256: "f".repeat(64),
    },
    connectProxyCounters: {
      accepted: 7,
      rejected: 0,
      upstreamAttempts: 7,
      upstreamConnected: 7,
      upstreamFailures: 0,
    },
    reset: {
      database: {
        scopeSha256: sha256(composeProject),
        schemaSha256: "7".repeat(64),
        tableCount: 12,
        sequenceCount: 0,
        resetSequence: 1,
        transaction: "truncate-public-application-tables-cascade-no-sequences",
        redis: "flush-owned-db-0",
      },
    },
    navigation: {
      finalUrl: "https://pay.ci.clean-pay.dev/cabinet",
      headingVisible: true,
      unexpectedRequestCount: 0,
      unexpectedConsoleCount: 0,
      unexpectedPageErrorCount: 0,
    },
    providerOverlap,
  };
}

function stackContract(role: "baseline" | "candidate") {
  const baseline = role === "baseline";
  return {
    schemaVersion: 1,
    kind: "self-contained-synthetic-browser-journey",
    project: `clean-pay-browser-journey-provider-proof-${role}-${(baseline ? "1" : "2").repeat(12)}`,
    revision: baseline ? baselineRevision : candidateRevision,
    images: {
      application: `clean-pay:${role}`,
      migration: `clean-pay-migration:${role}`,
    },
    publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
    fixtureContract: {
      domain: "clean-pay-browser-journey-fixture-v5",
      sha256: fixtureContractSha256,
    },
    publications: {
      app: baseline ? "127.0.0.1:4100" : "127.0.0.1:4200",
      providerControl: baseline ? "127.0.0.1:13100" : "127.0.0.1:13200",
      browserTls: baseline ? "127.0.0.2:443" : "127.0.0.3:443",
      connectProxy: baseline ? "127.0.0.1:14444" : "127.0.0.1:14544",
    },
    secretSource: "deterministic synthetic fixture labels; no external env or credential file",
    ownedStateReset: {
      postgres: "transactional truncate of public application tables; migrations retained; schema has no sequences",
      redis: "flush DB 0 on the project-local redis service",
      scope: "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
    },
  };
}

function resetEvidence(scenario: string, project: string) {
  return {
    status: "reset",
    seed_sha256: sha256(`clean-pay-browser-journey-v1:${scenario}`),
    scenario_sha256: sha256(scenario),
    state: {
      ledger: 0,
      payments: 0,
      payment_idempotency: 0,
      profiles: 0,
      owner_profiles: 0,
      access_owners: 0,
      refresh_owners: 0,
      registered_emails: 0,
      subscriptionless_owners: 0,
      telegram_owner_aliases: 0,
      remnawave_users: 1,
      consumed_turnstile_tokens: 0,
      payment_disconnect_injection_armed: false,
      payment_rate_limit_injection_armed: false,
      sequence: 0,
      payment_sequence: 0,
      scenario_telegram_id_format: "9-digit-synthetic",
    },
    oidc: {
      status: "reset",
      codes: 0,
      authorize_sequence: 0,
      event_count: 0,
      key_id: "clean-pay-browser-journey-oidc-key",
      seed_sha256: sha256("clean-pay-browser-journey-v1"),
      scenario_sha256: sha256(scenario),
      subject_format: "9-digit-synthetic",
    },
    database: {
      status: "reset",
      scopeContract: "exact-compose-project-label",
      scopeSha256: sha256(project),
      schemaSha256: "8".repeat(64),
      sequenceCount: 0,
      tableCount: 12,
      transaction: "truncate-public-application-tables-cascade-no-sequences",
      redis: "flush-owned-db-0",
      resetSequence: 1,
    },
  };
}
