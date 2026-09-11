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
import {
  DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
  LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS,
} from "../render-policy.mjs";

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
  expect(projected.checkpoints[0]!.cookies[0]!.value.sha256)
    .toBe("<dynamic:cookie-clean_pay_access:1>");
  const oidc = projected.boundaries[0]!.value.preCallback[0]!;
  expect(oidc.expiry.epochSeconds).toBe("<bounded-cookie-expiry>");
  expect(oidc.valueBytes).toBe(64);
});

test("projects only an exactly ledger-backed Server Action ERR_ABORTED schedule", () => {
  const baseline = responseBackedActionAbortManifest();
  const candidate = journeyManifest("candidate");
  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);

  const nearMisses: Array<(
    manifest: ReturnType<typeof responseBackedActionAbortManifest>,
  ) => void> = [
    (manifest) => { manifest.network.serverActionCount = 2; },
    (manifest) => { manifest.network.serverActions[0]!.status = 201; },
    (manifest) => { manifest.network.serverActions[0]!.requestIndex = 1; },
    (manifest) => { manifest.network.requests[0]!.method = "GET"; },
    (manifest) => { manifest.network.requests[0]!.response.status = 201; },
    (manifest) => { manifest.network.requests[0]!.requestHeaders.push({
      ...manifest.network.requests[0]!.requestHeaders[0]!,
    }); },
    (manifest) => { Object.assign(manifest.network.requests[0]!.failure!, {
      unexpected: true,
    }); },
    (manifest) => { Object.assign(manifest.network.requests[0]!, {
      unexpected: true,
    }); },
    (manifest) => { manifest.source.fixtureContract.sha256 = "invalid"; },
  ];
  for (const mutate of nearMisses) {
    const nearMiss = responseBackedActionAbortManifest();
    mutate(nearMiss);
    const projected = project(nearMiss) as typeof nearMiss;
    expect(projected.network.requests[0]!.failure, JSON.stringify(nearMiss))
      .not.toBeNull();
  }
});

test("projects response-backed Server Action aborts after network compaction", () => {
  const manifest = responseBackedActionAbortManifest();
  const prefetch = automaticPrefetchRequest(0);
  const action = manifest.network.requests[0]!;
  action.index = 1;
  manifest.network.requests = [prefetch, action];
  manifest.network.serverActions[0]!.requestIndex = 1;

  const projected = project(manifest) as typeof manifest;
  expect(projected.network.requests).toHaveLength(1);
  expect(projected.network.requests[0]!.index).toBe(0);
  expect(projected.network.requests[0]!.failure).toBeNull();
  expect(projected.network.serverActions[0]!.requestIndex).toBe(0);
});

test("projects exact pending RSC prefetch redirect tails after network compaction", () => {
  const manifest = responseBackedActionAbortManifest();
  const prefetch = automaticPrefetchRequest(0);
  const tail = automaticPrefetchRedirectTailRequest(1, 0);
  const action = manifest.network.requests[0]!;
  action.index = 2;
  manifest.network.requests = [prefetch, tail, action];
  manifest.network.serverActions[0]!.requestIndex = 2;

  const projected = project(manifest) as typeof manifest;
  expect(projected.network.requests).toHaveLength(1);
  expect(projected.network.requests[0]!.index).toBe(0);
  expect(projected.network.serverActions[0]!.requestIndex).toBe(0);

  const nearMiss = responseBackedActionAbortManifest();
  const retainedTail = automaticPrefetchRedirectTailRequest(1, 0);
  retainedTail.url.pathname = "/login";
  nearMiss.network.requests[0]!.index = 2;
  nearMiss.network.requests = [
    automaticPrefetchRequest(0),
    retainedTail,
    nearMiss.network.requests[0]!,
  ];
  nearMiss.network.serverActions[0]!.requestIndex = 2;
  expect((project(nearMiss) as typeof nearMiss).network.requests)
    .toHaveLength(3);
});

test("projects response-backed Server Action aborts beside unrelated pending actions", () => {
  const manifest = responseBackedActionAbortManifest();
  const pending = structuredClone(manifest.network.requests[0]!);
  pending.index = 1;
  pending.url = canonicalUrl("/cabinet");
  pending.response = null as unknown as typeof pending.response;
  pending.failure = null;
  const pendingIdentifier = { bytes: 42, sha256: "f".repeat(64) };
  pending.serverAction.identifier = pendingIdentifier;
  pending.requestHeaders[0]!.value = pendingIdentifier;

  manifest.network.requests.push(pending);
  manifest.network.serverActions.push({
    order: 1,
    requestIndex: 1,
    method: "POST",
    url: canonicalUrl("/cabinet"),
    identifier: pendingIdentifier,
    payload: pending.postData,
    status: 200,
  });
  manifest.network.serverActionCount = 2;

  const projected = project(manifest) as typeof manifest;
  expect(projected.network.requests[0]!.failure).toBeNull();
  expect(projected.network.requests[1]!.response).toBeNull();
});

test("projects exact page announcement and hidden display style noise", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  const snapshotBody = [
    "- main:",
    "  - heading \"Подтверждение оплаты\" [level=1]",
    "  - button \"Перейти к оплате\"",
  ].join("\n");
  const baselineCheckpoint = baseline.checkpoints[0]! as Record<string, unknown>;
  const candidateCheckpoint = candidate.checkpoints[0]! as Record<string, unknown>;
  baselineCheckpoint.ariaSnapshot = `- alert\n${snapshotBody}`;
  candidateCheckpoint.ariaSnapshot = `- alert: Подтверждение оплаты\n${snapshotBody}`;
  baselineCheckpoint.dom = hiddenDisplayDom("display: none; visibility: hidden;");
  candidateCheckpoint.dom = hiddenDisplayDom("display: none;");

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
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
  setPwaShellCache(candidateUuid, "clean-pay-shell-24b4a4eb-27e9-432f-b44c-90bd75fb2ba0");
  const uuidNearMiss = projectPair(baseline, candidateUuid);
  expect(uuidNearMiss.actual).not.toEqual(uuidNearMiss.expected);

  const inconsistent = journeyManifest("candidate");
  setPwaShellCache(inconsistent, pwaRevisionCache(inconsistent));
  pwaBoundaryCacheNames(inconsistent)[0] = `clean-pay-shell-${"b".repeat(40)}`;
  const inconsistentProjection = projectPair(baseline, inconsistent);
  expect(inconsistentProjection.actual).not.toEqual(inconsistentProjection.expected);
  expect(pwaBoundaryCacheNames(inconsistentProjection.expected as typeof baseline)[0])
    .toBe(legacyCache);

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

  const scopedBaseline = journeyManifest("baseline");
  const scopedCandidate = journeyManifest("candidate");
  setPwaShellCache(scopedBaseline, legacyCache);
  setPwaShellCache(scopedCandidate, pwaRevisionCache(scopedCandidate));
  setCheckpointServiceWorkerScopes(scopedBaseline, [[rootServiceWorkerScope()], [rootServiceWorkerScope()]]);
  setCheckpointServiceWorkerScopes(scopedCandidate, [[rootServiceWorkerScope()], [rootServiceWorkerScope()]]);
  expect(projectPair(scopedBaseline, scopedCandidate).actual)
    .toEqual(projectPair(scopedBaseline, scopedCandidate).expected);

  const nonRootScope = journeyManifest("candidate");
  setPwaShellCache(nonRootScope, pwaRevisionCache(nonRootScope));
  setCheckpointServiceWorkerScopes(nonRootScope, [[rootServiceWorkerScope()], [rootServiceWorkerScope()]]);
  setCheckpointServiceWorkerScopes(scopedBaseline, [[rootServiceWorkerScope()], [rootServiceWorkerScope()]]);
  checkpointServiceWorkerScopes(nonRootScope, 0)[0]!.pathname = "/nested";
  expect(projectPair(scopedBaseline, nonRootScope).actual)
    .not.toEqual(projectPair(scopedBaseline, nonRootScope).expected);
});

test("projects authenticated Chatwoot identifiers only with exact matched presence", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(baseline, "baseline", [true, true]);
  setAuthenticatedChatwootGeneratedState(candidate, "candidate", [true, true]);
  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);

  const identityName = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(identityName, "candidate", [true, true]);
  for (const index of [0, 1]) {
    const cookie = authenticatedChatwootCheckpoint(identityName, index).cookies[2] as {
      name: string;
    };
    cookie.name = `cw_user_${digest("unexpected-chatwoot-website-token")}`;
  }
  expect(projectPair(baseline, identityName).actual)
    .not.toEqual(projectPair(baseline, identityName).expected);

  const presenceNearMiss = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(presenceNearMiss, "candidate", [true, false]);
  expect(projectPair(baseline, presenceNearMiss).actual)
    .not.toEqual(projectPair(baseline, presenceNearMiss).expected);

  const ownershipDrift = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(ownershipDrift, "candidate", [true, true]);
  const ownership = authenticatedChatwootCheckpoint(ownershipDrift, 1)
    .storage.local[0]!.value;
  ownership.sha256 = digest("candidate:other-ownership");
  expect(projectPair(baseline, ownershipDrift).actual)
    .toEqual(projectPair(baseline, ownershipDrift).expected);

  const ownershipBytes = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(ownershipBytes, "candidate", [true, true]);
  for (const index of [0, 1]) {
    authenticatedChatwootCheckpoint(ownershipBytes, index)
      .storage.local[0]!.value.bytes = 86;
  }
  expect(projectPair(baseline, ownershipBytes).actual)
    .toEqual(projectPair(baseline, ownershipBytes).expected);

  const ownershipShape = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(ownershipShape, "candidate", [true, true]);
  for (const index of [0, 1]) {
    Object.assign(
      authenticatedChatwootCheckpoint(ownershipShape, index).storage.local[0]!,
      { unexpected: true },
    );
  }
  expect(projectPair(baseline, ownershipShape).actual)
    .not.toEqual(projectPair(baseline, ownershipShape).expected);

  const identityValue = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(identityValue, "candidate", [true, true]);
  for (const index of [0, 1]) {
    const cookie = authenticatedChatwootCheckpoint(identityValue, index).cookies[2] as {
      value: { sha256: string };
    };
    cookie.value.sha256 = digest("unexpected-chatwoot-user");
  }
  expect(projectPair(baseline, identityValue).actual)
    .not.toEqual(projectPair(baseline, identityValue).expected);

  const widenedCookie = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(widenedCookie, "candidate", [true, true]);
  authenticatedChatwootCheckpoint(widenedCookie, 0).cookies.push({
    ...authenticatedChatwootCheckpoint(widenedCookie, 0).cookies[1]!,
    name: "cw_unexpected",
  });
  expect(projectPair(baseline, widenedCookie).actual)
    .not.toEqual(projectPair(baseline, widenedCookie).expected);
});

test("projects only the exact idempotent authenticated Chatwoot boundary retry", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  candidate.journey = baseline.journey;
  const run = {
    method: "run",
    baseUrl: "https://chatwoot.browser.clean-pay.dev",
    websiteTokenBytes: 64,
  };
  const setUser = {
    method: "setUser",
    identifierBytes: 25,
    attributeKeys: ["custom_attributes", "email", "identifier_hash", "name"],
  };
  const hide = { method: "toggleBubbleVisibility", value: "hide" };
  const show = { method: "toggleBubbleVisibility", value: "show" };
  const frameLoaded = { method: "frame.loaded" };
  const removeLabel = { method: "removeLabel", label: "subscription_expired" };
  const identityConfirmed = { method: "identity.confirmed" };
  const canonical = [run, hide, setUser, frameLoaded, show, removeLabel, identityConfirmed];
  const retried = [
    run, hide, setUser, frameLoaded, show,
    show, setUser, frameLoaded, show,
    removeLabel, identityConfirmed,
  ];
  baseline.boundaries = [{ label: "chatwoot-authenticated", value: retried }] as never;
  candidate.boundaries = [{ label: "chatwoot-authenticated", value: canonical }] as never;
  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);

  const changedRetry = structuredClone(baseline);
  const changedCalls = changedRetry.boundaries[0]!.value as unknown as Array<Record<string, unknown>>;
  changedCalls[6] = { ...changedCalls[6], identifierBytes: 26 };
  expect(projectPair(changedRetry, candidate).actual)
    .not.toEqual(projectPair(changedRetry, candidate).expected);

  const extraShow = structuredClone(baseline);
  (extraShow.boundaries[0]!.value as unknown as unknown[]).splice(9, 0, show);
  expect(projectPair(extraShow, candidate).actual)
    .not.toEqual(projectPair(extraShow, candidate).expected);
});

test("projects general Chatwoot journey identifiers before merge-specific checks", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(baseline, "baseline", [true, true]);
  setAuthenticatedChatwootGeneratedState(candidate, "candidate", [true, true]);
  baseline.journey = "telegram-webapp-browser-boundary";
  candidate.journey = "telegram-webapp-browser-boundary";
  for (const index of [0, 1]) {
    authenticatedChatwootCheckpoint(candidate, index)
      .storage.local[0]!.value.bytes = 86;
  }

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const identityTokenDrift = journeyManifest("candidate");
  setAuthenticatedChatwootGeneratedState(identityTokenDrift, "candidate", [true, true]);
  identityTokenDrift.journey = "telegram-webapp-browser-boundary";
  const identity = authenticatedChatwootCheckpoint(identityTokenDrift, 0).cookies[2] as {
    name: string;
  };
  identity.name = `cw_user_${digest("other-chatwoot-website-token")}`;
  expect(projectPair(baseline, identityTokenDrift).actual)
    .not.toEqual(projectPair(baseline, identityTokenDrift).expected);
});

test("projects passive authenticated provider effect order only with exact multiset", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  candidate.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  baseline.providerEffects.entries = [
    passiveProviderEffect(1, "read_profile"),
    passiveProviderEffect(2, "contact_identity_probed"),
    passiveProviderEffect(3, "contact_identity_probed"),
    structuredClone(baseline.providerEffects.entries[0]!),
  ] as unknown as typeof baseline.providerEffects.entries;
  baseline.providerEffects.entries[3]!.sequence = 4;
  candidate.providerEffects.entries = [
    passiveProviderEffect(1, "contact_identity_probed"),
    passiveProviderEffect(2, "read_profile"),
    structuredClone(candidate.providerEffects.entries[0]!),
  ] as unknown as typeof candidate.providerEffects.entries;
  candidate.providerEffects.entries[2]!.sequence = 3;

  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);

  const countNearMiss = journeyManifest("candidate");
  countNearMiss.journey = candidate.journey;
  countNearMiss.providerEffects.entries = [
    passiveProviderEffect(1, "contact_identity_probed"),
    structuredClone(countNearMiss.providerEffects.entries[0]!),
  ] as typeof countNearMiss.providerEffects.entries;
  countNearMiss.providerEffects.entries[1]!.sequence = 2;
  expect(projectPair(baseline, countNearMiss).actual)
    .not.toEqual(projectPair(baseline, countNearMiss).expected);
});

test("projects concurrent Remnawave cabinet reads in the authenticated passive multiset", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  candidate.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  baseline.providerEffects.entries = [
    passiveProviderEffect(1, "read_profile"),
    remnawaveProviderEffect(2),
    structuredClone(baseline.providerEffects.entries[0]!),
  ] as unknown as typeof baseline.providerEffects.entries;
  baseline.providerEffects.entries[2]!.sequence = 3;
  candidate.providerEffects.entries = [
    remnawaveProviderEffect(1),
    passiveProviderEffect(2, "read_profile"),
    structuredClone(candidate.providerEffects.entries[0]!),
  ] as unknown as typeof candidate.providerEffects.entries;
  candidate.providerEffects.entries[2]!.sequence = 3;

  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);
});

test("projects authenticated Chatwoot document abort transport noise", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-account-links-and-merges-telegram";
  candidate.journey = "email-account-links-and-merges-telegram";
  addExactChatwootTransportRequest(baseline, "document");
  const aborted = baseline.network.requests.at(-1)!;
  aborted.url.query = [
    { key: "website_token", value: "<redacted>" },
    { key: "cw_conversation", value: "<redacted>" },
  ];
  aborted.requestHeaders = [{
    name: "referer",
    value: canonicalUrl("/"),
  }] as unknown as typeof aborted.requestHeaders;
  aborted.response = null as unknown as typeof aborted.response;
  aborted.failure = {
    errorText: {
      bytes: 16,
      sha256: "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e",
    },
  };

  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);
});

test("projects response-backed authenticated Chatwoot document abort transport noise", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-account-links-and-merges-telegram";
  candidate.journey = "email-account-links-and-merges-telegram";
  addExactChatwootTransportRequest(baseline, "document");
  const aborted = baseline.network.requests.at(-1)!;
  aborted.url.query = [
    { key: "website_token", value: "<redacted>" },
    { key: "cw_conversation", value: "<redacted>" },
  ];
  aborted.failure = {
    errorText: {
      bytes: 16,
      sha256: "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e",
    },
  };

  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);
});

test("projects authenticated browser noise after removing passive server actions", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-account-links-and-merges-telegram";
  candidate.journey = "email-account-links-and-merges-telegram";
  configureResponseBackedAction(baseline, "/register", 143);
  configureResponseBackedAction(candidate, "/register", 143);
  prependPassiveRefreshAction(baseline);

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).network.serverActions)
    .toHaveLength(1);

  baseline.source.fixtureContract.sha256 = currentJourneyFixtureContractSha256();
  const currentPair = projectCharacterizationManifestPairForComparison(baseline, candidate);
  expect(currentPair.actual).toEqual(currentPair.expected);
});

test("projects response-backed aborted passive authenticated refresh actions", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-account-links-and-merges-telegram";
  candidate.journey = "email-account-links-and-merges-telegram";
  configureResponseBackedAction(baseline, "/register", 143);
  configureResponseBackedAction(candidate, "/register", 143);
  prependPassiveRefreshAction(baseline);
  baseline.network.requests[0]!.failure = {
    errorText: {
      bytes: 16,
      sha256: "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e",
    },
  };

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).network.serverActions)
    .toHaveLength(1);
});

test("projects optional zero content-length on exact 307 redirects", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  candidate.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  setTelegramCallbackRedirect(baseline, false);
  setTelegramCallbackRedirect(candidate, true);

  expect(projectPair(baseline, candidate).actual)
    .toEqual(projectPair(baseline, candidate).expected);
});

test("projects bounded Telegram login server action payload byte drift", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  candidate.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  configureResponseBackedAction(baseline, "/login", 700);
  configureResponseBackedAction(candidate, "/login", 720);
  baseline.network.requests[0]!.url = canonicalUrl("/login");
  baseline.network.serverActions[0]!.url = baseline.network.requests[0]!.url;
  candidate.network.requests[0]!.url = canonicalUrl("/login");
  candidate.network.serverActions[0]!.url = candidate.network.requests[0]!.url;

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).network.requests[0]!.postData.bytes)
    .toBe("<dynamic:telegram-login-payload-bytes>");

  const nearMiss = journeyManifest("candidate");
  nearMiss.journey = candidate.journey;
  configureResponseBackedAction(nearMiss, "/login", 1200);
  nearMiss.network.requests[0]!.url = canonicalUrl("/login");
  nearMiss.network.serverActions[0]!.url = nearMiss.network.requests[0]!.url;
  expect(projectPair(baseline, nearMiss).actual)
    .not.toEqual(projectPair(baseline, nearMiss).expected);
});

test("projects Telegram login payload drift beside passkey setup payload drift", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  candidate.journey = "telegram-oidc-cabinet-profile-link-referral-passkey";
  configureResponseBackedAction(baseline, "/login", 638);
  configureResponseBackedAction(candidate, "/login", 784);
  baseline.network.requests[0]!.url = canonicalUrl("/login");
  baseline.network.serverActions[0]!.url = baseline.network.requests[0]!.url;
  candidate.network.requests[0]!.url = canonicalUrl("/login");
  candidate.network.serverActions[0]!.url = candidate.network.requests[0]!.url;
  appendExactServerAction(
    baseline,
    "/passkey/setup",
    [{ key: "redirect_to", value: "<dynamic:query-redirect_to:1>" }],
    1026,
    "passkey-setup",
  );
  appendExactServerAction(
    candidate,
    "/passkey/setup",
    [{ key: "redirect_to", value: "<dynamic:query-redirect_to:1>" }],
    1172,
    "passkey-setup",
  );

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  const projectedNetwork = (projected.actual as typeof candidate).network;
  expect(projectedNetwork.requests[0]!.postData.bytes)
    .toBe("<dynamic:telegram-login-payload-bytes>");
  expect(projectedNetwork.requests[1]!.postData.bytes)
    .toBe("<dynamic:passkey-setup-payload-bytes>");
});

test("projects final authenticated passive network and provider multiplicity drift", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-account-links-and-merges-telegram";
  candidate.journey = "email-account-links-and-merges-telegram";
  configureResponseBackedAction(baseline, "/register", 143);
  configureResponseBackedAction(candidate, "/register", 143);
  prependPassiveRefreshAction(candidate);
  candidate.providerEffects.entries.push(
    passiveProviderEffect(2, "read_profile") as unknown as typeof candidate.providerEffects.entries[number],
  );

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).network.serverActions)
    .toHaveLength(1);
  expect((projected.actual as typeof candidate).providerEffects.entries)
    .toHaveLength(1);
});

test("projects public install exact provider readiness multiplicity drift", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "public-responsive-keyboard-install-offline-support";
  candidate.journey = "public-responsive-keyboard-install-offline-support";
  baseline.project = "journey-768x1024";
  candidate.project = "journey-768x1024";
  baseline.providerEffects.entries = [
    enrichedReadinessEffect(1, "metadata"),
    enrichedReadinessEffect(2, "email-start"),
    enrichedReadinessEffect(3, "identify"),
    enrichedReadinessEffect(4, "service-session"),
    enrichedReadinessEffect(5, "notification-preferences"),
    enrichedReadinessEffect(6, "plans"),
    enrichedReadinessEffect(7, "jwks"),
    enrichedReadinessEffect(8, "metadata"),
    enrichedReadinessEffect(9, "email-start"),
    enrichedReadinessEffect(10, "identify"),
    enrichedReadinessEffect(11, "service-session"),
    enrichedReadinessEffect(12, "notification-preferences"),
    enrichedReadinessEffect(13, "plans"),
    enrichedReadinessEffect(14, "metadata"),
    enrichedReadinessEffect(15, "jwks"),
    enrichedReadinessEffect(16, "email-start"),
    enrichedReadinessEffect(17, "identify"),
    enrichedReadinessEffect(18, "service-session"),
    enrichedReadinessEffect(19, "notification-preferences"),
  ] as unknown as typeof baseline.providerEffects.entries;
  candidate.providerEffects.entries = [
    enrichedReadinessEffect(1, "plans"),
    enrichedReadinessEffect(2, "metadata"),
    enrichedReadinessEffect(3, "jwks"),
    enrichedReadinessEffect(4, "email-start"),
    enrichedReadinessEffect(5, "identify"),
    enrichedReadinessEffect(6, "service-session"),
    enrichedReadinessEffect(7, "notification-preferences"),
    enrichedReadinessEffect(8, "plans"),
    enrichedReadinessEffect(9, "jwks"),
    enrichedReadinessEffect(10, "metadata"),
    enrichedReadinessEffect(11, "email-start"),
    enrichedReadinessEffect(12, "identify"),
    enrichedReadinessEffect(13, "service-session"),
    enrichedReadinessEffect(14, "notification-preferences"),
    enrichedReadinessEffect(15, "plans"),
    enrichedReadinessEffect(16, "metadata"),
    enrichedReadinessEffect(17, "email-start"),
    enrichedReadinessEffect(18, "jwks"),
    enrichedReadinessEffect(19, "identify"),
    enrichedReadinessEffect(20, "service-session"),
    enrichedReadinessEffect(21, "notification-preferences"),
  ] as unknown as typeof candidate.providerEffects.entries;

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).providerEffects.entries)
    .toHaveLength(0);
});

test("keeps public install active provider multiplicity drift observable", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "public-responsive-keyboard-install-offline-support";
  candidate.journey = "public-responsive-keyboard-install-offline-support";
  baseline.project = "journey-768x1024";
  candidate.project = "journey-768x1024";
  candidate.providerEffects.entries = [
    structuredClone(baseline.providerEffects.entries[0]!),
    structuredClone(baseline.providerEffects.entries[0]!),
  ] as typeof candidate.providerEffects.entries;
  candidate.providerEffects.entries[1]!.sequence = 2;

  const projected = projectPair(baseline, candidate);
  expect((projected.actual as typeof candidate).providerEffects.entries)
    .toHaveLength(2);
});

test("projects authenticated static chunk multiplicity beside passive network drift", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-register-verify-and-login";
  candidate.journey = "email-register-verify-and-login";
  configureResponseBackedAction(baseline, "/register", 143);
  configureResponseBackedAction(candidate, "/register", 143);
  setHashedNextTopology(baseline, "baseline", 4, true);
  setHashedNextTopology(candidate, "candidate", 1, false);
  appendExactServerAction(candidate, "/cabinet", [], 29, "passive-cabinet-refresh");

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).network.serverActions)
    .toHaveLength(1);
});

test("projects authenticated PWA document route beside passive network drift", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "email-account-links-and-merges-telegram";
  candidate.journey = "email-account-links-and-merges-telegram";
  configureResponseBackedAction(baseline, "/register", 143);
  configureResponseBackedAction(candidate, "/register", 143);
  setHashedNextTopology(baseline, "baseline", 3, true);
  setHashedNextTopology(candidate, "candidate", 1, false);
  appendExactServerAction(candidate, "/link-account", [], 29, "passive-link-refresh");
  addPwaControlledDocumentRequest(candidate, "/link-account");

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  expect((projected.actual as typeof candidate).network.serverActions)
    .toHaveLength(1);

  const nearMiss = structuredClone(candidate);
  (nearMiss.network.requests.at(-1)!.response as Record<string, unknown>).headers = [
    { name: "content-type", value: "application/json" },
  ];
  const rejected = projectPair(baseline, nearMiss);
  expect(rejected.actual).not.toEqual(rejected.expected);
});

test("projects passive authenticated payment refresh actions beside active payment actions", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "tariffs-payment-returns-extend-idempotency";
  candidate.journey = "tariffs-payment-returns-extend-idempotency";
  setHashedNextTopology(baseline, "baseline", 2, true);
  setHashedNextTopology(candidate, "candidate", 1, false);

  appendExactServerAction(
    baseline,
    "/payment/pending",
    [{ key: "operation_id", value: "<dynamic:query-operation_id:1>" }],
    29,
    "passive-pending-refresh",
  );
  appendExactServerAction(
    candidate,
    "/payment/pending",
    [{ key: "operation_id", value: "<dynamic:query-operation_id:1>" }],
    29,
    "passive-pending-refresh",
  );
  appendExactServerAction(
    baseline,
    "/payment/pending",
    [{ key: "operation_id", value: "<dynamic:query-operation_id:1>" }],
    29,
    "passive-pending-refresh",
  );
  appendExactServerAction(
    baseline,
    "/payment/pending",
    [{ key: "operation_id", value: "<dynamic:query-operation_id:1>" }],
    62,
    "active-pending-check",
  );
  appendExactServerAction(
    candidate,
    "/payment/pending",
    [{ key: "operation_id", value: "<dynamic:query-operation_id:1>" }],
    62,
    "active-pending-check",
  );
  appendExactServerAction(baseline, "/extend", [], 29, "passive-pending-refresh");
  appendExactServerAction(baseline, "/extend", [], 334, "active-extend");
  appendExactServerAction(candidate, "/extend", [], 334, "active-extend");

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  const projectedNetwork = (projected.actual as typeof candidate).network;
  expect(projectedNetwork.serverActions.map((action) => action.payload.bytes))
    .toEqual([240, 62, 334]);

  const payloadNearMiss = structuredClone(baseline);
  const passiveRequest = payloadNearMiss.network.requests.find((request) => (
    request.url.pathname === "/extend"
    && request.postData?.bytes === 29
  ))!;
  passiveRequest.postData.bytes = 30;
  const passiveAction = payloadNearMiss.network.serverActions.find((action) => (
    action.requestIndex === passiveRequest.index
  ))!;
  passiveAction.payload.bytes = 30;
  expect(projectPair(payloadNearMiss, candidate).actual)
    .not.toEqual(projectPair(payloadNearMiss, candidate).expected);
});

test("projects hashed Next topology only after complete journey semantic proof", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setHashedNextTopology(baseline, "baseline", 3, true);
  setHashedNextTopology(candidate, "candidate", 2, false);
  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  const projectedNetwork = (projected.actual as typeof candidate).network;
  expect(projectedNetwork.requests).toHaveLength(2);
  expect(projectedNetwork.serverActions).toHaveLength(1);
  expect(projectedNetwork.serverActionCount).toBe(1);
  expect(projectedNetwork.serverActions[0]!.requestIndex).toBe(1);
  expect(projectedNetwork.serverActions[0]!.order).toBe(0);
  expect(projectedNetwork.serverActions[0]!.payload.bytes).toBe(240);

  const semanticNearMiss = journeyManifest("candidate");
  setHashedNextTopology(semanticNearMiss, "candidate", 2, false);
  semanticNearMiss.checkpoints[0]!.label = "unexpected-checkpoint";
  const retainedSemantic = projectPair(baseline, semanticNearMiss);
  expect((retainedSemantic.expected as typeof baseline).network.requests).toHaveLength(5);
  expect((retainedSemantic.actual as typeof semanticNearMiss).network.requests).toHaveLength(4);

  const staticNearMiss = journeyManifest("candidate");
  setHashedNextTopology(staticNearMiss, "candidate", 2, false);
  staticNearMiss.network.requests[2]!.response.status = 404;
  const retainedStatic = projectPair(baseline, staticNearMiss);
  expect((retainedStatic.expected as typeof baseline).network.requests).toHaveLength(5);
  expect((retainedStatic.actual as typeof staticNearMiss).network.requests).toHaveLength(4);

  const linkNearMiss = journeyManifest("candidate");
  setHashedNextTopology(linkNearMiss, "candidate", 2, false, 472);
  const retainedLink = projectPair(baseline, linkNearMiss);
  expect((retainedLink.expected as typeof baseline).network.requests).toHaveLength(5);
  expect((retainedLink.actual as typeof linkNearMiss).network.requests).toHaveLength(4);
});

test("projects optional Origin headers on exact journey static chunks", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setHashedNextTopology(baseline, "baseline", 1, false);
  setHashedNextTopology(candidate, "candidate", 1, false);
  baseline.network.requests[1]!.requestHeaders = [{
    name: "origin",
    value: canonicalUrl("/"),
  }] as unknown as typeof baseline.network.requests[number]["requestHeaders"];

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const countDriftBaseline = journeyManifest("baseline");
  const countDriftCandidate = journeyManifest("candidate");
  setHashedNextTopology(countDriftBaseline, "baseline", 2, true);
  setHashedNextTopology(countDriftCandidate, "candidate", 1, false);
  for (const request of countDriftBaseline.network.requests.filter((entry) => (
    entry.resourceType === "script"
  ))) {
    request.requestHeaders = [{
      name: "origin",
      value: canonicalUrl("/"),
    }] as unknown as typeof request.requestHeaders;
  }
  const projectedCountDrift = projectPair(countDriftBaseline, countDriftCandidate);
  expect(projectedCountDrift.actual).toEqual(projectedCountDrift.expected);

  const semanticNearMiss = journeyManifest("candidate");
  setHashedNextTopology(semanticNearMiss, "candidate", 1, false);
  semanticNearMiss.network.requests[0]!.url = canonicalUrl("/profile");
  const retainedSemantic = projectPair(baseline, semanticNearMiss);
  expect(retainedSemantic.actual).not.toEqual(retainedSemantic.expected);

  const headerNearMiss = journeyManifest("candidate");
  setHashedNextTopology(headerNearMiss, "candidate", 1, false);
  baseline.network.requests[1]!.requestHeaders.push({
    name: "authorization",
    value: { bytes: 12, sha256: digest("bearer-token") },
  } as unknown as typeof baseline.network.requests[number]["requestHeaders"][number]);
  const retainedHeader = projectPair(baseline, headerNearMiss);
  expect(retainedHeader.actual).not.toEqual(retainedHeader.expected);
});

test("projects hashed static referers on exact journey font assets", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setHashedNextTopology(baseline, "baseline", 1, false);
  setHashedNextTopology(candidate, "candidate", 1, false);
  addExactFontRequestFromGeneratedStylesheet(baseline, "baseline");
  addExactFontRequestFromGeneratedStylesheet(candidate, "candidate");

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const nearMiss = journeyManifest("candidate");
  setHashedNextTopology(nearMiss, "candidate", 1, false);
  addExactFontRequestFromGeneratedStylesheet(nearMiss, "candidate");
  const fontRequest = nearMiss.network.requests.at(-1)!;
  const referer = fontRequest.requestHeaders.find((header) => (
    header.name === "referer"
  ))!;
  (referer.value as Record<string, unknown>).pathname = "/profile";
  fontRequest.requestHeaders.push({
    name: "rsc",
    value: { bytes: 1, sha256: "0".repeat(64) },
  });

  const rejected = projectPair(baseline, nearMiss);
  expect(rejected.actual).not.toEqual(rejected.expected);
});

test("projects hashed Next topology when a valid chunk floats around a server action", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setHashedNextTopology(baseline, "baseline", 2, true);
  setHashedNextTopology(candidate, "candidate", 1, false);
  moveLastChunkAfterServerAction(candidate);

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);
  const projectedNetwork = (projected.actual as typeof candidate).network;
  expect(projectedNetwork.requests).toHaveLength(2);
  expect(projectedNetwork.serverActions[0]!.requestIndex).toBe(1);

  const staticNearMiss = journeyManifest("candidate");
  setHashedNextTopology(staticNearMiss, "candidate", 1, false);
  staticNearMiss.network.requests[1]!.response.status = 404;
  moveLastChunkAfterServerAction(staticNearMiss);
  const retainedStatic = projectPair(baseline, staticNearMiss);
  expect((retainedStatic.expected as typeof baseline).network.requests).toHaveLength(4);
  expect((retainedStatic.actual as typeof staticNearMiss).network.requests).toHaveLength(3);
});

test("projects fully validated static resource count drift with the app logo", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setHashedNextTopology(baseline, "baseline", 2, true);
  setHashedNextTopology(candidate, "candidate", 1, false);
  addExactLogoRequest(candidate);

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const nearMiss = journeyManifest("candidate");
  setHashedNextTopology(nearMiss, "candidate", 1, false);
  addExactLogoRequest(nearMiss);
  nearMiss.network.requests.at(-1)!.response.headers = [];
  const rejected = projectPair(baseline, nearMiss);
  expect(rejected.actual).not.toEqual(rejected.expected);
});

test("projects exact document static link digest before removed Next disclosure", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  setHashedNextTopology(baseline, "baseline", 1, true);
  setHashedNextTopology(candidate, "candidate", 1, false);

  const projected = projectCharacterizationManifestPairForComparison(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const nearMiss = journeyManifest("candidate");
  setHashedNextTopology(nearMiss, "candidate", 1, false, 472);
  const rejected = projectCharacterizationManifestPairForComparison(baseline, nearMiss);
  expect(rejected.actual).not.toEqual(rejected.expected);
});

test("projects only exact authenticated Chatwoot external transport requests", () => {
  const baseline = journeyManifest("baseline");
  const candidate = journeyManifest("candidate");
  baseline.journey = "telegram-webapp-browser-boundary";
  candidate.journey = "telegram-webapp-browser-boundary";
  setHashedNextTopology(baseline, "baseline", 1, true);
  setHashedNextTopology(candidate, "candidate", 1, false);
  addExactChatwootTransportRequest(candidate, "document");

  const projected = projectPair(baseline, candidate);
  expect(projected.actual).toEqual(projected.expected);

  const oidcDocument = journeyManifest("candidate");
  setHashedNextTopology(oidcDocument, "candidate", 1, false);
  addOidcExternalDocumentRequest(oidcDocument);
  const rejected = projectPair(baseline, oidcDocument);
  expect(rejected.actual).not.toEqual(rejected.expected);
});

test("projects only exact removed Next disclosure headers in HAR entries", () => {
  const disclosure = {
    name: "x-powered-by",
    value: JSON.stringify({
      bytes: 7,
      sha256: "30b7f8482c4f570c063e4dff04b91ddc9b2b5f535ac70fedffb1cf34e0d23ec6",
    }),
  };
  const expected = {
    log: {
      entries: [{
        startedDateTime: "2026-09-08T00:00:00.000Z",
        request: { method: "GET", url: "https://pay.ci.clean-pay.dev/" },
        response: {
          status: 200,
          headers: [
            { name: "content-type", value: "text/html; charset=utf-8" },
            disclosure,
          ],
        },
      }],
    },
  };
  const actual = structuredClone(expected);
  actual.log.entries[0]!.response.headers = [
    { name: "content-type", value: "text/html; charset=utf-8" },
  ];

  const projected = projectCharacterizationManifestPairForComparison(expected, actual);
  expect(projected.actual).toEqual(projected.expected);

  const nearMiss = structuredClone(expected);
  nearMiss.log.entries[0]!.response.headers[1]!.value = JSON.stringify({
    bytes: 7,
    sha256: "f".repeat(64),
  });
  const rejected = projectCharacterizationManifestPairForComparison(nearMiss, actual);
  expect(rejected.actual).not.toEqual(rejected.expected);
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
    ["clean-pay-shell-24b4a4eb-27e9-432f-b44c-90bd75fb2ba0"],
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

  const nearMisses: Array<[
    string,
    (manifest: ReturnType<typeof journeyManifest>) => void,
  ]> = [
    ["failure digest", (manifest) => {
      const failure = failedStaticRequest(manifest, 1).failure as { errorText: { sha256: string } };
      failure.errorText.sha256 = "f".repeat(64);
    }],
    ["offline referer route", (manifest) => {
      const headers = failedStaticRequest(manifest, 1).requestHeaders as Array<Record<string, unknown>>;
      const referer = headers.at(-1)?.value as Record<string, unknown>;
      referer.pathname = "/tariffs";
    }],
    ["forbidden request header", (manifest) => {
      const headers = failedStaticRequest(manifest, 1).requestHeaders as unknown[];
      headers.push({ name: "rsc", value: { bytes: 1, sha256: "0".repeat(64) } });
    }],
    ["static pathname", (manifest) => {
      const url = failedStaticRequest(manifest, 2).url as Record<string, unknown>;
      url.pathname = "/_next/static/chunks/not-opaque.txt";
    }],
    ["request method", (manifest) => {
      Object.assign(failedStaticRequest(manifest, 1), { method: "POST" });
    }],
  ];
  for (const [label, mutate] of nearMisses) {
    const nearMiss = journeyManifest("candidate");
    addFailedStaticRequests(nearMiss, "candidate");
    mutate(nearMiss);
    expect(project(nearMiss), label).not.toEqual(project(baseline));
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
  const liveOverlapLaunchArgs = journeyChromiumLaunchArgs(
    resolverIp,
    "live-overlap",
  );
  const exactLiveOverlapPolicy = {
    ...exactPolicy,
    launchArgs: liveOverlapLaunchArgs,
  };
  expect(launchArgs).toEqual([
    ...DETERMINISTIC_CHROMIUM_LAUNCH_ARGS,
    "--ignore-certificate-errors",
    launchArgs.at(-1),
  ]);
  expect(liveOverlapLaunchArgs).toEqual([
    ...LIVE_OVERLAP_CHROMIUM_LAUNCH_ARGS,
    "--ignore-certificate-errors",
    launchArgs.at(-1),
  ]);
  expect(journeyProvenanceLaunchArgs()).not.toContain("--disable-partial-raster");
  expect(journeyProvenanceLaunchArgs("live-overlap")).toContain(
    "--disable-partial-raster",
  );
  expect(() => assertJourneyBrowserPolicy(
    exactLiveOverlapPolicy,
    "live-overlap",
  )).not.toThrow();
  expect(() => assertJourneyBrowserPolicy(exactLiveOverlapPolicy)).toThrow();
  expect(() => assertJourneyBrowserPolicy(
    exactPolicy,
    "live-overlap",
  )).toThrow();
  expect(() => journeyChromiumLaunchArgs(
    resolverIp,
    "invalid" as "canonical",
  )).toThrow(/renderer policy is invalid/);
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
        failure: null as {
          errorText: { bytes: number; sha256: string };
          unexpected?: boolean;
        } | null,
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

function responseBackedActionAbortManifest() {
  const manifest = journeyManifest("baseline");
  manifest.network.requests[0]!.failure = {
    errorText: {
      bytes: 16,
      sha256: "7ba7a1709a2d7d220e120c927e0a7e90adf45c88b09ba912b237d705090d1d4e",
    },
  };
  return manifest;
}

function passiveProviderEffect(
  sequence: number,
  effect: "contact_identity_probed" | "read_profile",
) {
  if (effect === "contact_identity_probed") {
    return {
      sequence,
      service: "chatwoot",
      method: "GET",
      pathname: "/api/v1/widget/contact",
      query_keys: ["website_token"],
      body_bytes: 0,
      body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      body_contract: null,
      idempotency_key_present: false,
      idempotency_key_sha256: null,
      idempotency_key_contract: null,
      credential_contract: {
        header_names: ["x-auth-token"],
        authorization_scheme: null,
        cookie_names: [],
      },
      effect,
    };
  }
  return {
    sequence,
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/auth/me",
    query_keys: [],
    body_bytes: 0,
    body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    body_contract: null,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      header_names: ["x-remnashop-auth-service-key"],
      authorization_scheme: null,
      cookie_names: ["access_token"],
    },
    effect,
  };
}

function enrichedReadinessEffect(
  sequence: number,
  kind: "email-start" | "identify" | "jwks" | "metadata" | "notification-preferences"
    | "plans" | "service-session",
) {
  const base = {
    sequence,
    query_keys: [] as string[],
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
  };
  if (kind === "plans") {
    return {
      ...base,
      service: "remnashop",
      method: "GET",
      pathname: "/api/v1/public/plans/public",
      body_bytes: 0,
      body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      body_contract: null,
      credential_contract: {
        header_names: [],
        authorization_scheme: null,
        cookie_names: [],
      },
      effect: "read_public_plans",
    };
  }
  if (kind === "metadata") {
    return {
      ...base,
      service: "remnawave",
      method: "GET",
      pathname: "/api/system/metadata",
      body_bytes: 0,
      body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      body_contract: null,
      credential_contract: {
        header_names: ["authorization"],
        authorization_scheme: "Bearer",
        cookie_names: [],
      },
      effect: "read_metadata",
    };
  }
  if (kind === "jwks") {
    return {
      ...base,
      service: "telegram-oidc",
      method: "GET",
      pathname: "/.well-known/jwks.json",
      body_bytes: 0,
      body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      body_contract: null,
      credential_contract: {
        header_names: [],
        authorization_scheme: null,
        cookie_names: [],
      },
      effect: "jwks_read",
    };
  }
  const pathnameByKind = {
    "email-start": "/api/v1/public/auth/email/start",
    identify: "/api/v1/public/auth/identify",
    "service-session": "/api/v1/public/auth/service-session",
    "notification-preferences": "/api/v1/public/auth/notification-preferences",
  };
  return {
    ...base,
    service: "remnashop",
    method: "POST",
    pathname: pathnameByKind[kind],
    body_bytes: 2,
    body_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    body_contract: {
      encoding: "json",
      value: {},
    },
    credential_contract: {
      header_names: ["x-remnashop-auth-service-key"],
      authorization_scheme: null,
      cookie_names: [],
    },
    effect: "probe_contract",
  };
}

function remnawaveProviderEffect(sequence: number) {
  return {
    sequence,
    service: "remnawave",
    method: "GET",
    pathname: "/api/users/rw-browser-1",
    query_keys: [],
    body_bytes: 0,
    body_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    body_contract: null,
    idempotency_key_present: false,
    idempotency_key_sha256: null,
    idempotency_key_contract: null,
    credential_contract: {
      header_names: ["authorization"],
      authorization_scheme: "Bearer",
      cookie_names: [],
    },
    effect: "read_user_by_uuid",
  };
}

function configureResponseBackedAction(
  manifest: ReturnType<typeof journeyManifest>,
  pathname: string,
  payloadBytes: number,
) {
  const request = manifest.network.requests[0]!;
  const action = manifest.network.serverActions[0]!;
  request.url = canonicalUrl(pathname, [{ key: "redirect_to", value: "<dynamic:query-redirect_to:1>" }]);
  request.postData.bytes = payloadBytes;
  request.response = {
    status: 200,
    headers: [{ name: "content-type", value: "text/x-component" }],
  } as typeof request.response;
  action.url = request.url;
  action.payload = request.postData;
  action.status = 200;
}

function prependPassiveRefreshAction(
  manifest: ReturnType<typeof journeyManifest>,
) {
  const activeRequest = manifest.network.requests[0]!;
  activeRequest.index = 1;
  const activeAction = manifest.network.serverActions[0]!;
  activeAction.requestIndex = 1;
  activeAction.order = 1;

  const passiveIdentifier = { bytes: 42, sha256: digest("passive-refresh:identifier") };
  const passivePayload = { bytes: 29, sha256: digest("passive-refresh:payload") };
  const passiveUrl = canonicalUrl("/cabinet");
  manifest.network.requests = [{
    ...structuredClone(activeRequest),
    index: 0,
    url: passiveUrl,
    serverAction: { present: true, identifier: { ...passiveIdentifier } },
    requestHeaders: [{ name: "next-action", value: { ...passiveIdentifier } }],
    postData: { ...passivePayload },
  }, activeRequest] as typeof manifest.network.requests;
  manifest.network.serverActions = [{
    order: 0,
    requestIndex: 0,
    method: "POST",
    url: passiveUrl,
    identifier: { ...passiveIdentifier },
    payload: { ...passivePayload },
    status: 200,
  }, activeAction] as typeof manifest.network.serverActions;
  manifest.network.serverActionCount = manifest.network.serverActions.length;
}

function setTelegramCallbackRedirect(
  manifest: ReturnType<typeof journeyManifest>,
  withContentLength: boolean,
) {
  const request = manifest.network.requests[0]!;
  request.method = "GET";
  request.url = canonicalUrl("/auth/telegram/callback", [
    { key: "code", value: "<opaque>" },
    { key: "state", value: "<opaque>" },
  ]);
  request.resourceType = "document";
  request.navigation = true;
  request.serverAction = { present: false, identifier: null } as never;
  request.requestHeaders = [];
  request.postData = null as never;
  request.response = {
    status: 307,
    headers: [
      ...(withContentLength ? [{ name: "content-length", value: "0" }] : []),
      { name: "location", value: canonicalUrl("/cabinet") },
    ],
  } as typeof request.response;
  manifest.network.serverActions = [] as typeof manifest.network.serverActions;
  manifest.network.serverActionCount = 0;
}

function hiddenDisplayDom(style: string) {
  return {
    type: "element",
    tag: "div",
    attributes: [],
    children: [{
      type: "element",
      tag: "div",
      attributes: [{ name: "style", value: style }],
      children: [],
    }],
  };
}

function automaticPrefetchRequest(index: number) {
  return {
    index,
    method: "GET",
    url: canonicalUrl("/tariffs", [{ key: "_rsc", value: "prefetch" }]),
    scope: "application",
    resourceType: "fetch",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [
      {
        name: "next-router-prefetch",
        value: {
          bytes: 1,
          sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
        },
      },
      {
        name: "rsc",
        value: {
          bytes: 1,
          sha256: "6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b",
        },
      },
    ],
    postData: null,
    redirectedFrom: null,
    response: { status: 200, headers: [] },
    failure: null,
    externalTransport: null,
  } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number];
}

function automaticPrefetchRedirectTailRequest(index: number, redirectedFrom: number) {
  return {
    index,
    method: "GET",
    url: canonicalUrl("/", [{ key: "_rsc", value: "<opaque>" }]),
    scope: "application",
    resourceType: "fetch",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [{
      name: "<header-read-error>",
      value: {
        bytes: 27,
        sha256: "870509317b49032de4cf9012617dfb66bf0d0122e6a2f5b789ba242a4a81c07d",
      },
    }],
    postData: null,
    redirectedFrom,
    response: null,
    failure: null,
    externalTransport: null,
  } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number];
}

function setHashedNextTopology(
  manifest: ReturnType<typeof journeyManifest>,
  seed: string,
  scriptCount: number,
  poweredBy: boolean,
  linkBytes = 471,
) {
  const action = structuredClone(manifest.network.requests[0]!);
  const linkHeader = {
    name: "link",
    value: { bytes: linkBytes, sha256: digest(`${seed}:next-link`) },
  };
  const headers = [
    linkHeader,
    ...(poweredBy ? [{
      name: "x-powered-by",
      value: {
        bytes: 7,
        sha256: "30b7f8482c4f570c063e4dff04b91ddc9b2b5f535ac70fedffb1cf34e0d23ec6",
      },
    }] : []),
  ];
  const document = {
    index: 0,
    method: "GET",
    url: canonicalUrl("/cabinet"),
    scope: "application",
    resourceType: "document",
    navigation: true,
    serverAction: { present: false, identifier: null },
    requestHeaders: [],
    postData: null,
    redirectedFrom: null,
    response: { status: 200, headers },
    failure: null,
    externalTransport: null,
  };
  const scripts = Array.from({ length: scriptCount }, (_, offset) => ({
    index: offset + 1,
    method: "GET",
    url: canonicalUrl(`/_next/static/chunks/${seed}${offset}12345678.js`),
    scope: "application",
    resourceType: "script",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [],
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      headers: [{
        name: "etag",
        value: { bytes: 20, sha256: digest(`${seed}:${offset}:etag`) },
      }],
    },
    failure: null,
    externalTransport: null,
  }));
  action.index = scripts.length + 1;
  manifest.network.requests = [
    document,
    ...scripts,
    action,
  ] as unknown as typeof manifest.network.requests;
  manifest.network.serverActions[0]!.requestIndex = action.index;
}

function moveLastChunkAfterServerAction(
  manifest: ReturnType<typeof journeyManifest>,
) {
  const document = manifest.network.requests[0]!;
  const staticRequest = manifest.network.requests[1]!;
  const action = manifest.network.requests[2]!;
  manifest.network.requests = [
    document,
    action,
    staticRequest,
  ] as typeof manifest.network.requests;
  for (const [index, request] of manifest.network.requests.entries()) {
    request.index = index;
  }
  manifest.network.serverActions[0]!.requestIndex = 1;
}

function addExactLogoRequest(
  manifest: ReturnType<typeof journeyManifest>,
) {
  manifest.network.requests.push({
    index: manifest.network.requests.length,
    method: "GET",
    url: canonicalUrl("/clean-pay-logo.png"),
    scope: "application",
    resourceType: "image",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [],
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      headers: [{ name: "content-type", value: "image/png" }],
    },
    failure: null,
    externalTransport: null,
  } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number]);
}

function addExactFontRequestFromGeneratedStylesheet(
  manifest: ReturnType<typeof journeyManifest>,
  seed: string,
) {
  manifest.network.requests.push({
    index: manifest.network.requests.length,
    method: "GET",
    url: canonicalUrl(`/_next/static/media/Inter-roman.var.${seed}12345678.woff2`),
    scope: "application",
    resourceType: "font",
    navigation: false,
    serverAction: { present: false, identifier: null },
    requestHeaders: [
      { name: "accept", value: { bytes: 3, sha256: "7994750c119d1c03615dde46677ccae5429cdbfc2687b51224f0ae6c5609a63d" } },
      { name: "origin", value: canonicalUrl("/") },
      {
        name: "referer",
        value: canonicalUrl(`/_next/static/chunks/${seed}style12345678.css`),
      },
    ],
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      headers: [
        { name: "content-length", value: "1234" },
        { name: "content-type", value: "font/woff2" },
        { name: "etag", value: { bytes: 20, sha256: digest(`${seed}:font-etag`) } },
      ],
    },
    failure: null,
    externalTransport: null,
  } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number]);
}

function appendExactServerAction(
  manifest: ReturnType<typeof journeyManifest>,
  pathname: string,
  query: Array<{ key: string; value: string }>,
  bytes: number,
  seed: string,
) {
  const template = structuredClone(manifest.network.requests.find((request) => (
    request.serverAction.present === true
  ))!);
  const index = manifest.network.requests.length;
  const identifier = { bytes: 42, sha256: digest(`${seed}:identifier`) };
  const payload = { bytes, sha256: digest(`${seed}:payload`) };
  const url = canonicalUrl(pathname, query);
  template.index = index;
  template.url = url;
  template.serverAction.identifier = identifier;
  template.requestHeaders = [{
    name: "next-action",
    value: identifier,
  }] as typeof template.requestHeaders;
  template.postData = payload;
  template.response = {
    status: 200,
    headers: [{ name: "content-type", value: "text/x-component" }],
  } as typeof template.response;
  template.failure = null;
  manifest.network.requests.push(template);
  manifest.network.serverActions.push({
    order: manifest.network.serverActions.length,
    requestIndex: index,
    method: "POST",
    url,
    identifier,
    payload,
    status: 200,
  });
  manifest.network.serverActionCount = manifest.network.serverActions.length;
}

function addExactChatwootTransportRequest(
  manifest: ReturnType<typeof journeyManifest>,
  kind: "document" | "script",
) {
  const request = kind === "script"
    ? {
        method: "GET",
        url: {
          origin: "<external-origin:b57b2ced207f8793>",
          pathname: "<external-path:segments=3:extension=js>",
          query: [],
          fragment: null,
        },
        scope: "external",
        resourceType: "script",
        navigation: false,
        serverAction: { present: false, identifier: null },
        requestHeaders: chatwootTransportHeaders("script"),
        postData: null,
        redirectedFrom: null,
        response: {
          status: 200,
          statusText: "",
          fromServiceWorker: false,
          headers: [{ name: "content-type", value: "application/javascript" }],
        },
        failure: null,
        externalTransport: "<redacted>",
      }
    : {
        method: "GET",
        url: {
          origin: "<external-origin:b57b2ced207f8793>",
          pathname: "<external-path:segments=1:extension=none>",
          query: [{ key: "website_token", value: "<redacted>" }],
          fragment: null,
        },
        scope: "external",
        resourceType: "document",
        navigation: true,
        serverAction: { present: false, identifier: null },
        requestHeaders: chatwootTransportHeaders("document"),
        postData: null,
        redirectedFrom: null,
        response: {
          status: 200,
          statusText: "",
          fromServiceWorker: false,
          headers: [{ name: "content-type", value: "text/html" }],
        },
        failure: null,
        externalTransport: "<redacted>",
      };
  pushRequest(manifest, request);
}

function addOidcExternalDocumentRequest(
  manifest: ReturnType<typeof journeyManifest>,
) {
  pushRequest(manifest, {
    method: "GET",
    url: {
      origin: "<external-origin:bbd8ca2460770262>",
      pathname: "<external-path:segments=1:extension=none>",
      query: [
        { key: "response_type", value: "<redacted>" },
        { key: "client_id", value: "<redacted>" },
      ],
      fragment: null,
    },
    scope: "external",
    resourceType: "document",
    navigation: true,
    serverAction: { present: false, identifier: null },
    requestHeaders: chatwootTransportHeaders("document"),
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      statusText: "",
      fromServiceWorker: true,
      headers: [{ name: "content-type", value: "text/html; charset=utf-8" }],
    },
    failure: null,
    externalTransport: "<redacted>",
  });
}

function addPwaControlledDocumentRequest(
  manifest: ReturnType<typeof journeyManifest>,
  pathname: "/cabinet" | "/link-account",
) {
  pushRequest(manifest, {
    method: "GET",
    url: canonicalUrl(pathname),
    scope: "application",
    resourceType: "document",
    navigation: true,
    serverAction: { present: false, identifier: null },
    requestHeaders: [],
    postData: null,
    redirectedFrom: null,
    response: {
      status: 200,
      statusText: "",
      fromServiceWorker: true,
      headers: [{ name: "content-type", value: "text/html; charset=utf-8" }],
    },
    failure: null,
    externalTransport: null,
  });
}

function chatwootTransportHeaders(kind: "document" | "script") {
  return [
    {
      name: "accept",
      value: kind === "script"
        ? {
            bytes: 3,
            sha256: "7994750c119d1c03615dde46677ccae5429cdbfc2687b51224f0ae6c5609a63d",
          }
        : {
            bytes: 135,
            sha256: "f2dc86899f6d0ab65c244825bbe60c0d8c267385ccb5204812d5f8b07f79ec6c",
          },
    },
    {
      name: "referer",
      value: canonicalUrl("/"),
    },
  ];
}

function pushRequest(
  manifest: ReturnType<typeof journeyManifest>,
  request: Record<string, unknown>,
) {
  manifest.network.requests.push({
    index: manifest.network.requests.length,
    ...request,
  } as unknown as ReturnType<typeof journeyManifest>["network"]["requests"][number]);
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

function setAuthenticatedChatwootGeneratedState(
  manifest: ReturnType<typeof journeyManifest>,
  seed: string,
  identityPresence: [boolean, boolean],
) {
  manifest.journey = "email-register-verify-and-login";
  const access = manifest.checkpoints[0]!.cookies[0]!;
  const conversation = {
    name: "cw_conversation",
    value: { bytes: 25, sha256: digest(`${seed}:chatwoot-conversation`) },
    domain: "<app-host>",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  };
  const identity = {
    name: `cw_user_${digest("synthetic-chatwoot-website-token")}`,
    value: { bytes: 23, sha256: digest("synthetic-chatwoot-user") },
    domain: "<app-host>",
    path: "/",
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  };
  const ownership = {
    key: "clean-pay:chatwoot-ownership:v1",
    value: { bytes: 85, sha256: digest(`${seed}:chatwoot-ownership`) },
  };
  manifest.checkpoints = (["register-cabinet", "email-login-cabinet"] as const)
    .map((label, index) => ({
      label,
      url: canonicalUrl("/cabinet"),
      cookies: [
        structuredClone(access),
        structuredClone(conversation),
        ...(identityPresence[index] ? [structuredClone(identity)] : []),
      ],
      storage: {
        local: [structuredClone(ownership)],
        session: [],
        cacheNames: [],
        serviceWorkerScopes: [],
      },
    })) as unknown as typeof manifest.checkpoints;
}

function authenticatedChatwootCheckpoint(
  manifest: ReturnType<typeof journeyManifest>,
  index: number,
) {
  return manifest.checkpoints[index] as unknown as {
    cookies: Array<Record<string, unknown>>;
    storage: {
      local: Array<{ value: { bytes: number; sha256: string } }>;
    };
  };
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

function rootServiceWorkerScope() {
  return canonicalUrl("/");
}

function setCheckpointServiceWorkerScopes(
  manifest: ReturnType<typeof journeyManifest>,
  values: Array<ReturnType<typeof rootServiceWorkerScope>[]>,
) {
  const checkpoints = (manifest as unknown as Record<string, unknown>).checkpoints as unknown[];
  for (const [index, scopes] of values.entries()) {
    const checkpoint = checkpoints[index] as { storage: { serviceWorkerScopes: unknown[] } };
    checkpoint.storage.serviceWorkerScopes = scopes.map((scope) => ({ ...scope }));
  }
}

function checkpointServiceWorkerScopes(
  manifest: ReturnType<typeof journeyManifest>,
  index: number,
) {
  const checkpoint = ((manifest as unknown as Record<string, unknown>).checkpoints as Array<{
    storage: { serviceWorkerScopes: ReturnType<typeof rootServiceWorkerScope>[] };
  }>)[index]!;
  return checkpoint.storage.serviceWorkerScopes;
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
