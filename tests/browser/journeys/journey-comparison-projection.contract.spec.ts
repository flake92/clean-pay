import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { projectCharacterizationManifestForComparison } from "../comparison-projection";
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
  expect(projected.checkpoints[0]!.cookies[0]!.value.bytes).toBe(256);
  const oidc = projected.boundaries[0]!.value.preCallback[0]!;
  expect(oidc.expiry.epochSeconds).toBe("<bounded-cookie-expiry>");
  expect(oidc.valueBytes).toBe(64);
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
        requestHeaders: [],
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
