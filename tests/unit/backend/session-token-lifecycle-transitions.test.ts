import { describe, expect, it } from "vitest";

import { ServiceError } from "@/backend/errors/service-error";
import {
  assertRecoveryUsableForCaller,
  isTerminalProviderRefreshRejection,
  normalizeRefreshResult,
  retryAfterSeconds,
} from "@/backend/integrations/remnashop/session-token-lifecycle-transitions";

describe("Remnashop session-token transitions", () => {
  const now = new Date("2026-08-27T00:00:00.000Z");

  it("normalizes a valid provider result without changing token bytes", () => {
    expect(normalizeRefreshResult({
      data: {
        expires_at: "2026-08-27T01:00:00.000Z",
        refresh_expires_at: "2026-09-27T00:00:00.000Z",
      },
      cookies: {
        accessToken: "byte-exact-access",
        refreshToken: "byte-exact-refresh",
      },
    }, now)).toEqual({
      version: 1,
      accessToken: "byte-exact-access",
      refreshToken: "byte-exact-refresh",
      accessExpiresAt: "2026-08-27T01:00:00.000Z",
      refreshExpiresAt: "2026-09-27T00:00:00.000Z",
    });
  });

  it("rejects unusable expiry transitions and expired finalized access", () => {
    expect(() => normalizeRefreshResult({
      data: {
        expires_at: "2026-08-26T23:59:59.000Z",
        refresh_expires_at: "2026-09-27T00:00:00.000Z",
      },
      cookies: { accessToken: "access", refreshToken: "refresh" },
    }, now)).toThrow("unusable token expiry window");

    expect(() => assertRecoveryUsableForCaller({
      version: 1,
      accessToken: "access",
      refreshToken: "refresh",
      accessExpiresAt: "2026-08-26T23:59:59.000Z",
      refreshExpiresAt: "2026-09-27T00:00:00.000Z",
    }, now)).toThrow("expired during finalization");
  });

  it("bounds lease retry timing and classifies only exact terminal rejection", () => {
    expect(retryAfterSeconds(new Date(now.getTime() - 1), now)).toBe(1);
    expect(retryAfterSeconds(new Date(now.getTime() + 2_001), now)).toBe(3);
    expect(retryAfterSeconds(new Date(now.getTime() + 60_000), now)).toBe(5);

    expect(isTerminalProviderRefreshRejection(new ServiceError(
      "UNAUTHORIZED",
      401,
      "rejected",
      { upstreamStatus: 401, upstreamPath: "/auth/refresh" },
    ))).toBe(true);
    expect(isTerminalProviderRefreshRejection(new ServiceError(
      "UNAUTHORIZED",
      401,
      "local rejection",
    ))).toBe(false);
  });
});
