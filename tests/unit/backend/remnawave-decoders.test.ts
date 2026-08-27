import { describe, expect, it } from "vitest";

import {
  decodeRemnawaveListResponse,
  decodeRemnawaveSingleResponse,
  decodeRemnawaveUser,
} from "@/backend/integrations/remnawave/decoders";

describe("Remnawave endpoint decoders", () => {
  it("keeps valid single-user fixtures deep-equal and drops extra fields", () => {
    expect(decodeRemnawaveSingleResponse({
      response: {
        uuid: "rw-1",
        status: "ACTIVE",
        email: "owner@example.com",
        telegramId: 777,
        expireAt: "2099-08-01T00:00:00.000Z",
        subscriptionUrl: "https://sub.example/token",
        subscription_url: null,
        provider_secret: "must-not-project",
        nested: { credential: "must-not-project" },
      },
      envelope_secret: "must-not-project",
    })).toEqual({
      response: {
        uuid: "rw-1",
        status: "ACTIVE",
        email: "owner@example.com",
        telegramId: 777,
        expireAt: "2099-08-01T00:00:00.000Z",
        subscriptionUrl: "https://sub.example/token",
        subscription_url: null,
      },
    });
  });

  it("projects every list item independently from unknown", () => {
    expect(decodeRemnawaveListResponse({
      response: [
        { uuid: "rw-1", email: null, ignored: "value" },
        { uuid: "rw-2", telegramId: "777", subscription_url: "legacy" },
      ],
    })).toEqual({
      response: [
        { uuid: "rw-1", email: null },
        { uuid: "rw-2", telegramId: "777", subscription_url: "legacy" },
      ],
    });
  });

  it("preserves null response envelopes", () => {
    expect(decodeRemnawaveSingleResponse({ response: null })).toEqual({
      response: null,
    });
    expect(decodeRemnawaveListResponse({ response: null })).toEqual({
      response: null,
    });
  });

  it("fails closed for malformed envelopes, users and field types", () => {
    expect(() => decodeRemnawaveSingleResponse({})).toThrow(
      "Remnawave response envelope is invalid",
    );
    expect(() => decodeRemnawaveSingleResponse({ response: [] })).toThrow(
      "Remnawave user must be an object",
    );
    expect(() => decodeRemnawaveListResponse({ response: {} })).toThrow(
      "Remnawave response must contain a user array",
    );
    expect(() => decodeRemnawaveUser({ uuid: 1 })).toThrow(
      "Remnawave uuid must be a string",
    );
    expect(() => decodeRemnawaveUser({ telegramId: {} })).toThrow(
      "Remnawave telegramId must be a string or number",
    );
  });
});
