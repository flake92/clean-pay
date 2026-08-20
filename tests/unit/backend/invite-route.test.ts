import { describe, expect, it } from "vitest";

import { GET } from "@/app/invite/[code]/route";
import {
  referralAttributionCookieName,
  verifyReferralAttributionValue,
} from "@/backend/integrations/referral/referral-attribution";

describe("canonical referral entry route", () => {
  it("stores signed attribution and sends a guest to registration then tariffs", async () => {
    const response = await GET(
      new Request("https://evil.example/invite/Friend42"),
      { params: Promise.resolve({ code: "Friend42" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "http://localhost:8080/register?redirect_to=%2Ftariffs",
    );
    const cookie = response.cookies.get(referralAttributionCookieName);
    expect(cookie).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      secure: false,
    });
    expect(verifyReferralAttributionValue(cookie?.value)).toBe("Friend42");
  });

  it.each(["ab", "friend_code", "..", " Friend42 ", "a".repeat(65)])(
    "returns 404 without a cookie for invalid code %s",
    async (code) => {
      const response = await GET(
        new Request(`http://localhost:8080/invite/${encodeURIComponent(code)}`),
        { params: Promise.resolve({ code }) },
      );

      expect(response.status).toBe(404);
      expect(response.cookies.get(referralAttributionCookieName)).toBeUndefined();
    },
  );
});
