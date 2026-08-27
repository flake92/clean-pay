import { expect, test } from "@playwright/test";

import {
  assertSyntheticLogoutStorageSnapshot,
  SYNTHETIC_APPLICATION_ORIGIN,
  SYNTHETIC_TURNSTILE_STORAGE_KEY,
} from "./synthetic-logout-storage";

const turnstileValue = JSON.stringify({
  sequence: 2,
  issueSequence: 3,
  calls: [
    { method: "render", widgetId: "synthetic-turnstile-1", action: "auth_login" },
    { method: "challenge", widgetId: "synthetic-turnstile-1", action: "auth_login", issue: 1 },
    { method: "reset", widgetId: "synthetic-turnstile-1" },
    { method: "challenge", widgetId: "synthetic-turnstile-1", action: "auth_login", issue: 2 },
    { method: "remove", widgetId: "synthetic-turnstile-1" },
    { method: "render", widgetId: "synthetic-turnstile-2", action: "email_verification" },
    { method: "challenge", widgetId: "synthetic-turnstile-2", action: "email_verification", issue: 3 },
  ],
});

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    fixtureEntries: [{
      area: "sessionStorage",
      key: SYNTHETIC_TURNSTILE_STORAGE_KEY,
      value: turnstileValue,
    }],
    localStorageKeyCount: 2,
    origin: SYNTHETIC_APPLICATION_ORIGIN,
    sessionStorageKeyCount: 3,
    ...overrides,
  };
}

test("preserves only the exact fixture-owned Turnstile state byte-for-byte", () => {
  expect(assertSyntheticLogoutStorageSnapshot(snapshot(), "before-clear"))
    .toBe(turnstileValue);
  expect(assertSyntheticLogoutStorageSnapshot(snapshot({
    localStorageKeyCount: 0,
    sessionStorageKeyCount: 1,
  }), "after-clear")).toBe(turnstileValue);
});

test("rejects wrong origins and extra or unsafe fixture storage keys", () => {
  for (const nearMiss of [
    snapshot({ origin: "https://pay.clean-pay.dev" }),
    snapshot({
      fixtureEntries: [{
        area: "localStorage",
        key: SYNTHETIC_TURNSTILE_STORAGE_KEY,
        value: turnstileValue,
      }],
    }),
    snapshot({
      fixtureEntries: [
        ...snapshot().fixtureEntries,
        {
          area: "sessionStorage",
          key: "clean-pay:browser-journey:webauthn-boundary",
          value: "[]",
        },
      ],
    }),
    snapshot({
      fixtureEntries: [{
        area: "sessionStorage",
        key: "clean-pay:browser-journey:<unsafe>",
        value: turnstileValue,
      }],
    }),
    { ...snapshot(), unexpected: true },
  ]) {
    expect(() => assertSyntheticLogoutStorageSnapshot(nearMiss, "before-clear")).toThrow();
  }
  expect(() => assertSyntheticLogoutStorageSnapshot(snapshot({
    localStorageKeyCount: 1,
    sessionStorageKeyCount: 1,
  }), "after-clear")).toThrow();
});

test("rejects malformed, extended, or non-sequential Turnstile state", () => {
  const parsed = JSON.parse(turnstileValue) as {
    calls: Array<Record<string, unknown>>;
    issueSequence: number;
    sequence: number;
  };
  for (const value of [
    "not-json",
    JSON.stringify({ ...parsed, extra: true }),
    JSON.stringify({ ...parsed, sequence: 3 }),
    JSON.stringify({ ...parsed, issueSequence: 4 }),
    JSON.stringify({
      ...parsed,
      calls: parsed.calls.map((call, index) => index === 0 ? { ...call, token: "secret" } : call),
    }),
    JSON.stringify({
      ...parsed,
      calls: parsed.calls.map((call, index) => (
        index === 0 ? { ...call, action: "auth/login" } : call
      )),
    }),
    JSON.stringify({
      ...parsed,
      calls: parsed.calls.map((call, index) => (
        index === 1 ? { ...call, issue: 2 } : call
      )),
    }),
  ]) {
    expect(() => assertSyntheticLogoutStorageSnapshot(snapshot({
      fixtureEntries: [{
        area: "sessionStorage",
        key: SYNTHETIC_TURNSTILE_STORAGE_KEY,
        value,
      }],
    }), "before-clear")).toThrow();
  }
});
