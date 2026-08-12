/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import {
  enterChatwootAuthenticatedMode,
  enterChatwootGuestMode,
  identifyChatwootUser,
  loadChatwootSdk,
  resetChatwootSession,
} from "@/frontend/lib/chatwoot";

const config: ChatwootWidgetConfig = {
  baseUrl: "https://chat.example.com",
  websiteToken: "website_token_123456789",
  user: {
    identifier: "user-123",
    identifierHash: "signed-identifier",
    name: "Clean Pay User",
    email: "verified@example.com",
    customAttributes: {
      clean_pay_user_id: "user-123",
      telegram_id: "7654321",
      telegram_username: "clean_pay_user",
    },
  },
};

function chatwootApi() {
  return {
    baseUrl: config.baseUrl,
    websiteToken: config.websiteToken,
    hasLoaded: true,
    setUser: vi.fn(),
    setCustomAttributes: vi.fn(),
    toggleBubbleVisibility: vi.fn(),
    reset: vi.fn(),
  };
}

describe("Chatwoot browser lifecycle", () => {
  beforeEach(() => {
    window.$chatwoot = undefined;
    window.chatwootSDK = undefined;
    window.chatwootSettings = undefined;
    window.cleanPayChatwootAuthorized = undefined;
    window.cleanPayChatwootIdentity = undefined;
    window.localStorage.clear();
    document.getElementById("clean-pay-chatwoot-sdk")?.remove();
    document.cookie = "cw_conversation=; Path=/; Max-Age=0";
    document.cookie = `cw_user_${config.websiteToken}=; Path=/; Max-Age=0`;
    vi.clearAllMocks();
  });

  it("identifies only an authenticated user and sends attributes atomically", () => {
    const api = chatwootApi();
    window.$chatwoot = api;

    identifyChatwootUser(config);
    expect(api.setUser).not.toHaveBeenCalled();

    enterChatwootAuthenticatedMode();
    identifyChatwootUser(config);

    expect(api.toggleBubbleVisibility).toHaveBeenCalledWith("show");
    expect(api.setUser).toHaveBeenCalledWith("user-123", {
      name: "Clean Pay User",
      email: "verified@example.com",
      identifier_hash: "signed-identifier",
      custom_attributes: config.user.customAttributes,
    });
    expect(api.setUser.mock.invocationCallOrder[0]).toBeLessThan(
      api.toggleBubbleVisibility.mock.invocationCallOrder[0],
    );
    expect(api.setCustomAttributes).not.toHaveBeenCalled();

    identifyChatwootUser(config);
    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.setCustomAttributes).not.toHaveBeenCalled();
  });

  it("updates custom attributes even when the SDK caches the core identity", () => {
    const api = chatwootApi();
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();
    identifyChatwootUser(config);
    window.cleanPayChatwootIdentity = undefined;

    const updated = {
      ...config,
      user: {
        ...config.user,
        customAttributes: { ...config.user.customAttributes, telegram_id: "999" },
      },
    };
    identifyChatwootUser(updated);

    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.setCustomAttributes).toHaveBeenCalledWith(updated.user.customAttributes);
  });

  it("resets before logout and keeps cleanup safe if the third-party SDK throws", () => {
    const api = chatwootApi();
    api.reset.mockImplementation(() => {
      throw new Error("broken iframe");
    });
    window.$chatwoot = api;
    window.cleanPayChatwootAuthorized = true;
    enterChatwootAuthenticatedMode();
    identifyChatwootUser(config);
    document.cookie = "cw_conversation=conversation; Path=/";
    document.cookie = `cw_user_${config.websiteToken}=contact; Path=/`;

    expect(() => resetChatwootSession()).not.toThrow();

    expect(window.cleanPayChatwootAuthorized).toBe(false);
    expect(window.cleanPayChatwootIdentity).toBeUndefined();
    expect(window.localStorage).toHaveLength(0);
    expect(api.toggleBubbleVisibility).toHaveBeenCalledWith("hide");
    expect(document.cookie).not.toContain("cw_conversation=");
    expect(document.cookie).not.toContain(`cw_user_${config.websiteToken}=`);
  });

  it("clears orphaned Chatwoot cookies on a fresh guest page", () => {
    document.cookie = "cw_conversation=conversation; Path=/";
    document.cookie = "cw_user_orphaned_token=contact; Path=/";

    enterChatwootGuestMode();

    expect(document.cookie).not.toContain("cw_conversation=");
    expect(document.cookie).not.toContain("cw_user_orphaned_token=");
  });

  it("loads the standard SDK once and supports a clean retry after failure", async () => {
    const failedLoad = loadChatwootSdk(config.baseUrl);
    const failedScript = document.getElementById("clean-pay-chatwoot-sdk") as HTMLScriptElement;
    expect(failedScript.src).toBe("https://chat.example.com/packs/js/sdk.js");
    failedScript.dispatchEvent(new Event("error"));
    await expect(failedLoad).rejects.toThrow("Chatwoot SDK failed to load");
    expect(document.getElementById("clean-pay-chatwoot-sdk")).toBeNull();

    const successfulLoad = loadChatwootSdk(config.baseUrl);
    const script = document.getElementById("clean-pay-chatwoot-sdk") as HTMLScriptElement;
    window.chatwootSDK = { run: vi.fn() };
    script.dispatchEvent(new Event("load"));

    await expect(successfulLoad).resolves.toBeUndefined();
    await expect(loadChatwootSdk(config.baseUrl)).resolves.toBeUndefined();
    expect(document.querySelectorAll("#clean-pay-chatwoot-sdk")).toHaveLength(1);
  });
});
