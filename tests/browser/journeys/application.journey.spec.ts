import { createHash } from "node:crypto";

import type { Cookie, Page, Request } from "@playwright/test";

import {
  beginJourneyOfflineFallbackConsoleCapture,
  finishJourneyOfflineFallbackConsoleCapture,
} from "../console-policy";
import { authenticatedJourneyLivePairCaptureEnabled } from "./authenticated-journey-capture-mode";
import { test, expect } from "./journey-fixtures";
import { enterJourneyOfflineMode } from "./journey-offline-transition";
import { clearSyntheticLogoutState } from "./synthetic-logout-storage";

test.describe.configure({ mode: "serial" });

test("public-responsive-keyboard-install-offline-support", async ({ journey }) => {
  const { page } = journey;
  for (const [id, pathname, heading] of [
    ["login", "/login", "Вход"],
    ["register", "/register", "Регистрация"],
    ["tariffs", "/tariffs", "Тарифы"],
    ["support", "/support", "Поддержка"],
  ] as const) {
    await gotoHeading(page, pathname, heading);
    if (id === "login" || id === "register") {
      await waitForAuthChallenge(page);
    }
    await journey.checkpoint(`public-${id}`);
  }

  journey.boundary("chatwoot-guest", await page.evaluate(() => (
    (window as unknown as { __cleanPayChatwootBoundaryCalls?: unknown[] })
      .__cleanPayChatwootBoundaryCalls ?? []
  )));

  await gotoHeading(page, "/login", "Вход");
  await waitForAuthChallenge(page);
  await page.keyboard.press("Tab");
  journey.boundary("keyboard-first-tab", await focusedControl(page));
  await journey.checkpoint("keyboard-login-first-tab");

  await gotoHeading(page, "/tariffs", "Тарифы");
  const menu = page.getByRole("button", { name: "Главное меню" });
  await expect(menu).toBeVisible();
  await menu.click();
  await journey.checkpoint("responsive-main-menu-open");

  await gotoHeading(page, "/install", "Установить Clean Pay");
  await journey.checkpoint("install-pristine-csp-client-boundary");

  await gotoHeading(page, "/install?platform=ios", "Установить Clean Pay");
  const iosDialog = page.getByRole("dialog");
  await expect(iosDialog).toHaveCount(0);
  journey.boundary("pwa-ios-pristine-csp-client-boundary", {
    dialogCount: await iosDialog.count(),
    reason: "pristine-static-csp-blocks-client-hydration",
  });
  await journey.checkpoint("install-ios-pristine-csp-client-boundary");

  await gotoHeading(page, "/offline", "Нет подключения");
  await journey.checkpoint("offline-direct-route");

  beginJourneyOfflineFallbackConsoleCapture(page);
  const serviceWorker = await exerciseProductionServiceWorker(page);
  journey.boundary("pwa-service-worker-offline", serviceWorker);
  await journey.checkpoint("offline-service-worker-fallback");
  finishJourneyOfflineFallbackConsoleCapture(page);
  await page.context().setOffline(false);
  await gotoHeading(page, "/support", "Поддержка");
  await journey.checkpoint("offline-recovery-support");
  journey.boundary("turnstile-lifecycle", await readTurnstileBoundary(page));
});

test("email-register-verify-and-login", async ({ journey }, testInfo) => {
  const { page } = journey;
  const viewportId = testInfo.project.name.replace(/^journey-/, "");
  const email = `new.${viewportId}@clean-pay.dev`;
  const password = "Synthetic-browser-password-42";
  const captureAuthenticatedChatwoot = authenticatedJourneyLivePairCaptureEnabled(process.env);

  if (captureAuthenticatedChatwoot) {
    await installFirstChatwootOwnershipCapture(page);
  }

  await gotoHeading(page, "/register?redirect_to=%2Fcabinet", "Регистрация");
  await waitForTurnstile(page, "auth_login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
  await page.getByLabel("Придумайте пароль").fill(password);
  await page.getByLabel("Повторите новый пароль").fill(password);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL((url) => url.pathname === "/register/verify-email");
  await journey.checkpoint("register-verification-required");

  await waitForTurnstile(page, "email_verification");
  await page.getByLabel("Код подтверждения").fill("123456");
  await page.getByRole("button", { name: "Подтвердить e-mail" }).click();
  await page.waitForURL((url) => url.pathname === "/passkey/setup");
  await journey.checkpoint("register-email-verified");
  await page.getByRole("button", { name: "Продолжить без него" }).click();
  await page.waitForURL((url) => url.pathname === "/cabinet");
  let preOwnedChatwootSeed: PreOwnedChatwootSeed | null = null;
  if (captureAuthenticatedChatwoot) {
    await test.step("chatwoot fresh A-to-B exact characterization", () => (
      waitForFreshAuthenticatedChatwootFixture(page)
    ));
    preOwnedChatwootSeed = await capturePreOwnedChatwootSeed(page);
  }
  await journey.checkpoint("register-cabinet");

  if (captureAuthenticatedChatwoot) {
    await test.step("chatwoot pre-owned A exact characterization", async () => {
      if (preOwnedChatwootSeed === null) {
        throw new Error("Fresh Chatwoot ownership was not captured before the pre-owned proof.");
      }
      await restorePreOwnedChatwootSeed(page, preOwnedChatwootSeed);
      await gotoHeading(page, "/cabinet", "Личный кабинет");
      await page.evaluate((marker) => {
        const readiness = (
          window as unknown as { __cleanPayChatwootFixtureReadiness?: unknown }
        ).__cleanPayChatwootFixtureReadiness;
        if (sessionStorage.getItem(marker) !== "armed" || readiness !== "restored") {
          throw new Error("Pre-owned Chatwoot seed did not bind the final cabinet document.");
        }
        sessionStorage.removeItem(marker);
      }, preOwnedChatwootSeedMarker);
      const seedMarker = await page.evaluate(
        (marker) => sessionStorage.getItem(marker),
        preOwnedChatwootSeedMarker,
      );
      expect(seedMarker).toBeNull();
      await waitForAuthenticatedChatwootFixture(page);
    });
  }

  await clearSyntheticLogoutState(page);
  await gotoHeading(page, "/login?redirect_to=%2Fcabinet", "Вход");
  await waitForTurnstile(page, "auth_login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByLabel("Пароль")).toBeVisible();
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.waitForURL((url) => url.pathname === "/cabinet");
  if (captureAuthenticatedChatwoot) {
    await test.step("chatwoot post-clear fresh A-to-B exact characterization", () => (
      waitForFreshAuthenticatedChatwootFixture(page)
    ));
  }
  await journey.checkpoint("email-login-cabinet");
  journey.boundary("turnstile-lifecycle", await readTurnstileBoundary(page));
});

test("telegram-oidc-cabinet-profile-link-referral-passkey", async ({ journey }) => {
  const { page } = journey;
  await installWebAuthnBoundary(page);
  const oidcLifecycle = await loginWithTelegramOidc(page, true);
  journey.boundary("telegram-oidc-cookie-lifecycle", oidcLifecycle);
  await journey.checkpoint("telegram-oidc-cabinet");

  await dispatchInstallPrompt(page);
  await page.getByRole("button", { name: "Установить приложение" }).click();
  await expect.poll(() => pwaBoundaryCalls(page)).toEqual([
    "preventDefault", "prompt", "userChoice",
  ]);
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect.poll(() => pwaBoundaryCalls(page)).toEqual([
    "preventDefault", "prompt", "userChoice", "appinstalled",
  ]);
  await expect(page.getByRole("button", { name: "Установить приложение" }))
    .toHaveCount(0);
  journey.boundary("pwa-install", await pwaBoundaryCalls(page));
  await journey.checkpoint("cabinet-pwa-installed");

  await gotoHeading(page, "/profile", "Профиль");
  await journey.checkpoint("profile");
  await gotoHeading(page, "/verify-email", "Подтверждение e-mail");
  await journey.checkpoint("verify-email");
  await gotoHeading(page, "/referral", "Пригласить друзей");
  await journey.checkpoint("referral");

  await installClipboardAndShareBoundary(page);
  const copy = page.getByRole("button", { name: "Скопировать" });
  await expect(copy).toBeVisible();
  await copy.click();
  const share = page.getByRole("button", { name: "Поделиться" });
  await expect(share).toBeVisible();
  await share.click();
  journey.boundary("referral-browser-apis", await browserApiBoundaryCalls(page));

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  try {
    await gotoHeading(page, "/passkey/setup?redirect_to=%2Fcabinet", "Быстрый вход");
    await page.getByLabel("Название ключа").fill("Synthetic browser key");
    await page.getByRole("button", { name: "Настроить быстрый вход" }).click();
    await page.waitForURL((url) => url.pathname === "/cabinet");
    const credentials = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
    journey.boundary("passkey-virtual-authenticator", {
      protocol: "ctap2",
      transport: "internal",
      credentialCount: credentials.credentials.length,
    });
    await page.getByRole("button", { name: "Выйти" }).last().click();
    await page.waitForURL((url) => url.pathname === "/login");
    await waitForTurnstile(page, "auth_login");
    await page.getByLabel("E-mail").fill("synthetic.browser@clean-pay.dev");
    await page.getByRole("button", { name: "Продолжить" }).click();
    await expect(page.getByRole("button", { name: "Войти быстро" })).toBeVisible();
    await journey.checkpoint("passkey-login-ready");
    await page.getByRole("button", { name: "Войти быстро" }).click();
    await page.waitForURL((url) => url.pathname === "/cabinet");
    await expect(page.getByRole("heading", { name: "Личный кабинет", level: 1 })).toBeVisible();
    journey.boundary("passkey-webauthn-operations", await readWebAuthnBoundary(page));
    await journey.checkpoint("passkey-login-cabinet");
  } finally {
    await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
    await cdp.send("WebAuthn.disable");
  }

  await gotoHeading(page, "/link-account", "Способы входа");
  await journey.checkpoint("link-account-with-passkey");
  const authenticatedChatwoot = await waitForChatwootBoundary(page);
  journey.boundary("chatwoot-authenticated", authenticatedChatwoot);
  const chatwootEffects = await journey.effects() as ProviderLedger;
  expect(chatwootEffects.entries.filter((entry) => entry.effect === "contact_identity_probed"))
    .not.toHaveLength(0);
  journey.boundary("turnstile-lifecycle", await readTurnstileBoundary(page));
});

test("email-account-links-and-merges-telegram", async ({ journey }, testInfo) => {
  const { page } = journey;
  const viewportId = testInfo.project.name.replace(/^journey-/, "");
  const email = `new.merge.${viewportId}@clean-pay.dev`;
  const password = "Synthetic-browser-password-42";

  await gotoHeading(page, "/register?redirect_to=%2Fcabinet", "Регистрация");
  await waitForTurnstile(page, "auth_login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByLabel("Придумайте пароль")).toBeVisible();
  await page.getByLabel("Придумайте пароль").fill(password);
  await page.getByLabel("Повторите новый пароль").fill(password);
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await page.waitForURL((url) => url.pathname === "/register/verify-email");
  await waitForTurnstile(page, "email_verification");
  await page.getByLabel("Код подтверждения").fill("123456");
  await page.getByRole("button", { name: "Подтвердить e-mail" }).click();
  await page.waitForURL((url) => url.pathname === "/passkey/setup");
  await page.getByRole("button", { name: "Продолжить без него" }).click();
  await page.waitForURL((url) => url.pathname === "/cabinet");

  await gotoHeading(page, "/link-account", "Способы входа");
  await waitForTurnstile(page, "telegram_auth_start");
  await expect(page.getByRole("button", { name: "Привязать Telegram" })).toBeVisible();
  await page.getByRole("button", { name: "Привязать Telegram" }).click();
  await page.waitForURL((url) => (
    url.pathname === "/link-account" && url.searchParams.get("auth") === "telegram_email_replace"
  ), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Объединить аккаунты" })).toBeVisible();
  await journey.checkpoint("link-account-merge-confirmation");
  const staged = await journey.effects() as ProviderLedger;
  expect(staged.entries.filter((entry) => entry.effect === "users_merge_dry_run"))
    .toHaveLength(1);

  await page.getByRole("button", { name: "Объединить аккаунты" }).click();
  await page.waitForURL((url) => url.pathname === "/cabinet", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Личный кабинет", level: 1 })).toBeVisible();
  await journey.checkpoint("link-account-merged-cabinet");
  const completed = await journey.effects() as ProviderLedger;
  const dryRunCount = completed.entries.filter((entry) => entry.effect === "users_merge_dry_run").length;
  const mergeCount = completed.entries.filter((entry) => entry.effect === "users_merged").length;
  journey.boundary("telegram-account-merge", {
    confirmed: true,
    dryRunCount,
    mergeCount,
    redirectPath: new URL(page.url()).pathname,
  });
  journey.boundary("turnstile-lifecycle", await readTurnstileBoundary(page));
});

test("tariffs-payment-returns-extend-idempotency", async ({ journey }) => {
  const { page } = journey;
  await loginWithTelegramOidc(page);
  await gotoHeading(page, "/tariffs", "Тарифы");
  await journey.checkpoint("tariffs-authenticated");
  await page.getByRole("link", { name: "Изменить тариф" }).first().click();
  await page.waitForURL((url) => url.pathname === "/payment");
  await journey.checkpoint("payment-confirmation");

  const payButton = page.getByRole("button", { name: "Перейти к оплате" });
  await journey.injectPaymentRateLimitOnce();
  const failedAction = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && typeof response.request().headers()["next-action"] === "string"
  ));
  await payButton.click();
  await failedAction;
  await expect(payButton).toBeEnabled({ timeout: 30_000 });
  await Promise.all([
    page.waitForURL((url) => url.hostname === "checkout.browser.clean-pay.dev"),
    payButton.evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    }),
  ]);
  await journey.checkpoint("payment-provider-checkout");
  const paymentEffects = await journey.effects() as ProviderLedger;
  const initializations = paymentEffects.entries.filter(
    (entry) => entry.effect === "purchase_initialized",
  );
  const replays = paymentEffects.entries.filter((entry) => entry.effect === "purchase_replayed");
  expect(initializations).toHaveLength(1);
  expect(replays).toHaveLength(1);
  expect(replays[0]?.idempotency_key_sha256).toBe(initializations[0]?.idempotency_key_sha256);
  expect(replays[0]?.body_contract).toEqual(initializations[0]?.body_contract);
  journey.boundary("payment-idempotency-fencing", {
    commitThenRateLimit: true,
    initializationCount: initializations.length,
    replayCount: replays.length,
    sameBody: true,
    sameKey: true,
  });
  await page.getByRole("link", { name: "Вернуться в Clean Pay" }).click();
  await page.waitForURL((url) => url.hostname === "pay.ci.clean-pay.dev");
  await journey.checkpoint("payment-return-from-provider");

  const paymentId = "00000000-0000-4000-8000-000000000001";
  for (const route of ["pending", "success", "fail"] as const) {
    await page.goto(`/payment/${route}?payment_id=${paymentId}`, { waitUntil: "load" });
    await journey.checkpoint(`payment-return-${route}`);
  }

  await gotoHeading(page, "/extend", "Продление подписки");
  await journey.checkpoint("extend-confirmation");
  const turnstileBoundary = await readTurnstileBoundary(page);
  await Promise.all([
    page.waitForURL((url) => url.hostname === "checkout.browser.clean-pay.dev"),
    page.getByRole("button", { name: "Продлить" }).click(),
  ]);
  await journey.checkpoint("extend-provider-checkout");
  const finalEffects = await journey.effects() as ProviderLedger;
  expect(finalEffects.entries.filter((entry) => entry.effect === "extend_initialized"))
    .toHaveLength(1);
  journey.boundary("turnstile-lifecycle", turnstileBoundary);
});

test("telegram-webapp-browser-boundary", async ({ journey }, testInfo) => {
  const { page } = journey;
  const projectTelegramId = {
    "journey-390x844": 900000201,
    "journey-768x1024": 900000202,
    "journey-1440x900": 900000203,
  }[testInfo.project.name];
  if (!projectTelegramId) throw new Error("Telegram WebApp journey requires a locked viewport project.");
  await page.addInitScript((telegramId) => {
    const storageKey = "clean-pay:browser-journey:telegram-webapp-boundary";
    let calls: string[] = [];
    try {
      const stored: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
      if (Array.isArray(stored) && stored.every((call) => ["ready", "expand"].includes(call))) {
        calls = stored;
      }
    } catch {
      calls = [];
    }
    const record = (call: "ready" | "expand") => {
      calls.push(call);
      sessionStorage.setItem(storageKey, JSON.stringify(calls));
    };
    Object.defineProperty(window, "__cleanPayTelegramBoundaryCalls", {
      configurable: false,
      value: calls,
    });
    Object.defineProperty(window, "Telegram", {
      configurable: true,
      value: {
        WebApp: {
          initData: `query_id=synthetic-browser&user=${encodeURIComponent(JSON.stringify({ id: telegramId }))}&hash=synthetic`,
          ready() { record("ready"); },
          expand() { record("expand"); },
        },
      },
    });
  }, projectTelegramId);
  await page.goto("/auth/telegram/webapp?redirect_to=%2Fcabinet", { waitUntil: "load" });
  await page.waitForURL((url) => url.pathname === "/cabinet");
  journey.boundary("telegram-webapp", await page.evaluate(() => {
    const storageKey = "clean-pay:browser-journey:telegram-webapp-boundary";
    const calls = (window as unknown as { __cleanPayTelegramBoundaryCalls?: string[] })
      .__cleanPayTelegramBoundaryCalls ?? [];
    sessionStorage.removeItem(storageKey);
    return calls;
  }));
  await journey.checkpoint("telegram-webapp-cabinet");
});

type ProviderLedger = {
  entries: Array<{
    body_contract?: unknown;
    effect: string;
    idempotency_key_sha256?: string | null;
  }>;
};

async function gotoHeading(page: Page, pathname: string, heading: string) {
  await page.goto(pathname, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function waitForTurnstile(
  page: Page,
  action: "auth_login" | "email_verification" | "telegram_auth_start",
) {
  await expect.poll(() => page.evaluate((expectedAction) => {
    const windowWithBoundary = window as unknown as {
      turnstile?: unknown;
      __cleanPayTurnstileDocumentChallenges?: Array<{ action?: unknown }>;
    };
    return typeof windowWithBoundary.turnstile === "object"
      && Array.isArray(windowWithBoundary.__cleanPayTurnstileDocumentChallenges)
      && windowWithBoundary.__cleanPayTurnstileDocumentChallenges.some(
        (challenge) => challenge.action === expectedAction,
      );
  }, action)).toBe(true);
}

async function waitForAuthChallenge(page: Page) {
  await waitForTurnstile(page, "auth_login");
  await expect(page.getByRole("button", { name: "Продолжить" })).toBeEnabled();
}

async function loginWithTelegramOidc(page: Page, captureLifecycle = false) {
  await gotoHeading(page, "/login?redirect_to=%2Fcabinet", "Вход");
  await waitForTurnstile(page, "auth_login");
  const callbackCookies = captureLifecycle ? captureTelegramCallbackCookies(page) : null;
  const navigationRequests: Array<{ origin: string; pathname: string; queryKeys: string[] }> = [];
  const onRequest = (request: Request) => {
    if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
    const url = new URL(request.url());
    navigationRequests.push({
      origin: url.origin,
      pathname: url.pathname,
      queryKeys: [...new Set(url.searchParams.keys())].sort(),
    });
  };
  if (captureLifecycle) page.on("request", onRequest);
  await page.getByRole("button", { name: "Войти через Telegram" }).click();
  await page.waitForURL((url) => url.pathname === "/cabinet", { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Личный кабинет", level: 1 })).toBeVisible();
  if (!captureLifecycle || !callbackCookies) return null;
  page.off("request", onRequest);
  const preCallback = await callbackCookies;
  const finalCookies = await page.context().cookies(
    "https://pay.ci.clean-pay.dev/auth/telegram/callback",
  );
  const temporaryNames = new Set([
    "clean_pay_tg_state",
    "clean_pay_tg_nonce",
    "clean_pay_tg_code_verifier",
  ]);
  expect(finalCookies.filter((cookie) => temporaryNames.has(cookie.name))).toEqual([]);
  const receipt = finalCookies.find((cookie) => cookie.name === "clean_pay_tg_callback_receipt");
  expect(receipt).toBeTruthy();
  return {
    preCallback,
    final: {
      temporaryCookiesCleared: true,
      callbackReceipt: receipt ? safeCookieContract(receipt, [60, 150]) : null,
    },
    redirectChain: navigationRequests,
  };
}

async function waitForChatwootBoundary(page: Page) {
  await expect.poll(() => page.evaluate(() => {
    const calls = (window as unknown as { __cleanPayChatwootBoundaryCalls?: Array<{ method?: string }> })
      .__cleanPayChatwootBoundaryCalls;
    return Array.isArray(calls)
      ? calls.map((entry) => entry.method).filter((method): method is string => typeof method === "string")
      : [];
  }), { timeout: 15_000 }).toEqual(expect.arrayContaining([
    "setUser",
    "identity.confirmed",
  ]));
  return page.evaluate(() => (
    (window as unknown as { __cleanPayChatwootBoundaryCalls?: unknown[] })
      .__cleanPayChatwootBoundaryCalls ?? []
  ));
}

type PersistedChatwootOwnership = {
  conversation: string;
  core: string;
  customAttributes: string;
};

type PreOwnedChatwootSeed = {
  cookies: Array<Pick<Cookie,
    "domain" | "httpOnly" | "name" | "path" | "sameSite" | "secure" | "value">>;
  ownership: string;
};

const preOwnedChatwootSeedMarker = "clean-pay:test-chatwoot-pre-owned-seed:v1";

async function installFirstChatwootOwnershipCapture(page: Page) {
  await page.addInitScript(() => {
    const storagePrototype = Storage.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(storagePrototype, "setItem");
    const original = descriptor?.value;
    if (typeof original !== "function") {
      throw new Error("Chatwoot ownership capture requires Storage.setItem.");
    }

    Object.defineProperty(storagePrototype, "setItem", {
      ...descriptor,
      value(this: Storage, key: string, value: string) {
        original.call(this, key, value);
        if (key !== "clean-pay:chatwoot-ownership:v1" || this !== window.localStorage) {
          return;
        }
        const target = window as unknown as { __cleanPayFirstChatwootOwnership?: string };
        if (target.__cleanPayFirstChatwootOwnership === undefined) {
          Object.defineProperty(target, "__cleanPayFirstChatwootOwnership", {
            configurable: false,
            enumerable: false,
            value,
            writable: false,
          });
        }
      },
    });
  });
}

async function capturePreOwnedChatwootSeed(page: Page): Promise<PreOwnedChatwootSeed> {
  const state = await page.evaluate(() => ({
    capturedOwnership: (
      window as unknown as { __cleanPayFirstChatwootOwnership?: string }
    ).__cleanPayFirstChatwootOwnership ?? null,
    conversation: document.cookie
      .split(";")
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith("cw_conversation="))
      ?.slice("cw_conversation=".length) ?? null,
    currentOwnership: localStorage.getItem("clean-pay:chatwoot-ownership:v1"),
  }));
  if (
    state.capturedOwnership === null
    || state.currentOwnership === null
    || state.conversation === null
  ) {
    throw new Error("Fresh Chatwoot A-to-B state did not expose both ownership generations.");
  }

  const captured = parsePersistedChatwootOwnership(state.capturedOwnership);
  const current = parsePersistedChatwootOwnership(state.currentOwnership);
  const conversation = decodeURIComponent(state.conversation);
  if (
    captured.core !== current.core
    || captured.customAttributes === current.customAttributes
    || captured.conversation !== current.conversation
    || captured.conversation !== chatwootFingerprintForTest(conversation)
  ) {
    throw new Error("Fresh Chatwoot ownership generations do not prove the exact A-to-B transition.");
  }

  const cookies = await readChatwootCookies(page);
  if (cookies.length !== 2) {
    throw new Error("Fresh Chatwoot ownership requires exactly two Chatwoot cookies.");
  }
  return { cookies, ownership: state.capturedOwnership };
}

async function restorePreOwnedChatwootSeed(page: Page, seed: PreOwnedChatwootSeed) {
  parsePersistedChatwootOwnership(seed.ownership);
  expect(await readChatwootCookies(page)).toEqual(seed.cookies);
  await page.addInitScript(({ marker, ownership }) => {
    if (window.top !== window || sessionStorage.getItem(marker) !== "armed") {
      return;
    }
    Object.defineProperty(window, "__cleanPayChatwootFixtureReadiness", {
      configurable: false,
      enumerable: false,
      value: "restored",
      writable: false,
    });
    localStorage.setItem("clean-pay:chatwoot-ownership:v1", ownership);
  }, { marker: preOwnedChatwootSeedMarker, ownership: seed.ownership });
  const storage = await page.evaluate(({ marker, ownership }) => {
    localStorage.removeItem("clean-pay:chatwoot-identity:v1");
    localStorage.setItem("clean-pay:chatwoot-ownership:v1", ownership);
    sessionStorage.setItem(marker, "armed");
    return {
      identity: localStorage.getItem("clean-pay:chatwoot-identity:v1"),
      keys: Object.keys(localStorage)
        .filter((key) => key.startsWith("clean-pay:chatwoot-"))
        .sort(),
      ownership: localStorage.getItem("clean-pay:chatwoot-ownership:v1"),
      seedMarker: sessionStorage.getItem(marker),
    };
  }, { marker: preOwnedChatwootSeedMarker, ownership: seed.ownership });
  expect(storage).toEqual({
    identity: null,
    keys: ["clean-pay:chatwoot-ownership:v1"],
    ownership: seed.ownership,
    seedMarker: "armed",
  });
  expect(await readChatwootCookies(page)).toEqual(seed.cookies);
}

function parsePersistedChatwootOwnership(raw: string): PersistedChatwootOwnership {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Persisted Chatwoot ownership is not valid JSON.");
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || Array.isArray(parsed)
    || JSON.stringify(Object.keys(parsed).sort())
      !== JSON.stringify(["conversation", "core", "customAttributes"])
  ) {
    throw new Error("Persisted Chatwoot ownership has an invalid schema.");
  }
  const record = parsed as Record<string, unknown>;
  const fingerprint = /^[1-9][0-9]{0,4}:[a-f0-9]{1,8}$/;
  if (
    typeof record.core !== "string"
    || !fingerprint.test(record.core)
    || typeof record.customAttributes !== "string"
    || !fingerprint.test(record.customAttributes)
    || typeof record.conversation !== "string"
    || !fingerprint.test(record.conversation)
  ) {
    throw new Error("Persisted Chatwoot ownership violates its fingerprint contract.");
  }
  return record as PersistedChatwootOwnership;
}

function chatwootFingerprintForTest(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`;
}

async function readChatwootCookies(page: Page) {
  return (await page.context().cookies(page.url()))
    .filter((cookie) => cookie.name === "cw_conversation" || cookie.name.startsWith("cw_user_"))
    .map(({ domain, httpOnly, name, path, sameSite, secure, value }) => ({
      domain,
      httpOnly,
      name,
      path,
      sameSite,
      secure,
      value,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function waitForAuthenticatedChatwootFixture(page: Page) {
  await expect.poll(async () => {
    const browserState = await page.evaluate(() => {
      const calls = (
        window as unknown as {
          __cleanPayChatwootBoundaryCalls?: unknown[];
          cleanPayChatwootOwnership?: unknown;
        }
      ).__cleanPayChatwootBoundaryCalls;
      const cookieEntries = document.cookie
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("=");
          return separator === -1
            ? [entry, ""] as const
            : [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))] as const;
        });
      const conversationEntries = cookieEntries.filter(([name]) => name === "cw_conversation");
      const identityEntries = cookieEntries.filter(([name]) => /^cw_user_[a-f0-9]{64}$/.test(name));
      const ownershipRaw = localStorage.getItem("clean-pay:chatwoot-ownership:v1");

      let ownership: unknown = null;
      try {
        ownership = ownershipRaw === null ? null : JSON.parse(ownershipRaw);
      } catch {
        ownership = null;
      }

      const fingerprint = (value: string) => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < value.length; index += 1) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193);
        }
        return `${value.length}:${(hash >>> 0).toString(16)}`;
      };
      const exactKeys = (value: unknown, keys: string[]) => (
        typeof value === "object"
        && value !== null
        && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
      );
      const conversation = conversationEntries[0]?.[1] ?? "";
      const ownershipRecord = ownership as Record<string, unknown> | null;
      const inMemoryOwnership = (
        window as unknown as { cleanPayChatwootOwnership?: unknown }
      ).cleanPayChatwootOwnership;
      const inMemoryRecord = inMemoryOwnership as Record<string, unknown> | null;
      const fingerprintPattern = /^[1-9][0-9]{0,4}:[a-f0-9]{1,8}$/;

      return {
        calls: Array.isArray(calls) ? calls : [],
        conversation,
        conversationCount: conversationEntries.length,
        identityCookie: identityEntries[0]
          ? { name: identityEntries[0][0], value: identityEntries[0][1] }
          : null,
        identityCookieCount: identityEntries.length,
        ownershipValid: exactKeys(ownership, ["conversation", "core", "customAttributes"])
          && typeof ownershipRecord?.core === "string"
          && fingerprintPattern.test(ownershipRecord.core)
          && typeof ownershipRecord.customAttributes === "string"
          && fingerprintPattern.test(ownershipRecord.customAttributes)
          && ownershipRecord.conversation === fingerprint(conversation),
        inMemoryOwnershipValid: exactKeys(
          inMemoryOwnership,
          ["conversation", "core", "customAttributes"],
        )
          && inMemoryRecord?.conversation === conversation
          && inMemoryRecord.core === ownershipRecord?.core
          && inMemoryRecord.customAttributes === ownershipRecord?.customAttributes,
        pathname: location.pathname,
      };
    });
    const chatwootCookies = (await page.context().cookies(page.url()))
      .filter((cookie) => cookie.name === "cw_conversation" || cookie.name.startsWith("cw_user_"))
      .map(({ domain, httpOnly, name, path, sameSite, secure, value }) => ({
        domain,
        httpOnly,
        name,
        path,
        sameSite,
        secure,
        value,
      }));
    return { browserState, chatwootCookies };
  }, { timeout: 15_000 }).toEqual({
    browserState: {
      calls: [
        {
          method: "run",
          baseUrl: "https://chatwoot.browser.clean-pay.dev",
          websiteTokenBytes: 64,
        },
        { method: "toggleBubbleVisibility", value: "show" },
        { method: "frame.loaded" },
        { method: "toggleBubbleVisibility", value: "show" },
        {
          method: "setUser",
          identifierBytes: 25,
          attributeKeys: ["custom_attributes", "email", "identifier_hash", "name"],
        },
        { method: "toggleBubbleVisibility", value: "show" },
        { method: "removeLabel", label: "subscription_expired" },
        { method: "identity.confirmed" },
      ],
      conversation: expect.stringMatching(/^c[a-z0-9]{24}$/),
      conversationCount: 1,
      identityCookie: {
        name: expect.stringMatching(/^cw_user_[a-f0-9]{64}$/),
        value: "synthetic-chatwoot-user",
      },
      identityCookieCount: 1,
      ownershipValid: true,
      inMemoryOwnershipValid: true,
      pathname: "/cabinet",
    },
    chatwootCookies: [
      {
        domain: "pay.ci.clean-pay.dev",
        httpOnly: false,
        name: "cw_conversation",
        path: "/",
        sameSite: "Lax",
        secure: true,
        value: expect.stringMatching(/^c[a-z0-9]{24}$/),
      },
      {
        domain: "pay.ci.clean-pay.dev",
        httpOnly: false,
        name: expect.stringMatching(/^cw_user_[a-f0-9]{64}$/),
        path: "/",
        sameSite: "Lax",
        secure: true,
        value: "synthetic-chatwoot-user",
      },
    ],
  });
}

// Run 33480237666 captured this fresh A-to-B order identically for baseline
// and candidate in all three viewports. The six exact Playwright diffs share
// SHA-256 6dbe21a612810cfcb6631ce58b95052ed0cdfe45301ad916a10b50c414650fff.
async function waitForFreshAuthenticatedChatwootFixture(page: Page) {
  await expect.poll(async () => {
    const browserState = await page.evaluate(() => {
      const calls = (
        window as unknown as {
          __cleanPayChatwootBoundaryCalls?: unknown[];
          cleanPayChatwootOwnership?: unknown;
        }
      ).__cleanPayChatwootBoundaryCalls;
      const cookieEntries = document.cookie
        .split(";")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const separator = entry.indexOf("=");
          return separator === -1
            ? [entry, ""] as const
            : [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))] as const;
        });
      const conversationEntries = cookieEntries.filter(([name]) => name === "cw_conversation");
      const identityEntries = cookieEntries.filter(([name]) => /^cw_user_[a-f0-9]{64}$/.test(name));
      const ownershipRaw = localStorage.getItem("clean-pay:chatwoot-ownership:v1");

      let ownership: unknown = null;
      try {
        ownership = ownershipRaw === null ? null : JSON.parse(ownershipRaw);
      } catch {
        ownership = null;
      }

      const fingerprint = (value: string) => {
        let hash = 0x811c9dc5;
        for (let index = 0; index < value.length; index += 1) {
          hash ^= value.charCodeAt(index);
          hash = Math.imul(hash, 0x01000193);
        }
        return `${value.length}:${(hash >>> 0).toString(16)}`;
      };
      const exactKeys = (value: unknown, keys: string[]) => (
        typeof value === "object"
        && value !== null
        && !Array.isArray(value)
        && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
      );
      const conversation = conversationEntries[0]?.[1] ?? "";
      const ownershipRecord = ownership as Record<string, unknown> | null;
      const inMemoryOwnership = (
        window as unknown as { cleanPayChatwootOwnership?: unknown }
      ).cleanPayChatwootOwnership;
      const inMemoryRecord = inMemoryOwnership as Record<string, unknown> | null;
      const fingerprintPattern = /^[1-9][0-9]{0,4}:[a-f0-9]{1,8}$/;

      return {
        calls: Array.isArray(calls) ? calls : [],
        conversation,
        conversationCount: conversationEntries.length,
        identityCookie: identityEntries[0]
          ? { name: identityEntries[0][0], value: identityEntries[0][1] }
          : null,
        identityCookieCount: identityEntries.length,
        ownershipValid: exactKeys(ownership, ["conversation", "core", "customAttributes"])
          && typeof ownershipRecord?.core === "string"
          && fingerprintPattern.test(ownershipRecord.core)
          && typeof ownershipRecord.customAttributes === "string"
          && fingerprintPattern.test(ownershipRecord.customAttributes)
          && ownershipRecord.conversation === fingerprint(conversation),
        inMemoryOwnershipValid: exactKeys(
          inMemoryOwnership,
          ["conversation", "core", "customAttributes"],
        )
          && inMemoryRecord?.conversation === conversation
          && inMemoryRecord.core === ownershipRecord?.core
          && inMemoryRecord.customAttributes === ownershipRecord?.customAttributes,
        pathname: location.pathname,
      };
    });
    const chatwootCookies = (await page.context().cookies(page.url()))
      .filter((cookie) => cookie.name === "cw_conversation" || cookie.name.startsWith("cw_user_"))
      .map(({ domain, httpOnly, name, path, sameSite, secure, value }) => ({
        domain,
        httpOnly,
        name,
        path,
        sameSite,
        secure,
        value,
      }));
    return { browserState, chatwootCookies };
  }, { timeout: 15_000 }).toEqual({
    browserState: {
      calls: [
        {
          method: "run",
          baseUrl: "https://chatwoot.browser.clean-pay.dev",
          websiteTokenBytes: 64,
        },
        { method: "toggleBubbleVisibility", value: "hide" },
        {
          method: "setUser",
          identifierBytes: 25,
          attributeKeys: ["custom_attributes", "email", "identifier_hash", "name"],
        },
        { method: "frame.loaded" },
        { method: "toggleBubbleVisibility", value: "show" },
        { method: "toggleBubbleVisibility", value: "show" },
        {
          method: "setUser",
          identifierBytes: 25,
          attributeKeys: ["custom_attributes", "email", "identifier_hash", "name"],
        },
        { method: "frame.loaded" },
        { method: "toggleBubbleVisibility", value: "show" },
        { method: "removeLabel", label: "subscription_expired" },
        { method: "identity.confirmed" },
        { method: "toggleBubbleVisibility", value: "show" },
        { method: "removeLabel", label: "subscription_expired" },
      ],
      conversation: expect.stringMatching(/^c[a-z0-9]{24}$/),
      conversationCount: 1,
      identityCookie: {
        name: expect.stringMatching(/^cw_user_[a-f0-9]{64}$/),
        value: "synthetic-chatwoot-user",
      },
      identityCookieCount: 1,
      ownershipValid: true,
      inMemoryOwnershipValid: true,
      pathname: "/cabinet",
    },
    chatwootCookies: [
      {
        domain: "pay.ci.clean-pay.dev",
        httpOnly: false,
        name: "cw_conversation",
        path: "/",
        sameSite: "Lax",
        secure: true,
        value: expect.stringMatching(/^c[a-z0-9]{24}$/),
      },
      {
        domain: "pay.ci.clean-pay.dev",
        httpOnly: false,
        name: expect.stringMatching(/^cw_user_[a-f0-9]{64}$/),
        path: "/",
        sameSite: "Lax",
        secure: true,
        value: "synthetic-chatwoot-user",
      },
    ],
  });
}

async function exerciseProductionServiceWorker(page: Page) {
  await gotoHeading(page, "/install", "Установить Clean Pay");
  const online = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    await navigator.serviceWorker.ready;
    const cacheNames = (await caches.keys()).sort();
    return {
      scriptPath: new URL(registration.active?.scriptURL ?? registration.installing?.scriptURL ?? "", location.origin).pathname,
      scopePath: new URL(registration.scope).pathname,
      cacheNames,
    };
  });
  await page.reload({ waitUntil: "load" });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await enterJourneyOfflineMode(page);
  try {
    await page.goto("/offline?journey_offline=1", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Нет подключения", level: 1 })).toBeVisible();
    const offline = await page.evaluate(() => ({
      controlled: Boolean(navigator.serviceWorker.controller),
      pathname: location.pathname,
      queryKeys: [...new URLSearchParams(location.search).keys()].sort(),
    }));
    return {
      registrationMode: "playwright-explicit-production-sw",
      reason: "pristine-static-csp-blocks-install-page-hydration",
      online,
      offline,
    };
  } catch (error) {
    await page.context().setOffline(false);
    throw error;
  }
}

function captureTelegramCallbackCookies(page: Page) {
  return new Promise<ReturnType<typeof safeCookieContract>[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off("request", onRequest);
      reject(new Error("Telegram callback navigation was not observed within 30 seconds."));
    }, 30_000);
    const onRequest = (request: Request) => {
      const url = new URL(request.url());
      if (
        !request.isNavigationRequest()
        || request.frame() !== page.mainFrame()
        || url.origin !== "https://pay.ci.clean-pay.dev"
        || url.pathname !== "/auth/telegram/callback"
      ) {
        return;
      }
      page.off("request", onRequest);
      clearTimeout(timer);
      void page.context().cookies("https://pay.ci.clean-pay.dev").then((cookies) => {
        const expected = [
          "clean_pay_tg_code_verifier",
          "clean_pay_tg_nonce",
          "clean_pay_tg_state",
        ];
        const temporary = cookies
          .filter((cookie) => expected.includes(cookie.name))
          .sort((left, right) => left.name.localeCompare(right.name));
        expect(temporary.map((cookie) => cookie.name)).toEqual(expected);
        resolve(temporary.map((cookie) => safeCookieContract(cookie, [1_700, 1_950])));
      }, reject);
    };
    page.on("request", onRequest);
  });
}

function safeCookieContract(cookie: Cookie, expiryRange: [number, number] | null) {
  const expiresInSeconds = cookie.expires < 0
    ? null
    : Math.round(cookie.expires - Date.now() / 1_000);
  if (
    expiryRange
    && (expiresInSeconds === null
      || expiresInSeconds < expiryRange[0]
      || expiresInSeconds > expiryRange[1])
  ) {
    throw new Error(`Cookie ${cookie.name} expiry is outside its bounded fixture contract.`);
  }
  return {
    name: cookie.name,
    valueBytes: Buffer.byteLength(cookie.value, "utf8"),
    valueSha256: createHash("sha256").update(cookie.value, "utf8").digest("hex"),
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    expiry: expiryRange ? {
      boundedSeconds: `${expiryRange[0]}..${expiryRange[1]}`,
      epochSeconds: cookie.expires,
    } : null,
  };
}

async function installWebAuthnBoundary(page: Page) {
  await page.addInitScript(() => {
    const storageKey = "clean-pay:browser-journey:webauthn-boundary";
    const read = () => {
      try {
        const parsed = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const append = (entry: unknown) => {
      const calls = [...read(), entry];
      sessionStorage.setItem(storageKey, JSON.stringify(calls));
    };
    const credentials = navigator.credentials;
    const originalCreate = credentials.create.bind(credentials);
    const originalGet = credentials.get.bind(credentials);
    Object.defineProperty(credentials, "create", {
      configurable: true,
      value: async (options?: CredentialCreationOptions) => {
        const publicKey = options?.publicKey;
        append({
          operation: "create.request",
          origin: location.origin,
          rpId: publicKey?.rp.id ?? null,
          rpName: publicKey?.rp.name ?? null,
          challengeBytes: publicKey?.challenge.byteLength ?? null,
          userIdBytes: publicKey?.user.id.byteLength ?? null,
          userNameBytes: publicKey?.user.name.length ?? null,
          algorithms: publicKey?.pubKeyCredParams.map((entry) => entry.alg) ?? [],
          residentKey: publicKey?.authenticatorSelection?.residentKey ?? null,
          userVerification: publicKey?.authenticatorSelection?.userVerification ?? null,
          attestation: publicKey?.attestation ?? null,
        });
        const result = await originalCreate(options);
        append({
          operation: "create.result",
          credentialType: result?.type ?? null,
          idBytes: result?.id.length ?? null,
        });
        return result;
      },
    });
    Object.defineProperty(credentials, "get", {
      configurable: true,
      value: async (options?: CredentialRequestOptions) => {
        const publicKey = options?.publicKey;
        append({
          operation: "get.request",
          origin: location.origin,
          rpId: publicKey?.rpId ?? null,
          challengeBytes: publicKey?.challenge.byteLength ?? null,
          allowCredentialCount: publicKey?.allowCredentials?.length ?? 0,
          allowCredentialTypes: publicKey?.allowCredentials?.map((entry) => entry.type) ?? [],
          userVerification: publicKey?.userVerification ?? null,
        });
        const result = await originalGet(options);
        append({
          operation: "get.result",
          credentialType: result?.type ?? null,
          idBytes: result?.id.length ?? null,
        });
        return result;
      },
    });
  });
}

async function readWebAuthnBoundary(page: Page) {
  return page.evaluate(() => {
    const storageKey = "clean-pay:browser-journey:webauthn-boundary";
    const calls = JSON.parse(sessionStorage.getItem(storageKey) ?? "[]");
    sessionStorage.removeItem(storageKey);
    return calls;
  });
}

async function focusedControl(page: Page) {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active ? {
      tag: active.tagName.toLowerCase(),
      role: active.getAttribute("role"),
      name: (active.getAttribute("aria-label") ?? active.textContent ?? "")
        .replace(/\s+/g, " ").trim(),
    } : null;
  });
}

async function dispatchInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const calls: string[] = [];
    Object.defineProperty(window, "__cleanPayPwaBoundaryCalls", { value: calls });
    window.addEventListener("appinstalled", () => calls.push("appinstalled"), { once: true });
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.defineProperties(event, {
      prompt: {
        value: async () => { calls.push("prompt"); },
      },
      userChoice: {
        get: () => {
          calls.push("userChoice");
          return Promise.resolve({ outcome: "accepted" });
        },
      },
    });
    window.dispatchEvent(event);
    if (event.defaultPrevented) calls.push("preventDefault");
  });
}

async function pwaBoundaryCalls(page: Page) {
  return page.evaluate(() => (
    (window as unknown as { __cleanPayPwaBoundaryCalls?: string[] })
      .__cleanPayPwaBoundaryCalls ?? []
  ));
}

async function installClipboardAndShareBoundary(page: Page) {
  await page.evaluate(() => {
    const calls: Array<{ operation: string; bytes?: number }> = [];
    Object.defineProperty(window, "__cleanPayBrowserApiBoundaryCalls", { value: calls });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value: string) {
          calls.push({ operation: "clipboard.writeText", bytes: value.length });
        },
      },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (value: { url?: string }) => {
        calls.push({ operation: "navigator.share", bytes: value.url?.length ?? 0 });
      },
    });
  });
}

async function browserApiBoundaryCalls(page: Page) {
  return page.evaluate(() => (
    (window as unknown as { __cleanPayBrowserApiBoundaryCalls?: unknown[] })
      .__cleanPayBrowserApiBoundaryCalls ?? []
  ));
}

async function readTurnstileBoundary(page: Page) {
  return page.evaluate(() => {
    const storageKey = "clean-pay:browser-journey:turnstile-boundary";
    try {
      const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      sessionStorage.removeItem(storageKey);
      return Array.isArray(stored.calls) ? stored.calls : [];
    } catch {
      sessionStorage.removeItem(storageKey);
      return [];
    }
  });
}
