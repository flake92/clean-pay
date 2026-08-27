import {
  mkdtemp,
  readFile,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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
  createProviderOverlapStackReport,
  extractProviderOverlapProof,
  resolveProviderOverlapOutputPath,
  sha256,
} from "./provider-overlap-proof-contract.mjs";
import {
  assertProviderOverlapRedirect,
  classifyProviderOverlapBrowserRequest,
  createProviderOverlapEventSeal,
  finalizeProviderOverlapBrowserContract,
  finalizeProviderOverlapEventLifecycle,
  finalizeProviderOverlapHistoryContract,
} from "./provider-overlap-browser-contract.mjs";
import { currentJourneyFixtureContractSha256 } from "./journey-fixture-manifest.mjs";
import {
  JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES,
  JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES,
  JOURNEY_COMPOSE_SERVICE_NAMES,
  JOURNEY_COMPOSE_VOLUME_NAMES,
} from "./journey-compose-runtime-attestation.mjs";
import { withJourneyOwnedStackPair } from "./journey-owned-stack-orchestrator.mjs";
import {
  JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
  buildJourneySyntheticEnvironment,
} from "./journey-synthetic-environment-contract.mjs";

const baselineRevision = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const candidateRevision = "6edb677dafbb16bb49899ae40cc406d3c71e1a1b";
const publicBuildContractSha256 = "5dc1c21d1db2b433736d50c008065d9dfa3adc1ff338fb403569913881b80673";
const fixtureContractSha256 = currentJourneyFixtureContractSha256();
const staticJavascriptPath = "/_next/static/chunks/app-123.js";
const staticStylesheetPath = "/_next/static/chunks/app/layout-123.css";
const staticFontPath = "/_next/static/media/inter-123.woff2";
const staticInventoryByPath = Object.freeze({
  [staticJavascriptPath]: "b".repeat(64),
  [staticStylesheetPath]: "c".repeat(64),
});
const staticRouteDeclaredPaths = Object.freeze([
  staticStylesheetPath, staticJavascriptPath,
].sort());
const staticInventoryLedger = Object.entries(staticInventoryByPath).map(([
  servedPath, assetSha256,
]) => ({ assetSha256, pathSha256: sha256(servedPath) }))
  .sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
const staticAssetContract = Object.freeze({
  attestationSha256: "a".repeat(64),
  configDigest: `sha256:${"1".repeat(64)}`,
  imageDigest: `sha256:${"2".repeat(64)}`,
  inventoryByPath: staticInventoryByPath,
  inventoryLedgerContractSha256: sha256(JSON.stringify(staticInventoryLedger)),
  inventorySha256: "d".repeat(64),
  manifestDigest: `sha256:${"3".repeat(64)}`,
  routeDeclaredPaths: staticRouteDeclaredPaths,
  routeDeclaredPathContractSha256: sha256(JSON.stringify(
    staticRouteDeclaredPaths.map(sha256),
  )),
});
const staticLoadGraph = Object.freeze({
  responseDeclaredStaticPaths: Object.freeze([
    staticFontPath, staticJavascriptPath, staticStylesheetPath,
  ].sort()),
  staticAssetContract,
});

test("compares two exact one-shot overlap reports while retaining observed arrival order", () => {
  const baselineOverlap = extractedOverlap("offers-first");
  const candidateOverlap = extractedOverlap("devices-first");
  const proof = dualProof(
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
    sameConnectProxyCounters: true,
    sameHistoryContract: true,
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

test("constructs each stack report directly without ambient labels or hidden state", () => {
  for (const role of ["baseline", "candidate"] as const) {
    const expected = stackReport(role, extractedOverlap(
      role === "baseline" ? "offers-first" : "devices-first",
    ));
    const contract = stackContract(role);
    expect(createProviderOverlapStackReport({
      role,
      browser: expected.browser,
      connectProxyAuthorityLedger: expected.connectProxyAuthorityLedger,
      connectProxyCounters: expected.connectProxyCounters,
      contract,
      fixtureContractSha256: expected.fixtureContract.sha256,
      imageIdentity: {
        assetImageDigest: expected.applicationImage.assetImageDigest,
        configDigest: expected.applicationImage.configDigest,
        manifestDigest: expected.applicationImage.manifestDigest,
        publicBuildContract: expected.applicationImage.publicBuildContract,
        reference: contract.images.application,
        repoDigestContractSha256: expected.applicationImage.repoDigestContractSha256,
        revision: expected.applicationImage.revision,
        role: expected.applicationImage.role,
        runtimeImageDigest: expected.applicationImage.runtimeImageDigest,
      },
      journeyContractSha256: expected.journeyContractSha256,
      navigation: expected.navigation,
      providerOverlap: expected.providerOverlap,
      reset: {
        database: expected.reset.database,
        scenarioSha256: expected.scenario.scenarioSha256,
        seedSha256: expected.scenario.seedSha256,
      },
      runtimeBinding: expected.runtimeBinding,
      scenario: expected.scenario.label,
    })).toEqual(expected);
  }
});

test("executes mocked dual prepare, barrier, factory, serialized reader, and cleanup in order", async () => {
  const repositoryRoot = path.resolve(__dirname, "../../..");
  const launchGate = createMockPairLaunchGate();
  const fixtures = await Promise.all([
    createMockOwnedStackInput("baseline", repositoryRoot, launchGate),
    createMockOwnedStackInput("candidate", repositoryRoot, launchGate),
  ]);
  try {
    const session = await withJourneyOwnedStackPair({
      baseline: fixtures[0].input,
      candidate: fixtures[1].input,
    }, async (owned: Readonly<{
      baseline: MockOwnedCallbackStack;
      candidate: MockOwnedCallbackStack;
      launch: Readonly<Record<string, unknown>>;
    }>) => {
      launchGate.timeline.push("callback:runtime-attested");
      const expected = [
        bindMockOwnedRuntimeReport(
          stackReport("baseline", extractedOverlap("offers-first")),
          fixtures[0],
          owned.baseline,
          owned.launch,
        ),
        bindMockOwnedRuntimeReport(
          stackReport("candidate", extractedOverlap("devices-first")),
          fixtures[1],
          owned.candidate,
          owned.launch,
        ),
      ];
      launchGate.timeline.push("factory:baseline");
      const baseline = createStackReportThroughFactory(
        "baseline",
        expected[0],
        fixtures[0].contract,
      );
      launchGate.timeline.push("factory:candidate");
      const candidate = createStackReportThroughFactory(
        "candidate",
        expected[1],
        fixtures[1].contract,
      );
      return Object.freeze({ baseline, candidate });
    });
    const proof = createDualProviderOverlapProof(
      session.value.baseline,
      session.value.candidate,
      session.cleanup,
      session.launch,
    );
    launchGate.timeline.push("reader:serialized");
    const result = assertDualProviderOverlapProof(JSON.parse(JSON.stringify(proof)));
    expect(result.comparison.status).toBe("proven");
    expect(launchGate.dispatchCount).toBe(2);
    const firstResolution = launchGate.timeline.findIndex((entry) => entry.startsWith("resolved:"));
    expect(firstResolution).toBeGreaterThan(
      Math.max(
        launchGate.timeline.indexOf("dispatch:baseline"),
        launchGate.timeline.indexOf("dispatch:candidate"),
      ),
    );
    expect(launchGate.timeline.indexOf("callback:runtime-attested"))
      .toBeGreaterThan(firstResolution);
    for (const fixture of fixtures) {
      expect(fixture.docker.activeProbeCount).toBe(0);
      expect(fixture.docker.activeResourceCount).toBe(0);
      expect(fixture.docker.downCalls).toBe(1);
    }
    for (const role of ["baseline", "candidate"] as const) {
      expect(launchGate.timeline.indexOf(`down:${role}`))
        .toBeGreaterThan(launchGate.timeline.indexOf(`factory:${role}`));
      expect(launchGate.timeline.indexOf(`down:${role}`))
        .toBeLessThan(launchGate.timeline.indexOf("reader:serialized"));
    }
  } finally {
    await Promise.all(fixtures.map(({ directory }) => removeMockOwnedInput(directory)));
  }
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
    ["same image", (value) => {
      value.applicationImage.assetImageDigest = baseline.applicationImage.assetImageDigest;
    }],
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
    expect(() => dualProof(baseline, nearMiss), label).toThrow();
  }
});

test("recomputes serialized cross-stack, lifecycle, and runtime invariants", () => {
  const exact = dualProof(
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
      value.stacks.candidate.applicationImage.assetImageDigest
        = value.stacks.baseline.applicationImage.assetImageDigest;
    }],
    ["fixture mismatch", (value) => {
      value.stacks.candidate.fixtureContract.sha256 = "0".repeat(64);
    }],
    ["runtime contract mismatch", (value) => {
      value.stacks.candidate.runtimeBinding.fixtureMountContractSha256 = "0".repeat(64);
    }],
    ["same Compose runtime", (value) => {
      value.stacks.candidate.runtimeBinding.composeRuntimeContractSha256
        = value.stacks.baseline.runtimeBinding.composeRuntimeContractSha256;
    }],
    ["journey contract mismatch", (value) => {
      value.stacks.candidate.runtimeBinding.journeyContractSha256 = "0".repeat(64);
    }],
    ["proxy failure", (value) => { value.stacks.candidate.connectProxyCounters.rejected = 1; }],
    ["extra CONNECT reconnect", (value) => {
      value.stacks.candidate.connectProxyCounters.accepted += 1;
      value.stacks.candidate.connectProxyCounters.upstreamAttempts += 1;
      value.stacks.candidate.connectProxyCounters.upstreamConnected += 1;
    }],
    ["symmetric repeated CONNECT authority", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        stack.connectProxyAuthorityLedger = Array(4).fill("pay.ci.clean-pay.dev:443");
      }
    }],
    ["reset scope", (value) => { value.stacks.candidate.reset.database.scopeSha256 = "0".repeat(64); }],
    ["reset sequence", (value) => { value.stacks.candidate.reset.database.resetSequence = 2; }],
    ["navigation query", (value) => {
      value.stacks.candidate.navigation.finalUrl = "https://pay.ci.clean-pay.dev/cabinet?adjacent=1";
    }],
    ["request contract", (value) => {
      value.stacks.candidate.navigation.requestContractSha256 = "0".repeat(64);
    }],
    ["symmetric semantic status and content forgery", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        const entry = stack.navigation.semanticRequestLedger[0];
        entry.responseStatus = 599;
        entry.responseContentType = "application/json";
        stack.navigation.requestContractSha256 = sha256(JSON.stringify({
          version: 1,
          semanticLedger: stack.navigation.semanticRequestLedger,
          staticClasses: [...new Set(stack.navigation.staticRequestLedger.map((item: {
            class: string;
          }) => item.class))]
            .sort(),
        }));
      }
    }],
    ["symmetric RSC redirect source without successor", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        stack.navigation.semanticRequestLedger.push(
          semantic("app-root-rsc", 307, "application/octet-stream"),
        );
        stack.navigation.requestCount += 1;
        stack.navigation.requestContractSha256 = sha256(JSON.stringify({
          version: 1,
          semanticLedger: stack.navigation.semanticRequestLedger,
          staticClasses: [...new Set(stack.navigation.staticRequestLedger.map((item: {
            class: string;
          }) => item.class))]
            .sort(),
        }));
      }
    }],
    ["history mutation", (value) => {
      value.stacks.candidate.navigation.historyLedger[1].location = "app-login";
    }],
    ["static duplicate", (value) => {
      value.stacks.candidate.navigation.staticRequestLedger.push(
        structuredClone(value.stacks.candidate.navigation.staticRequestLedger[0]),
      );
      value.stacks.candidate.navigation.staticRequestCount += 1;
      value.stacks.candidate.navigation.staticRequestContractSha256 = sha256(
        JSON.stringify(value.stacks.candidate.navigation.staticRequestLedger),
      );
    }],
    ["response-declared inventory chunk omitted from request closure", (value) => {
      const navigation = value.stacks.candidate.navigation;
      const pathSha256 = sha256("/_next/static/chunks/declared-but-omitted.js");
      navigation.staticLoadGraph.inventoryLedger.push({
        assetSha256: "f".repeat(64),
        pathSha256,
      });
      navigation.staticLoadGraph.inventoryLedger.sort((left: { pathSha256: string }, right: {
        pathSha256: string;
      }) => (
        left.pathSha256.localeCompare(right.pathSha256)
      ));
      navigation.staticLoadGraph.declaredPathSha256s.push(pathSha256);
      navigation.staticLoadGraph.declaredPathLedger.push({ class: "chunk", pathSha256 });
      navigation.staticLoadGraph.declaredPathLedger.sort((left: { pathSha256: string }, right: {
        pathSha256: string;
      }) => (
        left.pathSha256.localeCompare(right.pathSha256)
      ));
      navigation.staticLoadGraph.inventoryLedgerContractSha256 = sha256(
        JSON.stringify(navigation.staticLoadGraph.inventoryLedger),
      );
      navigation.staticLoadGraphContractSha256 = sha256(
        JSON.stringify(navigation.staticLoadGraph),
      );
      value.stacks.candidate.runtimeBinding.staticAssetInventoryProjectionSha256
        = navigation.staticLoadGraph.inventoryLedgerContractSha256;
    }],
    ["symmetric unconsumed media declaration", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        const pathSha256 = sha256("/_next/static/media/unconsumed.woff2");
        stack.navigation.staticLoadGraph.declaredPathSha256s.push(pathSha256);
        stack.navigation.staticLoadGraph.declaredPathLedger.push({ class: "media", pathSha256 });
        stack.navigation.staticLoadGraph.declaredPathLedger.sort((left: {
          pathSha256: string;
        }, right: { pathSha256: string }) => (
          left.pathSha256.localeCompare(right.pathSha256)
        ));
        stack.navigation.staticLoadGraphContractSha256 = sha256(
          JSON.stringify(stack.navigation.staticLoadGraph),
        );
      }
    }],
    ["role swap", (value) => { value.stacks.baseline.role = "candidate"; }],
    ["cleanup association", (value) => {
      value.lifecycle.projects[0].projectSha256 = "0".repeat(64);
    }],
    ["cleanup receipt association", (value) => {
      value.lifecycle.cleanup.stacks[1].generatedEnvironmentDirectorySha256 = "0".repeat(64);
    }],
    ["owned input receipt alias", (value) => {
      value.stacks.candidate.runtimeBinding.ownedInputReceiptSha256
        = value.stacks.baseline.runtimeBinding.ownedInputReceiptSha256;
    }],
    ["forged symmetric launch barrier", (value) => {
      value.lifecycle.launch.barrierSha256 = "f".repeat(64);
      for (const dispatch of value.lifecycle.launch.dispatches) {
        dispatch.barrierSha256 = value.lifecycle.launch.barrierSha256;
      }
    }],
    ["coexistence stray service substitution", (value) => {
      const observation = value.lifecycle.launch.coexistence.observations[0];
      observation.services[0].service = "redis";
      observation.containerSetSha256 = sha256(JSON.stringify(observation.services));
    }],
    ["symmetric coexistence health downgrade", (value) => {
      for (const observation of value.lifecycle.launch.coexistence.observations) {
        const app = observation.services.find(({ service }: { service: string }) => service === "app");
        if (app) app.state = "running";
        observation.containerSetSha256 = sha256(JSON.stringify(observation.services));
      }
    }],
    ["cross-project container identity reuse with recomputed opaque bindings", (value) => {
      const [baselineObservation, candidateObservation]
        = value.lifecycle.launch.coexistence.observations;
      for (let index = 0; index < candidateObservation.services.length - 1; index += 1) {
        candidateObservation.services[index].containerIdSha256
          = baselineObservation.services[index].containerIdSha256;
      }
      candidateObservation.containerSetSha256 = sha256(JSON.stringify(
        candidateObservation.services,
      ));
      const coexistenceSha256 = sha256(JSON.stringify(value.lifecycle.launch.coexistence));
      const launchSha256 = sha256(JSON.stringify(value.lifecycle.launch));
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        stack.runtimeBinding.pairCoexistenceContractSha256 = coexistenceSha256;
        stack.runtimeBinding.pairLaunchContractSha256 = launchSha256;
      }
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
    assetImageDigest: `sha256:${"1".repeat(64)}`,
    configDigest: `sha256:${"2".repeat(64)}`,
    manifestDigest: `sha256:${"3".repeat(64)}`,
    reference: contract.images.application,
    repoDigestContractSha256: "4".repeat(64),
    revision: contract.revision,
    role: "app",
    runtimeImageDigest: `sha256:${"2".repeat(64)}`,
    publicBuildContract: { ...contract.publicBuildContract },
  };
  expect(assertApplicationImageIdentity(
    imageIdentity,
    contract,
    {
      assetImageDigest: imageIdentity.assetImageDigest,
      configDigest: imageIdentity.configDigest,
      manifestDigest: imageIdentity.manifestDigest,
    },
    "baseline",
  )).toEqual(imageIdentity);
  for (const mutate of [
    (value: typeof imageIdentity) => { value.runtimeImageDigest = value.assetImageDigest; },
    (value: typeof imageIdentity) => { value.revision = candidateRevision; },
    (value: typeof imageIdentity) => { value.role = "migration"; },
    (value: typeof imageIdentity) => { value.publicBuildContract.sha256 = "3".repeat(64); },
  ]) {
    const nearMiss = structuredClone(imageIdentity);
    mutate(nearMiss);
    expect(() => assertApplicationImageIdentity(
      nearMiss,
      contract,
      {
        assetImageDigest: imageIdentity.assetImageDigest,
        configDigest: imageIdentity.configDigest,
        manifestDigest: imageIdentity.manifestDigest,
      },
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

test("rejects arbitrary same-host paths, queries, redirects, methods, and transports", async () => {
  const opaque = "opaque-state_1";
  const valid = [
    browserClassification("https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }),
    browserClassification(
      "https://pay.ci.clean-pay.dev/auth/telegram/start?redirect_to=%2Fprofile"
        + "&turnstile_token=synthetic-turnstile-token%3Alogin%3Asynthetic-turnstile-1%3A1",
      { resourceType: "document", isNavigation: true, isMainFrame: true },
    ),
    browserClassification(
      "https://oauth.telegram.org/auth?response_type=code&client_id=7654321098"
        + "&redirect_uri=https%3A%2F%2Fpay.ci.clean-pay.dev%2Fauth%2Ftelegram%2Fcallback"
        + `&scope=openid%20profile&state=${opaque}&nonce=${opaque}`
        + `&code_challenge=${opaque}&code_challenge_method=S256`,
      { resourceType: "document", isNavigation: true, isMainFrame: true },
    ),
    browserClassification(
      `https://pay.ci.clean-pay.dev/auth/telegram/callback?code=${opaque}&state=${opaque}`,
      { resourceType: "document", isNavigation: true, isMainFrame: true },
    ),
    browserClassification("https://pay.ci.clean-pay.dev/profile", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }),
    browserClassification("https://pay.ci.clean-pay.dev/cabinet", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }, true),
    browserClassification("https://pay.ci.clean-pay.dev/_next/static/chunks/app-123.js", {
      resourceType: "script",
    }),
    browserClassification("https://pay.ci.clean-pay.dev/_next/static/chunks/app/layout-123.css", {
      resourceType: "stylesheet",
    }),
    browserClassification("https://pay.ci.clean-pay.dev/_next/static/media/inter-123.woff2", {
      resourceType: "font",
    }),
    browserClassification(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      { resourceType: "script" },
    ),
    browserClassification("https://chatwoot.browser.clean-pay.dev/packs/js/sdk.js", {
      resourceType: "script",
    }),
    browserClassification(
      `https://chatwoot.browser.clean-pay.dev/widget?website_token=${"a".repeat(64)}`,
      { resourceType: "document", isNavigation: true },
    ),
  ];
  const statuses = [200, 307, 302, 307, 200, 200, 200, 200, 200, 200, 200, 200];
  const contentTypes = [
    "text/html",
    "application/octet-stream",
    null,
    "application/octet-stream",
    "text/html",
    "text/html",
    "application/javascript",
    "text/css",
    "font/woff2",
    "application/javascript",
    "application/javascript",
    "text/html",
  ];
  const redirectEdges = [
    null,
    null,
    "app-telegram-start:307->telegram-oidc-authorize",
    "telegram-oidc-authorize:302->app-telegram-callback",
    "app-telegram-callback:307->app-profile-document",
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ];
  const validRecords = valid.map((classification, index) => ({
    classification,
    redirectEdge: redirectEdges[index],
    responseContentType: contentTypes[index],
    responseStatus: statuses[index],
  }));
  const exactBrowserContract = finalizeProviderOverlapBrowserContract(validRecords, staticLoadGraph);
  expect(exactBrowserContract).toMatchObject({
    requestCount: 12,
    requestContractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  const repartitionedStaticRecords = structuredClone(validRecords);
  repartitionedStaticRecords.splice(7, 0, structuredClone(validRecords[6]));
  expect(() => finalizeProviderOverlapBrowserContract(
    repartitionedStaticRecords,
    staticLoadGraph,
  )).toThrow();
  expect(browserClassification(
    `https://chatwoot.browser.clean-pay.dev/widget?website_token=${"a".repeat(64)}`
      + "&cw_conversation=synthetic-conversation",
    { resourceType: "document", isNavigation: true },
  ).key).toBe("chatwoot-widget-conversation-frame");
  const wrongContentType = structuredClone(validRecords);
  wrongContentType[6].responseContentType = "text/html";
  expect(() => finalizeProviderOverlapBrowserContract(wrongContentType, staticLoadGraph)).toThrow();
  const orphanedRedirect = structuredClone(validRecords);
  orphanedRedirect.push({
    classification: browserClassification("https://pay.ci.clean-pay.dev/?_rsc=opaque-state_1", {
      resourceType: "fetch",
    }),
    redirectEdge: null,
    responseContentType: "application/octet-stream",
    responseStatus: 307,
  });
  expect(() => finalizeProviderOverlapBrowserContract(orphanedRedirect, staticLoadGraph)).toThrow();

  const unreachableExistingChunk = "/_next/static/chunks/unused-existing.js";
  const expandedInventoryByPath = {
    ...staticAssetContract.inventoryByPath,
    [unreachableExistingChunk]: "e".repeat(64),
  };
  const expandedInventoryLedger = Object.entries(expandedInventoryByPath).map(([
    servedPath, assetSha256,
  ]) => ({ assetSha256, pathSha256: sha256(servedPath) }))
    .sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
  const expandedStaticContract = {
    ...staticAssetContract,
    inventoryByPath: expandedInventoryByPath,
    inventoryLedgerContractSha256: sha256(JSON.stringify(expandedInventoryLedger)),
  };
  const extraUnique = structuredClone(validRecords);
  extraUnique.push({
    classification: classifyProviderOverlapBrowserRequest({
      url: `https://pay.ci.clean-pay.dev${unreachableExistingChunk}`,
      method: "GET",
      resourceType: "script",
      isNavigation: false,
      isMainFrame: false,
    }, { cabinetDocumentAllowed: false, staticAssetContract: expandedStaticContract }),
    redirectEdge: null,
    responseContentType: "application/javascript",
    responseStatus: 200,
  });
  expect(() => finalizeProviderOverlapBrowserContract(extraUnique, {
    responseDeclaredStaticPaths: staticLoadGraph.responseDeclaredStaticPaths,
    staticAssetContract: expandedStaticContract,
  })).toThrow();

  const history = finalizeProviderOverlapHistoryContract([
    { kind: "checkpoint", url: "https://pay.ci.clean-pay.dev/profile" },
    { kind: "frame-navigation", url: "https://pay.ci.clean-pay.dev/cabinet" },
  ]);
  expect(history.historyContractSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(() => finalizeProviderOverlapHistoryContract([
    { kind: "checkpoint", url: "https://pay.ci.clean-pay.dev/profile" },
    { kind: "hashchange", url: "https://pay.ci.clean-pay.dev/profile#transient" },
    { kind: "frame-navigation", url: "https://pay.ci.clean-pay.dev/cabinet" },
  ])).toThrow();
  expect(() => finalizeProviderOverlapHistoryContract([
    { kind: "checkpoint", url: "https://pay.ci.clean-pay.dev/profile" },
    { kind: "pushState", url: "https://pay.ci.clean-pay.dev/profile?transient=1" },
    { kind: "frame-navigation", url: "https://pay.ci.clean-pay.dev/cabinet" },
  ])).toThrow();

  for (const [label, url, overrides, cabinetAllowed] of [
    ["path", "https://pay.ci.clean-pay.dev/admin", {}, false],
    ["query", "https://pay.ci.clean-pay.dev/profile?extra=1", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }, false],
    ["hash", "https://pay.ci.clean-pay.dev/profile#extra", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }, false],
    ["method", "https://pay.ci.clean-pay.dev/profile", {
      method: "DELETE", resourceType: "fetch",
    }, false],
    ["resource", "https://pay.ci.clean-pay.dev/_next/static/chunks/app-123.js", {
      resourceType: "fetch",
    }, false],
    ["early cabinet", "https://pay.ci.clean-pay.dev/cabinet", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }, false],
    ["external", "https://example.com/profile", {
      resourceType: "document", isNavigation: true, isMainFrame: true,
    }, false],
    ["chatwoot query", `https://chatwoot.browser.clean-pay.dev/widget?website_token=${"a".repeat(64)}&extra=1`, {
      resourceType: "document", isNavigation: true,
    }, false],
  ] as const) {
    expect(() => browserClassification(url, overrides, cabinetAllowed), label).toThrow();
  }
  expect(() => assertProviderOverlapRedirect({
    from: { classification: valid[1], url: "https://pay.ci.clean-pay.dev/auth/telegram/start" },
    to: { classification: valid[2], url: "https://oauth.telegram.org/auth" },
    status: 308,
    location: "https://oauth.telegram.org/auth",
  })).toThrow();
  expect(() => assertProviderOverlapRedirect({
    from: { classification: valid[1], url: "https://pay.ci.clean-pay.dev/auth/telegram/start" },
    to: { classification: valid[2], url: "https://oauth.telegram.org/auth" },
    status: 307,
    location: "https://oauth.telegram.org/other",
  })).toThrow();

  const scriptSource = await readFile(path.resolve(__dirname, "prove-provider-overlap.mjs"), "utf8");
  expect(scriptSource).toContain('await context.routeWebSocket("**/*"');
  expect(scriptSource).toContain('context.on("serviceworker"');
  expect(scriptSource).toContain('serviceWorkers: "block"');
});

test("seals browser events only after a bounded quiet drain and rejects late events", async () => {
  const seal = createProviderOverlapEventSeal(32);
  const finish = seal.begin();
  let settled = false;
  const draining = seal.drainAndSeal(() => settled, {
    pollMs: 1,
    quietMs: 3,
    timeoutMs: 100,
  });
  finish();
  settled = true;
  await expect(draining).resolves.toMatchObject({ status: "drained-and-sealed" });
  expect(seal.assertClean()).toMatchObject({ lateEventCount: 0, status: "sealed-clean" });
  seal.record();
  expect(() => seal.assertClean()).toThrow(/changed after/);

  for (const source of ["console", "history", "request", "pageerror", "provider", "load"]) {
    const sourceSeal = createProviderOverlapEventSeal(32);
    const observed: string[] = [];
    await expect(finalizeProviderOverlapEventLifecycle({
      assertUnchanged: () => undefined,
      close: async () => undefined,
      detach: async () => undefined,
      eventSeal: sourceSeal,
      finish: async () => {
        sourceSeal.record();
        observed.push(source);
        return "finished";
      },
      isIdle: () => true,
      snapshot: () => {
        if (observed.length !== 0) throw new Error(`unexpected ${source} event`);
        return { source };
      },
    }), source).rejects.toThrow(source);
  }

  const closeSeal = createProviderOverlapEventSeal(32);
  await expect(finalizeProviderOverlapEventLifecycle({
    assertUnchanged: () => undefined,
    close: async () => { closeSeal.record(); },
    detach: async () => undefined,
    eventSeal: closeSeal,
    finish: async () => "finished",
    isIdle: () => true,
    snapshot: () => ({ status: "stable" }),
  })).rejects.toThrow(/changed after|close barrier/);

  const allowedSeal = createProviderOverlapEventSeal(32);
  const allowedRawLedger: string[] = [];
  setTimeout(() => {
    allowedSeal.record();
    allowedRawLedger.push("allowed-late-request");
  }, 10);
  await expect(finalizeProviderOverlapEventLifecycle({
    assertUnchanged: (snapshot: { rawCount: number }) => {
      expect(allowedRawLedger.length).toBe(snapshot.rawCount);
    },
    close: async () => undefined,
    detach: async () => undefined,
    eventSeal: allowedSeal,
    finish: async () => ({ requestCount: allowedRawLedger.length }),
    isIdle: () => true,
    snapshot: () => ({ rawCount: allowedRawLedger.length }),
  })).resolves.toMatchObject({
    snapshot: { rawCount: 1 },
    value: { requestCount: 1 },
  });
});

test("rejects a relative evidence output before normalization", () => {
  expect(() => resolveProviderOverlapOutputPath("relative/proof.json")).toThrow(/absolute/);
  expect(resolveProviderOverlapOutputPath(path.resolve("C:/proof/provider-overlap.json")))
    .toBe(path.resolve("C:/proof/provider-overlap.json"));
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
    runtimeAttestation,
    stackOrchestrator,
  ] = await Promise.all([
    readFile(path.join(directory, "provider-overlap-proof.schema.json"), "utf8"),
    readFile(path.join(directory, "prove-provider-overlap.mjs"), "utf8"),
    readFile(path.join(directory, "PROVIDER_OVERLAP_PROOF.md"), "utf8"),
    readFile(path.join(directory, "journey-connect-proxy-controller.mjs"), "utf8"),
    readFile(path.join(directory, "journey-browser-policy.mjs"), "utf8"),
    readFile(path.join(directory, "..", "render-policy.mjs"), "utf8"),
    readFile(path.join(directory, "journey-compose-runtime-attestation.mjs"), "utf8"),
    readFile(path.join(directory, "journey-owned-stack-orchestrator.mjs"), "utf8"),
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
    requestCount: { type: "integer", minimum: 1, maximum: 256 },
    requestContractSha256: { $ref: "#/$defs/sha256" },
    historyContractSha256: { $ref: "#/$defs/sha256" },
    staticLoadGraph: { $ref: "#/$defs/staticLoadGraph" },
    staticRequestContractSha256: { $ref: "#/$defs/sha256" },
    staticRequestCount: { type: "integer", minimum: 3, maximum: 256 },
    staticRequestLedger: {
      type: "array",
      items: { $ref: "#/$defs/staticRequestEntry" },
      minItems: 3,
      maxItems: 256,
      uniqueItems: true,
    },
    unexpectedConsoleCount: { const: 0 },
    unexpectedPageErrorCount: { const: 0 },
  });
  expect(schema.$defs.navigation.required).toEqual(expect.arrayContaining([
    "historyLedger",
    "staticLoadGraph",
    "staticRequestLedger",
  ]));
  expect(schema.$defs.navigation.additionalProperties).toBe(false);
  expect(schema.$defs.staticRequestEntry.additionalProperties).toBe(false);
  expect(schema.$defs.staticLoadGraph.additionalProperties).toBe(false);
  expect(schema.$defs.staticLoadGraph.properties.declaredPathLedger).toMatchObject({
    type: "array",
    minItems: 1,
    maxItems: 256,
    uniqueItems: true,
  });
  expect(schema.$defs.runtimeBinding.properties.composeRuntimeContractSha256)
    .toEqual({ $ref: "#/$defs/sha256" });
  expect(schema.$defs.runtimeBinding.properties.ownedInputReceiptSha256)
    .toEqual({ $ref: "#/$defs/sha256" });
  expect(schema.$defs.lifecycle.properties).toMatchObject({
    automaticCleanup: { const: true },
    cleanupMode: { const: "exact-verifier-owned-stack-pair-v1" },
    cleanup: { $ref: "#/$defs/cleanupReceipt" },
  });
  expect(schema.$defs.cleanupReceipt.additionalProperties).toBe(false);
  expect(schema.$defs.cleanupStackReceipt.additionalProperties).toBe(false);
  expect(schema.$defs.pairCoexistenceObservation.properties.services.prefixItems).toHaveLength(13);
  expect(schema.$defs.coexistApp.allOf[1].properties).toEqual({
    service: { const: "app" },
    state: { const: "running-healthy" },
  });
  expect(schema.$defs.coexistBrowserProxy.allOf[1].properties).toEqual({
    service: { const: "browser-proxy" },
    state: { const: "running" },
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
  const parallelProof = scriptSource.indexOf("runSettlements = await Promise.all([");
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
  expect(runtimeAttestation).toContain("normalizeHostPath(mount.Source)");
  expect(runtimeAttestation).toContain('"container", "exec", container.Id, "sha256sum"');
  expect(runtimeAttestation).toContain('"compose",');
  expect(runtimeAttestation).toContain('"config",');
  expect(stackOrchestrator).toContain("Buffer.byteLength(chunk, \"utf8\")");
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
  expect(connectProxyController).toContain("counters.accepted !== expected.accepted");
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
  const historyLedger = [
    { kind: "checkpoint", location: "app-profile" },
    { kind: "frame-navigation", location: "app-cabinet" },
  ];
  const staticLedger = [
    { assetSha256: "1".repeat(64), class: "next-static-js", pathSha256: sha256(staticJavascriptPath) },
    { assetSha256: "2".repeat(64), class: "next-static-css", pathSha256: sha256(staticStylesheetPath) },
    { assetSha256: null, class: "next-static-font", pathSha256: sha256(staticFontPath) },
  ];
  const staticAssetAttestationSha256 = baseline ? "b".repeat(64) : "c".repeat(64);
  const inventoryLedger = [
    { assetSha256: "1".repeat(64), pathSha256: sha256(staticJavascriptPath) },
    { assetSha256: "2".repeat(64), pathSha256: sha256(staticStylesheetPath) },
  ].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
  const routeDeclaredPathSha256s = [
    sha256(staticJavascriptPath), sha256(staticStylesheetPath),
  ];
  const staticLoadGraph = {
    assetAttestationSha256: staticAssetAttestationSha256,
    assetInventorySha256: "7".repeat(64),
    declaredPathLedger: [
      { class: "media", pathSha256: sha256(staticFontPath) },
      { class: "chunk", pathSha256: sha256(staticJavascriptPath) },
      { class: "chunk", pathSha256: sha256(staticStylesheetPath) },
    ].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256)),
    declaredPathSha256s: [
      sha256(staticFontPath), sha256(staticJavascriptPath), sha256(staticStylesheetPath),
    ],
    expectedChunkPathSha256s: [sha256(staticJavascriptPath), sha256(staticStylesheetPath)],
    inventoryLedger,
    inventoryLedgerContractSha256: sha256(JSON.stringify(inventoryLedger)),
    routeDeclaredPathContractSha256: sha256(JSON.stringify(routeDeclaredPathSha256s)),
    routeDeclaredPathSha256s,
  };
  const semanticRequestLedger = [
    semantic("app-login-document", 200, "text/html"),
    semantic("app-telegram-start", 307, "application/octet-stream"),
    semantic(
      "telegram-oidc-authorize",
      302,
      null,
      "app-telegram-start:307->telegram-oidc-authorize",
    ),
    semantic(
      "app-telegram-callback",
      307,
      "application/octet-stream",
      "telegram-oidc-authorize:302->app-telegram-callback",
    ),
    semantic(
      "app-profile-document",
      200,
      "text/html",
      "app-telegram-callback:307->app-profile-document",
    ),
    semantic("app-cabinet-document", 200, "text/html"),
    semantic("turnstile-widget-script", 200, "application/javascript"),
    semantic("chatwoot-sdk-script", 200, "application/javascript"),
    semantic("chatwoot-widget-frame", 200, "text/html"),
  ];
  const requestContractSha256 = sha256(JSON.stringify({
    version: 1,
    semanticLedger: semanticRequestLedger,
    staticClasses: ["next-static-css", "next-static-font", "next-static-js"],
  }));
  const fixtureMountContractSha256 = "e".repeat(64);
  const fixtureBindingContractSha256 = sha256(JSON.stringify({
    globalFixtureContractSha256: fixtureContractSha256,
    mountSubsetContractSha256: fixtureMountContractSha256,
  }));
  const connectProxyTarget = baseline ? "127.0.0.2:443" : "127.0.0.3:443";
  const assetImageDigest = `sha256:${(baseline ? "1" : "2").repeat(64)}`;
  const configDigest = `sha256:${(baseline ? "3" : "4").repeat(64)}`;
  const manifestDigest = `sha256:${(baseline ? "5" : "6").repeat(64)}`;
  const referenceSha256 = sha256(stackContract(role).images.application);
  const applicationImageBindingContractSha256 = sha256(JSON.stringify({
    assetImageDigest,
    configDigest,
    referenceSha256,
    repoDigests: [assetImageDigest, manifestDigest].sort(),
    role: "application",
  }));
  return {
    role,
    composeProject,
    connectProxyTarget,
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
      assetImageDigest,
      configDigest,
      manifestDigest,
      referenceSha256,
      repoDigestContractSha256: baseline ? "5".repeat(64) : "6".repeat(64),
      revision,
      role: "app",
      runtimeImageDigest: configDigest,
      publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
    },
    runtimeBinding: {
      status: "preflight-proven",
      applicationImageBindingContractSha256,
      applicationRepoDigestContractSha256: baseline ? "5".repeat(64) : "6".repeat(64),
      projectSha256: sha256(composeProject),
      journeyContractSha256,
      networkSha256: sha256(`${composeProject}_default`),
      connectProxyTargetSha256: sha256(connectProxyTarget),
      publicationsSha256: baseline ? "a".repeat(64) : "b".repeat(64),
      serviceIdentitySha256: baseline ? "c".repeat(64) : "d".repeat(64),
      composeRuntimeContractSha256: baseline ? "1".repeat(64) : "2".repeat(64),
      fixtureExecutionContractSha256: baseline ? "1".repeat(64) : "2".repeat(64),
      migrationImageBindingContractSha256: baseline ? "3".repeat(64) : "4".repeat(64),
      oneShotLifecycleContractSha256: baseline ? "5".repeat(64) : "6".repeat(64),
      pairCoexistenceContractSha256: "0".repeat(64),
      pairLaunchContractSha256: "0".repeat(64),
      staticAssetAttestationSha256,
      staticAssetInventoryProjectionSha256: staticLoadGraph.inventoryLedgerContractSha256,
      staticAssetInventorySha256: "7".repeat(64),
      staticAssetRouteGraphSha256: staticLoadGraph.routeDeclaredPathContractSha256,
      fixtureMountContractSha256,
      fixtureBindingContractSha256,
      globalFixtureContractSha256: fixtureContractSha256,
      generatedEnvironmentDirectorySha256: baseline ? "c".repeat(64) : "d".repeat(64),
      ownedInputReceiptSha256: baseline ? "e".repeat(64) : "f".repeat(64),
      syntheticEnvironmentContractSha256: "f".repeat(64),
      syntheticRoleEnvironmentContractSha256: baseline ? "9".repeat(64) : "a".repeat(64),
      syntheticRoleEnvironmentPolicySha256: "b".repeat(64),
    },
    connectProxyAuthorityLedger: [
      "challenges.cloudflare.com:443",
      "chatwoot.browser.clean-pay.dev:443",
      "oauth.telegram.org:443",
      "pay.ci.clean-pay.dev:443",
    ].sort(),
    connectProxyCounters: {
      accepted: 4,
      rejected: 0,
      upstreamAttempts: 4,
      upstreamConnected: 4,
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
      eventLifecycle: {
        drainedEventCount: 24,
        lateEventCount: 0,
        status: "sealed-clean",
      },
      finalUrl: "https://pay.ci.clean-pay.dev/cabinet",
      headingVisible: true,
      requestCount: semanticRequestLedger.length + staticLedger.length,
      requestContractSha256,
      semanticRequestLedger,
      historyContractSha256: sha256(JSON.stringify(historyLedger)),
      historyCount: historyLedger.length,
      historyLedger,
      staticLoadGraph,
      staticLoadGraphContractSha256: sha256(JSON.stringify(staticLoadGraph)),
      staticRequestContractSha256: sha256(JSON.stringify(staticLedger)),
      staticRequestCount: staticLedger.length,
      staticRequestLedger: staticLedger,
      unexpectedRequestCount: 0,
      unexpectedConsoleCount: 0,
      unexpectedPageErrorCount: 0,
    },
    providerOverlap,
  };
}

function createStackReportThroughFactory(
  role: "baseline" | "candidate",
  expected: ReturnType<typeof stackReport>,
  contract = stackContract(role),
) {
  return createProviderOverlapStackReport({
    role,
    browser: expected.browser,
    connectProxyAuthorityLedger: expected.connectProxyAuthorityLedger,
    connectProxyCounters: expected.connectProxyCounters,
    contract,
    fixtureContractSha256: expected.fixtureContract.sha256,
    imageIdentity: {
      assetImageDigest: expected.applicationImage.assetImageDigest,
      configDigest: expected.applicationImage.configDigest,
      manifestDigest: expected.applicationImage.manifestDigest,
      publicBuildContract: expected.applicationImage.publicBuildContract,
      reference: contract.images.application,
      repoDigestContractSha256: expected.applicationImage.repoDigestContractSha256,
      revision: expected.applicationImage.revision,
      role: expected.applicationImage.role,
      runtimeImageDigest: expected.applicationImage.runtimeImageDigest,
    },
    journeyContractSha256: expected.journeyContractSha256,
    navigation: expected.navigation,
    providerOverlap: expected.providerOverlap,
    reset: {
      database: expected.reset.database,
      scenarioSha256: expected.scenario.scenarioSha256,
      seedSha256: expected.scenario.seedSha256,
    },
    runtimeBinding: expected.runtimeBinding,
    scenario: expected.scenario.label,
  });
}

function semantic(
  key: string,
  responseStatus: number,
  responseContentType: string | null,
  redirectEdge: string | null = null,
) {
  return {
    disposition: "continue",
    key,
    redirectEdge,
    responseContentType,
    responseStatus,
  };
}

function dualProof(
  baseline: ReturnType<typeof stackReport>,
  candidate: ReturnType<typeof stackReport>,
) {
  const launch = launchReceipt(baseline, candidate);
  const launchSha256 = sha256(JSON.stringify(launch));
  const coexistenceSha256 = sha256(JSON.stringify(launch.coexistence));
  for (const report of [baseline, candidate]) {
    report.runtimeBinding.pairLaunchContractSha256 = launchSha256;
    report.runtimeBinding.pairCoexistenceContractSha256 = coexistenceSha256;
  }
  return createDualProviderOverlapProof(
    baseline,
    candidate,
    cleanupReceipt(baseline, candidate),
    launch,
  );
}

function launchReceipt(
  baseline: ReturnType<typeof stackReport>,
  candidate: ReturnType<typeof stackReport>,
) {
  const reports = [baseline, candidate];
  const inputReceiptContractSha256s = reports.map((report) => (
    report.runtimeBinding.ownedInputReceiptSha256
  ));
  const projects = reports.map((report) => report.runtimeBinding.projectSha256);
  const barrierSha256 = sha256(JSON.stringify({
    inputReceiptContractSha256s,
    projects,
    version: 1,
  }));
  return {
    barrierSha256,
    coexistence: {
      observations: reports.map((report, stackIndex) => {
        const services = [...JOURNEY_COMPOSE_SERVICE_NAMES].sort().map((service, index) => ({
          containerIdSha256: sha256(`${stackIndex}:${index}:${service}`),
          service,
          state: JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[
            service as keyof typeof JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES
          ],
        }));
        return {
          containerSetSha256: sha256(JSON.stringify(services)),
          projectSha256: report.runtimeBinding.projectSha256,
          serviceCount: services.length,
          services,
        };
      }),
      status: "both-project-container-sets-coexisted",
    },
    dispatches: reports.map((report, ordinal) => ({
      barrierSha256,
      ordinal,
      projectSha256: report.runtimeBinding.projectSha256,
    })),
    inputReceiptContractSha256s,
    lifecycleNotBefore: "2026-01-01T00:00:00.000Z",
    status: "dual-compose-up-dispatched-after-shared-barrier",
  };
}

function cleanupReceipt(
  baseline: ReturnType<typeof stackReport>,
  candidate: ReturnType<typeof stackReport>,
) {
  return {
    status: "verifier-owned-stack-pair-cleaned",
    stacks: [baseline, candidate].map((report) => ({
      role: report.role,
      generatedEnvironmentDirectorySha256:
        report.runtimeBinding.generatedEnvironmentDirectorySha256,
      projectSha256: report.runtimeBinding.projectSha256,
      status: "verifier-owned-stack-cleaned",
    })),
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

function browserClassification(
  url: string,
  overrides: Partial<{
    method: string;
    resourceType: string;
    isNavigation: boolean;
    isMainFrame: boolean;
  }> = {},
  cabinetDocumentAllowed = false,
) {
  return classifyProviderOverlapBrowserRequest({
    url,
    method: overrides.method ?? "GET",
    resourceType: overrides.resourceType ?? "fetch",
    isNavigation: overrides.isNavigation ?? false,
    isMainFrame: overrides.isMainFrame ?? false,
  }, { cabinetDocumentAllowed, staticAssetContract });
}

type MockProviderRole = "baseline" | "candidate";

type MockPairLaunchGate = ReturnType<typeof createMockPairLaunchGate>;

type MockOwnedCallbackStack = Readonly<{
  inputReceipt: Readonly<Record<string, string>>;
  runtime: Readonly<Record<string, string>>;
  status: string;
}>;

function createMockPairLaunchGate() {
  let dispatchCount = 0;
  let release: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const timeline: string[] = [];
  return {
    get dispatchCount() { return dispatchCount; },
    timeline,
    async arrive(role: MockProviderRole) {
      timeline.push(`dispatch:${role}`);
      dispatchCount += 1;
      if (dispatchCount > 2) throw new Error("Mock pair launch dispatched more than twice.");
      if (dispatchCount === 2) release();
      await barrier;
      timeline.push(`resolved:${role}`);
    },
  };
}

async function createMockOwnedStackInput(
  role: MockProviderRole,
  repositoryRoot: string,
  launchGate: MockPairLaunchGate,
) {
  const contract = structuredClone(stackContract(role));
  const directory = await mkdtemp(path.join(tmpdir(), `clean-pay-provider-combined-${role}-`));
  const generated = buildJourneySyntheticEnvironment({
    appImage: contract.images.application,
    appPort: contract.publications.app.split(":")[1],
    connectProxyPort: contract.publications.connectProxy.split(":")[1],
    directory,
    migrationImage: contract.images.migration,
    project: contract.project,
    providerPort: contract.publications.providerControl.split(":")[1],
    proxyBind: contract.publications.browserTls.split(":")[0],
    revision: contract.revision,
    turnstileSiteKey: `custom-provider-overlap-${"x".repeat(24)}`,
  });
  contract.publicBuildContract.sha256 = generated.publicBuildContractSha256;
  const generatedFiles = generated.files as Readonly<Record<string, string>>;
  for (const filename of JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES) {
    await writeFile(
      path.join(directory, filename),
      generatedFiles[filename],
      { flag: "wx", mode: 0o600 },
    );
  }
  const contractBytes = Buffer.from(`${JSON.stringify(contract)}\n`, "utf8");
  const contractPath = path.join(directory, "browser-journey-contract.json");
  await writeFile(contractPath, contractBytes, { flag: "wx", mode: 0o600 });
  const baseline = role === "baseline";
  const identities = Object.freeze({
    application: Object.freeze({
      asset: `sha256:${(baseline ? "1" : "2").repeat(64)}`,
      config: `sha256:${(baseline ? "3" : "4").repeat(64)}`,
      manifest: `sha256:${(baseline ? "5" : "6").repeat(64)}`,
      reference: contract.images.application,
    }),
    migration: Object.freeze({
      asset: `sha256:${(baseline ? "7" : "9").repeat(64)}`,
      config: `sha256:${(baseline ? "8" : "a").repeat(64)}`,
      reference: contract.images.migration,
    }),
  });
  const applicationAssignments = parseMockEnvironment(generatedFiles[".env.app"]);
  const sharedApplicationAssignments = Object.fromEntries(
    Object.entries(applicationAssignments).filter(([name]) => ![
      "CLEAN_PAY_IMAGE",
      "CLEAN_PAY_MIGRATION_IMAGE",
      "CLEAN_PAY_RELEASE",
      "CLEAN_PAY_REVISION",
    ].includes(name)),
  );
  const docker = createFullJourneyDockerMock(role, contract, identities, launchGate);
  return {
    contract,
    directory,
    docker,
    input: {
      repositoryRoot,
      contractPath,
      contract,
      expectedApplicationAssetImageDigest: identities.application.asset,
      expectedApplicationImageConfigDigest: identities.application.config,
      expectedApplicationRepoDigests: [
        identities.application.asset,
        identities.application.manifest,
      ].sort(),
      expectedMigrationAssetImageDigest: identities.migration.asset,
      runDocker: docker.run,
    },
    journeyContractSha256: sha256(contractBytes),
    sharedSyntheticEnvironmentContractSha256:
      sha256(JSON.stringify(sharedApplicationAssignments)),
  };
}

function bindMockOwnedRuntimeReport(
  report: ReturnType<typeof stackReport>,
  fixture: Awaited<ReturnType<typeof createMockOwnedStackInput>>,
  owned: MockOwnedCallbackStack,
  launch: Readonly<Record<string, unknown>>,
) {
  const runtime = owned.runtime;
  const receipt = owned.inputReceipt;
  if (report.applicationImage.assetImageDigest
      !== fixture.input.expectedApplicationAssetImageDigest
    || report.applicationImage.configDigest
      !== fixture.input.expectedApplicationImageConfigDigest) {
    throw new Error("Mock report image identity differs from its owned stack input.");
  }
  report.journeyContractSha256 = fixture.journeyContractSha256;
  report.applicationImage.publicBuildContract.sha256
    = fixture.contract.publicBuildContract.sha256;
  report.applicationImage.repoDigestContractSha256
    = runtime.applicationRepoDigestContractSha256;
  Object.assign(report.runtimeBinding, {
    applicationImageBindingContractSha256:
      runtime.applicationImageBindingContractSha256,
    applicationRepoDigestContractSha256:
      runtime.applicationRepoDigestContractSha256,
    composeRuntimeContractSha256: runtime.composeRuntimeContractSha256,
    connectProxyTargetSha256: sha256(report.connectProxyTarget),
    fixtureBindingContractSha256: receipt.fixtureBindingContractSha256,
    fixtureExecutionContractSha256: runtime.fixtureExecutionContractSha256,
    fixtureMountContractSha256: runtime.fixtureMountContractSha256,
    generatedEnvironmentDirectorySha256:
      receipt.generatedEnvironmentDirectorySha256,
    globalFixtureContractSha256: receipt.globalFixtureContractSha256,
    journeyContractSha256: fixture.journeyContractSha256,
    migrationImageBindingContractSha256:
      runtime.migrationImageBindingContractSha256,
    networkSha256: runtime.networkSha256,
    oneShotLifecycleContractSha256: runtime.oneShotLifecycleContractSha256,
    ownedInputReceiptSha256: sha256(JSON.stringify(receipt)),
    pairCoexistenceContractSha256: sha256(JSON.stringify(launch.coexistence)),
    pairLaunchContractSha256: sha256(JSON.stringify(launch)),
    projectSha256: sha256(fixture.contract.project),
    publicationsSha256: sha256(JSON.stringify(fixture.contract.publications)),
    serviceIdentitySha256: runtime.serviceIdentitySha256,
    syntheticEnvironmentContractSha256:
      fixture.sharedSyntheticEnvironmentContractSha256,
    syntheticRoleEnvironmentContractSha256:
      runtime.syntheticRoleEnvironmentContractSha256,
    syntheticRoleEnvironmentPolicySha256:
      runtime.syntheticRoleEnvironmentPolicySha256,
  });
  return report;
}

function parseMockEnvironment(source: string) {
  return Object.fromEntries(source.trimEnd().split("\n").map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function removeMockOwnedInput(directory: string) {
  for (const filename of [
    ...JOURNEY_SYNTHETIC_ENVIRONMENT_FILENAMES,
    "browser-journey-contract.json",
  ]) {
    await unlink(path.join(directory, filename));
  }
  await rmdir(directory);
}

type MockImageIdentities = Readonly<{
  application: Readonly<{
    asset: string;
    config: string;
    manifest: string;
    reference: string;
  }>;
  migration: Readonly<{
    asset: string;
    config: string;
    reference: string;
  }>;
}>;

function createFullJourneyDockerMock(
  role: MockProviderRole,
  contract: ReturnType<typeof stackContract>,
  identities: MockImageIdentities,
  launchGate: MockPairLaunchGate,
) {
  const calls: string[][] = [];
  const probes = new Map<string, {
    name: string;
    owner: string;
    role: "application" | "migration";
  }>();
  let downCalls = 0;
  let probeOrdinal = 0;
  let resourcesActive = false;
  let runtime: ReturnType<typeof createFullMockRuntime> | undefined;

  const run = async (
    args: string[],
    _maximumBytes?: number,
    environment: Record<string, string> = {},
  ): Promise<string> => {
    calls.push([...args]);
    if (args[0] === "compose" && args.includes("config")) {
      const envFile = args[args.indexOf("--env-file") + 1];
      const assignments = parseMockEnvironment(await readFile(envFile, "utf8"));
      return JSON.stringify(createFullMockComposeModel(contract, {
        application: assignments.CLEAN_PAY_IMAGE,
        migration: assignments.CLEAN_PAY_MIGRATION_IMAGE,
      }, environment));
    }
    if (args[0] === "compose" && args.includes("up")) {
      const envFile = args[args.indexOf("--env-file") + 1];
      const assignments = parseMockEnvironment(await readFile(envFile, "utf8"));
      const compose = createFullMockComposeModel(contract, {
        application: assignments.CLEAN_PAY_IMAGE,
        migration: assignments.CLEAN_PAY_MIGRATION_IMAGE,
      }, environment);
      runtime = createFullMockRuntime(contract, identities, compose);
      resourcesActive = true;
      await launchGate.arrive(role);
      return "";
    }
    if (args[0] === "compose" && args.includes("down")) {
      if (!resourcesActive || !runtime) {
        throw new Error("Mock stack cleanup ran without exact live resources.");
      }
      downCalls += 1;
      launchGate.timeline.push(`down:${role}`);
      resourcesActive = false;
      return "";
    }
    if (args[0] === "image" && args[1] === "inspect") {
      const identity = Object.values(identities).find((candidate) => (
        args[2] === candidate.reference || args[2] === candidate.config
      ));
      if (!identity) throw new Error(`Unexpected mock image inspection: ${args[2]}`);
      const imageRole = identity === identities.application ? "app" : "migration";
      return JSON.stringify([mockImageInspection(identity, imageRole, contract)]);
    }
    if (args[0] === "container" && args[1] === "create") {
      const name = args[args.indexOf("--name") + 1];
      const ownerLabel = args[args.indexOf("--label") + 1];
      const imageRole = name.includes("-application-") ? "application" : "migration";
      probeOrdinal += 1;
      const probeId = sha256(`${contract.project}:probe:${probeOrdinal}:${name}`);
      probes.set(probeId, {
        name,
        owner: ownerLabel.slice("io.clean-pay.verifier-probe=".length),
        role: imageRole,
      });
      return probeId;
    }
    if (args[0] === "container" && args[1] === "inspect") {
      const probe = probes.get(args[2]);
      if (probe) {
        const identity = identities[probe.role];
        return JSON.stringify([{
          Id: args[2],
          Image: identity.config,
          Name: `/${probe.name}`,
          RestartCount: 0,
          Config: {
            Entrypoint: ["/bin/true"],
            Image: identity.reference,
            Labels: { "io.clean-pay.verifier-probe": probe.owner },
          },
          State: { Running: false, Status: "created" },
        }]);
      }
      const container = runtime?.containersById[args[2]];
      if (!resourcesActive || !container) {
        throw new Error(`Unexpected mock container inspection: ${args[2]}`);
      }
      return JSON.stringify([container]);
    }
    if (args[0] === "container" && args[1] === "rm") {
      if (!probes.delete(args[2])) throw new Error("Mock probe cleanup identity differs.");
      return args[2];
    }
    if (args[0] === "container" && args[1] === "exec") {
      const container = runtime?.containersById[args[2]];
      const destination = args[4];
      const mount = container?.Mounts.find((entry) => entry.Destination === destination);
      if (!resourcesActive || !container || !mount || mount.Type !== "bind") {
        throw new Error("Mock live fixture execution escaped its exact bind.");
      }
      return `${sha256(await readFile(mount.Source))}  ${destination}\n`;
    }
    if (args[0] === "ps") {
      if (args.some((entry) => entry.startsWith("label=io.clean-pay.verifier-probe="))) {
        const label = args.find((entry) => entry.startsWith(
          "label=io.clean-pay.verifier-probe=",
        ));
        const name = args.find((entry) => entry.startsWith("name=^/"));
        const expectedOwner = label?.slice("label=io.clean-pay.verifier-probe=".length);
        const expectedName = name?.slice("name=^/".length, -1);
        return [...probes.entries()]
          .filter(([, probe]) => probe.owner === expectedOwner && probe.name === expectedName)
          .map(([identity]) => identity)
          .join("\n");
      }
      if (!resourcesActive || !runtime) return "";
      const serviceFilter = args.find((entry) => entry.startsWith(
        "label=com.docker.compose.service=",
      ));
      if (serviceFilter) {
        const service = serviceFilter.slice("label=com.docker.compose.service=".length);
        return runtime.containerIdsByService[service] ?? "";
      }
      return Object.values(runtime.containerIdsByService).join("\n");
    }
    if (args[0] === "network" && args[1] === "ls") {
      return resourcesActive && runtime ? runtime.network.Id : "";
    }
    if (args[0] === "volume" && args[1] === "ls") {
      return resourcesActive && runtime
        ? runtime.volumes.map(({ Name }) => Name).join("\n")
        : "";
    }
    if (args[0] === "network" && args[1] === "inspect") {
      if (!resourcesActive || !runtime || args[2] !== runtime.network.Id) {
        throw new Error("Unexpected mock network inspection.");
      }
      return JSON.stringify([runtime.network]);
    }
    if (args[0] === "volume" && args[1] === "inspect") {
      const volume = runtime?.volumes.find(({ Name }) => Name === args[2]);
      if (!resourcesActive || !volume) throw new Error("Unexpected mock volume inspection.");
      return JSON.stringify([volume]);
    }
    if (args[0] === "events") {
      const filter = args.find((entry) => entry.startsWith("container="));
      const identity = filter?.slice("container=".length) ?? "";
      const events = runtime?.eventLinesByContainerId[identity];
      if (!resourcesActive || events === undefined) {
        throw new Error("Unexpected mock one-shot event query.");
      }
      return events;
    }
    if (args[0] === "info") return "json-file";
    throw new Error(`Unexpected full-runtime mock Docker command: ${args.join(" ")}`);
  };

  return {
    calls,
    get activeProbeCount() { return probes.size; },
    get activeResourceCount() {
      return resourcesActive ? JOURNEY_COMPOSE_SERVICE_NAMES.length
        + JOURNEY_COMPOSE_VOLUME_NAMES.length + 1 : 0;
    },
    get downCalls() { return downCalls; },
    run,
  };
}

function mockImageInspection(
  identity: MockImageIdentities["application"] | MockImageIdentities["migration"],
  role: "app" | "migration",
  contract: ReturnType<typeof stackContract>,
) {
  return {
    Id: identity.config,
    Descriptor: { digest: identity.asset },
    RepoDigests: [`registry.example/clean-pay-${role}@${identity.asset}`],
    Config: {
      Cmd: null,
      Entrypoint: null,
      Env: ["PATH=/usr/local/bin"],
      Labels: {
        "io.clean-pay.role": role,
        "org.opencontainers.image.revision": contract.revision,
        "io.clean-pay.public-build-contract-version": contract.publicBuildContract.version,
        "io.clean-pay.public-build-contract-sha256": contract.publicBuildContract.sha256,
      },
      User: "",
      WorkingDir: "",
    },
  };
}

function createFullMockComposeModel(
  contract: ReturnType<typeof stackContract>,
  images: { application: string; migration: string },
  environment: Record<string, string>,
) {
  const fixtureMounts: Record<string, { destination: string; source: string }> = {
    "browser-db-observer": {
      destination: "/app/browser-db-observer.mjs",
      source: environment.CLEAN_PAY_BROWSER_DB_OBSERVER_FILE,
    },
    "browser-db-observer-provision": {
      destination: "/fixture/db-observer-provision.sh",
      source: environment.CLEAN_PAY_BROWSER_DB_OBSERVER_PROVISION_FILE,
    },
    "browser-oidc-mock": {
      destination: "/mock/oidc-mock.mjs",
      source: environment.CLEAN_PAY_BROWSER_OIDC_MOCK_FILE,
    },
    "browser-provider-mock": {
      destination: "/mock/provider-mock.mjs",
      source: environment.CLEAN_PAY_BROWSER_PROVIDER_MOCK_FILE,
    },
    "browser-proxy": {
      destination: "/etc/caddy/Caddyfile",
      source: environment.CLEAN_PAY_BROWSER_CADDYFILE,
    },
  };
  if (Object.values(fixtureMounts).some(({ source }) => typeof source !== "string")) {
    throw new Error("Full-runtime mock Compose fixture source is missing.");
  }
  const migrationServices = new Set([
    "browser-db-observer", "db-grant-sync", "db-role-provision", "migration",
  ]);
  const services = Object.fromEntries(JOURNEY_COMPOSE_SERVICE_NAMES.map((serviceName) => {
    const fixture = fixtureMounts[serviceName];
    const volumes: Array<{
      read_only?: boolean;
      source: string;
      target: string;
      type: "bind" | "volume";
    }> = [];
    if (fixture) {
      volumes.push({
        read_only: true,
        source: fixture.source,
        target: fixture.destination,
        type: "bind",
      });
    }
    if (serviceName === "postgres") {
      volumes.push({
        source: "postgres-data",
        target: "/var/lib/postgresql/data",
        type: "volume",
      });
    }
    if (serviceName === "redis") {
      volumes.push({ source: "redis-data", target: "/data", type: "volume" });
    }
    const ports: Array<{
      host_ip: string;
      protocol: string;
      published: number;
      target: number;
    }> = [];
    const publication = serviceName === "app" ? contract.publications.app
      : serviceName === "browser-provider-mock" ? contract.publications.providerControl
        : serviceName === "browser-proxy" ? contract.publications.browserTls
          : undefined;
    if (publication) {
      const [hostIp, published] = publication.split(":");
      ports.push({
        host_ip: hostIp,
        protocol: "tcp",
        published: Number(published),
        target: serviceName === "app" ? 4000
          : serviceName === "browser-provider-mock" ? 3100 : 443,
      });
    }
    return [serviceName, {
      cap_drop: ["ALL"],
      command: fixture ? ["fixture", fixture.destination] : ["fixture", serviceName],
      image: migrationServices.has(serviceName) ? images.migration : images.application,
      networks: { default: null },
      ports,
      read_only: true,
      security_opt: ["no-new-privileges:true"],
      volumes,
    }];
  }));
  return {
    name: contract.project,
    networks: { default: { name: `${contract.project}_default` } },
    services,
    volumes: Object.fromEntries(JOURNEY_COMPOSE_VOLUME_NAMES.map((name) => [
      name,
      { name: `${contract.project}_${name}` },
    ])),
  };
}

function createFullMockRuntime(
  contract: ReturnType<typeof stackContract>,
  identities: MockImageIdentities,
  compose: ReturnType<typeof createFullMockComposeModel>,
) {
  const createdAt = new Date().toISOString();
  const containerIdsByService: Record<string, string> = {};
  const containersById: Record<string, ReturnType<typeof createFullMockContainer>> = {};
  const eventLinesByContainerId: Record<string, string> = {};
  const networkContainers: Record<string, { Name: string }> = {};
  for (const [index, serviceName] of JOURNEY_COMPOSE_SERVICE_NAMES.entries()) {
    const service = compose.services[serviceName] as Record<string, unknown> & {
      command: string[];
      image: string;
      ports: Array<{ host_ip: string; protocol: string; published: number; target: number }>;
      volumes: Array<{
        read_only?: boolean;
        source: string;
        target: string;
        type: "bind" | "volume";
      }>;
    };
    const identity = service.image === identities.migration.config
      ? identities.migration : identities.application;
    const imageRole = identity === identities.migration ? "migration" : "app";
    const containerId = sha256(`${contract.project}:container:${serviceName}`);
    containerIdsByService[serviceName] = containerId;
    const oneShot = JOURNEY_COMPOSE_ONE_SHOT_SERVICE_NAMES.includes(serviceName);
    const container = createFullMockContainer({
      containerId,
      contract,
      createdAt,
      identity,
      imageRole,
      oneShot,
      service,
      serviceName,
    });
    containersById[containerId] = container;
    if (oneShot) {
      const timeNano = BigInt(Date.now()) * 1_000_000n + BigInt(index * 10);
      eventLinesByContainerId[containerId] = [
        `${timeNano} create ${containerId}`,
        `${timeNano + 1n} start ${containerId}`,
        `${timeNano + 2n} die ${containerId}`,
      ].join("\n");
    } else {
      networkContainers[containerId] = { Name: `${contract.project}-${serviceName}-1` };
    }
  }
  const network = {
    Id: sha256(`${contract.project}:network:default`),
    Name: `${contract.project}_default`,
    Driver: "bridge",
    Internal: false,
    Attachable: false,
    Ingress: false,
    Containers: networkContainers,
    Labels: {
      "com.docker.compose.network": "default",
      "com.docker.compose.project": contract.project,
    },
  };
  const volumes = JOURNEY_COMPOSE_VOLUME_NAMES.map((name) => ({
    Name: `${contract.project}_${name}`,
    Driver: "local",
    Options: null,
    Labels: {
      "com.docker.compose.project": contract.project,
      "com.docker.compose.volume": name,
    },
  }));
  return {
    containerIdsByService,
    containersById,
    eventLinesByContainerId,
    network,
    volumes,
  };
}

function createFullMockContainer({
  containerId,
  contract,
  createdAt,
  identity,
  imageRole,
  oneShot,
  service,
  serviceName,
}: {
  containerId: string;
  contract: ReturnType<typeof stackContract>;
  createdAt: string;
  identity: MockImageIdentities["application"] | MockImageIdentities["migration"];
  imageRole: "app" | "migration";
  oneShot: boolean;
  service: {
    command: string[];
    image: string;
    ports: Array<{ host_ip: string; protocol: string; published: number; target: number }>;
    volumes: Array<{
      read_only?: boolean;
      source: string;
      target: string;
      type: "bind" | "volume";
    }>;
  };
  serviceName: string;
}) {
  const expectedState = JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES[
    serviceName as keyof typeof JOURNEY_COMPOSE_EXPECTED_SERVICE_STATES
  ];
  const ports = Object.fromEntries(service.ports.map((entry) => [
    `${entry.target}/${entry.protocol}`,
    [{ HostIp: entry.host_ip, HostPort: String(entry.published) }],
  ]));
  const state = oneShot ? {
    Dead: false,
    Error: "",
    ExitCode: 0,
    FinishedAt: createdAt,
    OOMKilled: false,
    Paused: false,
    Pid: 0,
    Restarting: false,
    Running: false,
    StartedAt: createdAt,
    Status: "exited",
  } : {
    ExitCode: 0,
    Health: expectedState === "running-healthy" ? { Status: "healthy" } : undefined,
    Running: true,
    Status: "running",
  };
  return {
    Id: containerId,
    Created: createdAt,
    Image: identity.config,
    Name: `/${contract.project}-${serviceName}-1`,
    RestartCount: 0,
    Config: {
      Cmd: service.command,
      Entrypoint: null,
      Env: ["PATH=/usr/local/bin"],
      Image: service.image,
      Labels: {
        "com.docker.compose.project": contract.project,
        "com.docker.compose.service": serviceName,
        "io.clean-pay.public-build-contract-sha256": contract.publicBuildContract.sha256,
        "io.clean-pay.public-build-contract-version": contract.publicBuildContract.version,
        "io.clean-pay.role": imageRole,
        "org.opencontainers.image.revision": contract.revision,
      },
      User: "",
      WorkingDir: "",
    },
    HostConfig: {
      AutoRemove: false,
      CapAdd: null,
      CapDrop: ["ALL"],
      DeviceRequests: [],
      Devices: [],
      Dns: [],
      DnsOptions: [],
      DnsSearch: [],
      ExtraHosts: [],
      GroupAdd: [],
      Init: null,
      Links: [],
      LogConfig: { Config: {}, Type: "json-file" },
      Memory: 0,
      NanoCpus: 0,
      NetworkMode: `${contract.project}_default`,
      OomKillDisable: false,
      PidMode: "",
      PidsLimit: 0,
      Privileged: false,
      ReadonlyRootfs: true,
      RestartPolicy: { MaximumRetryCount: 0, Name: "no" },
      SecurityOpt: ["no-new-privileges:true"],
      Sysctls: {},
      Tmpfs: {},
      UTSMode: "",
      UsernsMode: "",
    },
    Mounts: service.volumes.map((mount) => ({
      Destination: mount.target,
      Name: mount.type === "volume" ? `${contract.project}_${mount.source}` : undefined,
      RW: !mount.read_only,
      Source: mount.type === "bind" ? mount.source : `/mock-volume/${mount.source}`,
      Type: mount.type,
    })),
    NetworkSettings: {
      Networks: {
        [`${contract.project}_default`]: {
          Aliases: [`${contract.project}-${serviceName}-1`, serviceName],
        },
      },
      Ports: ports,
    },
    State: state,
  };
}
