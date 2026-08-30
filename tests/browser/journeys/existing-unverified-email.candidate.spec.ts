import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";

import type { Page, Route } from "@playwright/test";

import { test, expect } from "../fixtures";
import { recordNetwork } from "../network-recorder";
import { clearSyntheticLogoutState } from "./synthetic-logout-storage";
import { isJourneyBrowserRequestAllowed } from "./journey-browser-policy";
import {
  AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
  UNVERIFIED_EMAIL_PROOF_FILENAME,
  assertUnverifiedEmailLoginProof,
} from "./unverified-email-login-proof-contract.mjs";

const applicationOrigin = "https://pay.ci.clean-pay.dev";
const redirectTo = "/payment?plan=pro&duration=30";
const expectedFinalRoute =
  "/register/verify-email?redirect_to=%2Fpayment%3Fplan%3Dpro%26duration%3D30";
const expectedDirectCabinetFinalRoute =
  "/register/verify-email?redirect_to=%2Fcabinet";
const authServiceKey = createHash("sha256")
  .update("clean-pay-browser-journey:remnashop-auth", "utf8")
  .digest("hex");
const forbiddenCabinetEffects = new Set([
  "read_devices",
  "read_notification_preferences",
  "read_offers",
  "read_payment_history",
  "read_referral_program",
  "read_subscription",
]);

test("authorized existing unverified e-mail login is gated before cabinet reads", async ({
  guardedPage: page,
}) => {
  const environment = candidateEnvironment();
  await resetSyntheticProvider(environment.providerControlUrl, environment.candidateRevision);

  const blockedRequests: string[] = [];
  const enforceSyntheticNetwork = async (route: Route) => {
    const url = route.request().url();
    if (isJourneyBrowserRequestAllowed(url)) {
      await route.continue();
      return;
    }
    blockedRequests.push(createHash("sha256").update(url).digest("hex"));
    await route.abort("blockedbyclient");
  };
  await page.route("**/*", enforceSyntheticNetwork);

  const email = "new.authorized-unverified-linked@clean-pay.dev";
  const password = "Synthetic-browser-password-42";
  await registerWithoutVerification(page, email, password);
  const profile = await linkSyntheticTelegram(
    environment.providerControlUrl,
    email,
    password,
  );
  expect(profile).toEqual({
    emailPresent: true,
    emailVerified: false,
    telegramLinked: true,
  });

  const ledgerBeforeLogin = await providerLedger(environment.providerControlUrl);
  const sequenceBeforeLogin = ledgerBeforeLogin.entries.at(-1)?.sequence ?? 0;
  await clearSyntheticLogoutState(page);

  const navigationPathnames: string[] = [];
  page.on("request", (request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    navigationPathnames.push(new URL(request.url()).pathname);
  });
  const recorder = recordNetwork(page, applicationOrigin);

  await page.goto(`/login?redirect_to=${encodeURIComponent(redirectTo)}`, {
    waitUntil: "load",
  });
  await waitForTurnstile(page, "auth_login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByLabel("Пароль")).toBeVisible();
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.waitForURL((url) => `${url.pathname}${url.search}` === expectedFinalRoute);
  await expect(page.getByRole("heading", {
    name: "Подтверждение e-mail",
    level: 1,
  })).toBeVisible();

  const network = await recorder.finish();
  const serverActions = network.filter((entry) => entry.serverAction.present);
  expect(serverActions).toHaveLength(2);
  expect(serverActions.map(({ method, scope }) => ({ method, scope }))).toEqual([
    { method: "POST", scope: "application" },
    { method: "POST", scope: "application" },
  ]);

  const ledgerAfterLogin = await providerLedger(environment.providerControlUrl);
  const loginEntries = ledgerAfterLogin.entries.filter(
    ({ sequence }) => sequence > sequenceBeforeLogin,
  );
  const cabinetReads = loginEntries.filter(({ effect }) => (
    forbiddenCabinetEffects.has(effect)
  ));
  const cabinetNavigationCount = navigationPathnames.filter(
    (pathname) => pathname === "/cabinet",
  ).length;
  expect(cabinetReads).toEqual([]);
  expect(cabinetNavigationCount).toBe(0);
  expect(blockedRequests).toEqual([]);

  const accessClaims = await currentAccessClaims(page);
  expect(accessClaims).toEqual({
    emailVerified: false,
    telegramLinked: true,
  });
  const sequenceBeforeDirectCabinet =
    ledgerAfterLogin.entries.at(-1)?.sequence ?? sequenceBeforeLogin;
  const navigationCountBeforeDirectCabinet = navigationPathnames.length;
  await page.goto("/cabinet", { waitUntil: "load" });
  await page.waitForURL(
    (url) => `${url.pathname}${url.search}` === expectedDirectCabinetFinalRoute,
  );
  await expect(page.getByRole("heading", {
    name: "Подтверждение e-mail",
    level: 1,
  })).toBeVisible();
  const genericCabinetErrorCount = await page.getByText(
    "Не удалось загрузить подписку.",
    { exact: true },
  ).count();
  const directCabinetNavigationAttemptCount = navigationPathnames
    .slice(navigationCountBeforeDirectCabinet)
    .filter((pathname) => pathname === "/cabinet")
    .length;
  const ledgerAfterDirectCabinet = await providerLedger(
    environment.providerControlUrl,
  );
  const directProviderRequests = ledgerAfterDirectCabinet.entries.filter(
    ({ sequence }) => sequence > sequenceBeforeDirectCabinet,
  );
  const directCabinetReads = directProviderRequests.filter(({ effect }) => (
    forbiddenCabinetEffects.has(effect)
  ));
  expect(directCabinetNavigationAttemptCount).toBe(1);
  expect(directProviderRequests).toEqual([]);
  expect(directCabinetReads).toEqual([]);
  expect(genericCabinetErrorCount).toBe(0);
  expect(blockedRequests).toEqual([]);

  const proof = assertUnverifiedEmailLoginProof({
    schemaVersion: 2,
    kind: "clean-pay-authorized-unverified-email-login-proof",
    status: "existing-unverified-email-login-gated",
    authorizedSemanticDiff: AUTHORIZED_UNVERIFIED_EMAIL_SEMANTIC_DIFF,
    candidateRevision: environment.candidateRevision,
    candidateApplicationImageDigest: environment.candidateApplicationImageDigest,
    candidateMigrationImageDigest: environment.candidateMigrationImageDigest,
    finalRoute: expectedFinalRoute,
    telegramLinkedFixture: true,
    serverActionCount: serverActions.length,
    providerRequestCount: loginEntries.length,
    cabinetNavigationCount,
    cabinetReadCount: cabinetReads.length,
    directCabinetFinalRoute: expectedDirectCabinetFinalRoute,
    directCabinetNavigationAttemptCount,
    directCabinetReadCount: directCabinetReads.length,
    directProviderRequestCount: directProviderRequests.length,
    emailVerifiedAccessClaim: accessClaims.emailVerified,
    genericCabinetErrorCount,
    telegramLinkedAccessClaim: accessClaims.telegramLinked,
  }, environment);
  await writeCreateOnlyProof(environment.proofOutput, proof);
});

async function registerWithoutVerification(page: Page, email: string, password: string) {
  await page.goto(`/register?redirect_to=${encodeURIComponent(redirectTo)}`, {
    waitUntil: "load",
  });
  await waitForTurnstile(page, "auth_login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
  await page.getByLabel("Придумайте пароль").fill(password);
  await page.getByLabel("Повторите новый пароль").fill(password);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL((url) => url.pathname === "/register/verify-email");
}

async function linkSyntheticTelegram(
  providerControlUrl: string,
  email: string,
  password: string,
) {
  const login = await fetch(new URL("/api/v1/public/auth/login", providerControlUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-remnashop-auth-service-key": authServiceKey,
    },
    body: JSON.stringify({ email, password }),
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  expect(login.status).toBe(200);
  const getSetCookie = (login.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie;
  const setCookies = getSetCookie?.call(login.headers) ?? [];
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  expect(cookie).toMatch(/(?:^|; )access_token=/u);
  await login.body?.cancel();

  const linked = await fetch(
    new URL("/api/v1/public/auth/telegram/link", providerControlUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-remnashop-auth-service-key": authServiceKey,
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    },
  );
  expect(linked.status).toBe(200);
  const value = await readBoundedJsonResponse(linked, 16_384);
  if (!isRecord(value)) throw new Error("Synthetic linked profile is invalid.");
  return {
    emailPresent: typeof value.email === "string" && value.email.length > 0,
    emailVerified: value.is_email_verified === true,
    telegramLinked: Number.isSafeInteger(value.telegram_id),
  };
}

async function resetSyntheticProvider(providerControlUrl: string, revision: string) {
  const response = await fetch(new URL("/__reset", providerControlUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenario: `authorized-unverified-email:${revision.slice(0, 12)}`,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Synthetic provider reset failed.");
  const value: unknown = await response.json();
  if (!isRecord(value) || value.status !== "reset") {
    throw new Error("Synthetic provider reset returned an invalid contract.");
  }
}

async function providerLedger(providerControlUrl: string) {
  const response = await fetch(new URL("/__ledger", providerControlUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Synthetic provider ledger read failed.");
  const value: unknown = await response.json();
  if (!isRecord(value) || !Array.isArray(value.entries)
    || value.entries.some((entry) => !isRecord(entry)
      || !Number.isSafeInteger(entry.sequence)
      || typeof entry.effect !== "string")) {
    throw new Error("Synthetic provider ledger differs from its exact projection.");
  }
  return value as { entries: Array<{ effect: string; sequence: number }> };
}

async function currentAccessClaims(page: Page) {
  const accessCookie = (await page.context().cookies(applicationOrigin))
    .find(({ name }) => name === "clean_pay_access");
  if (!accessCookie || accessCookie.value.length > 4_096) {
    throw new Error("Candidate access claim is absent or outside its byte bound.");
  }
  const segments = accessCookie.value.split(".");
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error("Candidate access claim has an invalid envelope.");
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(segments[0], "base64url").toString("utf8"));
  } catch {
    throw new Error("Candidate access claim has an invalid payload.");
  }
  if (!isRecord(value)
    || typeof value.ev !== "boolean"
    || typeof value.tg !== "boolean") {
    throw new Error("Candidate access claim differs from its bounded projection.");
  }
  return {
    emailVerified: value.ev,
    telegramLinked: value.tg,
  };
}

async function readBoundedJsonResponse(response: Response, maximumBytes: number) {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maximumBytes)) {
    throw new Error("Synthetic provider response exceeded its declared byte bound.");
  }
  if (!response.body) throw new Error("Synthetic provider response body is absent.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error("Synthetic provider response exceeded its streamed byte bound.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error("Synthetic provider response is not bounded UTF-8 JSON.");
  }
}

async function waitForTurnstile(page: Page, action: "auth_login") {
  await expect.poll(() => page.evaluate((expectedAction) => {
    const boundary = window as unknown as {
      turnstile?: unknown;
      __cleanPayTurnstileDocumentChallenges?: Array<{ action?: unknown }>;
    };
    return typeof boundary.turnstile === "object"
      && Array.isArray(boundary.__cleanPayTurnstileDocumentChallenges)
      && boundary.__cleanPayTurnstileDocumentChallenges.some(
        (challenge) => challenge.action === expectedAction,
      );
  }, action)).toBe(true);
}

function candidateEnvironment() {
  const value = {
    candidateRevision: process.env.CLEAN_PAY_BROWSER_SOURCE_REVISION?.trim(),
    candidateApplicationImageDigest:
      process.env.CLEAN_PAY_BROWSER_SOURCE_IMAGE_DIGEST?.trim(),
    candidateMigrationImageDigest:
      process.env.CLEAN_PAY_BROWSER_MIGRATION_IMAGE_DIGEST?.trim(),
    providerControlUrl:
      process.env.CLEAN_PAY_BROWSER_PROVIDER_CONTROL_URL?.trim(),
    proofOutput:
      process.env.CLEAN_PAY_BROWSER_UNVERIFIED_EMAIL_PROOF_OUTPUT?.trim(),
  };
  if (!/^[a-f0-9]{40}$/.test(value.candidateRevision ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.candidateApplicationImageDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.candidateMigrationImageDigest ?? "")
    || !/^http:\/\/127\.0\.0\.1:\d{2,5}\/$/.test(value.providerControlUrl ?? "")
    || !value.proofOutput
    || !path.isAbsolute(value.proofOutput)
    || path.basename(value.proofOutput) !== UNVERIFIED_EMAIL_PROOF_FILENAME) {
    throw new Error("Candidate unverified e-mail proof environment is invalid.");
  }
  return value as {
    candidateRevision: string;
    candidateApplicationImageDigest: string;
    candidateMigrationImageDigest: string;
    providerControlUrl: string;
    proofOutput: string;
  };
}

async function writeCreateOnlyProof(target: string, value: unknown) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  if (bytes.byteLength < 1 || bytes.byteLength > 16_384) {
    throw new Error("Candidate unverified e-mail proof is outside its byte bound.");
  }
  const handle = await open(target, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
