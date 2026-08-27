import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  projectCharacterizationManifestForComparison,
  projectCharacterizationManifestPairForComparison,
} from "../comparison-projection";
import {
  PINNED_JOURNEY_V5_FIXTURE_SHA256,
  currentJourneyFixtureContractSha256,
} from "./journey-fixture-contract";
import {
  JOURNEY_SYNTHETIC_HOSTNAMES,
  JOURNEY_SYNTHETIC_TLS_POLICY,
  assertJourneyBrowserPolicy,
  isJourneyBrowserRequestAllowed,
  journeyChromiumLaunchArgs,
  journeyConnectProxy,
  journeyProvenanceLaunchArgs,
} from "./journey-browser-policy";

test("projects generated journey values by referential symbol while retaining structure", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.boundaries = oidcBoundary("baseline");
  candidate.boundaries = oidcBoundary("candidate");
  expect(project(candidate)).toEqual(project(baseline));

  const projected = project(candidate) as ReturnType<typeof journeyManifest>;
  const dynamic = projected.providerEffects.entries[0]!.body_contract.value.return_url
    .path[2] as { sha256: string };
  expect(projected.navigations[0]!.pathname).toContain(dynamic.sha256);
  expect(projected.providerEffects.entries[0]!.body_sha256)
    .toBe("<derived-from-redacted-body-contract>");
  expect(projected.network.serverActions[0]!.payload.bytes).toBe(240);
  expect(projected.network.requests[0]!.requestHeaders[0]!.value)
    .toEqual(projected.network.serverActions[0]!.identifier);
  expect(projected.checkpoints[0]!.cookies[0]!.value.bytes).toBe(256);
  const oidc = projected.boundaries[0]!.value.preCallback[0]!;
  expect(oidc.expiry.epochSeconds).toBe("<bounded-cookie-expiry>");
  expect(oidc.valueBytes).toBe(64);
});

test("projects only the pinned baseline and recomputed current fixture contracts", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.source.fixtureContract.sha256 = PINNED_JOURNEY_V5_FIXTURE_SHA256;
  candidate.source.fixtureContract.sha256 = currentJourneyFixtureContractSha256();
  const projected = projectCharacterizationManifestPairForComparison(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  for (const [expectedHash, actualHash] of [
    ["0".repeat(64), currentJourneyFixtureContractSha256()],
    [PINNED_JOURNEY_V5_FIXTURE_SHA256, "f".repeat(64)],
  ]) {
    const wrongBaseline = journeyManifest("baseline");
    const wrongCandidate = journeyManifest("candidate");
    wrongBaseline.source.fixtureContract.sha256 = expectedHash;
    wrongCandidate.source.fixtureContract.sha256 = actualHash;
    const wrong = projectCharacterizationManifestPairForComparison(
      wrongBaseline,
      wrongCandidate,
    );
    expect(wrong.actual).not.toEqual(wrong.expected);
  }

  const projectedSentinels = journeyManifest("candidate");
  projectedSentinels.source.fixtureContract.sha256 = currentJourneyFixtureContractSha256();
  Object.assign(projectedSentinels.source, {
    revision: "<source-revision>",
    imageDigest: "sha256:<source-image-digest>",
    imageTag: "<source-image-tag>",
    migrationImageDigest: "sha256:<migration-image-digest>",
    migrationImageTag: "<migration-image-tag>",
  });
  const rejectedSentinels = projectCharacterizationManifestPairForComparison(
    baseline,
    projectedSentinels,
  );
  expect(rejectedSentinels.actual).not.toEqual(rejectedSentinels.expected);
});

test("projects only a consistent generated PWA shell cache contract", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  const legacyCache = "clean-pay-shell-ff7922ad-71fe-405d-b05f-363392d82108";
  setPwaShellCache(baseline, legacyCache);
  setPwaShellCache(candidate, pwaRevisionCache(candidate));
  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const candidateUuid = journeyManifest("candidate");
  setPwaShellCache(candidateUuid, legacyCache);
  const uuidNearMiss = projectPair(baseline, candidateUuid);
  expect(uuidNearMiss.actual).not.toEqual(uuidNearMiss.expected);

  const inconsistent = journeyManifest("candidate");
  setPwaShellCache(inconsistent, pwaRevisionCache(inconsistent));
  pwaBoundaryCacheNames(inconsistent)[0] = `clean-pay-shell-${"b".repeat(40)}`;
  const inconsistentProjection = projectPair(baseline, inconsistent);
  expect(inconsistentProjection.actual).not.toEqual(inconsistentProjection.expected);

  const invalidFormat = journeyManifest("candidate");
  setPwaShellCache(invalidFormat, "clean-pay-shell-synthetic-build");
  const invalidFormatProjection = projectPair(baseline, invalidFormat);
  expect(invalidFormatProjection.actual).not.toEqual(invalidFormatProjection.expected);

  const widenedBoundary = journeyManifest("candidate");
  setPwaShellCache(widenedBoundary, pwaRevisionCache(widenedBoundary));
  Object.assign(pwaBoundary(widenedBoundary), { unexpected: true });
  const widenedProjection = projectPair(baseline, widenedBoundary);
  expect(widenedProjection.actual).not.toEqual(widenedProjection.expected);

  const outsideJourney = journeyManifest("candidate");
  setPwaShellCache(outsideJourney, pwaRevisionCache(outsideJourney));
  outsideJourney.journey = "tariffs-payment-returns-extend-idempotency";
  const outsideProjection = projectPair(baseline, outsideJourney);
  expect(outsideProjection.actual).not.toEqual(outsideProjection.expected);
});

test("projects a consistent generated PWA shell cache in non-public journey checkpoints", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setCheckpointCacheNames(
    baseline,
    ["clean-pay-shell-ff7922ad-71fe-405d-b05f-363392d82108"],
  );
  setCheckpointCacheNames(candidate, [pwaRevisionCache(candidate)]);
  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const candidateUuid = journeyManifest("candidate");
  setCheckpointCacheNames(
    candidateUuid,
    ["clean-pay-shell-ff7922ad-71fe-405d-b05f-363392d82108"],
  );
  const uuidNearMiss = projectPair(baseline, candidateUuid);
  expect(uuidNearMiss.actual).not.toEqual(uuidNearMiss.expected);

  const inconsistent = journeyManifest("candidate");
  appendMatchingCheckpoint(inconsistent, "second-checkpoint");
  setCheckpointCacheNames(inconsistent, [
    pwaRevisionCache(inconsistent),
    "clean-pay-shell-ff7922ad-71fe-405d-b05f-363392d82108",
  ]);
  const repeatedBaseline = journeyManifest("baseline");
  appendMatchingCheckpoint(repeatedBaseline, "second-checkpoint");
  setCheckpointCacheNames(repeatedBaseline, [
    "clean-pay-shell-ff7922ad-71fe-405d-b05f-363392d82108",
    "clean-pay-shell-ff7922ad-71fe-405d-b05f-363392d82108",
  ]);
  const inconsistentProjection = projectPair(repeatedBaseline, inconsistent);
  expect(inconsistentProjection.actual).not.toEqual(inconsistentProjection.expected);

  const tooMany = journeyManifest("candidate");
  setCheckpointCacheNames(tooMany, [[
    pwaRevisionCache(tooMany),
    pwaRevisionCache(tooMany),
  ]]);
  const tooManyProjection = projectPair(baseline, tooMany);
  expect(tooManyProjection.actual).not.toEqual(tooManyProjection.expected);

  const addedPresence = journeyManifest("candidate");
  setCheckpointCacheNames(addedPresence, [pwaRevisionCache(addedPresence)]);
  const emptyBaseline = journeyManifest("baseline");
  setCheckpointCacheNames(emptyBaseline, [[]]);
  const presenceProjection = projectPair(emptyBaseline, addedPresence);
  expect(presenceProjection.actual).not.toEqual(presenceProjection.expected);
});

test("projects only exactly correlated Next-Action request headers", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  expect(project(candidate)).toEqual(project(baseline));

  const mutations: Array<(manifest: ReturnType<typeof journeyManifest>) => void> = [
    (manifest) => {
      manifest.network.requests[0]!.requestHeaders[0]!.value.sha256 = "f".repeat(64);
    },
    (manifest) => {
      manifest.network.requests[0]!.requestHeaders.push({
        name: "next-action",
        value: { ...manifest.network.requests[0]!.serverAction.identifier },
      });
    },
    (manifest) => {
      Object.assign(manifest.network.requests[0]!.requestHeaders[0]!, { unexpected: true });
    },
    (manifest) => {
      manifest.network.requests[0]!.requestHeaders.length = 0;
    },
  ];
  for (const mutate of mutations) {
    const nearMiss = journeyManifest("candidate");
    mutate(nearMiss);
    expect(project(nearMiss)).not.toEqual(project(baseline));
  }
});

test("projects hashed static references inside journey checkpoints only", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setCheckpointStylesheet(baseline, "/_next/static/chunks/12345678.css");
  setCheckpointStylesheet(candidate, "/_next/static/chunks/87654321.css");
  expect(project(candidate)).toEqual(project(baseline));

  const nearMiss = journeyManifest("candidate");
  setCheckpointStylesheet(nearMiss, "/_next/static/chunks/not-opaque.css");
  expect(project(nearMiss)).not.toEqual(project(baseline));
});

test("projects only exact failed generated static requests in the public journey", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  addFailedStaticRequests(baseline, "baseline");
  addFailedStaticRequests(candidate, "candidate");
  expect(project(candidate)).toEqual(project(baseline));

  const nearMisses: Array<(manifest: ReturnType<typeof journeyManifest>) => void> = [
    (manifest) => {
      const failure = failedStaticRequest(manifest, 1).failure as { errorText: { sha256: string } };
      failure.errorText.sha256 = "f".repeat(64);
    },
    (manifest) => {
      const headers = failedStaticRequest(manifest, 1).requestHeaders as Array<Record<string, unknown>>;
      const referer = headers.at(-1)?.value as Record<string, unknown>;
      referer.pathname = "/tariffs";
    },
    (manifest) => {
      const headers = failedStaticRequest(manifest, 1).requestHeaders as unknown[];
      headers.push({ name: "x-near-miss", value: { bytes: 1, sha256: "0".repeat(64) } });
    },
    (manifest) => {
      const url = failedStaticRequest(manifest, 2).url as Record<string, unknown>;
      url.pathname = "/_next/static/chunks/not-opaque.css";
    },
    (manifest) => {
      Object.assign(failedStaticRequest(manifest, 1), { unexpected: true });
    },
  ];
  for (const mutate of nearMisses) {
    const nearMiss = journeyManifest("candidate");
    addFailedStaticRequests(nearMiss, "candidate");
    mutate(nearMiss);
    expect(project(nearMiss)).not.toEqual(project(baseline));
  }
});

test("keeps stable journey payload fields and dynamic formats observable", () => {
  const baseline = journeyManifest("baseline");

  const stableField = journeyManifest("candidate");
  stableField.providerEffects.entries[0]!.body_contract.value.plan_id = 2;
  expect(project(stableField)).not.toEqual(project(baseline));

  const wrongFormat = journeyManifest("candidate");
  const dynamicPath = wrongFormat.providerEffects.entries[0]!
    .body_contract.value.return_url.path[2];
  if (typeof dynamicPath !== "object") throw new Error("Expected a dynamic path contract.");
  dynamicPath.format = "uuid";
  expect(project(wrongFormat)).not.toEqual(project(baseline));

  const payloadLength = journeyManifest("candidate");
  payloadLength.network.requests[0]!.postData.bytes += 1;
  payloadLength.network.serverActions[0]!.payload.bytes += 1;
  expect(project(payloadLength)).not.toEqual(project(baseline));

  const unknownCookie = journeyManifest("candidate");
  unknownCookie.checkpoints[0]!.cookies[0]!.name = "new_external_cookie";
  expect(project(unknownCookie)).not.toEqual(project(baseline));

  const resetNearMisses: Array<(
    database: ReturnType<typeof journeyManifest>["syntheticReset"]["database"],
  ) => void> = [
    (database) => { database.scopeContract = "arbitrary-project"; },
    (database) => { database.status = "partial"; },
    (database) => { database.scopeSha256 = "bad"; },
    (database) => { database.schemaSha256 = "bad"; },
    (database) => { database.tableCount = 0; },
    (database) => { database.sequenceCount = 1; },
    (database) => { database.resetSequence = 0; },
    (database) => { database.transaction = "delete-rows"; },
    (database) => { database.redis = "flush-all"; },
    (database) => { Object.assign(database, { unexpected: true }); },
  ];
  for (const mutate of resetNearMisses) {
    const resetScopeNearMiss = journeyManifest("candidate");
    mutate(resetScopeNearMiss.syntheticReset.database);
    expect(project(resetScopeNearMiss)).not.toEqual(project(baseline));
  }

  const boundaryNearMiss = journeyManifest("candidate");
  boundaryNearMiss.boundaries = oidcBoundary("candidate");
  boundaryNearMiss.boundaries[0]!.value.preCallback[0]!.expiry.boundedSeconds = "0..9999";
  const boundaryBaseline = journeyManifest("baseline");
  boundaryBaseline.boundaries = oidcBoundary("baseline");
  expect(project(boundaryNearMiss)).not.toEqual(project(boundaryBaseline));

  const offlineBaseline = journeyManifest("baseline");
  offlineBaseline.journey = "public-responsive-keyboard-install-offline-support";
  const projectedOfflineCandidate = journeyManifest("candidate");
  projectedOfflineCandidate.journey = "public-responsive-keyboard-install-offline-support";
  setOfflineCssPaths(projectedOfflineCandidate, "candidate");
  expect(project(projectedOfflineCandidate)).toEqual(project(offlineBaseline));
  const offlineNearMisses: Array<(manifest: ReturnType<typeof journeyManifest>) => void> = [
    (manifest) => { manifest.console.offlineFallbackResourceFailures.pop(); },
    (manifest) => {
      manifest.console.offlineFallbackResourceFailures.push(
        structuredClone(manifest.console.offlineFallbackResourceFailures[4]!),
      );
    },
    (manifest) => { manifest.console.offlineFallbackResourceFailures[0]!.order = 1; },
    (manifest) => {
      manifest.console.offlineFallbackResourceFailures[0]!.diagnostic.message.sha256 = "f".repeat(64);
    },
    (manifest) => {
      manifest.console.offlineFallbackResourceFailures[0]!.diagnostic.location.url.pathname
        = "/_next/static/chunks/not-opaque.css";
    },
    (manifest) => {
      manifest.console.offlineFallbackResourceFailures[0]!.diagnostic.location.url.query
        = [{ key: "near", value: "miss" }];
    },
    (manifest) => {
      manifest.console.offlineFallbackResourceFailures[4]!.diagnostic.location.url.pathname
        = "/other-logo.png";
    },
    (manifest) => {
      manifest.console.offlineFallbackResourceFailures[0]!.diagnostic.type = "warning";
    },
  ];
  for (const mutate of offlineNearMisses) {
    const candidate = journeyManifest("candidate");
    candidate.journey = "public-responsive-keyboard-install-offline-support";
    setOfflineCssPaths(candidate, "candidate");
    mutate(candidate);
    expect(project(candidate)).not.toEqual(project(offlineBaseline));
  }
});

test("does not apply generated-value projection outside the exact journey envelope", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  candidate.source.fixtureContract.version = "journey-v6";
  expect(project(candidate)).not.toEqual(project(baseline));

  const wrongProject = journeyManifest("candidate");
  wrongProject.project = "chromium-390x844";
  expect(project(wrongProject)).not.toEqual(project(baseline));

  const wrongActionReference = journeyManifest("candidate");
  wrongActionReference.network.serverActions[0]!.requestIndex = 1;
  expect(project(wrongActionReference)).not.toEqual(project(baseline));

  const resolverIp = "127.0.0.3";
  const launchArgs = journeyChromiumLaunchArgs(resolverIp);
  const exactPolicy = {
    resolverIp,
    launchArgs,
    syntheticHostnames: [...JOURNEY_SYNTHETIC_HOSTNAMES],
    tlsPolicy: { ...JOURNEY_SYNTHETIC_TLS_POLICY },
  };
  expect(() => assertJourneyBrowserPolicy(exactPolicy)).not.toThrow();
  for (const nearMiss of [
    { ...exactPolicy, resolverIp: undefined },
    { ...exactPolicy, resolverIp: "127.0.0.1" },
    { ...exactPolicy, launchArgs: launchArgs.slice(1) },
    { ...exactPolicy, launchArgs: [...launchArgs, "--ignore-certificate-errors-spki-list=bad"] },
    { ...exactPolicy, launchArgs: [...launchArgs, "--proxy-bypass-list=localhost"] },
    {
      ...exactPolicy,
      launchArgs: launchArgs.map((entry) => entry.replace(
        "EXCLUDE 127.0.0.1",
        "EXCLUDE 127.0.0.2",
      )),
    },
    {
      ...exactPolicy,
      launchArgs: launchArgs.map((entry) => entry.replace(
        "EXCLUDE 127.0.0.1",
        "EXCLUDE localhost, EXCLUDE 127.0.0.1",
      )),
    },
    { ...exactPolicy, syntheticHostnames: exactPolicy.syntheticHostnames.slice(1) },
    { ...exactPolicy, syntheticHostnames: [...exactPolicy.syntheticHostnames, "unexpected.invalid"] },
    { ...exactPolicy, tlsPolicy: { ...exactPolicy.tlsPolicy, scope: "all-hostnames" } },
  ]) {
    expect(() => assertJourneyBrowserPolicy(nearMiss)).toThrow();
  }
  expect(isJourneyBrowserRequestAllowed("https://pay.ci.clean-pay.dev/login")).toBe(true);
  expect(isJourneyBrowserRequestAllowed("data:text/plain,fixture")).toBe(true);
  expect(journeyConnectProxy("http://127.0.0.1:14444")).toEqual({
    server: "http://127.0.0.1:14444",
    bypass: "<-loopback>",
  });
  for (const nearMissProxy of [
    undefined,
    "https://127.0.0.1:14444",
    "http://127.0.0.2:14444",
    "http://127.0.0.1:443",
    "http://127.0.0.1:04444",
    "http://127.0.0.1:14444/",
    "http://127.0.0.1:14444?bypass=1",
    "http://synthetic@127.0.0.1:14444",
    "http://localhost:14444",
    "http://127.0.0.1:65536",
    "http://example.invalid:14444",
  ]) {
    expect(() => journeyConnectProxy(nearMissProxy)).toThrow();
  }
  for (const nearMissUrl of [
    "http://pay.ci.clean-pay.dev/login",
    "https://pay.ci.clean-pay.dev:444/login",
    "https://pay.ci.clean-pay.dev.evil.invalid/login",
    "https://127.0.0.3/login",
    "https://unexpected.invalid/",
    "not a url",
  ]) {
    expect(isJourneyBrowserRequestAllowed(nearMissUrl)).toBe(false);
  }
});

function project(value: unknown) {
  return projectCharacterizationManifestForComparison(value);
}

function projectPair(
  expected: ReturnType<typeof journeyManifest>,
  actual: ReturnType<typeof journeyManifest>,
) {
  pinJourneyFixturePair(expected, actual);
  return projectCharacterizationManifestPairForComparison(expected, actual);
}

function journeyManifest(seed: string) {
  const cuid = (seed === "baseline" ? "cmfbase" : "cmfcandidate").padEnd(28, "0");
  const idempotency = seed === "baseline"
    ? "00000000-0000-4000-8000-000000000001"
    : "00000000-0000-4000-8000-000000000002";
  const dynamic = (format: string, value: string) => ({
    kind: "dynamic",
    format,
    bytes: Buffer.byteLength(value),
    sha256: digest(value),
  });
  const requestIdentifier = { bytes: 40, sha256: digest(`${seed}:action`) };
  const requestPayload = { bytes: 240, sha256: digest(`${seed}:payload`) };
  const offlineFailure = (index: number) => ({
    kind: "offline-resource-load-failure",
    order: index,
    resourceClass: index < 4 ? "compiled-css" : "logo",
    diagnostic: {
      type: "error",
      message: {
        bytes: 55,
        sha256: "9432f8effe23a68459f7aa20703ce905a61dcf53282cb8611c650798ff432126",
      },
      location: {
        url: canonicalUrl(index < 4
          ? `/_next/static/chunks/fixture${index}chunk.css`
          : "/clean-pay-logo.png"),
        lineNumber: 0,
        columnNumber: 0,
      },
    },
  });
  return {
    schemaVersion: 2,
    baselineCommit: "f5cb6f543d85256e7733a1ade6a4f451d86cf378",
    source: {
      revision: digest(`${seed}:revision`).slice(0, 40),
      imageDigest: `sha256:${digest(`${seed}:image`)}`,
      imageTag: `${seed}:journey`,
      migrationImageDigest: `sha256:${digest(`${seed}:migration-image`)}`,
      migrationImageTag: `${seed}:journey-migration`,
      publicBuildContract: { version: "1", sha256: "1".repeat(64) },
      fixtureContract: { version: "journey-v5", sha256: "2".repeat(64) },
      browser: {
        engine: "chromium",
        version: "140.0.0.0",
        playwright: "1.62.1",
        launchArgs: journeyProvenanceLaunchArgs(),
        syntheticHostnames: [...JOURNEY_SYNTHETIC_HOSTNAMES],
        tlsPolicy: { ...JOURNEY_SYNTHETIC_TLS_POLICY },
      },
    },
    project: "journey-390x844",
    journey: "tariffs-payment-returns-extend-idempotency",
    console: {
      normalizedStaticCspViolations: [],
      offlineFallbackResourceFailures: [0, 1, 2, 3, 4].map(offlineFailure),
    },
    syntheticReset: {
      seed_sha256: "3".repeat(64),
      database: {
        status: "reset",
        scopeContract: "exact-compose-project-label",
        scopeSha256: digest(`${seed}:compose-project`),
        schemaSha256: "4".repeat(64),
        sequenceCount: 0,
        tableCount: 16,
        transaction: "truncate-public-application-tables-cascade-no-sequences",
        redis: "flush-owned-db-0",
        resetSequence: 1,
      },
    },
    checkpoints: [{
      label: "payment-return-pending",
      url: canonicalUrl(`/payment/${cuid}`),
      cookies: [{
        name: "clean_pay_access",
        value: { bytes: 256, sha256: digest(`${seed}:cookie`) },
        domain: "<app-host>",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      }],
    }],
    navigations: [canonicalUrl(`/payment/${cuid}`, [
      { key: "state", value: `<sha256:${digest(`${seed}:state`).slice(0, 16)}>` },
    ])],
    boundaries: [] as ReturnType<typeof oidcBoundary>,
    network: {
      requests: [{
        index: 0,
        method: "POST",
        url: canonicalUrl("/tariffs"),
        scope: "application",
        resourceType: "fetch",
        navigation: false,
        serverAction: { present: true, identifier: { ...requestIdentifier } },
        requestHeaders: [{
          name: "next-action",
          value: { ...requestIdentifier },
        }],
        postData: { ...requestPayload },
        redirectedFrom: null,
        response: { status: 200, headers: [] },
        failure: null,
        externalTransport: null,
      }],
      serverActionCount: 1,
      serverActions: [{
        order: 0,
        requestIndex: 0,
        method: "POST",
        url: canonicalUrl("/tariffs"),
        identifier: { ...requestIdentifier },
        payload: { ...requestPayload },
        status: 200,
      }],
    },
    providerEffects: {
      entries: [{
        sequence: 1,
        service: "remnashop",
        method: "POST",
        pathname: "/api/v1/public/subscription/purchase",
        query_keys: [],
        body_bytes: 180,
        body_sha256: digest(`${seed}:body`),
        body_contract: {
          encoding: "json",
          value: {
            plan_id: 1,
            return_url: {
              kind: "url",
              origin: "https://pay.ci.clean-pay.dev",
              path: ["", "payment", dynamic("cuid", cuid)],
              query: [],
              fragment: null,
            },
          },
        },
        idempotency_key_present: true,
        idempotency_key_sha256: digest(idempotency),
        idempotency_key_contract: dynamic("idempotency-key", idempotency),
        credential_contract: {
          header_names: ["x-remnashop-auth-service-key"],
          authorization_scheme: null,
          cookie_names: ["access_token", "refresh_token"],
        },
        effect: "purchase_initialized",
      }],
    },
  };
}

function setOfflineCssPaths(
  manifest: ReturnType<typeof journeyManifest>,
  seed: string,
) {
  for (let index = 0; index < 4; index += 1) {
    manifest.console.offlineFallbackResourceFailures[index]!
      .diagnostic.location.url.pathname = `/_next/static/chunks/${seed}${index}chunk.css`;
  }
}

function setPwaShellCache(
  manifest: ReturnType<typeof journeyManifest>,
  cacheName: string,
) {
  manifest.journey = "public-responsive-keyboard-install-offline-support";
  const checkpoints = (manifest as unknown as Record<string, unknown>).checkpoints as unknown[];
  checkpoints.push({
    label: "offline-recovery-support",
    cookies: [],
  });
  for (const checkpointValue of checkpoints) {
    const checkpoint = checkpointValue as unknown as Record<string, unknown>;
    checkpoint.storage = {
      local: [],
      session: [],
      cacheNames: [cacheName],
      serviceWorkerScopes: [],
    };
  }
  (manifest as unknown as Record<string, unknown>).boundaries = [{
    label: "pwa-service-worker-offline",
    value: {
      registrationMode: "playwright-explicit-production-sw",
      reason: "pristine-static-csp-blocks-install-page-hydration",
      online: {
        scriptPath: "/sw.js",
        scopePath: "/",
        cacheNames: [cacheName],
      },
      offline: {
        controlled: true,
        pathname: "/offline",
        queryKeys: ["journey_offline"],
      },
    },
  }];
}

function pwaBoundary(manifest: ReturnType<typeof journeyManifest>) {
  return ((manifest as unknown as Record<string, unknown>).boundaries as Array<Record<string, unknown>>)[0]!;
}

function pwaBoundaryCacheNames(manifest: ReturnType<typeof journeyManifest>) {
  const value = pwaBoundary(manifest).value as Record<string, unknown>;
  const online = value.online as Record<string, unknown>;
  return online.cacheNames as string[];
}

function pwaRevisionCache(manifest: ReturnType<typeof journeyManifest>) {
  return `clean-pay-shell-${manifest.source.revision}`;
}

function setCheckpointCacheNames(
  manifest: ReturnType<typeof journeyManifest>,
  values: Array<string | string[]>,
) {
  const checkpoints = (manifest as unknown as Record<string, unknown>).checkpoints as unknown[];
  for (const [index, value] of values.entries()) {
    const checkpoint = checkpoints[index] as Record<string, unknown>;
    checkpoint.storage = {
      local: [],
      session: [],
      cacheNames: Array.isArray(value) ? [...value] : [value],
      serviceWorkerScopes: [],
    };
  }
}

function appendMatchingCheckpoint(
  manifest: ReturnType<typeof journeyManifest>,
  label: string,
) {
  const checkpoints = (manifest as unknown as Record<string, unknown>).checkpoints as Array<
    Record<string, unknown>
  >;
  const checkpoint = structuredClone(checkpoints[0]!);
  checkpoint.label = label;
  checkpoints.push(checkpoint);
}

function pinJourneyFixturePair(
  baseline: ReturnType<typeof journeyManifest>,
  candidate: ReturnType<typeof journeyManifest>,
) {
  baseline.source.fixtureContract.sha256 = PINNED_JOURNEY_V5_FIXTURE_SHA256;
  candidate.source.fixtureContract.sha256 = currentJourneyFixtureContractSha256();
}

function setCheckpointStylesheet(
  manifest: ReturnType<typeof journeyManifest>,
  href: string,
) {
  const checkpoint = manifest.checkpoints[0] as unknown as Record<string, unknown>;
  checkpoint.url = canonicalUrl("/tariffs");
  checkpoint.dom = {
    type: "element",
    tag: "html",
    attributes: [],
    children: [{
      type: "element",
      tag: "head",
      attributes: [],
      children: [{
        type: "element",
        tag: "link",
        attributes: [
          { name: "href", value: href },
          { name: "rel", value: "stylesheet" },
        ],
        children: [],
      }],
    }],
  };
}

function addFailedStaticRequests(
  manifest: ReturnType<typeof journeyManifest>,
  seed: string,
) {
  manifest.journey = "public-responsive-keyboard-install-offline-support";
  manifest.network.requests.push(
    {
      index: 1,
      method: "GET",
      url: canonicalUrl(`/_next/static/chunks/${seed}0chunk.js`),
      scope: "application",
      resourceType: "script",
      navigation: false,
      serverAction: { present: false, identifier: null },
      requestHeaders: [{
        name: "referer",
        value: canonicalUrl("/install"),
      }],
      postData: null,
      redirectedFrom: null,
      response: null,
      failure: {
        errorText: {
          bytes: 3,
          sha256: "438ced67d76cf3c3bf3e9781a9640ab685b2c877f7cc93b6758cc641efd51bc6",
        },
      },
      externalTransport: null,
    } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number],
    {
      index: 2,
      method: "GET",
      url: canonicalUrl(`/_next/static/chunks/${seed}1chunk.css`),
      scope: "application",
      resourceType: "stylesheet",
      navigation: false,
      serverAction: { present: false, identifier: null },
      requestHeaders: offlineStylesheetHeaders(),
      postData: null,
      redirectedFrom: null,
      response: null,
      failure: {
        errorText: {
          bytes: 30,
          sha256: "4b47ef4954a96234348ce9b1a492377dca3fd6bb69b657049ce6cf31071e69a3",
        },
      },
      externalTransport: null,
    } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number],
  );
}

function failedStaticRequest(
  manifest: ReturnType<typeof journeyManifest>,
  index: number,
) {
  return manifest.network.requests[index] as unknown as Record<string, unknown>;
}

function offlineStylesheetHeaders() {
  return [
    { name: "accept", value: { bytes: 18, sha256: "c2ad092018fde14a52b5febd6b403e12f11001eed0aff58f453ab8b621a255d3" } },
    { name: "accept-language", value: { bytes: 5, sha256: "d3555b890eb35b88d3cb9ce38d8e64de37a39fcb9d8930fa297f454996543a54" } },
    {
      name: "referer",
      value: canonicalUrl("/offline", [{
        key: "journey_offline",
        value: "<sha256:6b86b273ff34fce1>",
      }]),
    },
    { name: "sec-ch-ua", value: { bytes: 66, sha256: "27e6edc326b21eb663888a7317cfd4710d559fc9e6c8093ff5016c7aa469d4fd" } },
    { name: "sec-ch-ua-mobile", value: { bytes: 2, sha256: "36100dcc5adbcee0b8d9480dda9be2a0cd192e33af3a6933caad3a09fd50c1c0" } },
    { name: "sec-ch-ua-platform", value: { bytes: 9, sha256: "0b1d1e9a36456a50dec652d22d95df7908422c429f91c65e9906ce500aaa2d8b" } },
    { name: "user-agent", value: { bytes: 123, sha256: "3caf269ff15e9469bb7f47985b75b52aa4c2fd24dbe3118b40ca31edb48c9178" } },
  ];
}

function canonicalUrl(
  pathname: string,
  query: Array<{ key: string; value: string }> = [],
) {
  return { origin: "<app-origin>", pathname, query, fragment: null };
}

function oidcBoundary(seed: string) {
  const cookie = (name: string, path: string, boundedSeconds: string, order: number) => ({
    name,
    valueBytes: 64,
    valueSha256: digest(`${seed}:${name}`),
    domain: "pay.ci.clean-pay.dev",
    path,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    expiry: {
      boundedSeconds,
      epochSeconds: 1_788_000_000 + order + (seed === "candidate" ? 100 : 0),
    },
  });
  return [{
    label: "telegram-oidc-cookie-lifecycle",
    value: {
      preCallback: [
        cookie("clean_pay_tg_code_verifier", "/", "1700..1950", 1),
        cookie("clean_pay_tg_nonce", "/", "1700..1950", 2),
        cookie("clean_pay_tg_state", "/", "1700..1950", 3),
      ],
      final: {
        temporaryCookiesCleared: true,
        callbackReceipt: cookie(
          "clean_pay_tg_callback_receipt",
          "/auth/telegram/callback",
          "60..150",
          4,
        ),
      },
      redirectChain: [],
    },
  }];
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
