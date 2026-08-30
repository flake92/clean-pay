import { mkdir, writeFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";

import { BEHAVIORAL_BASELINE_COMMIT } from "./baseline-policy";
import {
  assertStaticCspSidecarContract,
  consoleBaselineEvidence,
  registerBaselineReconciliation,
  staticCspConsoleSidecarEvidence,
} from "./console-policy";
import { projectCharacterizationManifestBytesForComparison } from "./comparison-projection";
import type {
  CharacterizationPagePairQuorum,
  CharacterizationPageQuorum,
} from "./fixtures";
import { navigationChain, recordNetwork } from "./network-recorder";
import {
  browserStorage,
  canonicalDom,
  interactiveState,
  sanitizeAriaUrls,
  selectedComputedStyles,
} from "./page-characterization";
import {
  requireExactProcessBytesAgreement,
  selectIndependentProcessCharacterizationPairQuorum,
  selectIndependentProcessCharacterizationQuorum,
} from "./process-quorum";
import {
  captureByteIdenticalTerminalScreenshot,
  createSerializedPairTerminalScreenshotCapture,
} from "./screenshot-majority";
import {
  PUBLIC_OVERLAP_CAPTURE_POLICY,
  PUBLIC_OVERLAP_PROJECTS,
  PUBLIC_OVERLAP_ROUTES,
  type PreparedCaptureOwnership,
  type PublicOverlapRoute,
  type PublicOverlapRole,
  readPreparedCaptureOwnership,
  requirePublicOverlapEnvironment,
  requirePublicOverlapPairEnvironment,
  sha256,
  writeImmutableCaptureArtifact,
} from "./public-overlap-evidence";
import {
  canonicalizeUrl,
  digestValue,
  requireBrowserBaseUrl,
  sanitizeStorageKey,
  shortDigest,
} from "./redaction";

export async function capturePublicOverlapCharacterization(options: {
  pages: CharacterizationPageQuorum;
  route: PublicOverlapRoute;
  testInfo: TestInfo;
  validateNavigation: (finalUrl: URL) => void;
}) {
  const { pages, route, testInfo, validateNavigation } = options;
  assertExactCaptureCase(testInfo.project.name, route);
  const environment = requirePublicOverlapEnvironment();
  const ownership = await readPreparedCaptureOwnership({
    bindingSha256: environment.bindingSha256,
    captureId: environment.captureId,
    ownershipSha256: environment.ownershipSha256,
    role: environment.role,
  });
  const baseUrl = requireBrowserBaseUrl();
  if (baseUrl.origin !== environment.applicationOrigin) {
    throw new Error("Public overlap browser origin changed after config validation.");
  }
  const applicationOrigin = baseUrl.origin;
  const samples: Awaited<ReturnType<typeof captureSample>>[] = [];

  for (const [processIndex, guardedPage] of pages.entries()) {
    const sample = await captureSample({
      applicationOrigin,
      baseUrl,
      page: guardedPage.page,
      replayGuard: guardedPage.replayGuard,
      route,
      testInfo,
    });
    samples.push(sample);
    await persistRawProcessSample(processIndex, sample, testInfo);
    assertReadOnlySample(sample);
    validateNavigation(sample.finalUrl);
  }

  const quorum = selectIndependentProcessCharacterizationQuorum(
    samples.map((sample) => ({
      manifest: sample.manifestBytes,
      screenshot: sample.screenshot,
    })),
    projectCharacterizationManifestBytesForComparison,
  );
  const selected = samples[quorum.selectedProcessIndex];
  if (!selected) throw new Error("Public overlap process quorum selected no evidence.");

  registerPublicOverlapRoleArtifacts({
    applicationOrigin,
    ownership,
    pages,
    route,
    samples,
    selected,
    selectedScreenshot: quorum.selectedScreenshot,
    testInfo,
  });

  return Object.freeze({
    finalUrl: selected.finalUrl,
    manifest: selected.manifest,
  });
}

export async function capturePublicOverlapCharacterizationPair(options: {
  pagePairs: CharacterizationPagePairQuorum;
  route: PublicOverlapRoute;
  testInfo: TestInfo;
  validateNavigation: (role: PublicOverlapRole, finalUrl: URL) => void;
}) {
  const { pagePairs, route, testInfo, validateNavigation } = options;
  assertExactCaptureCase(testInfo.project.name, route);
  const environment = requirePublicOverlapPairEnvironment();
  const ownershipEntries = await Promise.all(
    (["baseline", "candidate"] as const).map(async (role) => ([
      role,
      await readPreparedCaptureOwnership({
        bindingSha256: environment.roles[role].bindingSha256,
        captureId: environment.captureId,
        ownershipSha256: environment.roles[role].ownershipSha256,
        role,
      }),
    ] as const)),
  );
  const ownership = Object.fromEntries(ownershipEntries) as Record<
    PublicOverlapRole,
    PreparedCaptureOwnership
  >;
  if (ownership.baseline.root === ownership.candidate.root) {
    throw new Error("Paired public overlap ownership roots are not distinct.");
  }

  const samples: Record<PublicOverlapRole, CapturedSample[]> = {
    baseline: [],
    candidate: [],
  };
  for (const [processIndex, pair] of pagePairs.entries()) {
    const screenshotCapture = createSerializedPairTerminalScreenshotCapture();
    const settlements = await Promise.allSettled(
      (["baseline", "candidate"] as const).map(async (role) => {
        try {
          return await captureSample({
            applicationOrigin: environment.roles[role].applicationOrigin,
            baseUrl: new URL(environment.roles[role].applicationOrigin),
            captureScreenshot: (page) => screenshotCapture.capture(role, page),
            page: pair[role].page,
            replayGuard: pair[role].replayGuard,
            route,
            testInfo,
          });
        } finally {
          screenshotCapture.complete(role);
        }
      }),
    );
    const failures = settlements.flatMap((result) => (
      result.status === "rejected" ? [result.reason] : []
    ));
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "Paired public overlap role captures did not both settle successfully.",
      );
    }
    for (const [roleIndex, role] of (["baseline", "candidate"] as const).entries()) {
      const result = settlements[roleIndex];
      if (result?.status !== "fulfilled") {
        throw new Error("Paired public overlap capture settlement is incomplete.");
      }
      const sample = result.value;
      samples[role].push(sample);
      await persistRawProcessSample(processIndex, sample, testInfo, role);
      assertReadOnlySample(sample);
      validateNavigation(role, sample.finalUrl);
    }
  }

  const quorum = selectIndependentProcessCharacterizationPairQuorum(
    pagePairs.map((_pair, processIndex) => ({
      baseline: {
        manifest: samples.baseline[processIndex]?.manifestBytes as Uint8Array,
        screenshot: samples.baseline[processIndex]?.screenshot as Uint8Array,
      },
      candidate: {
        manifest: samples.candidate[processIndex]?.manifestBytes as Uint8Array,
        screenshot: samples.candidate[processIndex]?.screenshot as Uint8Array,
      },
    })),
    projectCharacterizationManifestBytesForComparison,
  );

  for (const role of ["baseline", "candidate"] as const) {
    const selected = samples[role][quorum.selectedProcessIndex];
    if (!selected) {
      throw new Error("Paired public overlap quorum selected no role evidence.");
    }
    const rolePages: CharacterizationPageQuorum = [
      pagePairs[0][role],
      pagePairs[1][role],
      pagePairs[2][role],
    ];
    registerPublicOverlapRoleArtifacts({
      applicationOrigin: environment.roles[role].applicationOrigin,
      ownership: ownership[role],
      pages: rolePages,
      route,
      samples: samples[role],
      selected,
      selectedScreenshot: quorum[role].selectedScreenshot,
      testInfo,
    });
  }

  return Object.freeze({
    baseline: samples.baseline[quorum.selectedProcessIndex]?.manifest,
    candidate: samples.candidate[quorum.selectedProcessIndex]?.manifest,
    selectedProcessIndex: quorum.selectedProcessIndex,
    selectedProcessIndexes: quorum.selectedProcessIndexes,
  });
}

type CapturedSample = Awaited<ReturnType<typeof captureSample>>;

function registerPublicOverlapRoleArtifacts(options: {
  applicationOrigin: string;
  ownership: PreparedCaptureOwnership;
  pages: CharacterizationPageQuorum;
  route: PublicOverlapRoute;
  samples: readonly CapturedSample[];
  selected: CapturedSample;
  selectedScreenshot: Uint8Array;
  testInfo: TestInfo;
}) {
  const {
    applicationOrigin,
    ownership,
    pages,
    route,
    samples,
    selected,
    selectedScreenshot,
    testInfo,
  } = options;
  const primary = pages[0];
  if (!primary) throw new Error("Public overlap role has no primary evidence page.");
  registerBaselineReconciliation(primary.page, async () => {
    const consoleSidecars = await Promise.all(samples.map(async (_sample, processIndex) => {
      const page = pages[processIndex]?.page as Page;
      const normalizedStaticCspViolations = staticCspConsoleSidecarEvidence(page);
      assertStaticCspSidecarContract(
        new URL(route.requestPath, applicationOrigin).pathname,
        normalizedStaticCspViolations,
      );
      return Buffer.from(`${JSON.stringify({
        schemaVersion: 1,
        baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
        project: testInfo.project.name,
        route: { id: route.id, kind: route.kind },
        normalizedStaticCspViolations,
      }, null, 2)}\n`, "utf8");
    }));
    const consoleSidecar = requireExactProcessBytesAgreement(
      consoleSidecars,
      "public overlap console sidecars",
    );
    const relativeDirectory = `${testInfo.project.name}/${route.id}`;
    await Promise.all([
      writeImmutableCaptureArtifact({
        bytes: selected.manifestBytes,
        ownership,
        relativePath: `${relativeDirectory}/characterization.json`,
        root: ownership.root,
      }),
      writeImmutableCaptureArtifact({
        bytes: consoleSidecar,
        ownership,
        relativePath: `${relativeDirectory}/console.json`,
        root: ownership.root,
      }),
      writeImmutableCaptureArtifact({
        bytes: selectedScreenshot,
        ownership,
        relativePath: `${relativeDirectory}/viewport.png`,
        root: ownership.root,
      }),
    ]);
  });
}

async function captureSample(options: {
  applicationOrigin: string;
  baseUrl: URL;
  captureScreenshot?: (page: Page) => Promise<Buffer>;
  page: Page;
  replayGuard: CharacterizationPageQuorum[number]["replayGuard"];
  route: PublicOverlapRoute;
  testInfo: TestInfo;
}) {
  const { applicationOrigin, baseUrl, page, replayGuard, route, testInfo } = options;
  const networkRecorder = recordNetwork(page, applicationOrigin);
  const finalResponse = await page.goto(route.requestPath, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);

  const screenshot = options.captureScreenshot
    ? await options.captureScreenshot(page)
    : await captureByteIdenticalTerminalScreenshot(page);
  const [dom, computedStyles, interactiveElements, ariaSnapshot, storage, redirects] = (
    await Promise.all([
      canonicalDom(page),
      selectedComputedStyles(page),
      interactiveState(page),
      page.locator("body").ariaSnapshot(),
      browserStorage(page),
      navigationChain(finalResponse, applicationOrigin),
    ])
  );

  let drainFailure: unknown;
  try {
    await replayGuard.drain();
  } catch (error) {
    drainFailure = error;
  } finally {
    replayGuard.seal();
  }
  let network: Awaited<ReturnType<typeof networkRecorder.finish>>;
  try {
    network = await networkRecorder.finish();
  } catch (error) {
    if (drainFailure !== undefined) {
      throw new AggregateError(
        [drainFailure, error],
        "Public overlap replay drain and network recorder both failed.",
      );
    }
    throw error;
  }
  if (drainFailure !== undefined) throw drainFailure;
  replayGuard.assertNoViolations();

  const finalUrl = page.url();
  const viewport = page.viewportSize();
  const imageDimensions = pngDimensions(screenshot);
  const capturedAtEpochSeconds = Math.floor(Date.now() / 1_000);
  const cookies = await page.context().cookies();
  const sanitizedCookies = cookies
    .map((cookie) => ({
      name: /^[A-Za-z0-9_.-]{1,80}$/.test(cookie.name)
        ? cookie.name
        : `<sha256:${shortDigest(cookie.name)}>`,
      value: digestValue(cookie.value),
      domain: normalizeCookieDomain(cookie.domain, baseUrl.hostname),
      path: cookie.path,
      expiresInSeconds: cookie.expires === -1
        ? null
        : Math.round((cookie.expires - capturedAtEpochSeconds) / 60) * 60,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    }))
    .sort((left, right) => `${left.domain}:${left.path}:${left.name}`
      .localeCompare(`${right.domain}:${right.path}:${right.name}`));
  const sanitizedStorage = {
    local: sanitizeStorageEntries(storage.local),
    session: sanitizeStorageEntries(storage.session),
    cacheNames: storage.cacheNames.map(sanitizeStorageKey).sort(),
    serviceWorkerScopes: storage.serviceWorkerScopes
      .map((scope) => canonicalizeUrl(scope, applicationOrigin)),
  };
  const serverActions = network
    .filter((entry) => entry.serverAction.present)
    .map((entry, order) => ({
      order,
      requestIndex: entry.index,
      method: entry.method,
      url: entry.url,
      identifier: entry.serverAction.identifier,
      payload: entry.postData,
      status: entry.response?.status ?? null,
    }));
  const manifest = {
    schemaVersion: 1,
    baselineCommit: BEHAVIORAL_BASELINE_COMMIT,
    project: testInfo.project.name,
    route: {
      id: route.id,
      kind: route.kind,
      requested: canonicalizeUrl(
        new URL(route.requestPath, applicationOrigin).href,
        applicationOrigin,
      ),
      final: canonicalizeUrl(finalUrl, applicationOrigin),
      redirects,
      finalStatus: finalResponse?.status() ?? null,
    },
    viewport,
    screenshot: {
      width: imageDimensions.width,
      height: imageDimensions.height,
      sha256: sha256(screenshot),
    },
    dom,
    computedStyles,
    ariaSnapshot: sanitizeAriaUrls(ariaSnapshot, applicationOrigin, finalUrl),
    interactiveElements,
    consolePolicy: consoleBaselineEvidence(page),
    browserState: {
      cookies: sanitizedCookies,
      storage: sanitizedStorage,
    },
    network: {
      requests: network,
      serverActionCount: serverActions.length,
      serverActions,
    },
  };
  return {
    finalUrl: new URL(finalUrl),
    manifest,
    manifestBytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    replayGuard,
    screenshot,
  };
}

async function persistRawProcessSample(
  processIndex: number,
  sample: Awaited<ReturnType<typeof captureSample>>,
  testInfo: TestInfo,
  role?: PublicOverlapRole,
) {
  const outputDirectory = testInfo.outputPath("process-quorum");
  await mkdir(outputDirectory, { recursive: true });
  const roleSuffix = role === undefined ? "" : `.${role}`;
  const manifestPath = testInfo.outputPath(
    "process-quorum",
    `process-${processIndex + 1}${roleSuffix}.characterization.raw.json`,
  );
  const screenshotPath = testInfo.outputPath(
    "process-quorum",
    `process-${processIndex + 1}${roleSuffix}.viewport.raw.png`,
  );
  await Promise.all([
    writeFile(manifestPath, sample.manifestBytes),
    writeFile(screenshotPath, sample.screenshot),
  ]);
}

function assertExactCaptureCase(project: string, route: PublicOverlapRoute) {
  if (
    !PUBLIC_OVERLAP_PROJECTS.includes(project as (typeof PUBLIC_OVERLAP_PROJECTS)[number])
    || !PUBLIC_OVERLAP_ROUTES.some((expected) => (
      expected.id === route.id
      && expected.kind === route.kind
      && expected.requestPath === route.requestPath
    ))
    || PUBLIC_OVERLAP_CAPTURE_POLICY.caseCount !== 42
    || PUBLIC_OVERLAP_CAPTURE_POLICY.artifactPaths.length !== 126
  ) {
    throw new Error("Public overlap capture is restricted to the exact 42-case inventory.");
  }
}

function assertReadOnlySample(sample: Awaited<ReturnType<typeof captureSample>>) {
  sample.replayGuard.assertNoViolations();
  const { network } = sample.manifest;
  if (
    network.serverActionCount !== 0
    || network.serverActions.length !== 0
    || network.requests.some((request) => (
      request.method !== "GET"
      || request.serverAction.present !== false
      || request.postData !== null
    ))
  ) {
    throw new Error("Public overlap capture emitted a side-effecting or credential-bearing request.");
  }
}

function sanitizeStorageEntries(entries: Array<{ key: string; value: string }>) {
  return entries
    .map(({ key, value }) => ({ key: sanitizeStorageKey(key), value: digestValue(value) }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeCookieDomain(domain: string, applicationHostname: string) {
  if (domain.replace(/^\./, "") === applicationHostname) return "<app-host>";
  return `<external-domain:${shortDigest(domain)}>`;
}

function pngDimensions(png: Uint8Array) {
  const buffer = Buffer.from(png);
  if (buffer.length < 24 || buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("Public overlap capture returned an invalid PNG screenshot.");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}
