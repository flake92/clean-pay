import { describe, expect, it, vi } from "vitest";

import {
  normalizedRemnawaveEmail,
  normalizedRemnawaveIdentity,
  remnawaveIdentitySynchronizationState,
  remnawaveUserHasAnyExpectedIdentity,
  selectUnambiguousRemnawaveSubscriptionUrl,
} from "@/backend/integrations/remnawave/identity-transitions";

describe("Remnawave identity transitions", () => {
  it("normalizes stable identity values without mutating input", () => {
    expect(normalizedRemnawaveIdentity(" 777 ")).toBe("777");
    expect(normalizedRemnawaveIdentity(777)).toBe("777");
    expect(normalizedRemnawaveIdentity("   ")).toBeNull();
    expect(normalizedRemnawaveEmail(" Owner@Example.COM "))
      .toBe("owner@example.com");
  });

  it("derives owner synchronization state and any-identity matching", () => {
    const user = {
      uuid: "rw-1",
      email: "owner@example.com",
      telegramId: 777,
    };
    const input = {
      uuid: "rw-1",
      email: "OWNER@example.com",
      telegramId: "777",
    };

    expect(remnawaveIdentitySynchronizationState(user, input)).toEqual({
      uuidMatches: true,
      emailMatches: true,
      telegramMatches: true,
    });
    expect(remnawaveUserHasAnyExpectedIdentity(user, input)).toBe(true);
    expect(remnawaveUserHasAnyExpectedIdentity(user, {
      email: "another@example.com",
      telegramId: "888",
    })).toBe(false);
  });

  it("selects one URL only for an unambiguous live UUID identity", () => {
    const live = vi.fn(() => true);
    const url = vi.fn((user: { subscriptionUrl?: string | null }) =>
      user.subscriptionUrl ?? null
    );
    const duplicate = {
      uuid: "rw-1",
      status: "ACTIVE",
      email: "owner@example.com",
      telegramId: "777",
      subscriptionUrl: "https://sub.example/same",
    };

    expect(selectUnambiguousRemnawaveSubscriptionUrl(
      [duplicate, { ...duplicate }],
      { email: "owner@example.com", telegramId: 777 },
      { isLiveUser: live, subscriptionUrl: url },
    )).toBe("https://sub.example/same");
    expect(selectUnambiguousRemnawaveSubscriptionUrl(
      [
        duplicate,
        { ...duplicate, subscriptionUrl: "https://sub.example/conflict" },
      ],
      { email: "owner@example.com", telegramId: 777 },
      { isLiveUser: live, subscriptionUrl: url },
    )).toBeNull();
  });
});
