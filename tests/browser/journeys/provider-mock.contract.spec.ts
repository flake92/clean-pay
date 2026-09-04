import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";

import { expect, test } from "@playwright/test";

const journeyDirectory = path.resolve(__dirname);
const authServiceKey = digest("clean-pay-browser-journey:remnashop-auth");
const apiKey = digest("clean-pay-browser-journey:remnashop-api");
const remnawaveToken = digest("clean-pay-browser-journey:remnawave");
const cabinetReadOverlapAction = "cabinet_read_overlap_once";
const cabinetReadOverlapProbe = "cabinet-offers-devices-overlap";
const cabinetReadOverlapTimeoutMs = 250;
const cabinetReadParticipants = [
  {
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/devices",
  },
  {
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/offers",
  },
] as const;

type CabinetReadParticipant = {
  service: string;
  method: string;
  pathname: string;
  entered: boolean;
  ledgerSequence: number | null;
};

type CabinetReadWindow = {
  probe: string;
  occurrence: number;
  timeoutMs: number;
  participants: CabinetReadParticipant[];
  duplicates: Array<{
    service: string;
    method: string;
    pathname: string;
    ledgerSequence: number;
  }>;
  enteredCount: number;
  maxInFlight: number;
  release: string;
  outcome: string;
};

type CabinetReadEvidence = {
  contractVersion: number;
  active: null | Omit<CabinetReadWindow, "duplicates" | "release" | "outcome">;
  windows: CabinetReadWindow[];
};

test("records a bounded one-shot offers/devices overlap proof without changing disabled semantics", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
      CLEAN_PAY_BROWSER_CABINET_READ_OVERLAP_TIMEOUT_MS:
        String(cabinetReadOverlapTimeoutMs),
    }));

    const control = `http://127.0.0.1:${controlPort}`;
    const shop = `http://127.0.0.1:${remnashopPort}/api/v1/public`;
    await Promise.all([
      waitForOk(`${control}/__health`),
      waitForOk(`http://127.0.0.1:${oidcPort}/.well-known/jwks.json`),
    ]);
    expect(await concurrencyEvidence(control)).toEqual({
      contractVersion: 1,
      active: null,
      windows: [],
    });

    const login = await postSession(`${shop}/auth/login`, {
      email: "synthetic.browser@clean-pay.dev",
      password: "synthetic-password",
    });
    const [ordinaryOffers, ordinaryDevices] = await Promise.all([
      subscriptionRead(`${shop}/subscription/offers`, login.cookie),
      subscriptionRead(`${shop}/subscription/devices`, login.cookie),
    ]);
    const ordinaryLedger = await fetchJson(`${control}/__ledger`) as {
      entries: Array<{ effect: string }>;
    };
    expect(Object.keys(ordinaryLedger)).toEqual(["entries"]);
    expect(ordinaryLedger.entries.filter(({ effect }) => (
      effect === "read_offers" || effect === "read_devices"
    )).map(({ effect }) => effect).sort()).toEqual(["read_devices", "read_offers"]);
    expect(await concurrencyEvidence(control)).toEqual({
      contractVersion: 1,
      active: null,
      windows: [],
    });

    const widenedInjection = await fetch(`${control}/__inject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: cabinetReadOverlapAction, timeoutMs: 1 }),
    });
    expect(widenedInjection.status).toBe(422);
    await expect(widenedInjection.json()).resolves.toEqual({
      error: "unsupported_injection",
    });

    await armCabinetReadOverlap(control);
    const repeatedArm = await fetch(`${control}/__inject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: cabinetReadOverlapAction }),
    });
    expect(repeatedArm.status).toBe(409);
    await expect(repeatedArm.json()).resolves.toEqual({
      error: "concurrency_probe_already_armed",
    });

    let firstDeviceSettled = false;
    const firstDevice = subscriptionRead(
      `${shop}/subscription/devices`,
      login.cookie,
    ).finally(() => { firstDeviceSettled = true; });
    const deviceActive = await waitForConcurrencyEvidence(
      control,
      (evidence) => evidence.active?.enteredCount === 1,
    );
    expect(deviceActive.active).toEqual({
      probe: cabinetReadOverlapProbe,
      occurrence: 1,
      timeoutMs: cabinetReadOverlapTimeoutMs,
      participants: [
        { ...cabinetReadParticipants[0], entered: true, ledgerSequence: expect.any(Number) },
        { ...cabinetReadParticipants[1], entered: false, ledgerSequence: null },
      ],
      enteredCount: 1,
      maxInFlight: 1,
    });
    await subscriptionRead(`${shop}/subscription/current`, login.cookie);
    expect(firstDeviceSettled).toBe(false);
    const firstOffer = subscriptionRead(`${shop}/subscription/offers`, login.cookie);
    const [provenDevices, provenOffers] = await Promise.all([firstDevice, firstOffer]);
    expect(provenDevices).toEqual(ordinaryDevices);
    expect(provenOffers).toEqual(ordinaryOffers);

    const firstProof = await concurrencyEvidence(control);
    expect(firstProof).toEqual({
      contractVersion: 1,
      active: null,
      windows: [provenWindow(1)],
    });
    await expectConcurrencyLedgerReferences(control, firstProof.windows);

    await armCabinetReadOverlap(control);
    const secondOffer = subscriptionRead(`${shop}/subscription/offers`, login.cookie);
    await waitForConcurrencyEvidence(
      control,
      (evidence) => evidence.active?.participants[1]?.entered === true,
    );
    const secondDevice = subscriptionRead(`${shop}/subscription/devices`, login.cookie);
    const [reverseOffers, reverseDevices] = await Promise.all([secondOffer, secondDevice]);
    expect(reverseOffers).toEqual(ordinaryOffers);
    expect(reverseDevices).toEqual(ordinaryDevices);
    const reverseProof = await concurrencyEvidence(control);
    expect(reverseProof.windows).toEqual([provenWindow(1), provenWindow(2)]);
    await expectConcurrencyLedgerReferences(control, reverseProof.windows);

    await armCabinetReadOverlap(control);
    const originalOffer = subscriptionRead(`${shop}/subscription/offers`, login.cookie);
    const duplicateActive = await waitForConcurrencyEvidence(
      control,
      (evidence) => evidence.active?.participants[1]?.entered === true,
    );
    const originalOfferSequence = duplicateActive.active?.participants[1]?.ledgerSequence;
    expect(originalOfferSequence).toEqual(expect.any(Number));
    const duplicateOffer = subscriptionRead(`${shop}/subscription/offers`, login.cookie);
    const [originalOfferBody, duplicateOfferBody] = await Promise.all([
      originalOffer,
      duplicateOffer,
    ]);
    expect(originalOfferBody).toEqual(ordinaryOffers);
    expect(duplicateOfferBody).toEqual(ordinaryOffers);
    const duplicateProof = await concurrencyEvidence(control);
    expect(duplicateProof.windows[2]).toEqual({
      probe: cabinetReadOverlapProbe,
      occurrence: 3,
      timeoutMs: cabinetReadOverlapTimeoutMs,
      participants: [
        { ...cabinetReadParticipants[0], entered: false, ledgerSequence: null },
        {
          ...cabinetReadParticipants[1],
          entered: true,
          ledgerSequence: originalOfferSequence,
        },
      ],
      duplicates: [{
        ...cabinetReadParticipants[1],
        ledgerSequence: expect.any(Number),
      }],
      enteredCount: 1,
      maxInFlight: 2,
      release: "invalid-duplicate",
      outcome: "invalid",
    });
    await expectConcurrencyLedgerReferences(control, duplicateProof.windows);

    await armCabinetReadOverlap(control);
    const timedOutDevice = await subscriptionRead(
      `${shop}/subscription/devices`,
      login.cookie,
    );
    expect(timedOutDevice).toEqual(ordinaryDevices);
    const timeoutProof = await concurrencyEvidence(control);
    expect(timeoutProof.windows[3]).toEqual({
      probe: cabinetReadOverlapProbe,
      occurrence: 4,
      timeoutMs: cabinetReadOverlapTimeoutMs,
      participants: [
        { ...cabinetReadParticipants[0], entered: true, ledgerSequence: expect.any(Number) },
        { ...cabinetReadParticipants[1], entered: false, ledgerSequence: null },
      ],
      duplicates: [],
      enteredCount: 1,
      maxInFlight: 1,
      release: "bounded-timeout",
      outcome: "timeout",
    });
    await expectConcurrencyLedgerReferences(control, timeoutProof.windows);

    await armCabinetReadOverlap(control);
    const absentProof = await waitForConcurrencyEvidence(
      control,
      (evidence) => evidence.windows.length === 5,
    );
    expect(absentProof.windows[4]).toEqual({
      probe: cabinetReadOverlapProbe,
      occurrence: 5,
      timeoutMs: cabinetReadOverlapTimeoutMs,
      participants: cabinetReadParticipants.map((participant) => ({
        ...participant,
        entered: false,
        ledgerSequence: null,
      })),
      duplicates: [],
      enteredCount: 0,
      maxInFlight: 0,
      release: "bounded-timeout",
      outcome: "timeout",
    });

    await armCabinetReadOverlap(control);
    const resetOffer = subscriptionRead(`${shop}/subscription/offers`, login.cookie);
    await waitForConcurrencyEvidence(
      control,
      (evidence) => evidence.active?.enteredCount === 1,
    );
    await postJson(`${control}/__reset`, { scenario: "contract-overlap-reset" });
    expect(await resetOffer).toEqual(ordinaryOffers);
    expect(await concurrencyEvidence(control)).toEqual({
      contractVersion: 1,
      active: null,
      windows: [],
    });

    const loginAfterReset = await postSession(`${shop}/auth/login`, {
      email: "synthetic.browser@clean-pay.dev",
      password: "synthetic-password",
    });
    const [resetOffers, resetDevices] = await Promise.all([
      subscriptionRead(`${shop}/subscription/offers`, loginAfterReset.cookie),
      subscriptionRead(`${shop}/subscription/devices`, loginAfterReset.cookie),
    ]);
    expect(resetOffers).toEqual(ordinaryOffers);
    expect(resetDevices).toEqual(ordinaryDevices);
    expect(await concurrencyEvidence(control)).toEqual({
      contractVersion: 1,
      active: null,
      windows: [],
    });
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("two reset/seed cycles restore every mutable provider and OIDC state", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
    }));

    const control = `http://127.0.0.1:${controlPort}`;
    const shop = `http://127.0.0.1:${remnashopPort}/api/v1/public`;
    const oidc = `http://127.0.0.1:${oidcPort}`;
    const wave = `http://127.0.0.1:${remnawavePort}`;
    await Promise.all([
      waitForOk(`${control}/__health`),
      waitForOk(`${oidc}/.well-known/jwks.json`),
    ]);

    const first = await mutateAndReset({ control, shop, oidc });
    const second = await mutateAndReset({ control, shop, oidc });
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: "reset",
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
      },
      oidc: { status: "reset", codes: 0, authorize_sequence: 0 },
    });
    await expect(fetchJson(`${control}/__ledger`)).resolves.toEqual({ entries: [] });

    const firstLocation = await oidcAuthorizeLocation(oidc);
    await postJson(`${control}/__reset`, {});
    const secondLocation = await oidcAuthorizeLocation(oidc);
    expect(secondLocation).toBe(firstLocation);

    const scenario = "journey-390x844:telegram-oidc-cabinet-profile-link-referral-passkey";
    const scenarioReset = await postJson(`${control}/__reset`, { scenario });
    const scenarioLocation = await oidcAuthorizeLocation(oidc);
    const scenarioRemnawave = await fetch(`${wave}/api/users/rw-browser-1`, {
      headers: { authorization: `Bearer ${remnawaveToken}` },
    });
    expect(scenarioRemnawave.status).toBe(200);
    await expect(scenarioRemnawave.json()).resolves.toMatchObject({
      response: { telegramId: scenarioTelegramId(scenario) },
    });
    const repeatedReset = await postJson(`${control}/__reset`, { scenario });
    expect(repeatedReset).toEqual(scenarioReset);
    expect(await oidcAuthorizeLocation(oidc)).toBe(scenarioLocation);
    const otherReset = await postJson(`${control}/__reset`, {
      scenario: "journey-768x1024:telegram-oidc-cabinet-profile-link-referral-passkey",
    });
    expect(otherReset.scenario_sha256).not.toBe(scenarioReset.scenario_sha256);
    expect(await oidcAuthorizeLocation(oidc)).not.toBe(scenarioLocation);
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("scopes opaque linked-email auth failures to the exact authorized candidate scenario", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
    }));

    const control = `http://127.0.0.1:${controlPort}`;
    const shop = `http://127.0.0.1:${remnashopPort}/api/v1/public`;
    await waitForOk(`${control}/__health`);
    await postJson(`${control}/__reset`, {
      scenario: "authorized-linked-email-feedback:contract",
    });

    const telegram = await postSession(`${shop}/auth/telegram`, {
      id: 900000777,
      auth_date: 1_788_000_000,
      hash: "synthetic",
    });
    await expect(fetchJsonWithCookie(`${shop}/auth/me`, telegram.cookie))
      .resolves.toMatchObject({
        email: null,
        is_email_verified: false,
        telegram_id: 900000777,
      });

    const target = "linked-email-existing@clean-pay.dev";
    const authRequest = (pathname: "/auth/login" | "/auth/register") => fetch(
      `${shop}${pathname}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-remnashop-auth-service-key": authServiceKey,
        },
        body: JSON.stringify({ email: target, password: "wrong-password" }),
      },
    );
    const login = await authRequest("/auth/login");
    expect(login.status).toBe(401);
    await expect(login.json()).resolves.toEqual({ detail: "Request failed" });
    const registration = await authRequest("/auth/register");
    expect(registration.status).toBe(409);
    await expect(registration.json()).resolves.toEqual({ detail: "Request failed" });

    const ledger = await fetchJson(`${control}/__ledger`) as {
      entries: Array<{ effect: string }>;
    };
    expect(ledger.entries.filter(({ effect }) => effect.startsWith("linked_email_")))
      .toEqual([
        expect.objectContaining({ effect: "linked_email_login_auth_failed" }),
        expect.objectContaining({ effect: "linked_email_register_conflict" }),
      ]);

    await postJson(`${control}/__reset`, { scenario: "contract-default" });
    await expect(postSession(`${shop}/auth/login`, {
      email: target,
      password: "wrong-password",
    })).resolves.toMatchObject({ body: expect.any(Object) });
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("preserves a verified email identity across login and isolates Telegram auth", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
    }));

    const control = `http://127.0.0.1:${controlPort}`;
    const shop = `http://127.0.0.1:${remnashopPort}/api/v1/public`;
    const admin = `http://127.0.0.1:${remnashopPort}/api/v1/admin`;
    await waitForOk(`${control}/__health`);
    const email = "new.contract@clean-pay.dev";
    const registration = await postSession(`${shop}/auth/register`, {
      email,
      password: "synthetic-password",
    });
    const verified = await fetchJsonWithCookie(
      `${shop}/auth/email/confirm`,
      registration.cookie,
      "POST",
      { code: "123456" },
    );
    expect(verified).toMatchObject({ success: true, email });

    const login = await postSession(`${shop}/auth/login`, {
      email,
      password: "synthetic-password",
    });
    const emailProfile = await fetchJsonWithCookie(`${shop}/auth/me`, login.cookie);
    expect(emailProfile).toMatchObject({
      auth_type: "email",
      email,
      is_email_verified: true,
      telegram_id: null,
      username: null,
    });
    await expect(fetchJsonWithCookie(`${shop}/subscription/current`, login.cookie))
      .resolves.toBeNull();

    const telegram = await postSession(`${shop}/auth/telegram`, {
      id: 900000001,
      auth_date: 1_788_000_000,
      hash: "synthetic",
    });
    const telegramProfile = await fetchJsonWithCookie(`${shop}/auth/me`, telegram.cookie);
    expect(telegramProfile).toMatchObject({
      auth_type: "telegram",
      telegram_id: 900000001,
      is_email_verified: true,
    });
    const restored = await postSession(`${shop}/auth/service-session`, {
      email: telegramProfile.email,
      user_id: "900000001",
    });
    expect(await fetchJsonWithCookie(`${shop}/auth/me`, restored.cookie))
      .toEqual(telegramProfile);
    expect(await fetchJsonWithCookie(`${shop}/auth/me`, login.cookie)).toEqual(emailProfile);

    const sourceAccountId = Number(sessionSubject(telegram.cookie));
    const targetAccountId = Number(sessionSubject(login.cookie));
    expect(sourceAccountId).not.toBe(targetAccountId);
    const mergeInput = {
      source_user_id: sourceAccountId,
      target_user_id: targetAccountId,
      reason: "browser journey verified account merge",
      email_resolution: "KEEP_TARGET",
      telegram_resolution: "KEEP_SOURCE",
      payment_resolution: "REKEY_SOURCE",
    };
    const preflight = await fetch(`${admin}/users/merge?dry_run=true`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(mergeInput),
    });
    expect(preflight.status).toBe(200);
    expect(sessionSubject((await postSession(`${shop}/auth/telegram`, {
      id: 900000001,
      auth_date: 1_788_000_000,
      hash: "synthetic",
    })).cookie)).toBe(String(sourceAccountId));
    await expect(fetchJsonWithCookie(`${shop}/subscription/current`, login.cookie))
      .resolves.toBeNull();

    const merged = await fetch(`${admin}/users/merge?dry_run=false`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(mergeInput),
    });
    expect(merged.status).toBe(200);
    const mergedTelegram = await postSession(`${shop}/auth/telegram`, {
      id: 900000001,
      auth_date: 1_788_000_000,
      hash: "synthetic",
    });
    expect(sessionSubject(mergedTelegram.cookie)).toBe(String(targetAccountId));
    await expect(fetchJsonWithCookie(`${shop}/auth/me`, mergedTelegram.cookie))
      .resolves.toMatchObject({ email, is_email_verified: true, telegram_id: 900000001 });
    await expect(fetchJsonWithCookie(`${shop}/subscription/current`, mergedTelegram.cookie))
      .resolves.toMatchObject({ user_remna_id: "rw-browser-1", status: "ACTIVE" });
    const identify = await fetch(`${shop}/auth/identify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-remnashop-auth-service-key": authServiceKey,
      },
      body: JSON.stringify({ email }),
    });
    expect(identify.status).toBe(200);
    await expect(identify.json()).resolves.toEqual({ exists: true });
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("enforces synthetic credentials and models merge, password, and Remnawave identity DTOs", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
    }));
    const control = `http://127.0.0.1:${controlPort}`;
    const shop = `http://127.0.0.1:${remnashopPort}/api/v1/public`;
    const admin = `http://127.0.0.1:${remnashopPort}/api/v1/admin`;
    const wave = `http://127.0.0.1:${remnawavePort}`;
    await waitForOk(`${control}/__health`);
    await postJson(`${control}/__reset`, {});

    const rejected = await fetch(`${shop}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "synthetic.browser@clean-pay.dev", password: "x" }),
    });
    expect(rejected.status).toBe(401);

    const login = await postSession(`${shop}/auth/login`, {
      email: "synthetic.browser@clean-pay.dev",
      password: "synthetic-password",
    });
    const changed = await fetchJsonWithCookie(
      `${shop}/auth/change-password`,
      login.cookie,
      "POST",
      { current_password: "synthetic-password", new_password: "synthetic-password-2" },
    );
    expect(changed).toEqual({ success: true });

    const mergeInput = {
      source_user_id: 101,
      target_user_id: 102,
      reason: "browser journey synthetic merge",
      email_resolution: "KEEP_TARGET",
      telegram_resolution: "KEEP_SOURCE",
      payment_resolution: "REKEY_SOURCE",
    };
    const preflight = await fetch(`${admin}/users/merge?dry_run=true`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(mergeInput),
    });
    expect(preflight.status).toBe(200);
    await expect(preflight.json()).resolves.toMatchObject({
      dry_run: true,
      moved: { payments: 0, sessions: 0 },
      conflicts: [],
      requires_relogin: true,
    });

    const merge = await fetch(`${admin}/users/merge?dry_run=false`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(mergeInput),
    });
    expect(merge.status).toBe(200);
    await expect(merge.json()).resolves.toMatchObject({
      dry_run: false,
      source_user_id: 101,
      target_user_id: 102,
      target: { id: 102 },
      moved: { payments: 1, sessions: 1 },
      conflicts: [],
      requires_relogin: true,
    });

    const patch = await fetch(`${wave}/api/users`, {
      method: "PATCH",
      headers: {
        authorization: `Bearer ${remnawaveToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        uuid: "rw-browser-1",
        email: "linked.browser@clean-pay.dev",
        telegramId: 900000002,
      }),
    });
    expect(patch.status).toBe(200);
    const byEmail = await fetch(
      `${wave}/api/users/by-email/${encodeURIComponent("linked.browser@clean-pay.dev")}`,
      { headers: { authorization: `Bearer ${remnawaveToken}` } },
    );
    await expect(byEmail.json()).resolves.toMatchObject({
      response: [{ uuid: "rw-browser-1", email: "linked.browser@clean-pay.dev", telegramId: 900000002 }],
    });
    const wrongIdentity = await fetch(`${wave}/api/users/by-telegram-id/900000001`, {
      headers: { authorization: `Bearer ${remnawaveToken}` },
    });
    await expect(wrongIdentity.json()).resolves.toEqual({ response: [] });

    const ledger = await fetchJson(`${control}/__ledger`) as { entries: unknown[] };
    expect(JSON.stringify(ledger)).not.toContain("linked.browser@clean-pay.dev");
    expect(ledger.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        effect: "users_merged",
        credential_contract: expect.objectContaining({ header_names: ["x-api-key"] }),
      }),
      expect.objectContaining({
        effect: "user_identity_updated",
        credential_contract: expect.objectContaining({ authorization_scheme: "Bearer" }),
      }),
    ]));
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("accepts only exact single-use Turnstile action tokens and synthetic secret", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
    }));
    const control = `http://127.0.0.1:${controlPort}`;
    await waitForOk(`${control}/__health`);
    await postJson(`${control}/__reset`, {});
    const token = "synthetic-turnstile-token:auth_login:synthetic-turnstile-1:1";
    const verify = (secret: string) => fetch(`${control}/turnstile/v0/siteverify`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ response: token, secret }),
    }).then((response) => response.json());
    await expect(verify(digest("clean-pay-browser-journey:turnstile")))
      .resolves.toMatchObject({ success: true, action: "auth_login" });
    await expect(verify(digest("clean-pay-browser-journey:turnstile")))
      .resolves.toMatchObject({ success: false });
    await expect(verify("wrong-synthetic-secret"))
      .resolves.toMatchObject({ success: false });
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("payment idempotency survives lost and rate-limited committed responses and rejects key reuse", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
    }));
    const control = `http://127.0.0.1:${controlPort}`;
    const shop = `http://127.0.0.1:${remnashopPort}/api/v1/public`;
    await waitForOk(`${control}/__health`);
    await postJson(`${control}/__reset`, {});
    const login = await postSession(`${shop}/auth/login`, {
      email: "synthetic.browser@clean-pay.dev",
      password: "synthetic-password",
    });
    const key = "synthetic-contract-idempotency";
    const input = {
      plan_code: "browser-basic",
      duration_days: 30,
      gateway_type: "CARD",
      return_url: "https://pay.ci.clean-pay.dev/payment/pending?operation_id=synthetic-operation",
    };
    await postJson(`${control}/__inject`, { action: "payment_commit_disconnect_once" });
    await expect(paymentRequest(`${shop}/subscription/purchase`, login.cookie, key, input))
      .rejects.toThrow();
    const replay = await paymentRequest(`${shop}/subscription/purchase`, login.cookie, key, input);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({
      payment_id: "00000000-0000-4000-8000-000000000001",
      purchase_type: "NEW",
      status: "PENDING",
    });
    const conflict = await paymentRequest(`${shop}/subscription/purchase`, login.cookie, key, {
      ...input,
      duration_days: 31,
    });
    expect(conflict.status).toBe(409);

    const rateLimitedKey = "synthetic-contract-rate-limit-idempotency";
    await postJson(`${control}/__inject`, { action: "payment_commit_rate_limit_once" });
    const rateLimited = await paymentRequest(
      `${shop}/subscription/purchase`,
      login.cookie,
      rateLimitedKey,
      input,
    );
    expect(rateLimited.status).toBe(429);
    const rateLimitedReplay = await paymentRequest(
      `${shop}/subscription/purchase`,
      login.cookie,
      rateLimitedKey,
      input,
    );
    expect(rateLimitedReplay.status).toBe(200);

    const providerLedger = await fetchJson(`${control}/__ledger`) as {
      entries: Array<{ effect: string; idempotency_key_contract: unknown }>;
    };
    expect(providerLedger.entries.filter((entry) => entry.effect === "purchase_initialized"))
      .toHaveLength(2);
    expect(providerLedger.entries.filter((entry) => entry.effect === "purchase_replayed"))
      .toHaveLength(2);
    expect(providerLedger.entries.filter((entry) => entry.effect === "payment_idempotency_conflict"))
      .toHaveLength(1);
    expect(providerLedger.entries.filter((entry) => [
      "purchase_initialized", "purchase_replayed", "payment_idempotency_conflict",
    ].includes(entry.effect)).every((entry) => entry.idempotency_key_contract !== null)).toBe(true);
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

test("Chatwoot contact probe validates the synthetic inbox and records only credential shape", async () => {
  const [oidcPort, remnashopPort, remnawavePort, controlPort] = await freePorts(4);
  const children: ChildProcess[] = [];
  try {
    children.push(spawnFixture("oidc-mock.mjs", {
      PORT: String(oidcPort),
      OIDC_ISSUER: `http://127.0.0.1:${oidcPort}`,
      OIDC_PUBLIC_ISSUER: `http://127.0.0.1:${oidcPort}`,
    }));
    children.push(spawnFixture("provider-mock.mjs", {
      REMNASHOP_PORT: String(remnashopPort),
      REMNAWAVE_PORT: String(remnawavePort),
      CONTROL_PORT: String(controlPort),
      OIDC_RESET_URL: `http://127.0.0.1:${oidcPort}/__reset`,
      CLEAN_PAY_BROWSER_CHATWOOT_CONTACT_RESPONSE_DELAY_MS: "75",
    }));
    const control = `http://127.0.0.1:${controlPort}`;
    await waitForOk(`${control}/__health`);
    const websiteToken = digest("clean-pay-browser-journey:chatwoot-website");
    const conversation = "csyntheticbrowserjourney01";
    const acceptedStartedAt = performance.now();
    const accepted = await fetch(
      `${control}/api/v1/widget/contact?website_token=${websiteToken}`,
      { headers: { "x-auth-token": conversation } },
    );
    const acceptedElapsedMs = performance.now() - acceptedStartedAt;
    expect(accepted.status).toBe(200);
    expect(acceptedElapsedMs).toBeGreaterThanOrEqual(50);
    expect(acceptedElapsedMs).toBeLessThan(3_000);
    expect(await accepted.json()).toEqual({ identifier: conversation });
    const rejected = await fetch(
      `${control}/api/v1/widget/contact?website_token=wrong`,
      { headers: { "x-auth-token": conversation } },
    );
    expect(rejected.status).toBe(401);
    const providerLedger = await fetchJson(`${control}/__ledger`) as {
      entries: Array<{
        effect: string;
        credential_contract: { header_names: string[] };
        pathname: string;
        query_keys: string[];
      }>;
    };
    expect(providerLedger.entries).toEqual([
      expect.objectContaining({
        effect: "contact_identity_probed",
        pathname: "/api/v1/widget/contact",
        query_keys: ["website_token"],
        credential_contract: expect.objectContaining({ header_names: ["x-auth-token"] }),
      }),
      expect.objectContaining({
        effect: "contact_identity_probe_rejected",
        pathname: "/api/v1/widget/contact",
        query_keys: ["website_token"],
        credential_contract: expect.objectContaining({ header_names: ["x-auth-token"] }),
      }),
    ]);
    expect(JSON.stringify(providerLedger)).not.toContain(conversation);
    expect(JSON.stringify(providerLedger)).not.toContain(websiteToken);
  } finally {
    await Promise.all(children.map(stopChild));
  }
});

function provenWindow(occurrence: number) {
  return {
    probe: cabinetReadOverlapProbe,
    occurrence,
    timeoutMs: cabinetReadOverlapTimeoutMs,
    participants: cabinetReadParticipants.map((participant) => ({
      ...participant,
      entered: true,
      ledgerSequence: expect.any(Number),
    })),
    duplicates: [],
    enteredCount: 2,
    maxInFlight: 2,
    release: "all-entered",
    outcome: "proven",
  };
}

async function armCabinetReadOverlap(control: string) {
  await expect(postJson(`${control}/__inject`, {
    action: cabinetReadOverlapAction,
  })).resolves.toEqual({
    status: "armed",
    action: cabinetReadOverlapAction,
  });
}

async function concurrencyEvidence(control: string) {
  return fetchJson(`${control}/__concurrency`) as Promise<CabinetReadEvidence>;
}

async function waitForConcurrencyEvidence(
  control: string,
  predicate: (evidence: CabinetReadEvidence) => boolean,
) {
  const deadline = Date.now() + 2_000;
  let latest: CabinetReadEvidence | null = null;
  while (Date.now() < deadline) {
    latest = await concurrencyEvidence(control);
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Concurrency evidence did not reach the expected state: ${JSON.stringify(latest)}`,
  );
}

async function subscriptionRead(url: string, cookie: string) {
  const response = await fetch(url, { headers: { cookie } });
  expect(response.status).toBe(200);
  return response.json();
}

async function expectConcurrencyLedgerReferences(
  control: string,
  windows: CabinetReadWindow[],
) {
  const value = await fetchJson(`${control}/__ledger`) as {
    entries: Array<Record<string, unknown>>;
  };
  const referenced = windows.flatMap((window) => [
    ...window.participants.filter((participant) => participant.entered),
    ...window.duplicates.map((duplicate) => ({ ...duplicate, entered: true })),
  ]);
  const referencedSequences = referenced.map(({ ledgerSequence }) => ledgerSequence);
  expect(new Set(referencedSequences).size).toBe(referencedSequences.length);
  for (const participant of referenced) {
    expect(participant.ledgerSequence).toEqual(expect.any(Number));
    const entry = value.entries.find(
      (candidate) => candidate.sequence === participant.ledgerSequence,
    );
    expect(entry).toBeDefined();
    expect(Object.keys(entry ?? {}).sort()).toEqual([
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
    ]);
    expect(entry).toEqual({
      sequence: participant.ledgerSequence,
      service: participant.service,
      method: participant.method,
      pathname: participant.pathname,
      query_keys: [],
      body_bytes: 0,
      body_sha256: digest(""),
      body_contract: null,
      idempotency_key_present: false,
      idempotency_key_sha256: null,
      idempotency_key_contract: null,
      credential_contract: {
        header_names: [],
        authorization_scheme: null,
        cookie_names: ["access_token", "refresh_token"],
      },
      effect: participant.pathname.endsWith("/devices")
        ? "read_devices"
        : "read_offers",
    });
  }
}

async function mutateAndReset(options: { control: string; shop: string; oidc: string }) {
  await oidcAuthorizeLocation(options.oidc);
  const login = await fetch(`${options.shop}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-remnashop-auth-service-key": authServiceKey,
    },
    body: JSON.stringify({
      email: "synthetic.browser@clean-pay.dev",
      password: "synthetic-browser-password",
    }),
  });
  expect(login.status).toBe(200);
  const cookies = login.headers.getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  expect(cookies).toContain("access_token=");
  expect(cookies).toContain("refresh_token=");

  const purchase = await fetch(`${options.shop}/subscription/purchase`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookies,
      "idempotency-key": "synthetic-contract-idempotency",
    },
    body: JSON.stringify({
      plan_code: "browser-basic",
      duration_days: 30,
      gateway_type: "CARD",
      return_url: "https://pay.ci.clean-pay.dev/payment/pending",
    }),
  });
  expect(purchase.status).toBe(200);
  return postJson(`${options.control}/__reset`, {});
}

function paymentRequest(
  url: string,
  cookie: string,
  idempotencyKey: string,
  body: unknown,
) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "idempotency-key": idempotencyKey,
    },
    body: JSON.stringify(body),
  });
}

async function oidcAuthorizeLocation(origin: string) {
  const url = new URL("/auth", origin);
  const verifier = "synthetic-browser-pkce-verifier-00000000000000000000000000000000";
  url.searchParams.set("client_id", "synthetic-client");
  url.searchParams.set("redirect_uri", "https://pay.ci.clean-pay.dev/auth/telegram/callback");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("state", "synthetic-state");
  url.searchParams.set("nonce", "synthetic-nonce");
  url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("client_id", "7654321098");
  const response = await fetch(url, { redirect: "manual" });
  expect(response.status).toBe(302);
  const location = response.headers.get("location");
  expect(location).toBeTruthy();
  return location;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response.json();
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json();
}

async function postSession(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-remnashop-auth-service-key": authServiceKey,
    },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie()
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  expect(cookie).toContain("access_token=");
  return { cookie, body: await response.json() };
}

async function fetchJsonWithCookie(
  url: string,
  cookie: string,
  method = "GET",
  body?: unknown,
) {
  const response = await fetch(url, {
    method,
    headers: {
      cookie,
      "x-remnashop-auth-service-key": authServiceKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.status).toBe(200);
  return response.json();
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scenarioTelegramId(scenario: string) {
  return 900000000
    + (Number.parseInt(digest(`telegram:${scenario}`).slice(0, 8), 16) % 99999999);
}

function sessionSubject(cookie: string) {
  const token = cookie.match(/(?:^|; )access_token=([^;]+)/)?.[1];
  if (!token) throw new Error("Synthetic session has no access token.");
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Synthetic access token has no payload.");
  const value: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  const subject = value && typeof value === "object" && !Array.isArray(value)
    ? (value as { sub?: unknown }).sub
    : null;
  if (typeof subject !== "string" || !/^\d{1,18}$/.test(subject)) {
    throw new Error("Synthetic access token has an invalid subject.");
  }
  return subject;
}

function spawnFixture(filename: string, environment: Record<string, string>) {
  const child = spawn(process.execPath, [path.join(journeyDirectory, filename)], {
    env: { ...process.env, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.resume();
  child.stderr?.resume();
  return child;
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function freePorts(count: number) {
  const ports: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not allocate a port.");
    ports.push(address.port);
    server.close();
    await once(server, "close");
  }
  return ports;
}

async function waitForOk(url: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Fixture process may still be binding its socket.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Fixture did not become ready: ${url}`);
}
