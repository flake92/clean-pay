import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";

import type { Page, Route } from "@playwright/test";

import { test, expect } from "../fixtures";
import { recordNetwork } from "../network-recorder";
import { isJourneyBrowserRequestAllowed } from "./journey-browser-policy";
import {
  AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
  LINKED_EMAIL_FAILURE_PROOF_FILENAME,
  assertLinkedEmailFailureProof,
} from "./linked-email-failure-proof-contract.mjs";

const applicationOrigin = "https://pay.ci.clean-pay.dev";
const finalRoute = "/link-account?reason=email-required";
const targetEmail = "linked-email-existing@clean-pay.dev";
const password = "wrong-password";
const authFailedMessage = "Неверный e-mail или пароль.";
const rateLimitedMessage = "Слишком много попыток. Попробуйте позже.";
const genericFallback = "Не удалось связать e-mail с аккаунтом.";
const networkFallback = "Сеть недоступна. Не удалось связать e-mail с аккаунтом.";
const allowedProviderEffects = new Set([
  "linked_email_login_auth_failed",
  "linked_email_register_conflict",
]);

test("authorized linked-email failures expose only the exact actionable feedback", async ({
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

  await establishTelegramOnlySession(page);
  await page.goto(finalRoute, { waitUntil: "load" });
  await expect(page.getByRole("heading", {
    name: "Сохраните доступ к аккаунту",
    level: 1,
  }))
    .toBeVisible();
  await expect(page.getByRole("heading", { name: "Добавьте резервный вход", level: 2 }))
    .toBeVisible();
  await expect(page.getByLabel("E-mail")).toBeVisible();
  await expect(page.getByText(/^Telegram ID: /u)).toHaveCount(0);

  const email = page.getByLabel("E-mail");
  const passwordInput = page.getByLabel("Пароль для входа");
  const confirmation = page.getByLabel("Повторите пароль");
  const submit = page.getByRole("button", { name: "Сохранить e-mail и пароль" });
  const errorMessage = page.locator(".p-inline-message-error");
  await email.fill(targetEmail);
  await passwordInput.fill(password);
  await confirmation.fill(password);

  const ledgerBefore = await providerLedger(environment.providerControlUrl);
  const databaseBefore = ledgerBefore.database;
  const recorder = recordNetwork(page, applicationOrigin);

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    await submitServerAction(page, submit);
    await expect(errorMessage).toHaveText(authFailedMessage);
    await expect(submit).toBeEnabled();
  }

  const ledgerBeforeRateLimit = await providerLedger(environment.providerControlUrl);
  const providerEffects = ledgerBeforeRateLimit.entries
    .filter(({ sequence, service }) => (
      sequence > ledgerBefore.lastSequence && service === "remnashop"
    ));
  expect(providerEffects.map(({ effect }) => effect)).toEqual(Array.from(
    { length: 10 },
    () => ["linked_email_login_auth_failed", "linked_email_register_conflict"],
  ).flat());
  expect(providerEffects.filter(({ effect }) => !allowedProviderEffects.has(effect)))
    .toEqual([]);

  await submitServerAction(page, submit);
  await expect(errorMessage).toHaveText(rateLimitedMessage);
  await expect(submit).toBeEnabled();

  const ledgerAfter = await providerLedger(environment.providerControlUrl);
  const rateLimitedProviderRequests = ledgerAfter.entries.filter(
    ({ sequence, service }) => (
      sequence > ledgerBeforeRateLimit.lastSequence && service === "remnashop"
    ),
  );
  expect(rateLimitedProviderRequests).toEqual([]);
  expect(ledgerAfter.database).toEqual(databaseBefore);
  expect(blockedRequests).toEqual([]);

  const network = await recorder.finish();
  const serverActions = network.filter((entry) => entry.serverAction.present);
  expect(serverActions).toHaveLength(11);
  expect(serverActions.every(({ method }) => method === "POST")).toBe(true);
  expect(serverActions.every(({ response }) => (
    response !== null && response.status >= 200 && response.status < 300
  ))).toBe(true);
  const payloadContracts = serverActions.map(({ postData }) => JSON.stringify(postData));
  expect(new Set(payloadContracts).size).toBe(1);

  const visibleErrorCount = await page.locator(".p-inline-message-error:visible").count();
  const genericFallbackCount = await page.getByText(genericFallback, { exact: true }).count();
  const networkFallbackCount = await page.getByText(networkFallback, { exact: true }).count();
  const route = new URL(page.url());
  expect(`${route.pathname}${route.search}`).toBe(finalRoute);
  expect(await email.inputValue()).toBe(targetEmail);
  expect(await passwordInput.inputValue()).toBe(password);
  expect(await confirmation.inputValue()).toBe(password);
  expect(visibleErrorCount).toBe(1);
  expect(genericFallbackCount).toBe(0);
  expect(networkFallbackCount).toBe(0);

  const proof = assertLinkedEmailFailureProof({
    schemaVersion: 1,
    kind: "clean-pay-authorized-linked-email-failure-feedback-proof",
    status: "linked-email-auth-failure-feedback-specific",
    authorizedSemanticDiff: AUTHORIZED_LINKED_EMAIL_FAILURE_SEMANTIC_DIFF,
    candidateRevision: environment.candidateRevision,
    candidateApplicationImageDigest: environment.candidateApplicationImageDigest,
    candidateMigrationImageDigest: environment.candidateMigrationImageDigest,
    finalRoute,
    telegramLinkedFixture: true,
    emailInitiallyAbsent: true,
    wrongPasswordAttemptCount: 10,
    rateLimitedAttemptNumber: 11,
    wrongPasswordMessage: authFailedMessage,
    rateLimitedMessage,
    serverActionCount: serverActions.length,
    serverActionMethodsAllPost: true,
    serverActionResponsesAllSuccessful: true,
    serverActionPayloadStable: true,
    serverActionPayloadContractSha256: createHash("sha256")
      .update(payloadContracts[0] ?? "", "utf8")
      .digest("hex"),
    authFailedProviderRequestCount: providerEffects.length,
    rateLimitedProviderRequestCount: rateLimitedProviderRequests.length,
    providerEffectOrder: providerEffects.map(({ effect }) => effect),
    databaseUnchanged: true,
    formStatePreserved: true,
    submitButtonEnabled: await submit.isEnabled(),
    visibleErrorCount,
    genericFallbackCount,
    networkFallbackCount,
  }, {
    candidateRevision: environment.candidateRevision,
    candidateApplicationImageDigest: environment.candidateApplicationImageDigest,
    candidateMigrationImageDigest: environment.candidateMigrationImageDigest,
  });
  await writeCreateOnlyProof(environment.proofOutput, proof);
});

async function establishTelegramOnlySession(page: Page) {
  await page.goto(`/login?redirect_to=${encodeURIComponent(finalRoute)}`, {
    waitUntil: "load",
  });
  await waitForTurnstile(page, "auth_login");
  await page.getByRole("button", { name: "Войти через Telegram" }).click();
  await page.waitForURL((url) => (
    url.origin === applicationOrigin
    && url.pathname !== "/login"
    && !url.pathname.startsWith("/auth/telegram/")
  ), { timeout: 30_000 });
}

async function submitServerAction(
  page: Page,
  submit: ReturnType<Page["getByRole"]>,
) {
  const response = page.waitForResponse((candidate) => (
    candidate.request().method() === "POST"
    && typeof candidate.request().headers()["next-action"] === "string"
  ));
  await submit.click();
  const settled = await response;
  expect(settled.status()).toBeGreaterThanOrEqual(200);
  expect(settled.status()).toBeLessThan(300);
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

async function resetSyntheticProvider(providerControlUrl: string, revision: string) {
  const response = await fetch(new URL("/__reset", providerControlUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenario: `authorized-linked-email-feedback:${revision.slice(0, 12)}`,
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

type ProviderEntry = {
  effect: string;
  sequence: number;
  service: string;
};

type DatabaseSnapshot = {
  schemaSha256: string;
  sequenceCount: number;
  tables: Array<{ count: number; name: string }>;
};

async function providerLedger(providerControlUrl: string) {
  const response = await fetch(new URL("/__ledger", providerControlUrl), {
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error("Synthetic provider ledger read failed.");
  const value: unknown = await response.json();
  if (!isRecord(value)
    || !Array.isArray(value.entries)
    || value.entries.some((entry) => !validProviderEntry(entry))
    || !validDatabaseSnapshot(value.database)) {
    throw new Error("Synthetic provider ledger differs from its exact projection.");
  }
  const entries = value.entries as ProviderEntry[];
  return {
    entries,
    database: value.database as DatabaseSnapshot,
    lastSequence: entries.at(-1)?.sequence ?? 0,
  };
}

function validProviderEntry(value: unknown): value is ProviderEntry {
  return isRecord(value)
    && Number.isSafeInteger(value.sequence)
    && typeof value.effect === "string"
    && typeof value.service === "string";
}

function validDatabaseSnapshot(value: unknown): value is DatabaseSnapshot {
  return isRecord(value)
    && typeof value.schemaSha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.schemaSha256)
    && value.sequenceCount === 0
    && Array.isArray(value.tables)
    && value.tables.length > 0
    && value.tables.every((table) => isRecord(table)
      && typeof table.name === "string"
      && /^[A-Za-z_][A-Za-z0-9_]*$/.test(table.name)
      && Number.isSafeInteger(table.count)
      && Number(table.count) >= 0);
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
      process.env.CLEAN_PAY_BROWSER_LINKED_EMAIL_FAILURE_PROOF_OUTPUT?.trim(),
  };
  if (!/^[a-f0-9]{40}$/.test(value.candidateRevision ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.candidateApplicationImageDigest ?? "")
    || !/^sha256:[a-f0-9]{64}$/.test(value.candidateMigrationImageDigest ?? "")
    || !/^http:\/\/127\.0\.0\.1:\d{2,5}\/$/.test(value.providerControlUrl ?? "")
    || !value.proofOutput
    || !path.isAbsolute(value.proofOutput)
    || path.basename(value.proofOutput) !== LINKED_EMAIL_FAILURE_PROOF_FILENAME) {
    throw new Error("Candidate linked e-mail failure proof environment is invalid.");
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
    throw new Error("Candidate linked e-mail failure proof is outside its byte bound.");
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
