import { describe, expect, it } from "vitest";

import { addDays, stripTurnstile } from "@/backend/auth/payload";
import { localUserProfile, remnashopUserProfile } from "@/backend/auth/profile-presenter";
import { safeRedirectPath } from "@/backend/auth/redirect-policy";

const baseSession = {
  authMethod: "TELEGRAM",
  user: {
    telegramId: "12345",
    telegramUsername: "clean_user",
    email: "user@example.com",
    emailVerified: true,
    fullName: "Clean User",
    displayName: "Clean",
  },
} as never;

describe("auth payload helpers and profile presenters", () => {
  it("strips both supported Turnstile fields", () => {
    expect(stripTurnstile({ email: "a@b.test", turnstileToken: "token-a" })).toEqual({
      body: { email: "a@b.test" },
      turnstileToken: "token-a",
    });
    expect(stripTurnstile({ email: "a@b.test", "cf-turnstile-response": "token-b" })).toEqual({
      body: { email: "a@b.test" },
      turnstileToken: "token-b",
    });
  });

  it("adds calendar days without mutating the original date", () => {
    const now = new Date("2026-06-25T00:00:00.000Z");

    expect(addDays(now, 2).toISOString()).toBe("2026-06-27T00:00:00.000Z");
    expect(now.toISOString()).toBe("2026-06-25T00:00:00.000Z");
  });

  it("builds local and remnashop-backed profiles", () => {
    expect(localUserProfile(baseSession).auth_type).toBe("telegram");
    expect(localUserProfile(baseSession).telegram_id).toBe("12345");

    const profile = remnashopUserProfile(baseSession, {
      telegram_id: 999,
      auth_type: "email",
      email: "remote@example.com",
      is_email_verified: false,
      pending_email: null,
      name: "Remote User",
      username: "remote",
      language: "ru",
    });

    expect(profile.auth_type).toBe("telegram");
    expect(profile.telegram_id).toBe("12345");
    expect(profile.fullName).toBe("Clean User");
    expect(profile.emailVerified).toBe(true);
  });

  it("uses Remnashop verification when the linked local email matches", () => {
    const staleLocalSession = {
      ...baseSession,
      user: {
        ...baseSession.user,
        emailVerified: false,
      },
    } as never;

    expect(remnashopUserProfile(staleLocalSession, {
      telegram_id: 999,
      auth_type: "email",
      email: "user@example.com",
      is_email_verified: true,
      pending_email: null,
      name: "Remote User",
      username: "remote",
      language: "ru",
    })).toMatchObject({
      email: "user@example.com",
      is_email_verified: true,
      emailVerified: true,
    });
  });

  it("does not report email as verified when no email is linked", () => {
    const sessionWithoutEmail = {
      ...baseSession,
      user: {
        ...baseSession.user,
        email: null,
        emailVerified: true,
      },
    } as never;

    expect(localUserProfile(sessionWithoutEmail)).toMatchObject({
      email: null,
      is_email_verified: false,
      emailVerified: false,
    });

    expect(remnashopUserProfile(sessionWithoutEmail, {
      telegram_id: 999,
      auth_type: "telegram",
      email: null,
      is_email_verified: true,
      pending_email: null,
      name: "Remote User",
      username: "remote",
      language: "ru",
    })).toMatchObject({
      email: null,
      is_email_verified: false,
      emailVerified: false,
    });
  });

  it("accepts only same-origin relative redirect paths", () => {
    expect(safeRedirectPath("/cabinet?tab=1#top")).toBe("/cabinet?tab=1#top");
    expect(safeRedirectPath(null)).toBeUndefined();
    expect(safeRedirectPath("https://evil.test")).toBeUndefined();
    expect(safeRedirectPath("//evil.test/path")).toBeUndefined();
  });
});
