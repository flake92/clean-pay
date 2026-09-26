import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { Page } from "@playwright/test";

import {
  BEHAVIORAL_BASELINE_COMMIT,
  CANONICAL_BASELINE_ID,
  DETERMINISTIC_V4_BASELINE_ID,
  FORENSIC_BASELINE_ID,
  PARALLEL_BASELINE_ID,
  SERIAL_BASELINE_ID,
  SOFTWARE_BASELINE_ID,
  baselineUpdateRequested,
  browserBaselineRoot,
  browserDeterministicV4BaselineRoot,
  browserForensicBaselineRoot,
  browserParallelBaselineRoot,
  browserSerialBaselineRoot,
  browserSoftwareBaselineRoot,
  reconcileBaselineArtifact,
  sha256,
} from "./baseline-policy";
import {
  TURNSTILE_STUB_CONTRACT,
  TURNSTILE_STUB_SHA256,
} from "./turnstile-stub";
import { DETERMINISTIC_CHROMIUM_LAUNCH_ARGS } from "./render-policy";

const BASELINE_TREE = "6647fc51c61018ba46aae95da21e534434028fbe";
const PRISTINE_ARCHIVE_SHA256 =
  "8f424f5d4839d2aa421849bb2c7f8f48420ee675";
const SOURCE_IMAGE_TAG = "clean-pay:baseline-f5cb6f543d85-prod-pristine";
const SOURCE_IMAGE_DIGEST =
  "sha256:e0640e36c6221ba8f2dc174ebbea3961fda59f6320aad56d2f071b1c51a75ffc";
const PLAYWRIGHT_VERSION = "1.62.1";
const COMPARISON_POLICY_V4_FILE = "comparison-policy-v4.json";
const COMPARISON_POLICY_V4_SHA256 =
  "426aed73e59731cbd740814920650294bd09b1bf4ae2aaa2432fac465a1e1b49";
const COMPARISON_POLICY_V5_FILE = "comparison-policy-v5.json";
const COMPARISON_POLICY_V5_SHA256 =
  "43981de5e6f5076f7c3e6ac1e69a1744ceb4cd0562800f82ea2f739cb140d896";
const SERIAL_METADATA_SHA256 =
  "9ee2e9c85582a37f54f6a2d1e43548a81064e2aba7e63a4a85c01ed3340d0c4c";
const SOFTWARE_METADATA_SHA256 =
  "18eb5c0f86973987689af327721f1deb90da17ff0ef4286c7315847346efeb66";
const SOFTWARE_INVENTORY_SHA256 =
  "d314eb8d3133176d9415bfac9b962f0532fd89106e7a5910bfe793c599960e87";
const DETERMINISTIC_V4_METADATA_SHA256 =
  "40cfa07e476fe6b04c5ad6b2389ceb54a65115e9f241129ef44759af9672e200";
const DETERMINISTIC_V4_INVENTORY_SHA256 =
  "481c2bf5f0b2ab95c653c2ca372a90af44c8fe90edb1b275a6829f506ec71c76";
const SOFTWARE_RENDERER_ARGS = ["--disable-gpu"] as const;
const DETERMINISTIC_V4_RENDERER_ARGS = [
  "--disable-gpu",
  "--disable-gpu-compositing",
  "--disable-gpu-rasterization",
  "--disable-skia-runtime-opts",
  "--disable-lcd-text",
  "--disable-font-subpixel-positioning",
  "--font-render-hinting=none",
] as const;
const EXPECTED_RAW_ARTIFACT_COUNT = 126;
export const PROVENANCE_CORRECTION_FILE = "provenance-correction-v1.json";
const RECOMPUTED_PRISTINE_ARCHIVE_SHA256 =
  "6ccdccdd162ede951850759392a72376792988080307b4e29ae0cffef2397a03";
const RECOMPUTED_PRISTINE_ARCHIVE_BYTES = 7_587_840;

let reconciliation: Promise<void> | undefined;

export function reconcileBrowserBaselineProvenance(page: Page) {
  if (baselineUpdateRequested()) return reconcileProvenance(page);
  reconciliation ??= reconcileProvenance(page);
  return reconciliation;
}

async function reconcileProvenance(page: Page) {
  const forensicSet = await hashArtifactSet(browserForensicBaselineRoot);
  const parallelSet = await hashArtifactSet(browserParallelBaselineRoot);
  const serialRawSet = await hashArtifactSet(
    browserSerialBaselineRoot,
    [
      "metadata.json",
      COMPARISON_POLICY_V4_FILE,
      COMPARISON_POLICY_V5_FILE,
      "supersession-v3.json",
    ],
  );
  const softwareRawSet = await hashArtifactSet(
    browserSoftwareBaselineRoot,
    ["metadata.json", "artifact-inventory.json", "supersession-v4.json"],
  );
  const deterministicV4RawSet = await hashArtifactSet(
    browserDeterministicV4BaselineRoot,
    ["metadata.json", "artifact-inventory.json", "supersession-v5.json"],
  );
  const canonicalRawSet = await hashArtifactSet(
    browserBaselineRoot,
    ["metadata.json", "artifact-inventory.json", PROVENANCE_CORRECTION_FILE],
  );
  const browser = page.context().browser();
  if (!browser) throw new Error("Browser provenance is unavailable.");
  const executablePath = browser.browserType().executablePath();
  const revision = /[\\/]chromium-(\d+)[\\/]/.exec(executablePath)?.[1];
  if (!revision) {
    throw new Error("Pinned Chromium revision is absent from its executable path.");
  }
  const runtime = {
    engine: "chromium",
    browserVersion: browser.version(),
    playwrightVersion: PLAYWRIGHT_VERSION,
    chromiumRevision: revision,
  };
  const source = {
    commit: BEHAVIORAL_BASELINE_COMMIT,
    tree: BASELINE_TREE,
    pristineArchiveSha256: PRISTINE_ARCHIVE_SHA256,
    productionImage: {
      tag: SOURCE_IMAGE_TAG,
      digest: SOURCE_IMAGE_DIGEST,
    },
  };
  const forensicMetadata = jsonBytes({
    schemaVersion: 1,
    baselineId: FORENSIC_BASELINE_ID,
    status: "invalid_for_gate",
    retainedAs: "immutable_forensic_capture",
    reason: [
      "external Turnstile timing produced multiple DOM and screenshot states",
      "automatic Next RSC prefetch and response-backed resource teardown were nondeterministic",
    ],
    source,
    runtime,
    artifactSet: forensicSet,
    canonicalReplacement: PARALLEL_BASELINE_ID,
  });
  const parallelMetadata = jsonBytes({
    schemaVersion: 1,
    baselineId: PARALLEL_BASELINE_ID,
    status: "canonical",
    purpose: "candidate behavioral equality gate",
    source,
    runtime,
    supersedes: {
      baselineId: FORENSIC_BASELINE_ID,
      status: "invalid_for_gate",
      artifactSet: forensicSet,
    },
    deterministicDependencies: {
      turnstile: {
        contract: TURNSTILE_STUB_CONTRACT,
        sourceSha256: TURNSTILE_STUB_SHA256,
      },
    },
    comparison: {
      rawArtifactsPreserved: true,
      projectionVersion: 1,
      exactExclusions: [
        "network requests whose scope is exactly external",
        "observed expected console diagnostics with a canonical external origin",
        "non-Server-Action GET fetches with exact next-router-prefetch=1 and rsc=1 digests",
      ],
      exactNormalization: [
        "net::ERR_ABORTED on a non-navigation application GET resource with an existing response",
        "retained request indexes and their redirect/Server Action references after exact exclusions",
      ],
    },
  });
  const parallelSupersession = jsonBytes({
    schemaVersion: 1,
    baselineId: PARALLEL_BASELINE_ID,
    status: "invalid_for_gate",
    retainedAs: "immutable_parallel_capture",
    reason: [
      "parallel Chromium GPU raster varied 60 color channels by at most 2 values",
      "parallel initial capture admitted timing-dependent static-route request state",
    ],
    source,
    runtime,
    artifactSet: parallelSet,
    canonicalReplacement: SERIAL_BASELINE_ID,
  });
  const serialMetadata = jsonBytes({
    schemaVersion: 1,
    baselineId: SERIAL_BASELINE_ID,
    status: "canonical",
    purpose: "candidate behavioral equality gate",
    source,
    runtime,
    captureExecution: {
      workers: 1,
      fullyParallel: false,
      reason: "deterministic Chromium raster and static-resource scheduling",
    },
    supersedes: [
      {
        baselineId: FORENSIC_BASELINE_ID,
        status: "invalid_for_gate",
        artifactSet: forensicSet,
      },
      {
        baselineId: PARALLEL_BASELINE_ID,
        status: "invalid_for_gate",
        artifactSet: parallelSet,
      },
    ],
    deterministicDependencies: {
      turnstile: {
        contract: TURNSTILE_STUB_CONTRACT,
        sourceSha256: TURNSTILE_STUB_SHA256,
      },
    },
    comparison: {
      rawArtifactsPreserved: true,
      projectionVersion: 2,
      exactExclusions: [
        "network requests whose scope is exactly external",
        "observed expected console diagnostics with a canonical external origin",
        "non-Server-Action GET fetches with exact next-router-prefetch=1 and rsc=1 digests",
        "exact static PWA Next JS chunk records whose 200-vs-csp transport race is covered by the immutable CSP sidecar",
      ],
      exactNormalization: [
        "net::ERR_ABORTED on a non-navigation application GET resource with an existing response",
        "retained request indexes and their redirect/Server Action references after exact exclusions",
      ],
      staticPwaCspSidecar: {
        routes: ["/install", "/offline"],
        blockedChunkCount: 12,
        blockedInlineCount: 2,
        totalCount: 14,
        equality: "exact kind, count, order, template, and redacted location",
      },
    },
  });
  const comparisonPolicy = jsonBytes({
    schemaVersion: 1,
    baselineId: SERIAL_BASELINE_ID,
    status: "active",
    policyVersion: 4,
    supersedesEmbeddedProjectionVersion: 2,
    reason: [
      "preserve the immutable v2 raw capture while documenting exact post-capture comparison rules",
      "make approved accessibility-only candidate semantics explicit without changing baseline evidence",
    ],
    source,
    rawArtifactSet: serialRawSet,
    invariants: {
      rawArtifactsPreserved: true,
      pngEquality: "byte-exact in the normal unfocused state",
      stableJsonFields: "exact unless named below",
      serverActions: "count, order, identifier, payload, and effects remain exact",
      focusVisibleException: "only the exact skip link may become visible after keyboard focus",
    },
    networkProjection: {
      exactExclusions: [
        "scope=external request records",
        "observed expected diagnostics with an exact canonical external origin",
        "non-navigation application GET fetch records with no Server Action and exact next-router-prefetch=1 plus rsc=1 digests",
        "GET same-origin non-navigation non-action non-RSC /_next/static/chunks/*.js records on requested /install or /offline only when the immutable CSP sidecar contract matches",
      ],
      exactNormalization: [
        "the known sha256 net::ERR_ABORTED failure on a response-backed non-navigation application GET resource",
        "sort values only within existing successful same-origin /_next/static/media/[A-Za-z0-9._-]+.woff2 font positions by pathname, then deterministically reindex",
        "retained request indexes and exact redirect or Server Action references after exclusions",
      ],
    },
    candidateSemanticAllowlist: [
      {
        change: "skip-link and main target",
        path: "html > body > div[:nth-of-type(n)] > a",
        exactContract: [
          "parent class layout-wrapper layout-static p-ripple-disabled",
          "a.skip-link[href=<exact final route>#<fragment>] with exact Russian text",
          "main.layout-main direct child of .layout-main-container gains only id=main-content and tabindex=-1",
          "offscreen computed style, interactive record, and exact ARIA URL block are projected only when all signatures match",
        ],
      },
      {
        change: "cabinet heading levels",
        requestedPath: "/cabinet",
        exactContract: [
          "six named card headings only; devices/payments retain their exact ids and aria-labelledby parents",
          "h5 becomes h2.text-xl",
          "newly selected h2 computed-style record is projected only with the complete 20px/500/24px visual contract and 24px box height",
        ],
      },
      {
        change: "three decorative logo alternatives",
        source: "/clean-pay-logo.png",
        exactContract: [
          "auth 68x68 .clean-auth-logo under .text-center.mb-4",
          "topbar 40x40 direct child of a.layout-topbar-logo",
          "footer 14x14 .mr-2 direct child of footer.layout-footer.flex.align-items-center",
          "only the prior Clean Pay alternative is projected to the candidate empty alternative",
        ],
      },
      {
        change: "passkey delete accessible names",
        requestedPath: "/link-account",
        exactContract: [
          "button is a direct child of .passkey-list-item and contains .pi.pi-trash",
          "only Russian baseline label or Russian name-plus-positive-index label is projected",
          "ARIA snapshot counts must equal the exact DOM target count",
        ],
      },
      {
        change: "PrimeReact Russian ARIA locale",
        exactContract: [
          "only elements with data-pc-* or p-* component signatures",
          "only the exact PrimeReact English/Russian static labels and bounded dynamic OTP/page/slide/star grammars",
          "ARIA snapshot label counts must equal the exact DOM target counts",
        ],
      },
    ],
  });
  const comparisonPolicyV5 = jsonBytes({
    schemaVersion: 1,
    baselineId: SERIAL_BASELINE_ID,
    status: "active",
    policyVersion: 5,
    carriesForward: {
      file: COMPARISON_POLICY_V4_FILE,
      sha256: COMPARISON_POLICY_V4_SHA256,
      policyVersion: 4,
    },
    reason: [
      "two independent serial read-only runs exposed rare Chromium raster readback variance of at most two channel values",
      "stabilize screenshot acquisition without pixel tolerance, normalization, or baseline replacement",
    ],
    source,
    rawArtifactSet: serialRawSet,
    screenshotAcquisition: {
      timing: "three immediate captures after the existing load, fonts.ready, double-rAF, and network-idle wait",
      count: 3,
      acceptance: "at least two PNGs must be fully byte-identical",
      selectedBytes: "the unchanged bytes of the byte-identical majority",
      failure: "three byte-different PNGs fail the test before baseline reconciliation",
      forbidden: [
        "pixel tolerance",
        "channel normalization",
        "perceptual matching",
        "baseline-aware selection",
        "baseline rewriting",
      ],
    },
    evidence: [
      {
        project: "chromium-1440x900",
        route: "protected-payment",
        changedChannels: 28,
        maxChannelDelta: 1,
        bounds: { minX: 384, minY: 778, maxX: 386, maxY: 786 },
      },
      {
        project: "chromium-390x844",
        route: "protected-cabinet",
        changedChannels: 115,
        maxChannelDelta: 2,
        bounds: { minX: 12, minY: 87, maxX: 377, maxY: 756 },
      },
    ],
  });
  const serialSupersession = jsonBytes({
    schemaVersion: 1,
    baselineId: SERIAL_BASELINE_ID,
    status: "invalid_for_gate",
    retainedAs: "immutable_serial_hardware_raster_capture",
    reason: [
      "serial read-only runs still produced cross-process Skia raster variance while DOM, styles, ARIA, routes, state, and projected network remained equal",
      "a three-shot byte-majority proved the variance can remain internally stable within one process and therefore cannot establish cross-process PNG identity",
    ],
    source,
    runtime,
    artifactSet: serialRawSet,
    immutableFiles: {
      metadataSha256: SERIAL_METADATA_SHA256,
      comparisonPolicyV4Sha256: COMPARISON_POLICY_V4_SHA256,
      comparisonPolicyV5Sha256: COMPARISON_POLICY_V5_SHA256,
    },
    sanitizedEvidence: [
      {
        project: "chromium-1440x900",
        route: "protected-payment",
        changedChannels: 28,
        maxChannelDelta: 1,
        bounds: { minX: 384, minY: 778, maxX: 386, maxY: 786 },
      },
      {
        project: "chromium-390x844",
        route: "protected-cabinet",
        changedChannels: 115,
        maxChannelDelta: 2,
        bounds: { minX: 12, minY: 87, maxX: 377, maxY: 756 },
      },
      {
        project: "chromium-1440x900",
        route: "login",
        byteIdenticalWithinProcess: "3/3",
        changedChannelsAgainstSerialCapture: 53,
        maxChannelDelta: 1,
      },
    ],
    canonicalReplacement: SOFTWARE_BASELINE_ID,
  });
  const priorSoftwareMetadata = jsonBytes({
    schemaVersion: 1,
    baselineId: SOFTWARE_BASELINE_ID,
    status: "canonical",
    purpose: "candidate behavioral equality gate",
    source,
    runtime,
    captureExecution: {
      workers: 1,
      fullyParallel: false,
      launchArgs: SOFTWARE_RENDERER_ARGS,
      rendererPolicy: "software raster; exact PNG bytes only",
      screenshotAcquisition: {
        count: 3,
        acceptance: "byte-identical majority of at least two",
        allDifferent: "fail closed",
      },
    },
    supersedes: {
      baselineId: SERIAL_BASELINE_ID,
      status: "invalid_for_gate",
      artifactSet: serialRawSet,
      metadataSha256: SERIAL_METADATA_SHA256,
      policySha256: [
        COMPARISON_POLICY_V4_SHA256,
        COMPARISON_POLICY_V5_SHA256,
      ],
    },
    deterministicDependencies: {
      turnstile: {
        contract: TURNSTILE_STUB_CONTRACT,
        sourceSha256: TURNSTILE_STUB_SHA256,
      },
    },
    comparison: {
      rawArtifactsPreserved: true,
      policyVersion: 5,
      carriedForwardFrom: [
        `${SERIAL_BASELINE_ID}/${COMPARISON_POLICY_V4_FILE}`,
        `${SERIAL_BASELINE_ID}/${COMPARISON_POLICY_V5_FILE}`,
      ],
      pngEquality: "byte-exact normal-state PNG",
      semanticAllowlist: "only the exact candidate accessibility contracts recorded in policy v4",
      screenshotStability: "only the byte-identical majority contract recorded in policy v5",
    },
    expectedCapture: {
      projects: ["chromium-390x844", "chromium-768x1024", "chromium-1440x900"],
      routesPerProject: 14,
      rawArtifactsPerRoute: [
        "characterization.json",
        "console.json",
        "viewport.png",
      ],
      expectedRawArtifactCount: 126,
    },
  });
  const priorSoftwareInventory = jsonBytes({
    schemaVersion: 1,
    baselineId: SOFTWARE_BASELINE_ID,
    status: "immutable_canonical_artifact_inventory",
    source,
    runtime,
    renderer: {
      launchArgs: SOFTWARE_RENDERER_ARGS,
      screenshotAcceptance: "byte-identical majority of at least two of three PNGs",
    },
    artifactSet: softwareRawSet,
  });
  const softwareSupersession = jsonBytes({
    schemaVersion: 1,
    baselineId: SOFTWARE_BASELINE_ID,
    status: "invalid_for_gate",
    retainedAs: "immutable_single_flag_software_capture",
    reason: [
      "--disable-gpu alone did not eliminate cross-process font and Skia raster variance",
      "the byte-identical majority remained internally stable within each failing process, so no PNG tolerance or normalization is justified",
    ],
    source,
    runtime,
    artifactSet: softwareRawSet,
    immutableFiles: {
      metadataSha256: SOFTWARE_METADATA_SHA256,
      artifactInventorySha256: SOFTWARE_INVENTORY_SHA256,
    },
    sanitizedReadOnlyEvidence: [
      {
        project: "chromium-768x1024",
        routes: ["protected-cabinet", "protected-profile"],
        expectedPngSha256: "dec783392fe4be448ad8dabed9c7fa5b62f5096094e78827a332d2c6fde570f5",
        observedPngSha256: "8ff3ca0e38a27a88ec7e2949a6883cd71c4f0e824f442fc0eb72bd7aa613475f",
      },
      {
        project: "chromium-1440x900",
        routes: ["protected-passkey-setup"],
        expectedPngSha256: "05f933b14befeb9567984236508da0ec1998ba2a32a433b2570d54243893b8c2",
        observedPngSha256: "5ba38281b5943b9f7c2a9bba52e561dc062f1fc62c1b0e0aa29b2684293dc983",
      },
    ],
    canonicalReplacement: DETERMINISTIC_V4_BASELINE_ID,
  });
  const deterministicV4Metadata = jsonBytes({
    schemaVersion: 1,
    baselineId: DETERMINISTIC_V4_BASELINE_ID,
    status: "canonical",
    purpose: "candidate behavioral equality gate",
    source,
    runtime,
    captureExecution: {
      workers: 1,
      fullyParallel: false,
      launchArgs: DETERMINISTIC_V4_RENDERER_ARGS,
      rendererPolicy: "software raster plus deterministic text raster; exact PNG bytes only",
      screenshotAcquisition: {
        count: 3,
        acceptance: "byte-identical majority of at least two",
        allDifferent: "fail closed",
      },
    },
    preCaptureProbe: {
      independentCliRuns: 12,
      chromiumProcesses: 36,
      uniquePngHashesPerViewport: 1,
      hashes: {
        "chromium-390x844": "61a60e477a248da65d9f0b6d4f01b867d9e1c63471c52b7be2c50f1b77dc7031",
        "chromium-768x1024": "57651acfbc72c6ba6d7bd1db876e2b3f67d6a67bdb21aff43ac8a1cbcc236918",
        "chromium-1440x900": "11ca971282d7ca9dbdae888b1b7659de3859d9208fd0b97414b2e7c9e6982d5f",
      },
    },
    supersedes: {
      baselineId: SOFTWARE_BASELINE_ID,
      status: "invalid_for_gate",
      artifactSet: softwareRawSet,
      metadataSha256: SOFTWARE_METADATA_SHA256,
      artifactInventorySha256: SOFTWARE_INVENTORY_SHA256,
    },
    deterministicDependencies: {
      turnstile: {
        contract: TURNSTILE_STUB_CONTRACT,
        sourceSha256: TURNSTILE_STUB_SHA256,
      },
    },
    comparison: {
      rawArtifactsPreserved: true,
      policyVersion: 5,
      carriedForwardFrom: [
        `${SERIAL_BASELINE_ID}/${COMPARISON_POLICY_V4_FILE}`,
        `${SERIAL_BASELINE_ID}/${COMPARISON_POLICY_V5_FILE}`,
      ],
      pngEquality: "byte-exact normal-state PNG",
      semanticAllowlist: "only the exact candidate accessibility contracts recorded in policy v4",
      screenshotStability: "only the byte-identical majority contract recorded in policy v5",
    },
    expectedCapture: {
      projects: ["chromium-390x844", "chromium-768x1024", "chromium-1440x900"],
      routesPerProject: 14,
      rawArtifactsPerRoute: [
        "characterization.json",
        "console.json",
        "viewport.png",
      ],
      expectedRawArtifactCount: 126,
    },
  });
  const deterministicV4Inventory = jsonBytes({
    schemaVersion: 1,
    baselineId: DETERMINISTIC_V4_BASELINE_ID,
    status: "immutable_canonical_artifact_inventory",
    source,
    runtime,
    renderer: {
      launchArgs: DETERMINISTIC_V4_RENDERER_ARGS,
      screenshotAcceptance: "byte-identical majority of at least two of three PNGs",
    },
    artifactSet: deterministicV4RawSet,
  });
  const deterministicV4Supersession = jsonBytes({
    schemaVersion: 1,
    baselineId: DETERMINISTIC_V4_BASELINE_ID,
    status: "invalid_for_gate",
    retainedAs: "immutable_seven_flag_renderer_capture",
    reason: [
      "a second independent full read-only pass produced cross-process Skia antialias variance with the exact seven-flag renderer",
      "DOM, bounding boxes, computed styles, ARIA, route, browser state, and projected network remained byte-exact; no pixel tolerance, masking, or CSS injection is permitted",
      "the variance is confined to out-of-process rasterization and is removed by the exact additional --disable-oop-rasterization launch flag",
    ],
    source,
    runtime,
    artifactSet: deterministicV4RawSet,
    immutableFiles: {
      metadataSha256: DETERMINISTIC_V4_METADATA_SHA256,
      artifactInventorySha256: DETERMINISTIC_V4_INVENTORY_SHA256,
    },
    sanitizedReadOnlyEvidence: {
      fullPass: { passed: 106, failed: 2, total: 108 },
      sharedRedirectScreen: {
        project: "chromium-768x1024",
        routes: ["login", "protected-payment"],
        expectedPngSha256: "57651acfbc72c6ba6d7bd1db876e2b3f67d6a67bdb21aff43ac8a1cbcc236918",
        observedPngSha256: "6e34d524e71c12c7a61c78349aea12aa9e10af79e71112f82336c8b044cb6df0",
        changedPixels: 33,
        totalPixels: 786432,
        changedChannels: 60,
        maxChannelDelta: 2,
        deltaHistogram: { "1": 58, "2": 2 },
        bounds: { minX: 48, minY: 840, maxX: 719, maxY: 848 },
        differingManifestPaths: ["$.screenshot.sha256"],
      },
    },
    rendererProbe: {
      selectedAdditionalFlag: "--disable-oop-rasterization",
      independentChromiumProcesses: {
        "chromium-390x844": 12,
        "chromium-768x1024": 24,
        "chromium-1440x900": 12,
      },
      uniquePngHashesPerViewport: 1,
      hashes: {
        "chromium-390x844": "61a60e477a248da65d9f0b6d4f01b867d9e1c63471c52b7be2c50f1b77dc7031",
        "chromium-768x1024": "57651acfbc72c6ba6d7bd1db876e2b3f67d6a67bdb21aff43ac8a1cbcc236918",
        "chromium-1440x900": "11ca971282d7ca9dbdae888b1b7659de3859d9208fd0b97414b2e7c9e6982d5f",
      },
      rejectedControl: {
        additionalFlag: "--num-raster-threads=1",
        project: "chromium-768x1024",
        processDistribution: [
          { sha256: "57651acfbc72c6ba6d7bd1db876e2b3f67d6a67bdb21aff43ac8a1cbcc236918", count: 6 },
          { sha256: "6e34d524e71c12c7a61c78349aea12aa9e10af79e71112f82336c8b044cb6df0", count: 2 },
        ],
      },
    },
    canonicalReplacement: CANONICAL_BASELINE_ID,
  });
  const canonicalMetadata = jsonBytes({
    schemaVersion: 1,
    baselineId: CANONICAL_BASELINE_ID,
    status: "canonical",
    purpose: "candidate behavioral equality gate",
    source,
    runtime,
    captureExecution: {
      workers: 1,
      fullyParallel: false,
      launchArgs: DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
      rendererPolicy: "software in-process raster plus deterministic text raster; exact PNG bytes only",
      screenshotAcquisition: {
        count: 3,
        acceptance: "byte-identical majority of at least two",
        allDifferent: "fail closed",
      },
    },
    preCaptureProbe: {
      totalIndependentChromiumProcesses: 48,
      independentChromiumProcesses: {
        "chromium-390x844": 12,
        "chromium-768x1024": 24,
        "chromium-1440x900": 12,
      },
      uniquePngHashesPerViewport: 1,
      hashes: {
        "chromium-390x844": "61a60e477a248da65d9f0b6d4f01b867d9e1c63471c52b7be2c50f1b77dc7031",
        "chromium-768x1024": "57651acfbc72c6ba6d7bd1db876e2b3f67d6a67bdb21aff43ac8a1cbcc236918",
        "chromium-1440x900": "11ca971282d7ca9dbdae888b1b7659de3859d9208fd0b97414b2e7c9e6982d5f",
      },
    },
    supersedes: {
      baselineId: DETERMINISTIC_V4_BASELINE_ID,
      status: "invalid_for_gate",
      artifactSet: deterministicV4RawSet,
      metadataSha256: DETERMINISTIC_V4_METADATA_SHA256,
      artifactInventorySha256: DETERMINISTIC_V4_INVENTORY_SHA256,
    },
    deterministicDependencies: {
      turnstile: {
        contract: TURNSTILE_STUB_CONTRACT,
        sourceSha256: TURNSTILE_STUB_SHA256,
      },
    },
    comparison: {
      rawArtifactsPreserved: true,
      policyVersion: 5,
      carriedForwardFrom: [
        `${SERIAL_BASELINE_ID}/${COMPARISON_POLICY_V4_FILE}`,
        `${SERIAL_BASELINE_ID}/${COMPARISON_POLICY_V5_FILE}`,
      ],
      pngEquality: "byte-exact normal-state PNG",
      semanticAllowlist: "only the exact candidate accessibility contracts recorded in policy v4",
      screenshotStability: "only the byte-identical majority contract recorded in policy v5",
    },
    expectedCapture: {
      projects: ["chromium-390x844", "chromium-768x1024", "chromium-1440x900"],
      routesPerProject: 14,
      rawArtifactsPerRoute: [
        "characterization.json",
        "console.json",
        "viewport.png",
      ],
      expectedRawArtifactCount: EXPECTED_RAW_ARTIFACT_COUNT,
    },
  });
  const canonicalInventory = jsonBytes({
    schemaVersion: 1,
    baselineId: CANONICAL_BASELINE_ID,
    status: "immutable_canonical_artifact_inventory",
    source,
    runtime,
    renderer: {
      launchArgs: DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
      screenshotAcceptance: "byte-identical majority of at least two of three PNGs",
    },
    artifactSet: canonicalRawSet,
  });
  const provenanceCorrection = jsonBytes(browserProvenanceCorrectionEvidence());

  await Promise.all([
    reconcileBaselineArtifact({
      baselineFile: path.join(browserForensicBaselineRoot, "metadata.json"),
      actual: forensicMetadata,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserParallelBaselineRoot, "metadata.json"),
      actual: parallelMetadata,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserParallelBaselineRoot, "supersession.json"),
      actual: parallelSupersession,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSerialBaselineRoot, "metadata.json"),
      actual: serialMetadata,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSerialBaselineRoot, COMPARISON_POLICY_V4_FILE),
      actual: comparisonPolicy,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSerialBaselineRoot, COMPARISON_POLICY_V5_FILE),
      actual: comparisonPolicyV5,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSerialBaselineRoot, "supersession-v3.json"),
      actual: serialSupersession,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSoftwareBaselineRoot, "metadata.json"),
      actual: priorSoftwareMetadata,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSoftwareBaselineRoot, "artifact-inventory.json"),
      actual: priorSoftwareInventory,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserSoftwareBaselineRoot, "supersession-v4.json"),
      actual: softwareSupersession,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserDeterministicV4BaselineRoot, "metadata.json"),
      actual: deterministicV4Metadata,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserDeterministicV4BaselineRoot, "artifact-inventory.json"),
      actual: deterministicV4Inventory,
    }),
  ]);

  if (canonicalRawSet.artifactCount !== EXPECTED_RAW_ARTIFACT_COUNT) {
    if (baselineUpdateRequested()) return;
    throw new Error(
      `Canonical browser baseline ${CANONICAL_BASELINE_ID} is incomplete: `
      + `expected ${EXPECTED_RAW_ARTIFACT_COUNT} raw artifacts, found `
      + `${canonicalRawSet.artifactCount}.`,
    );
  }

  await Promise.all([
    reconcileBaselineArtifact({
      baselineFile: path.join(
        browserDeterministicV4BaselineRoot,
        "supersession-v5.json",
      ),
      actual: deterministicV4Supersession,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserBaselineRoot, "metadata.json"),
      actual: canonicalMetadata,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserBaselineRoot, "artifact-inventory.json"),
      actual: canonicalInventory,
    }),
    reconcileBaselineArtifact({
      baselineFile: path.join(browserBaselineRoot, PROVENANCE_CORRECTION_FILE),
      actual: provenanceCorrection,
    }),
  ]);
}

export function browserProvenanceCorrectionEvidence() {
  return {
    schemaVersion: 1,
    baselineId: CANONICAL_BASELINE_ID,
    status: "additive_provenance_correction",
    immutableBaselineFilesChanged: false,
    legacyForensicRecord: {
      file: "metadata.json",
      field: "source.pristineArchiveSha256",
      retainedValue: PRISTINE_ARCHIVE_SHA256,
      verification: "unverified_legacy_value",
      classification: "40-hex Git-like value; not a SHA-256 digest",
    },
    recomputation: {
      command: [
        "git",
        "archive",
        "--format=tar",
        BEHAVIORAL_BASELINE_COMMIT,
      ],
      archiveFormat: "git archive tar stream",
      bytes: RECOMPUTED_PRISTINE_ARCHIVE_BYTES,
      sha256: RECOMPUTED_PRISTINE_ARCHIVE_SHA256,
      repeatedResult: "byte-identical",
    },
    sourceIdentity: {
      commit: BEHAVIORAL_BASELINE_COMMIT,
      tree: BASELINE_TREE,
      productionImage: {
        tag: SOURCE_IMAGE_TAG,
        digest: SOURCE_IMAGE_DIGEST,
      },
    },
    inventoryContract: {
      rawArtifactCount: EXPECTED_RAW_ARTIFACT_COUNT,
      correctionSidecarExcludedFromRawAggregate: true,
      rawAggregateRemains:
        "bf449337e7222adc093f9adb7c1b3d7f2c122af74720bf1e1dfacb34fb69f4c3",
    },
  };
}

async function hashArtifactSet(
  root: string,
  excludedRelativePaths = ["metadata.json", "supersession.json"],
) {
  const excluded = new Set(excludedRelativePaths);
  const files = (await listFiles(root))
    .filter((file) => !excluded.has(path.relative(root, file)))
    .sort();
  const entries = await Promise.all(files.map(async (file) => {
    const contents = await readFile(file);
    return {
      path: path.relative(root, file).replaceAll(path.sep, "/"),
      bytes: contents.byteLength,
      sha256: sha256(contents),
    };
  }));
  const inventory = entries
    .map((entry) => `${entry.path}\0${entry.bytes}\0${entry.sha256}\n`)
    .join("");
  return {
    artifactCount: entries.length,
    aggregateSha256: sha256(inventory),
    aggregateFormat: "sorted path\\0bytes\\0sha256\\n",
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const resolved = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(resolved) : [resolved];
  }));
  return files.flat();
}

function jsonBytes(value: unknown) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}
