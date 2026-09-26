import { expect, test } from "@playwright/test";

import { sanitizeJourneyBoundary } from "./journey-boundary-contract";

test("accepts exact PII-free journey boundary schemas", () => {
  expect(sanitizeJourneyBoundary("passkey-virtual-authenticator", {
    protocol: "ctap2",
    transport: "internal",
    credentialCount: 1,
  })).toEqual({ protocol: "ctap2", transport: "internal", credentialCount: 1 });
  expect(sanitizeJourneyBoundary("pwa-install", [
    "preventDefault", "prompt", "userChoice", "appinstalled",
  ])).toEqual(["preventDefault", "prompt", "userChoice", "appinstalled"]);
  expect(sanitizeJourneyBoundary("pwa-service-worker-offline", {
    registrationMode: "playwright-explicit-production-sw",
    reason: "pristine-static-csp-blocks-install-page-hydration",
    online: {
      scriptPath: "/sw.js",
      scopePath: "/",
      cacheNames: ["clean-pay-shell-synthetic-build"],
    },
    offline: {
      controlled: true,
      pathname: "/offline",
      queryKeys: ["journey_offline"],
    },
  })).toBeTruthy();
  const safeCookie = (name: string, path: string, boundedSeconds: string) => ({
    name,
    valueBytes: 64,
    valueSha256: "a".repeat(64),
    domain: "pay.ci.clean-pay.dev",
    path,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    expiry: { boundedSeconds, epochSeconds: 1_788_000_000 },
  });
  expect(sanitizeJourneyBoundary("telegram-oidc-cookie-lifecycle", {
    preCallback: [
      safeCookie("clean_pay_tg_code_verifier", "/", "1700..1950"),
      safeCookie("clean_pay_tg_nonce", "/", "1700..1950"),
      safeCookie("clean_pay_tg_state", "/", "1700..1950"),
    ],
    final: {
      temporaryCookiesCleared: true,
      callbackReceipt: safeCookie(
        "clean_pay_tg_callback_receipt",
        "/auth/telegram/callback",
        "60..150",
      ),
    },
    redirectChain: [
      { origin: "https://pay.ci.clean-pay.dev", pathname: "/auth/telegram/start", queryKeys: ["redirect_to"] },
      { origin: "https://oauth.telegram.org", pathname: "/auth", queryKeys: ["state"] },
      { origin: "https://pay.ci.clean-pay.dev", pathname: "/auth/telegram/callback", queryKeys: ["code", "state"] },
      { origin: "https://pay.ci.clean-pay.dev", pathname: "/cabinet", queryKeys: [] },
    ],
  })).toBeTruthy();
  expect(sanitizeJourneyBoundary("telegram-account-merge", {
    confirmed: true,
    dryRunCount: 2,
    mergeCount: 1,
    redirectPath: "/cabinet",
  })).toBeTruthy();
  expect(sanitizeJourneyBoundary("turnstile-lifecycle", [
    { method: "render", widgetId: "synthetic-turnstile-1", action: "auth_login" },
    {
      method: "challenge",
      widgetId: "synthetic-turnstile-1",
      action: "auth_login",
      issue: 1,
    },
  ])).toBeTruthy();
});

test("rejects unknown labels, extra fields, PII, and lifecycle near misses", () => {
  expect(() => sanitizeJourneyBoundary("future-unreviewed-label", {})).toThrow();
  expect(() => sanitizeJourneyBoundary("keyboard-first-tab", {
    tag: "a",
    role: null,
    name: "private@example.invalid",
  })).toThrow();
  expect(() => sanitizeJourneyBoundary("passkey-virtual-authenticator", {
    protocol: "ctap2",
    transport: "internal",
    credentialCount: 1,
    credentialId: "raw-secret-id",
  })).toThrow();
  expect(() => sanitizeJourneyBoundary("pwa-service-worker-offline", {
    registrationMode: "playwright-explicit-production-sw",
    reason: "pristine-static-csp-blocks-install-page-hydration",
    online: {
      scriptPath: "/different.js",
      scopePath: "/",
      cacheNames: ["clean-pay-shell-synthetic-build"],
    },
    offline: { controlled: true, pathname: "/offline", queryKeys: ["journey_offline"] },
  })).toThrow();
  expect(() => sanitizeJourneyBoundary("pwa-install", [
    "prompt", "userChoice", "appinstalled",
  ])).toThrow();
  expect(() => sanitizeJourneyBoundary("payment-idempotency-fencing", {
    commitThenRateLimit: true,
    initializationCount: 2,
    replayCount: 1,
    sameBody: true,
    sameKey: true,
  })).toThrow();
  expect(sanitizeJourneyBoundary("payment-idempotency-fencing", {
    commitThenRateLimit: true,
    initializationCount: 1,
    replayCount: 1,
    sameBody: true,
    sameKey: true,
  })).toBeTruthy();
  expect(() => sanitizeJourneyBoundary("telegram-account-merge", {
    confirmed: true,
    dryRunCount: 1,
    mergeCount: 1,
    redirectPath: "/cabinet",
  })).toThrow();
  expect(() => sanitizeJourneyBoundary("turnstile-lifecycle", [
    { method: "render", widgetId: "synthetic-turnstile-1", action: "auth_login" },
    { method: "remove", widgetId: "synthetic-turnstile-1" },
  ])).toThrow();
});

test("queries the callback receipt at its exact path scope", async ({ context }) => {
  const domain = "pay.ci.clean-pay.dev";
  await context.addCookies([
    {
      name: "clean_pay_tg_state",
      value: "synthetic-temporary-state",
      domain,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "clean_pay_tg_callback_receipt",
      value: "synthetic-callback-receipt",
      domain,
      path: "/auth/telegram/callback",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);

  const rootNames = (await context.cookies(`https://${domain}/`))
    .map((cookie) => cookie.name)
    .sort();
  const callbackNames = (await context.cookies(
    `https://${domain}/auth/telegram/callback`,
  )).map((cookie) => cookie.name).sort();

  expect(rootNames).toEqual(["clean_pay_tg_state"]);
  expect(callbackNames).toEqual([
    "clean_pay_tg_callback_receipt",
    "clean_pay_tg_state",
  ]);
});
