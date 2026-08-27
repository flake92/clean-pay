import { describe, expect, it, vi } from "vitest";

import {
  getWebSessionExpiryWindow,
  getWebSessionRevocationSource,
  resolveWebAccessCredential,
  revokedWebSessionData,
} from "@/backend/integrations/sessions/web-session-transitions";

describe("web session credential transitions", () => {
  it("does not invoke verification when the access credential is missing", () => {
    const verify = vi.fn();

    expect(resolveWebAccessCredential(undefined, verify)).toEqual({
      kind: "missing",
    });
    expect(verify).not.toHaveBeenCalled();
  });

  it("separates invalid and valid credentials without side effects", () => {
    const payload = {
      sid: "session-1",
      uid: "user-1",
      exp: 1_900_000_000,
      al: "FULL",
      ev: true,
      tg: false,
    } as const;
    const verify = vi.fn()
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(payload);

    expect(resolveWebAccessCredential("invalid", verify)).toEqual({
      kind: "invalid",
    });
    expect(resolveWebAccessCredential("valid", verify)).toEqual({
      kind: "valid",
      payload,
    });
    expect(verify.mock.calls.map(([token]) => token)).toEqual([
      "invalid",
      "valid",
    ]);
  });

  it("derives access and refresh expiry from one immutable clock value", () => {
    const now = new Date("2026-08-27T00:00:00.000Z");

    expect(getWebSessionExpiryWindow(now, 15, 30)).toEqual({
      accessTokenExpiresAt: new Date("2026-08-27T00:15:00.000Z"),
      refreshExpiresAt: new Date("2026-09-26T00:00:00.000Z"),
    });
    expect(now).toEqual(new Date("2026-08-27T00:00:00.000Z"));
  });

  it("preserves logout revocation-source precedence", () => {
    expect(getWebSessionRevocationSource(true, true)).toBe("access");
    expect(getWebSessionRevocationSource(true, false)).toBe("access");
    expect(getWebSessionRevocationSource(false, true)).toBe("refresh");
    expect(getWebSessionRevocationSource(false, false)).toBe("cookies_only");
  });

  it("projects the complete fail-closed revocation update from one timestamp", () => {
    const now = new Date("2026-08-27T00:00:00.000Z");

    expect(revokedWebSessionData(now)).toEqual({
      revokedAt: now,
      accessTokenExpiresAt: now,
      refreshExpiresAt: now,
      remnashopAccessTokenEncrypted: null,
      remnashopRefreshTokenEncrypted: null,
      remnashopAccessExpiresAt: null,
      remnashopRefreshExpiresAt: null,
      remnashopRefreshClaimTokenHash: null,
      remnashopRefreshLeaseExpiresAt: null,
      remnashopRefreshDispatchedAt: null,
      remnashopRefreshRecoveryEncrypted: null,
    });
  });
});
