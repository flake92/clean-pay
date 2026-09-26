import { describe, expect, it, vi } from "vitest";

vi.mock("@/backend/database/prisma", () => ({ prisma: {} }));

import * as webSession from "@/backend/integrations/sessions/web-session-service";

describe("web session facade", () => {
  it("preserves the exact runtime export surface", () => {
    expect(Object.keys(webSession).sort()).toEqual([
      "assertEmailVerificationPolicy",
      "clearWebSession",
      "clearWebSessionCookies",
      "createDurableCallbackWebSession",
      "createWebSession",
      "createWebSessionForRemnashopUser",
      "createWebSessionOnResponse",
      "getCurrentRefreshSessionCandidateReadOnly",
      "getCurrentSession",
      "getCurrentSessionReadOnly",
      "getCurrentUser",
      "getWebSessionUserIdFromAccessCookie",
      "refreshCurrentAccessCookie",
      "refreshTokenGraceMs",
      "replaceWebSessionAfterPasswordChange",
      "revokeAllWebSessionsForUser",
      "rotateRefreshTokenFamily",
      "setDurableCallbackReplayCookies",
      "setDurableCallbackWebSessionCookies",
      "upgradeCurrentSessionToFull",
    ]);
  });
});
