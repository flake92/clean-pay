/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import {
  applyChatwootManagedLabels,
  confirmChatwootIdentity,
  enterChatwootAuthenticatedMode,
  enterChatwootGuestMode,
  identifyChatwootUser,
  isChatwootIdentityConfirmation,
  loadChatwootSupportContextCached,
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
    identifier: config.user.identifier,
    user: {
      name: config.user.name,
      email: config.user.email ?? undefined,
      identifier_hash: config.user.identifierHash,
      custom_attributes: config.user.customAttributes,
    },
    resetTriggered: true,
    setUser: vi.fn(),
    setLabel: vi.fn(),
    removeLabel: vi.fn(),
    toggleBubbleVisibility: vi.fn(),
    reset: vi.fn(),
  };
}

function confirmIdentity() {
  document.cookie = "cw_conversation=authenticated; Path=/";
  document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
  expect(confirmChatwootIdentity()).toBe(true);
}

describe("Chatwoot browser lifecycle", () => {
  beforeEach(() => {
    window.$chatwoot = undefined;
    window.chatwootSDK = undefined;
    window.chatwootSettings = undefined;
    window.cleanPayChatwootAuthorized = undefined;
    window.cleanPayChatwootIdentity = undefined;
    window.cleanPayChatwootPendingIdentity = undefined;
    window.cleanPayChatwootFailedIdentity = undefined;
    window.localStorage.clear();
    document.getElementById("clean-pay-chatwoot-sdk")?.remove();
    document.cookie = "cw_conversation=; Path=/; Max-Age=0";
    document.cookie = `cw_user_${config.websiteToken}=; Path=/; Max-Age=0`;
    vi.clearAllMocks();
  });

  it("identifies only an authenticated user and sends attributes atomically", () => {
    const api = chatwootApi();
    window.$chatwoot = api;

    expect(identifyChatwootUser(config)).toBe("unavailable");
    expect(api.setUser).not.toHaveBeenCalled();

    enterChatwootAuthenticatedMode();
    expect(identifyChatwootUser(config)).toBe("pending");

    expect(api.toggleBubbleVisibility).not.toHaveBeenCalled();
    expect(api.setUser).toHaveBeenCalledWith("user-123", {
      name: "Clean Pay User",
      email: "verified@example.com",
      identifier_hash: "signed-identifier",
      custom_attributes: config.user.customAttributes,
    });
    confirmIdentity();
    expect(identifyChatwootUser(config)).toBe("ready");
    expect(api.toggleBubbleVisibility).toHaveBeenCalledWith("show");
    expect(api.setUser.mock.invocationCallOrder[0]).toBeLessThan(
      api.toggleBubbleVisibility.mock.invocationCallOrder[0],
    );
    expect(api.setUser).toHaveBeenCalledTimes(1);

    expect(identifyChatwootUser(config)).toBe("ready");
    expect(api.setUser).toHaveBeenCalledTimes(1);
  });

  it("forces an atomic signed identity update when custom attributes change", () => {
    const api = chatwootApi();
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();
    identifyChatwootUser(config);
    confirmIdentity();

    const updated = {
      ...config,
      user: {
        ...config.user,
        customAttributes: { ...config.user.customAttributes, telegram_id: "999" },
      },
    };
    expect(identifyChatwootUser(updated)).toBe("pending");

    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.setUser).toHaveBeenLastCalledWith("user-123", expect.objectContaining({
      custom_attributes: updated.user.customAttributes,
    }));
    expect(document.cookie).not.toContain(`cw_user_${config.websiteToken}=`);
  });

  it("requires a new signed identity confirmation when the Chatwoot origin changes", () => {
    const api = chatwootApi();
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();
    identifyChatwootUser(config);
    confirmIdentity();

    expect(identifyChatwootUser({
      ...config,
      baseUrl: "https://new-chat.example.com",
    })).toBe("pending");
    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.toggleBubbleVisibility).toHaveBeenLastCalledWith("hide");
  });

  it("serializes a newer context behind the pending signed identity request", () => {
    const api = chatwootApi();
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();

    expect(identifyChatwootUser(config)).toBe("pending");
    expect(identifyChatwootUser(config, { subscription_plan: "Premium" }))
      .toBe("pending");
    expect(api.setUser).toHaveBeenCalledTimes(1);

    confirmIdentity();
    expect(identifyChatwootUser(config, { subscription_plan: "Premium" }))
      .toBe("pending");
    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.setUser).toHaveBeenLastCalledWith("user-123", expect.objectContaining({
      custom_attributes: {
        ...config.user.customAttributes,
        subscription_plan: "Premium",
      },
    }));
  });

  it("identifies with support attributes in the same signed set-user command", () => {
    const api = chatwootApi();
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();

    identifyChatwootUser(config, {
      subscription_plan: "Premium",
      last_payment_status: "FAILED",
    });

    expect(api.setUser).toHaveBeenCalledWith("user-123", expect.objectContaining({
      custom_attributes: {
        ...config.user.customAttributes,
        subscription_plan: "Premium",
        last_payment_status: "FAILED",
      },
    }));
  });

  it("accepts identity confirmation only from the configured Chatwoot iframe", () => {
    const frame = document.createElement("iframe");
    frame.id = "chatwoot_live_chat_widget";
    document.body.appendChild(frame);
    const event = new MessageEvent("message", {
      origin: config.baseUrl,
      source: frame.contentWindow,
      data: 'chatwoot-widget:{"event":"setAuthCookie","data":{"widgetAuthToken":"token"}}',
    });

    expect(isChatwootIdentityConfirmation(event, config.baseUrl)).toBe(true);
    expect(isChatwootIdentityConfirmation(new MessageEvent("message", {
      origin: "https://attacker.example",
      source: frame.contentWindow,
      data: event.data,
    }), config.baseUrl)).toBe(false);
    frame.remove();
  });

  it("adds or removes only managed conversation labels", () => {
    const api = chatwootApi();
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();

    applyChatwootManagedLabels({
      customAttributes: {
        subscription_plan: "Premium",
        last_payment_status: "FAILED",
      },
      managedLabels: [
        { name: "payment_problem", enabled: true },
        { name: "subscription_expired", enabled: false },
      ],
    });

    expect(api.setLabel).toHaveBeenCalledWith("payment_problem");
    expect(api.removeLabel).toHaveBeenCalledWith("subscription_expired");
  });

  it("never applies context before signed authentication mode is active", () => {
    const api = chatwootApi();
    window.$chatwoot = api;

    applyChatwootManagedLabels({
      customAttributes: { subscription_plan: "Premium" },
      managedLabels: [{ name: "payment_problem", enabled: true }],
    });

    expect(api.setLabel).not.toHaveBeenCalled();
  });

  it("isolates optional context failures from the base widget", () => {
    const api = chatwootApi();
    api.setLabel.mockImplementation(() => { throw new Error("unsupported"); });
    window.$chatwoot = api;
    enterChatwootAuthenticatedMode();

    expect(() => applyChatwootManagedLabels({
      customAttributes: { subscription_status: "ACTIVE" },
      managedLabels: [
        { name: "payment_problem", enabled: true },
        { name: "subscription_expired", enabled: false },
      ],
    })).not.toThrow();
    expect(window.cleanPayChatwootAuthorized).toBe(true);
  });

  it("coalesces support-context loads briefly and clears them on logout", async () => {
    const loader = vi.fn(async () => ({
      customAttributes: { subscription_status: "ACTIVE" },
      managedLabels: [],
    }));

    const first = loadChatwootSupportContextCached("user-123", loader, 1_000);
    const second = loadChatwootSupportContextCached("user-123", loader, 1_001);

    expect(first).toBe(second);
    await expect(first).resolves.toMatchObject({
      customAttributes: { subscription_status: "ACTIVE" },
    });
    expect(loader).toHaveBeenCalledTimes(1);

    resetChatwootSession();
    await loadChatwootSupportContextCached("user-123", loader, 1_002);
    expect(loader).toHaveBeenCalledTimes(2);
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
    expect(api.identifier).toBeUndefined();
    expect(api.user).toBeUndefined();
    expect(api.hasLoaded).toBe(false);
    expect(api.resetTriggered).toBe(false);
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
