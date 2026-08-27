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
  attestProviderOverlapStaticResponse,
  classifyProviderOverlapBrowserRequest,
  createProviderOverlapEventSeal,
  createProviderOverlapStaticAssetContract,
  extractProviderOverlapCssMediaReferences,
  finalizeProviderOverlapBrowserContract,
  finalizeProviderOverlapEventLifecycle,
  finalizeProviderOverlapHistoryContract,
  installProviderOverlapHistoryInstrumentation,
  readProviderOverlapStaticResponseEvidence,
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
const staticEotPath = "/_next/static/media/primeicons-123.eot";
const staticFontPath = "/_next/static/media/inter-123.woff2";
const staticSecondFontPath = "/_next/static/media/primeicons-123.woff2";
const staticImagePath = "/_next/static/media/brand-123.svg";
const staticTtfPath = "/_next/static/media/primeicons-123.ttf";
const staticWoffPath = "/_next/static/media/primeicons-123.woff";
const staticBodyByPath = Object.freeze({
  [staticJavascriptPath]: "self.__cleanPay = 'provider-overlap';\n",
  [staticStylesheetPath]: "@font-face{src:url(../../media/primeicons-123.eot);"
    + "src:url(../../media/primeicons-123.eot),url(../../media/inter-123.woff2),"
    + "url(../../media/primeicons-123.woff),url(../../media/primeicons-123.ttf),"
    + "url(../../media/brand-123.svg)}"
    + "@font-face{src:url(../../media/inter-123.woff2)}"
    + "@font-face{src:url(../../media/primeicons-123.woff2)}\n",
  [staticEotPath]: "synthetic-eot-body",
  [staticFontPath]: "synthetic-woff2-body",
  [staticSecondFontPath]: "synthetic-primeicons-woff2-body",
  [staticImagePath]: "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n",
  [staticTtfPath]: "synthetic-ttf-body",
  [staticWoffPath]: "synthetic-woff-body",
});
const staticInventoryByPath: Readonly<Record<string, string>> = Object.freeze({
  [staticJavascriptPath]: sha256(staticBodyByPath[staticJavascriptPath]),
  [staticStylesheetPath]: sha256(staticBodyByPath[staticStylesheetPath]),
  [staticEotPath]: sha256(staticBodyByPath[staticEotPath]),
  [staticFontPath]: sha256(staticBodyByPath[staticFontPath]),
  [staticSecondFontPath]: sha256(staticBodyByPath[staticSecondFontPath]),
  [staticImagePath]: sha256(staticBodyByPath[staticImagePath]),
  [staticTtfPath]: sha256(staticBodyByPath[staticTtfPath]),
  [staticWoffPath]: sha256(staticBodyByPath[staticWoffPath]),
});
const staticInventoryMetadataByPath: Readonly<Record<
string, { assetBytes: number; extension: string }
>> = Object.freeze({
  [staticJavascriptPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticJavascriptPath]), extension: "js",
  }),
  [staticStylesheetPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticStylesheetPath]), extension: "css",
  }),
  [staticEotPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticEotPath]), extension: "eot",
  }),
  [staticFontPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticFontPath]), extension: "woff2",
  }),
  [staticSecondFontPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticSecondFontPath]), extension: "woff2",
  }),
  [staticImagePath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticImagePath]), extension: "svg",
  }),
  [staticTtfPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticTtfPath]), extension: "ttf",
  }),
  [staticWoffPath]: Object.freeze({
    assetBytes: Buffer.byteLength(staticBodyByPath[staticWoffPath]), extension: "woff",
  }),
});
const staticRouteDeclaredPaths = Object.freeze([
  staticStylesheetPath, staticJavascriptPath,
].sort());
const staticDocumentRouteContracts = Object.freeze([
  "app-login-document", "app-profile-document", "app-cabinet-document",
].map((documentKey) => Object.freeze({
  documentKey,
  routeDeclaredPaths: staticRouteDeclaredPaths,
})));
const staticDocumentRouteLedger = staticDocumentRouteContracts.map(({
  documentKey, routeDeclaredPaths,
}) => ({
  documentKey,
  routeDeclaredPathSha256s: routeDeclaredPaths.map(sha256).sort(),
}));
const staticInventoryLedger = Object.entries(staticInventoryByPath).map(([
  servedPath, assetSha256,
]) => ({
  assetBytes: staticInventoryMetadataByPath[servedPath].assetBytes,
  assetSha256,
  extension: staticInventoryMetadataByPath[servedPath].extension,
  pathSha256: sha256(servedPath),
}))
  .sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
const staticAssetContract = Object.freeze({
  attestationSha256: "a".repeat(64),
  configDigest: `sha256:${"1".repeat(64)}`,
  documentRouteContracts: staticDocumentRouteContracts,
  imageDigest: `sha256:${"2".repeat(64)}`,
  inventoryByPath: staticInventoryByPath,
  inventoryMetadataByPath: staticInventoryMetadataByPath,
  inventoryLedgerContractSha256: sha256(JSON.stringify(staticInventoryLedger)),
  inventorySha256: "d".repeat(64),
  manifestDigest: `sha256:${"3".repeat(64)}`,
  routeDeclaredPaths: staticRouteDeclaredPaths,
  routeDeclaredPathContractSha256: sha256(JSON.stringify(staticDocumentRouteLedger)),
});
const staticLoadGraph = Object.freeze({
  cssMediaReferences: Object.freeze([
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticEotPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticEotPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticFontPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticFontPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticSecondFontPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticTtfPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticWoffPath }),
    Object.freeze({ sourcePath: staticStylesheetPath, targetPath: staticImagePath }),
  ]),
  responseDeclarationsByDocument: Object.freeze([
    "app-login-document", "app-profile-document", "app-cabinet-document",
  ].map((documentKey) => Object.freeze({
    documentKey,
    paths: Object.freeze([
      staticEotPath, staticFontPath, staticSecondFontPath, staticImagePath,
      staticJavascriptPath, staticStylesheetPath, staticTtfPath, staticWoffPath,
    ].sort()),
  }))),
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
    ["symmetric impossible drained event count", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        stack.navigation.eventLifecycle.drainedEventCount += 1;
      }
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
    ["symmetric extra canonical history event", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        stack.navigation.historyLedger.push(structuredClone(stack.navigation.historyLedger[3]));
        stack.navigation.historyCount += 1;
        stack.navigation.historyContractSha256 = sha256(JSON.stringify(
          stack.navigation.historyLedger,
        ));
      }
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
    ["symmetric fully rehashed duplicate static occurrence", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        const navigation = stack.navigation;
        navigation.staticRequestLedger.push(structuredClone(
          navigation.staticRequestLedger.at(-1),
        ));
        navigation.staticRequestCount += 1;
        navigation.staticRequestContractSha256 = sha256(JSON.stringify(
          navigation.staticRequestLedger,
        ));
        navigation.requestCount += 1;
        navigation.requestOrderLedger.push({ kind: "static", occurrence: 13 });
        navigation.requestOrderContractSha256 = sha256(JSON.stringify(
          navigation.requestOrderLedger,
        ));
      }
    }],
    ["symmetric static occurrence before its document generation", (value) => {
      for (const stack of [value.stacks.baseline, value.stacks.candidate]) {
        const order = stack.navigation.requestOrderLedger;
        const [profileStatic] = order.splice(12, 1);
        order.splice(11, 0, profileStatic);
        stack.navigation.requestOrderContractSha256 = sha256(JSON.stringify(order));
      }
    }],
    ["static response class differs from attested extension", (value) => {
      const navigation = value.stacks.candidate.navigation;
      const stylesheet = navigation.staticRequestLedger.find((entry: { contentType: string }) => (
        entry.contentType === "text/css"
      ));
      if (!stylesheet) throw new Error("Synthetic stylesheet fixture is missing.");
      stylesheet.class = "next-static-font";
      navigation.staticRequestContractSha256 = sha256(
        JSON.stringify(navigation.staticRequestLedger),
      );
      navigation.requestContractSha256 = sha256(JSON.stringify({
        version: 1,
        semanticLedger: navigation.semanticRequestLedger,
        staticClasses: [...new Set(navigation.staticRequestLedger.map((entry: {
          class: string;
        }) => entry.class))].sort(),
      }));
    }],
    ["static declaration class differs from attested extension", (value) => {
      const navigation = value.stacks.candidate.navigation;
      const declaration = navigation.staticLoadGraph.declaredPathLedger.find((entry: {
        class: string;
      }) => entry.class === "chunk");
      if (!declaration) throw new Error("Synthetic chunk declaration fixture is missing.");
      declaration.class = "media";
      navigation.staticLoadGraphContractSha256 = sha256(
        JSON.stringify(navigation.staticLoadGraph),
      );
    }],
    ["response-declared inventory chunk omitted from request closure", (value) => {
      const navigation = value.stacks.candidate.navigation;
      const pathSha256 = sha256("/_next/static/chunks/declared-but-omitted.js");
      navigation.staticLoadGraph.inventoryLedger.push({
        assetBytes: 128,
        assetSha256: "f".repeat(64),
        extension: "js",
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
  const loginDocument = browserClassification(
    "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile",
    { resourceType: "document", isNavigation: true, isMainFrame: true },
  );
  const telegramStart = browserClassification(
      "https://pay.ci.clean-pay.dev/auth/telegram/start?redirect_to=%2Fprofile"
        + "&turnstile_token=synthetic-turnstile-token%3Aauth_login%3Asynthetic-turnstile-1%3A1",
      { resourceType: "document", isNavigation: true, isMainFrame: true },
    );
  const oidcAuthorize = browserClassification(
      "https://oauth.telegram.org/auth?response_type=code&client_id=7654321098"
        + "&redirect_uri=https%3A%2F%2Fpay.ci.clean-pay.dev%2Fauth%2Ftelegram%2Fcallback"
        + `&scope=openid%20profile&state=${opaque}&nonce=${opaque}`
        + `&code_challenge=${opaque}&code_challenge_method=S256`,
      { resourceType: "document", isNavigation: true, isMainFrame: true },
    );
  const telegramCallback = browserClassification(
      `https://pay.ci.clean-pay.dev/auth/telegram/callback?code=${opaque}&state=${opaque}`,
      { resourceType: "document", isNavigation: true, isMainFrame: true },
    );
  const profileDocument = browserClassification("https://pay.ci.clean-pay.dev/profile", {
    resourceType: "document", isNavigation: true, isMainFrame: true,
  });
  const cabinetDocument = browserClassification("https://pay.ci.clean-pay.dev/cabinet", {
    resourceType: "document", isNavigation: true, isMainFrame: true,
  }, true);
  const staticClassifications = [
    browserClassification(`https://pay.ci.clean-pay.dev${staticJavascriptPath}`, {
      resourceType: "script",
    }),
    browserClassification(`https://pay.ci.clean-pay.dev${staticStylesheetPath}`, {
      resourceType: "stylesheet",
    }),
    browserClassification(`https://pay.ci.clean-pay.dev${staticFontPath}`, {
      resourceType: "font",
    }),
    browserClassification(`https://pay.ci.clean-pay.dev${staticSecondFontPath}`, {
      resourceType: "font",
    }),
  ];
  const turnstile = browserClassification(
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
      { resourceType: "script" },
    );
  const chatwootSdk = browserClassification(
    "https://chatwoot.browser.clean-pay.dev/packs/js/sdk.js",
    { resourceType: "script" },
  );
  const chatwootWidget = browserClassification(
      `https://chatwoot.browser.clean-pay.dev/widget?website_token=${"a".repeat(64)}`,
      { resourceType: "document", isNavigation: true },
    );
  expect(() => browserClassification(
    "https://pay.ci.clean-pay.dev/auth/telegram/start?redirect_to=%2Fprofile"
      + "&turnstile_token=synthetic-turnstile-token%3Alogin%3Asynthetic-turnstile-1%3A1",
    { resourceType: "document", isNavigation: true, isMainFrame: true },
  )).toThrow(/Turnstile token/);
  const requestRecord = (
    classification: ProviderBrowserClassification,
    documentKey: "app-login-document" | "app-profile-document" | "app-cabinet-document",
    responseStatus: number | null,
    responseContentType: string | null,
    redirectEdge: string | null = null,
  ) => ({
    classification,
    documentKey,
    redirectEdge,
    responseContentType,
    responseStatus,
    staticResponseBytes: classification.staticPath === null
      ? null
      : staticInventoryMetadataByPath[classification.staticPath].assetBytes,
    staticResponseSha256: classification.staticPath === null
      ? null
      : staticInventoryByPath[classification.staticPath],
  });
  const staticRecords = (documentKey: Parameters<typeof requestRecord>[1]) => (
    staticClassifications.map((classification) => requestRecord(
      classification,
      documentKey,
      200,
      classification.key === "next-static-js" ? "application/javascript"
        : classification.key === "next-static-css" ? "text/css" : "font/woff2",
    ))
  );
  const validRecords = [
    requestRecord(loginDocument, "app-login-document", 200, "text/html"),
    ...staticRecords("app-login-document"),
    requestRecord(turnstile, "app-login-document", 200, "application/javascript"),
    requestRecord(chatwootSdk, "app-login-document", 200, "application/javascript"),
    requestRecord(chatwootWidget, "app-login-document", 200, "text/html"),
    requestRecord(telegramStart, "app-login-document", 307, "application/octet-stream"),
    requestRecord(
      oidcAuthorize,
      "app-login-document",
      302,
      null,
      "app-telegram-start:307->telegram-oidc-authorize",
    ),
    requestRecord(
      telegramCallback,
      "app-login-document",
      307,
      "application/octet-stream",
      "telegram-oidc-authorize:302->app-telegram-callback",
    ),
    requestRecord(
      profileDocument,
      "app-profile-document",
      200,
      "text/html",
      "app-telegram-callback:307->app-profile-document",
    ),
    ...staticRecords("app-profile-document"),
    requestRecord(cabinetDocument, "app-cabinet-document", 200, "text/html"),
    ...staticRecords("app-cabinet-document"),
  ];
  const exactBrowserContract = finalizeProviderOverlapBrowserContract(validRecords, staticLoadGraph);
  expect(exactBrowserContract).toMatchObject({
    requestCount: validRecords.length,
    requestContractSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    staticRequestCount: 12,
  });
  expect(exactBrowserContract.requestOrderLedger).toHaveLength(validRecords.length);
  expect(exactBrowserContract.staticLoadGraph.documentLoadLedger).toHaveLength(3);
  expect(exactBrowserContract.staticLoadGraph.cssMediaReferenceLedger).toHaveLength(8);
  expect(() => finalizeProviderOverlapBrowserContract(validRecords, {
    ...staticLoadGraph,
    cssMediaReferences: staticLoadGraph.cssMediaReferences.slice(0, -1),
  })).toThrow(/CSS media fallback extension closure/);
  expect(() => finalizeProviderOverlapBrowserContract(validRecords, {
    ...staticLoadGraph,
    cssMediaReferences: [
      ...staticLoadGraph.cssMediaReferences,
      staticLoadGraph.cssMediaReferences[0],
    ],
  })).toThrow(/CSS media fallback extension closure/);
  const staticRecordIndexes = validRecords.flatMap((record, index) => (
    record.classification.staticPath === null ? [] : [index]
  ));
  for (const index of [staticRecordIndexes[2], staticRecordIndexes[6]]) {
    const tamperedStaticBody = JSON.parse(JSON.stringify(validRecords));
    tamperedStaticBody[index] = {
      ...tamperedStaticBody[index],
      classification: {
        ...tamperedStaticBody[index].classification,
        staticAssetSha256: "0".repeat(64),
      },
    };
    expect(() => finalizeProviderOverlapBrowserContract(
      tamperedStaticBody,
      staticLoadGraph,
    ), `static body ${index}`).toThrow(/attested image inventory/);
  }
  const tamperedObservedBody = structuredClone(validRecords);
  tamperedObservedBody[staticRecordIndexes[6]].staticResponseSha256 = "0".repeat(64);
  expect(() => finalizeProviderOverlapBrowserContract(
    tamperedObservedBody,
    staticLoadGraph,
  )).toThrow(/attested image inventory/);
  const missingObservedBody = structuredClone(validRecords);
  missingObservedBody[staticRecordIndexes[10]].staticResponseBytes = null;
  missingObservedBody[staticRecordIndexes[10]].staticResponseSha256 = null;
  expect(() => finalizeProviderOverlapBrowserContract(
    missingObservedBody,
    staticLoadGraph,
  )).toThrow(/attested image inventory/);
  const missingFontInventory = Object.fromEntries(Object.entries(
    staticAssetContract.inventoryByPath,
  ).filter(([servedPath]) => servedPath !== staticFontPath));
  const missingFontMetadata = Object.fromEntries(Object.entries(
    staticAssetContract.inventoryMetadataByPath,
  ).filter(([servedPath]) => servedPath !== staticFontPath));
  const missingFontLedger = staticInventoryLedgerFor(missingFontInventory, missingFontMetadata);
  const missingFontContract = {
    ...staticAssetContract,
    inventoryByPath: missingFontInventory,
    inventoryMetadataByPath: missingFontMetadata,
    inventoryLedgerContractSha256: sha256(JSON.stringify(missingFontLedger)),
  };
  expect(() => browserClassification(
    `https://pay.ci.clean-pay.dev${staticFontPath}`,
    { resourceType: "font" },
    false,
    missingFontContract as unknown as typeof staticAssetContract,
  )).toThrow(/absent from the attested production image inventory/);

  const extraImagePath = "/_next/static/media/unexpected.svg";
  const extraImageInventory = {
    ...staticAssetContract.inventoryByPath,
    [extraImagePath]: "f".repeat(64),
  };
  const extraImageMetadata = {
    ...staticAssetContract.inventoryMetadataByPath,
    [extraImagePath]: { assetBytes: 17, extension: "svg" },
  };
  const extraImageLedger = staticInventoryLedgerFor(extraImageInventory, extraImageMetadata);
  const extraImageContract = {
    ...staticAssetContract,
    inventoryByPath: extraImageInventory,
    inventoryMetadataByPath: extraImageMetadata,
    inventoryLedgerContractSha256: sha256(JSON.stringify(extraImageLedger)),
  };
  const extraImageRecords = structuredClone(validRecords);
  extraImageRecords.push({
    classification: browserClassification(
      `https://pay.ci.clean-pay.dev${extraImagePath}`,
      { resourceType: "image" },
      false,
      extraImageContract,
    ),
    documentKey: "app-cabinet-document",
    redirectEdge: null,
    responseContentType: "image/svg+xml",
    responseStatus: 200,
    staticResponseBytes: 17,
    staticResponseSha256: "f".repeat(64),
  });
  expect(() => finalizeProviderOverlapBrowserContract(extraImageRecords, {
    cssMediaReferences: staticLoadGraph.cssMediaReferences,
    responseDeclarationsByDocument: staticLoadGraph.responseDeclarationsByDocument,
    staticAssetContract: extraImageContract,
  })).toThrow(/negotiated media|static media declaration closure/);
  const repartitionedStaticRecords = structuredClone(validRecords);
  repartitionedStaticRecords.splice(
    staticRecordIndexes[0] + 1,
    0,
    structuredClone(validRecords[staticRecordIndexes[0]]),
  );
  expect(() => finalizeProviderOverlapBrowserContract(
    repartitionedStaticRecords,
    staticLoadGraph,
  )).toThrow();
  const missingProfileOccurrence = structuredClone(validRecords);
  missingProfileOccurrence.splice(staticRecordIndexes[4], 1);
  expect(() => finalizeProviderOverlapBrowserContract(
    missingProfileOccurrence,
    staticLoadGraph,
  )).toThrow(/app-profile-document static chunk load graph/);
  const movedProfileOccurrence = structuredClone(validRecords);
  movedProfileOccurrence[staticRecordIndexes[4]].documentKey = "app-cabinet-document";
  expect(() => finalizeProviderOverlapBrowserContract(
    movedProfileOccurrence,
    staticLoadGraph,
  )).toThrow(/exact static generation/);
  expect(browserClassification(
    `https://chatwoot.browser.clean-pay.dev/widget?website_token=${"a".repeat(64)}`
      + "&cw_conversation=synthetic-conversation",
    { resourceType: "document", isNavigation: true },
  ).key).toBe("chatwoot-widget-conversation-frame");
  const wrongContentType = structuredClone(validRecords);
  wrongContentType[staticRecordIndexes[0]].responseContentType = "text/html";
  expect(() => finalizeProviderOverlapBrowserContract(wrongContentType, staticLoadGraph)).toThrow();
  const orphanedRedirect = structuredClone(validRecords);
  orphanedRedirect.push({
    classification: browserClassification("https://pay.ci.clean-pay.dev/?_rsc=opaque-state_1", {
      resourceType: "fetch",
    }),
    documentKey: "app-cabinet-document",
    redirectEdge: null,
    responseContentType: "application/octet-stream",
    responseStatus: 307,
    staticResponseBytes: null,
    staticResponseSha256: null,
  });
  expect(() => finalizeProviderOverlapBrowserContract(orphanedRedirect, staticLoadGraph)).toThrow();

  const unreachableExistingChunk = "/_next/static/chunks/unused-existing.js";
  const expandedInventoryByPath = {
    ...staticAssetContract.inventoryByPath,
    [unreachableExistingChunk]: "e".repeat(64),
  };
  const expandedInventoryMetadata = {
    ...staticAssetContract.inventoryMetadataByPath,
    [unreachableExistingChunk]: { assetBytes: 19, extension: "js" },
  };
  const expandedInventoryLedger = staticInventoryLedgerFor(
    expandedInventoryByPath,
    expandedInventoryMetadata,
  );
  const expandedStaticContract = {
    ...staticAssetContract,
    inventoryByPath: expandedInventoryByPath,
    inventoryMetadataByPath: expandedInventoryMetadata,
    inventoryLedgerContractSha256: sha256(JSON.stringify(expandedInventoryLedger)),
  };
  const extraUnique = structuredClone(validRecords);
  extraUnique.push({
    classification: browserClassification(
      `https://pay.ci.clean-pay.dev${unreachableExistingChunk}`,
      { resourceType: "script" },
      false,
      expandedStaticContract,
    ),
    documentKey: "app-cabinet-document",
    redirectEdge: null,
    responseContentType: "application/javascript",
    responseStatus: 200,
    staticResponseBytes: 19,
    staticResponseSha256: "e".repeat(64),
  });
  expect(() => finalizeProviderOverlapBrowserContract(extraUnique, {
    cssMediaReferences: staticLoadGraph.cssMediaReferences,
    responseDeclarationsByDocument: staticLoadGraph.responseDeclarationsByDocument,
    staticAssetContract: expandedStaticContract,
  })).toThrow();

  const checkpoint = {
    frameId: "main-frame-1",
    historyLength: 4,
    kind: "checkpoint",
    loaderId: "profile-loader-1",
    url: "https://pay.ci.clean-pay.dev/profile",
  };
  const documentNavigation = {
    frameId: "main-frame-1",
    kind: "document-navigation",
    loaderId: "cabinet-loader-2",
    navigationType: "Navigation",
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const replaceState = {
    afterNextAppRouterState: true,
    argumentUrl: "https://pay.ci.clean-pay.dev/cabinet",
    beforeHistoryLength: 5,
    beforeNextAppRouterState: false,
    beforeUrl: "https://pay.ci.clean-pay.dev/cabinet",
    historyLength: 5,
    kind: "replaceState",
    operationSequence: 1,
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const sameDocumentNavigation = {
    frameId: "main-frame-1",
    kind: "same-document-navigation",
    navigationType: "historyApi",
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const finalFrame = {
    frameId: "main-frame-1",
    loaderId: "cabinet-loader-2",
    url: "https://pay.ci.clean-pay.dev/cabinet",
  };
  const history = finalizeProviderOverlapHistoryContract([
    checkpoint, documentNavigation, replaceState, sameDocumentNavigation,
  ], finalFrame);
  const reversedDelivery = finalizeProviderOverlapHistoryContract([
    checkpoint, documentNavigation, sameDocumentNavigation, replaceState,
  ], finalFrame);
  expect(history.historyContractSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(reversedDelivery).toEqual(history);
  const historyMutations: Array<[
    string,
    (
      records: Array<Record<string, boolean | number | string>>,
      barrier: Record<string, string>,
    ) => void,
  ]> = [
    ["missing signal", (records) => { records.pop(); }],
    ["duplicate signal", (records) => { records[3] = structuredClone(records[2]); }],
    ["reused loader", (records) => { records[1].loaderId = records[0].loaderId; }],
    ["BFCache", (records) => { records[1].navigationType = "BackForwardCacheRestore"; }],
    ["query mutation", (records) => {
      records[2].url = "https://pay.ci.clean-pay.dev/cabinet?transient=1";
    }],
    ["state mismatch", (records) => { records[2].afterNextAppRouterState = false; }],
    ["history length", (records) => { records[2].historyLength = 6; }],
    ["cabinet document replaced history entry", (records) => {
      records[2].beforeHistoryLength = 4;
      records[2].historyLength = 4;
    }],
    ["cabinet document decremented history entry", (records) => {
      records[2].beforeHistoryLength = 3;
      records[2].historyLength = 3;
    }],
    ["frame mismatch", (records) => { records[3].frameId = "other-frame"; }],
    ["fragment navigation", (records) => { records[3].navigationType = "fragment"; }],
    ["final loader", (_records, barrier) => { barrier.loaderId = "other-loader"; }],
    ["extra raw field", (records) => { records[2].extra = true; }],
  ];
  for (const [label, mutate] of historyMutations) {
    const records = structuredClone([
      checkpoint, documentNavigation, replaceState, sameDocumentNavigation,
    ]);
    const barrier = structuredClone(finalFrame);
    mutate(records, barrier);
    expect(() => finalizeProviderOverlapHistoryContract(records, barrier), label).toThrow();
  }

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
    from: { classification: telegramStart, url: "https://pay.ci.clean-pay.dev/auth/telegram/start" },
    to: { classification: oidcAuthorize, url: "https://oauth.telegram.org/auth" },
    status: 308,
    location: "https://oauth.telegram.org/auth",
  })).toThrow();
  expect(() => assertProviderOverlapRedirect({
    from: { classification: telegramStart, url: "https://pay.ci.clean-pay.dev/auth/telegram/start" },
    to: { classification: oidcAuthorize, url: "https://oauth.telegram.org/auth" },
    status: 307,
    location: "https://oauth.telegram.org/other",
  })).toThrow();

  const scriptSource = await readFile(path.resolve(__dirname, "prove-provider-overlap.mjs"), "utf8");
  expect(scriptSource).toContain('await context.routeWebSocket("**/*"');
  expect(scriptSource).toContain('context.on("serviceworker"');
  expect(scriptSource).toContain('serviceWorkers: "block"');
  expect(scriptSource).toContain("createProviderOverlapEventSeal(1_024)");
  expect(installProviderOverlapHistoryInstrumentation.toString()).toContain(
    "historyBindingRejected = true",
  );
  expect(installProviderOverlapHistoryInstrumentation.toString()).not.toContain(
    "binding.finally",
  );
});

test("binds every completed static response to independent attested bytes and MIME", async () => {
  for (const [servedPath, resourceType, responseContentType] of [
    [staticJavascriptPath, "script", "application/javascript"],
    [staticStylesheetPath, "stylesheet", "text/css"],
    [staticFontPath, "font", "font/woff2"],
    [staticImagePath, "image", "image/svg+xml"],
  ] as const) {
    const classification = browserClassification(
      `https://pay.ci.clean-pay.dev${servedPath}`,
      { resourceType },
    );
    const body = Buffer.from(staticBodyByPath[servedPath], "utf8");
    expect(attestProviderOverlapStaticResponse({
      body,
      classification,
      responseContentType,
      responseStatus: 200,
    }, staticAssetContract)).toEqual({
      staticResponseBytes: body.byteLength,
      staticResponseSha256: staticInventoryByPath[servedPath],
    });
    const lifecycle: string[] = [];
    await expect(readProviderOverlapStaticResponseEvidence({
      classification,
      response: {
        body: async () => {
          lifecycle.push("body");
          return body;
        },
        finished: async () => {
          lifecycle.push("finished");
          return null;
        },
        status: () => 200,
      },
      responseContentType,
    }, staticAssetContract)).resolves.toMatchObject({
      observation: { staticResponseSha256: staticInventoryByPath[servedPath] },
    });
    expect(lifecycle).toEqual(["finished", "body"]);

    const tampered = Buffer.from(body);
    tampered[0] ^= 1;
    expect(() => attestProviderOverlapStaticResponse({
      body: tampered,
      classification,
      responseContentType,
      responseStatus: 200,
    }, staticAssetContract)).toThrow(/response bytes/);
  }

  const scriptClassification = browserClassification(
    `https://pay.ci.clean-pay.dev${staticJavascriptPath}`,
    { resourceType: "script" },
  );
  expect(() => attestProviderOverlapStaticResponse({
    body: undefined as unknown as Uint8Array,
    classification: scriptClassification,
    responseContentType: "application/javascript",
    responseStatus: 200,
  }, staticAssetContract)).toThrow(/incomplete/);
  await expect(readProviderOverlapStaticResponseEvidence({
    classification: scriptClassification,
    response: null,
    responseContentType: "application/javascript",
  }, staticAssetContract)).rejects.toThrow(/no readable response/);
  const oversized = Object.create(Uint8Array.prototype) as Uint8Array;
  Object.defineProperty(oversized, "byteLength", { value: 128 * 1024 * 1024 + 1 });
  expect(() => attestProviderOverlapStaticResponse({
    body: oversized,
    classification: scriptClassification,
    responseContentType: "application/javascript",
    responseStatus: 200,
  }, staticAssetContract)).toThrow(/byte length/);
});

test("keeps rejected history bindings sticky across early and close-adjacent drains", async () => {
  type InstrumentationGlobal = typeof globalThis & {
    __cleanPayProviderHistory: (record: unknown) => Promise<void>;
    __cleanPayProviderHistoryDrain?: () => Promise<void>;
    addEventListener: (name: string, listener: () => void) => void;
    history: {
      length: number;
      pushState: (state: unknown, unused: string, url?: string | URL | null) => void;
      replaceState: (state: unknown, unused: string, url?: string | URL | null) => void;
      state: unknown;
    };
    location: { href: string };
  };
  const runScenario = async (rejectBeforeDrain: boolean) => {
    const target = globalThis as InstrumentationGlobal;
    const names = [
      "__cleanPayProviderHistory", "__cleanPayProviderHistoryDrain",
      "addEventListener", "history", "location",
    ] as const;
    const descriptors = Object.fromEntries(names.map((name) => [
      name,
      Object.getOwnPropertyDescriptor(target, name),
    ]));
    let rejectBinding: ((reason?: unknown) => void) | undefined;
    const location = { href: "https://pay.ci.clean-pay.dev/cabinet" };
    const history = {
      length: 5,
      state: null as unknown,
      pushState(state: unknown, _unused: string, url?: string | URL | null) {
        this.state = state;
        this.length += 1;
        if (url !== undefined && url !== null) location.href = new URL(url, location.href).href;
      },
      replaceState(state: unknown, _unused: string, url?: string | URL | null) {
        this.state = state;
        if (url !== undefined && url !== null) location.href = new URL(url, location.href).href;
      },
    };
    try {
      Object.defineProperties(target, {
        __cleanPayProviderHistory: {
          configurable: true,
          value: () => new Promise<void>((_resolve, reject) => { rejectBinding = reject; }),
        },
        addEventListener: { configurable: true, value: () => undefined },
        history: { configurable: true, value: history },
        location: { configurable: true, value: location },
      });
      installProviderOverlapHistoryInstrumentation();
      history.replaceState({
        __NA: true,
        __PRIVATE_NEXTJS_INTERNALS_TREE: {},
      }, "", location.href);
      if (!rejectBinding || !target.__cleanPayProviderHistoryDrain) {
        throw new Error("Synthetic history binding fixture was not installed.");
      }
      if (rejectBeforeDrain) {
        rejectBinding(new Error("synthetic-early-binding-rejection"));
        await Promise.resolve();
      }
      const draining = target.__cleanPayProviderHistoryDrain();
      if (!rejectBeforeDrain) rejectBinding(new Error("synthetic-close-adjacent-rejection"));
      await expect(draining).rejects.toThrow(/rejected an event/);
    } finally {
      for (const name of names) {
        const descriptor = descriptors[name];
        if (descriptor) Object.defineProperty(target, name, descriptor);
        else delete target[name];
      }
    }
  };

  await runScenario(true);
  await runScenario(false);
});

test("derives the exact bounded static response contract from attested OCI inventory bytes", () => {
  const attestation = {
    attestationSha256: staticAssetContract.attestationSha256,
    source: {
      configDigest: staticAssetContract.configDigest,
      imageDigest: staticAssetContract.imageDigest,
      manifestDigest: staticAssetContract.manifestDigest,
    },
    inventory: {
      inventorySha256: staticAssetContract.inventorySha256,
      staticChunks: Object.entries(staticInventoryByPath).map(([servedPath, digest]) => ({
        imagePath: `/app/.next${servedPath.slice("/_next".length)}`,
        servedPath,
        sha256: digest,
        size: staticInventoryMetadataByPath[servedPath].assetBytes,
      })),
      clientReferences: ["/cabinet/page", "/login/page", "/profile/page"].map((route) => ({
        route,
        declaredStaticChunks: [...staticRouteDeclaredPaths],
      })),
    },
  };
  expect(createProviderOverlapStaticAssetContract(attestation)).toMatchObject({
    inventoryByPath: staticInventoryByPath,
    inventoryMetadataByPath: staticInventoryMetadataByPath,
    routeDeclaredPaths: staticRouteDeclaredPaths,
    documentRouteContracts: staticDocumentRouteContracts,
  });
  const missingSize = structuredClone(attestation);
  delete (missingSize.inventory.staticChunks[0] as Partial<{
    size: number;
  }>).size;
  expect(() => createProviderOverlapStaticAssetContract(missingSize))
    .toThrow(/static asset inventory/);
});

test("canonicalizes all current relative CSS media references without broadening URLs", () => {
  const sourcePath = "/_next/static/chunks/current-media.css";
  const references = [
    "primeicons.current.eot",
    "primeicons.current.eot",
    "primeicons.current.woff2",
    "primeicons.current.woff",
    "primeicons.current.ttf",
    "primeicons.current.svg",
    "Inter-roman.current.woff2",
    "Inter-italic.current.woff2",
  ];
  const cssBody = Buffer.from(references.map((filename) => (
    `url(../media/${filename})`
  )).join(","), "utf8");
  const inventoryByPath: Record<string, string> = {
    ...staticAssetContract.inventoryByPath,
    [sourcePath]: sha256(cssBody.toString("utf8")),
  };
  const inventoryMetadataByPath: Record<string, { assetBytes: number; extension: string }> = {
    ...staticAssetContract.inventoryMetadataByPath,
    [sourcePath]: { assetBytes: cssBody.byteLength, extension: "css" },
  };
  for (const filename of new Set(references)) {
    const servedPath = `/_next/static/media/${filename}`;
    inventoryByPath[servedPath] = sha256(`synthetic:${filename}`);
    inventoryMetadataByPath[servedPath] = {
      assetBytes: Buffer.byteLength(`synthetic:${filename}`),
      extension: filename.slice(filename.lastIndexOf(".") + 1),
    };
  }
  const contract = {
    ...staticAssetContract,
    inventoryByPath,
    inventoryMetadataByPath,
    inventoryLedgerContractSha256: sha256(JSON.stringify(staticInventoryLedgerFor(
      inventoryByPath,
      inventoryMetadataByPath,
    ))),
  };
  const observed = extractProviderOverlapCssMediaReferences(cssBody, sourcePath, contract);
  expect(observed).toHaveLength(8);
  expect(observed.map(({ targetPath }) => targetPath)).toEqual(
    references.map((filename) => `/_next/static/media/${filename}`),
  );
  for (const unsafe of [
    "url(data:font/woff2;base64,AAAA)",
    "url(https://example.invalid/font.woff2)",
    "url(../../../../media/primeicons.current.woff2)",
    "url(/_next/static/media/primeicons.current.woff2)",
  ]) {
    expect(() => extractProviderOverlapCssMediaReferences(
      Buffer.from(unsafe, "utf8"),
      sourcePath,
      contract,
    ), unsafe).toThrow(/noncanonical|escaped/);
  }
  const missing = structuredClone(contract);
  delete missing.inventoryByPath["/_next/static/media/primeicons.current.ttf"];
  delete missing.inventoryMetadataByPath["/_next/static/media/primeicons.current.ttf"];
  missing.inventoryLedgerContractSha256 = sha256(JSON.stringify(staticInventoryLedgerFor(
    missing.inventoryByPath,
    missing.inventoryMetadataByPath,
  )));
  expect(() => extractProviderOverlapCssMediaReferences(cssBody, sourcePath, missing))
    .toThrow(/escaped its attested image inventory/);
});

test("seals browser events only after a bounded quiet drain and rejects late events", async () => {
  const fullContractSeal = createProviderOverlapEventSeal();
  for (let index = 0; index < 772; index += 1) fullContractSeal.record();
  await expect(fullContractSeal.drainAndSeal(() => true, {
    pollMs: 1,
    quietMs: 1,
    timeoutMs: 100,
  })).resolves.toEqual({ eventCount: 772, status: "drained-and-sealed" });
  expect(fullContractSeal.assertClean()).toEqual({
    eventCount: 772,
    lateEventCount: 0,
    status: "sealed-clean",
  });

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

  for (const source of [
    "console", "history", "request", "response", "pageerror", "provider", "load",
  ]) {
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
    requestCount: { type: "integer", minimum: 18, maximum: 256 },
    requestContractSha256: { $ref: "#/$defs/sha256" },
    requestOrderContractSha256: { $ref: "#/$defs/sha256" },
    historyContractSha256: { $ref: "#/$defs/sha256" },
    staticLoadGraph: { $ref: "#/$defs/staticLoadGraph" },
    staticRequestContractSha256: { $ref: "#/$defs/sha256" },
    staticRequestCount: { type: "integer", minimum: 9, maximum: 256 },
    staticRequestLedger: {
      type: "array",
      items: { $ref: "#/$defs/staticRequestEntry" },
      minItems: 9,
      maxItems: 256,
    },
    unexpectedConsoleCount: { const: 0 },
    unexpectedPageErrorCount: { const: 0 },
  });
  expect(schema.$defs.navigation.required).toEqual(expect.arrayContaining([
    "historyLedger",
    "requestOrderContractSha256",
    "requestOrderLedger",
    "staticLoadGraph",
    "staticRequestLedger",
  ]));
  expect(schema.$defs.navigation.properties.historyLedger).toMatchObject({
    minItems: 4,
    maxItems: 4,
  });
  expect(schema.$defs.navigation.properties.historyLedger.prefixItems).toHaveLength(4);
  expect(schema.$defs.navigation.properties.requestOrderLedger.items).toMatchObject({
    additionalProperties: false,
    required: ["kind", "occurrence"],
  });
  expect(schema.$defs.navigation.additionalProperties).toBe(false);
  expect(schema.$defs.eventLifecycle.properties.drainedEventCount).toEqual({
    type: "integer",
    minimum: 58,
    maximum: 772,
  });
  expect(schema.$defs.staticRequestEntry.additionalProperties).toBe(false);
  expect(schema.$defs.staticRequestEntry.required).toEqual([
    "assetBytes", "assetSha256", "class", "contentType", "documentKey", "pathSha256",
  ]);
  expect(schema.$defs.staticRequestEntry.properties.assetBytes)
    .toEqual({ type: "integer", minimum: 1, maximum: 128 * 1024 * 1024 });
  expect(schema.$defs.navigation.properties.staticRequestLedger.uniqueItems).toBeUndefined();
  expect(schema.$defs.staticLoadGraph.additionalProperties).toBe(false);
  expect(schema.$defs.staticLoadGraph.properties.cssMediaReferenceLedger).toMatchObject({
    type: "array",
    minItems: 8,
    maxItems: 8,
    uniqueItems: true,
  });
  expect(schema.$defs.staticLoadGraph.properties.inventoryLedger.items.properties.extension.enum)
    .toEqual(["css", "eot", "ico", "js", "png", "svg", "ttf", "woff", "woff2"]);
  expect(schema.$defs.staticLoadGraph.properties.declaredPathLedger).toMatchObject({
    type: "array",
    minItems: 1,
    maxItems: 256,
    uniqueItems: true,
  });
  expect(schema.$defs.staticLoadGraph.properties.documentLoadLedger)
    .toMatchObject({ type: "array", minItems: 3, maxItems: 3 });
  expect(schema.$defs.staticLoadGraph.properties.routeExpectedChunkRequestLedger)
    .toBeUndefined();
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
  expect(scriptSource).toContain("await writeJourneySanitizedOutput(outputPath, bytes)");
  expect(stackOrchestrator).toContain('fileSystem.open(target, "wx", 0o600)');
  expect(stackOrchestrator).toContain("await enforceJourneySyntheticPrivateMode(target, 0o600");
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
    {
      frameRelation: "same-main-frame",
      kind: "document-navigation",
      loaderRelation: "changed",
      location: "app-cabinet",
      navigationType: "Navigation",
    },
    {
      historyLengthRelation: "unchanged",
      kind: "replaceState",
      location: "app-cabinet",
      operationSequence: 1,
      stateTransition: "unmarked-to-next-app-router",
      urlRelation: "unchanged",
    },
    {
      frameRelation: "same-main-frame",
      kind: "same-document-navigation",
      location: "app-cabinet",
      navigationType: "historyApi",
      pairedOperationSequence: 1,
    },
  ];
  const staticDocuments = [
    "app-login-document", "app-profile-document", "app-cabinet-document",
  ] as const;
  const staticLedger = staticDocuments.flatMap((documentKey) => ([
    { assetBytes: 101, assetSha256: "1".repeat(64), class: "next-static-js", contentType: "application/javascript", documentKey, pathSha256: sha256(staticJavascriptPath) },
    { assetBytes: 102, assetSha256: "2".repeat(64), class: "next-static-css", contentType: "text/css", documentKey, pathSha256: sha256(staticStylesheetPath) },
    { assetBytes: 103, assetSha256: "3".repeat(64), class: "next-static-font", contentType: "font/woff2", documentKey, pathSha256: sha256(staticFontPath) },
    { assetBytes: 108, assetSha256: "8".repeat(64), class: "next-static-font", contentType: "font/woff2", documentKey, pathSha256: sha256(staticSecondFontPath) },
  ]));
  const staticAssetAttestationSha256 = baseline ? "b".repeat(64) : "c".repeat(64);
  const inventoryLedger = [
    { assetBytes: 101, assetSha256: "1".repeat(64), extension: "js", pathSha256: sha256(staticJavascriptPath) },
    { assetBytes: 102, assetSha256: "2".repeat(64), extension: "css", pathSha256: sha256(staticStylesheetPath) },
    { assetBytes: 103, assetSha256: "3".repeat(64), extension: "woff2", pathSha256: sha256(staticFontPath) },
    { assetBytes: 108, assetSha256: "8".repeat(64), extension: "woff2", pathSha256: sha256(staticSecondFontPath) },
    { assetBytes: 104, assetSha256: "4".repeat(64), extension: "svg", pathSha256: sha256(staticImagePath) },
    { assetBytes: 105, assetSha256: "5".repeat(64), extension: "eot", pathSha256: sha256(staticEotPath) },
    { assetBytes: 106, assetSha256: "6".repeat(64), extension: "ttf", pathSha256: sha256(staticTtfPath) },
    { assetBytes: 107, assetSha256: "a".repeat(64), extension: "woff", pathSha256: sha256(staticWoffPath) },
  ].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
  const routeDeclaredPathSha256s = [
    sha256(staticJavascriptPath), sha256(staticStylesheetPath),
  ].sort();
  const documentLoadLedger = staticDocuments.map((documentKey) => ({
    documentKey,
    expectedChunkPathSha256s: [...routeDeclaredPathSha256s].sort(),
    expectedMediaPathSha256s: [
      sha256(staticFontPath), sha256(staticSecondFontPath),
    ].sort(),
    routeDeclaredPathSha256s: [...routeDeclaredPathSha256s].sort(),
  }));
  const staticLoadGraph = {
    assetAttestationSha256: staticAssetAttestationSha256,
    assetInventorySha256: "7".repeat(64),
    cssMediaReferenceLedger: [
      { occurrence: 1, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticEotPath) },
      { occurrence: 2, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticEotPath) },
      { occurrence: 3, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticFontPath) },
      { occurrence: 4, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticFontPath) },
      { occurrence: 5, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticSecondFontPath) },
      { occurrence: 6, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticTtfPath) },
      { occurrence: 7, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticWoffPath) },
      { occurrence: 8, sourcePathSha256: sha256(staticStylesheetPath), targetPathSha256: sha256(staticImagePath) },
    ],
    declaredPathLedger: [
      { class: "media", pathSha256: sha256(staticEotPath) },
      { class: "media", pathSha256: sha256(staticFontPath) },
      { class: "media", pathSha256: sha256(staticSecondFontPath) },
      { class: "media", pathSha256: sha256(staticImagePath) },
      { class: "media", pathSha256: sha256(staticTtfPath) },
      { class: "media", pathSha256: sha256(staticWoffPath) },
      { class: "chunk", pathSha256: sha256(staticJavascriptPath) },
      { class: "chunk", pathSha256: sha256(staticStylesheetPath) },
    ].sort((left, right) => left.pathSha256.localeCompare(right.pathSha256)),
    declaredPathSha256s: [
      sha256(staticEotPath), sha256(staticFontPath), sha256(staticSecondFontPath), sha256(staticImagePath),
      sha256(staticTtfPath), sha256(staticWoffPath),
      sha256(staticJavascriptPath), sha256(staticStylesheetPath),
    ].sort(),
    documentLoadLedger,
    expectedChunkPathSha256s: [sha256(staticJavascriptPath), sha256(staticStylesheetPath)],
    inventoryLedger,
    inventoryLedgerContractSha256: sha256(JSON.stringify(inventoryLedger)),
    routeDeclaredPathContractSha256: sha256(JSON.stringify(documentLoadLedger.map((entry) => ({
      documentKey: entry.documentKey,
      routeDeclaredPathSha256s: entry.routeDeclaredPathSha256s,
    })))),
    routeDeclaredPathSha256s,
  };
  const semanticRequestLedger = [
    semantic("app-login-document", 200, "text/html"),
    semantic("turnstile-widget-script", 200, "application/javascript"),
    semantic("chatwoot-sdk-script", 200, "application/javascript"),
    semantic("chatwoot-widget-frame", 200, "text/html"),
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
  ];
  const requestOrderLedger = [
    { kind: "semantic", occurrence: 1 },
    ...[1, 2, 3, 4].map((occurrence) => ({ kind: "static", occurrence })),
    ...[2, 3, 4, 5, 6, 7, 8].map((occurrence) => ({ kind: "semantic", occurrence })),
    ...[5, 6, 7, 8].map((occurrence) => ({ kind: "static", occurrence })),
    { kind: "semantic", occurrence: 9 },
    ...[9, 10, 11, 12].map((occurrence) => ({ kind: "static", occurrence })),
  ];
  const requestContractSha256 = sha256(JSON.stringify({
    version: 1,
    semanticLedger: semanticRequestLedger,
    staticClasses: [
      "next-static-css", "next-static-font", "next-static-js",
    ],
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
        drainedEventCount: 67,
        lateEventCount: 0,
        status: "sealed-clean",
      },
      finalUrl: "https://pay.ci.clean-pay.dev/cabinet",
      headingVisible: true,
      requestCount: semanticRequestLedger.length + staticLedger.length,
      requestContractSha256,
      requestOrderContractSha256: sha256(JSON.stringify(requestOrderLedger)),
      requestOrderLedger,
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

function staticInventoryLedgerFor(
  inventoryByPath: Record<string, string>,
  metadataByPath: Record<string, { assetBytes: number; extension: string }>,
) {
  return Object.entries(inventoryByPath).map(([servedPath, assetSha256]) => ({
    assetBytes: metadataByPath[servedPath].assetBytes,
    assetSha256,
    extension: metadataByPath[servedPath].extension,
    pathSha256: sha256(servedPath),
  })).sort((left, right) => left.pathSha256.localeCompare(right.pathSha256));
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
  assetContract = staticAssetContract,
): ProviderBrowserClassification {
  const classification: unknown = classifyProviderOverlapBrowserRequest({
    url,
    method: overrides.method ?? "GET",
    resourceType: overrides.resourceType ?? "fetch",
    isNavigation: overrides.isNavigation ?? false,
    isMainFrame: overrides.isMainFrame ?? false,
  }, { cabinetDocumentAllowed, staticAssetContract: assetContract });
  return classification as ProviderBrowserClassification;
}

type ProviderBrowserClassification = Readonly<{
  disposition: string;
  expectedStatuses: readonly number[];
  key: string;
  navigation: boolean;
  staticAssetSha256: string | null;
  staticPath: string | null;
}>;

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
