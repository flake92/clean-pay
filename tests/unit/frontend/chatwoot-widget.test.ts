/** @vitest-environment jsdom */

import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadContext: vi.fn(),
  verifyIdentity: vi.fn(),
  navigateTo: vi.fn(),
}));

vi.mock("@/app/actions/chatwoot", () => ({
  loadChatwootSupportContextAction: mocks.loadContext,
  verifyChatwootIdentityAction: mocks.verifyIdentity,
}));
vi.mock("@/frontend/lib/browser-navigation", () => ({
  navigateTo: mocks.navigateTo,
}));

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { ChatwootWidget } from "@/frontend/components/chatwoot-widget";
import {
  CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS,
  clearChatwootSupportContextCache,
  getChatwootPendingIdentityAttempt,
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
    customAttributes: { clean_pay_user_id: "user-123" },
  },
};

const context = {
  customAttributes: {
    subscription_plan: "Premium",
    payment_context_status: "ready",
  },
  managedLabels: [
    { name: "payment_problem" as const, enabled: true },
    { name: "subscription_expired" as const, enabled: false },
  ],
};

function chatwootApi() {
  return {
    baseUrl: config.baseUrl,
    websiteToken: config.websiteToken,
    hasLoaded: true,
    setUser: vi.fn(() => {
      document.cookie = "cw_conversation=authenticated; Path=/";
      document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
      queueMicrotask(() => {
        const frame = document.getElementById(
          "chatwoot_live_chat_widget",
        ) as HTMLIFrameElement | null;

        window.dispatchEvent(new MessageEvent("message", {
          origin: config.baseUrl,
          source: frame?.contentWindow ?? null,
          data: 'chatwoot-widget:{"event":"setAuthCookie","data":{"widgetAuthToken":"token"}}',
        }));
      });
    }),
    setLabel: vi.fn(),
    removeLabel: vi.fn(),
    toggleBubbleVisibility: vi.fn(),
    reset: vi.fn(),
  };
}

describe("Chatwoot widget context lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearChatwootSupportContextCache();
    window.$chatwoot = chatwootApi();
    window.chatwootSDK = { run: vi.fn() };
    window.cleanPayChatwootAuthorized = undefined;
    window.cleanPayChatwootIdentity = undefined;
    window.cleanPayChatwootPendingIdentity = undefined;
    window.cleanPayChatwootFailedIdentity = undefined;
    window.onmessage = null;
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    document.getElementById("chatwoot_live_chat_widget")?.remove();
    const frame = document.createElement("iframe");
    frame.id = "chatwoot_live_chat_widget";
    document.body.appendChild(frame);
    mocks.loadContext.mockResolvedValue(context);
    mocks.verifyIdentity.mockResolvedValue("confirmed");
  });

  afterEach(() => {
    cleanup();
    resetChatwootSession();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function flushWidgetEffects() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it("reapplies managed labels after Chatwoot creates a conversation", async () => {
    render(createElement(ChatwootWidget, { config }));

    await waitFor(() => expect(window.$chatwoot?.setLabel).toHaveBeenCalled());
    vi.mocked(window.$chatwoot!.setLabel!).mockClear();
    vi.mocked(window.$chatwoot!.removeLabel!).mockClear();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("chatwoot:on-message"));
    });

    await waitFor(() => {
      expect(window.$chatwoot?.setLabel).toHaveBeenCalledWith("payment_problem");
      expect(window.$chatwoot?.removeLabel).toHaveBeenCalledWith("subscription_expired");
    });
  });

  it("refreshes context on open after the one-minute cache expires", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    render(createElement(ChatwootWidget, { config }));

    await waitFor(() => expect(mocks.loadContext).toHaveBeenCalledTimes(1));
    now.mockReturnValue(62_000);

    act(() => window.dispatchEvent(new CustomEvent("chatwoot:opened")));

    await waitFor(() => expect(mocks.loadContext).toHaveBeenCalledTimes(2));
  });

  it("does not remove labels from an expired snapshot while refresh is failing", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    mocks.loadContext.mockResolvedValue({
      ...context,
      managedLabels: [{ name: "payment_problem", enabled: false }],
    });
    render(createElement(ChatwootWidget, { config }));

    await waitFor(() => expect(window.$chatwoot?.removeLabel).toHaveBeenCalled());
    vi.mocked(window.$chatwoot!.removeLabel!).mockClear();
    mocks.loadContext.mockRejectedValueOnce(new Error("offline"));
    now.mockReturnValue(62_000);

    act(() => window.dispatchEvent(new CustomEvent("chatwoot:opened")));
    await waitFor(() => expect(mocks.loadContext).toHaveBeenCalledTimes(2));

    expect(window.$chatwoot?.removeLabel).not.toHaveBeenCalled();
  });

  it("recreates the iframe once, ignores the stale frame, and then fails closed", async () => {
    vi.useFakeTimers();
    mocks.verifyIdentity.mockResolvedValue("pending");
    const api = chatwootApi();
    api.setUser.mockImplementation(() => undefined);
    window.$chatwoot = api;
    const firstFrame = document.getElementById(
      "chatwoot_live_chat_widget",
    ) as HTMLIFrameElement;
    const firstFrameWindow = firstFrame.contentWindow;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();

    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "sent",
      retryCount: 0,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS);
    });

    const replacementFrame = document.getElementById(
      "chatwoot_live_chat_widget",
    ) as HTMLIFrameElement;
    expect(replacementFrame).not.toBe(firstFrame);
    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "waiting_for_frame",
      retryCount: 1,
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: config.baseUrl,
        source: firstFrameWindow,
        data: 'chatwoot-widget:{"event":"setAuthCookie","data":{"widgetAuthToken":"stale"}}',
      }));
      await Promise.resolve();
    });
    expect(getChatwootPendingIdentityAttempt()?.phase).toBe("waiting_for_frame");
    expect(api.setUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: config.baseUrl,
        source: replacementFrame.contentWindow,
        data: 'chatwoot-widget:{"event":"loaded"}',
      }));
      await Promise.resolve();
    });
    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "sent",
      retryCount: 1,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS);
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS);
    });
    expect(getChatwootPendingIdentityAttempt()).toBeUndefined();
    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.toggleBubbleVisibility).toHaveBeenLastCalledWith("hide");

    act(() => {
      window.dispatchEvent(new CustomEvent("chatwoot:error"));
      window.dispatchEvent(new CustomEvent("chatwoot:ready"));
      window.dispatchEvent(new CustomEvent("chatwoot:opened"));
      window.dispatchEvent(new CustomEvent("chatwoot:on-message"));
    });
    await flushWidgetEffects();
    expect(api.setUser).toHaveBeenCalledTimes(2);
  });

  it("blocks Chatwoot-prefixed messages with the wrong origin from the SDK", async () => {
    mocks.verifyIdentity.mockResolvedValue("pending");
    const api = chatwootApi();
    api.setUser.mockImplementation(() => undefined);
    window.$chatwoot = api;
    const frame = document.getElementById(
      "chatwoot_live_chat_widget",
    ) as HTMLIFrameElement;
    const permissiveSdkHandler = vi.fn();

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    window.onmessage = permissiveSdkHandler;

    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: "https://attacker.example",
        source: frame.contentWindow,
        data: 'chatwoot-widget:{"event":"setAuthCookie","data":{"widgetAuthToken":"attacker"}}',
      }));
    });

    expect(permissiveSdkHandler).not.toHaveBeenCalled();
    expect(getChatwootPendingIdentityAttempt()).toBeDefined();
  });

  it("cancels the pending timeout after a valid identity confirmation", async () => {
    vi.useFakeTimers();
    mocks.loadContext.mockResolvedValue(null);
    mocks.verifyIdentity.mockResolvedValue("pending");
    const api = chatwootApi();
    api.setUser.mockImplementation(() => undefined);
    window.$chatwoot = api;
    const frame = document.getElementById(
      "chatwoot_live_chat_widget",
    ) as HTMLIFrameElement;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    document.cookie = "cw_conversation=authenticated; Path=/";
    document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
    mocks.verifyIdentity.mockResolvedValue("confirmed");

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: config.baseUrl,
        source: frame.contentWindow,
        data: 'chatwoot-widget:{"event":"setAuthCookie","data":{"widgetAuthToken":"token"}}',
      }));
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS * 2);
    });

    expect(getChatwootPendingIdentityAttempt()).toBeUndefined();
    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(document.getElementById("chatwoot_live_chat_widget")).toBe(frame);
    expect(mocks.verifyIdentity).not.toHaveBeenCalled();
  });

  it("supports Chatwoot success without a setAuthCookie message", async () => {
    vi.useFakeTimers();
    mocks.loadContext.mockResolvedValue(null);
    const api = chatwootApi();
    api.setUser.mockImplementation(() => {
      // Chatwoot 4.16 returns a successful contact response without a new
      // widget_auth_token when the current contact does not need rotation.
      document.cookie = "cw_conversation=authenticated; Path=/";
      document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
    });
    window.$chatwoot = api;
    const frame = document.getElementById("chatwoot_live_chat_widget");

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(mocks.verifyIdentity).toHaveBeenCalledWith("user-123");
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "ownership_confirmed",
    });
    expect(window.localStorage.length).toBe(0);
    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(api.toggleBubbleVisibility).toHaveBeenCalledWith("show");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS * 2);
    });
    expect(document.getElementById("chatwoot_live_chat_widget")).toBe(frame);
    expect(api.setUser).toHaveBeenCalledTimes(1);
  });

  it("replaces a stale conversation once and re-identifies the current user", async () => {
    vi.useFakeTimers();
    mocks.loadContext.mockResolvedValue(null);
    mocks.verifyIdentity
      .mockResolvedValueOnce("reset_required")
      .mockResolvedValueOnce("reset_required");
    const api = chatwootApi();
    api.setUser.mockImplementation(() => {
      document.cookie = "cw_conversation=stale; Path=/";
      document.cookie = `cw_user_${config.websiteToken}=stale; Path=/`;
    });
    window.$chatwoot = api;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(mocks.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(api.reset).toHaveBeenCalledOnce();
    expect(document.cookie).not.toContain("cw_conversation=");
    expect(document.cookie).not.toContain(`cw_user_${config.websiteToken}=`);
    expect(window.cleanPayChatwootAuthorized).toBe(true);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("chatwoot:ready"));
      await Promise.resolve();
    });
    expect(api.setUser).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(mocks.verifyIdentity).toHaveBeenCalledTimes(2);
    expect(api.reset).toHaveBeenCalledOnce();
    expect(api.toggleBubbleVisibility).toHaveBeenLastCalledWith("hide");
  });

  it("retries an ownership-only payload after its PATCH fails and the page reloads", async () => {
    vi.useFakeTimers();
    mocks.loadContext.mockResolvedValue(null);
    const firstApi = chatwootApi();
    firstApi.setUser.mockImplementation(() => {
      document.cookie = "cw_conversation=authenticated; Path=/";
      document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
    });
    window.$chatwoot = firstApi;
    const firstView = render(createElement(ChatwootWidget, { config }));

    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "ownership_confirmed",
    });
    expect(window.localStorage.length).toBe(0);

    act(() => window.dispatchEvent(new CustomEvent("chatwoot:error")));
    expect(getChatwootPendingIdentityAttempt()).toBeUndefined();
    expect(document.cookie).not.toContain(`cw_user_${config.websiteToken}=`);
    expect(window.localStorage.length).toBe(0);

    firstView.unmount();
    // A hard reload discards in-memory transport/failure latches but preserves
    // localStorage. Ownership alone must not have left an applied fingerprint
    // that suppresses the failed payload on the next SDK instance.
    window.cleanPayChatwootAuthorized = undefined;
    window.cleanPayChatwootIdentity = undefined;
    window.cleanPayChatwootPendingIdentity = undefined;
    window.cleanPayChatwootFailedIdentity = undefined;
    const secondApi = chatwootApi();
    secondApi.setUser.mockImplementation(() => undefined);
    window.$chatwoot = secondApi;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();

    expect(secondApi.setUser).toHaveBeenCalledTimes(1);
  });

  it("retires ownership-confirmed A before B so a late A error cannot fail B", async () => {
    vi.useFakeTimers();
    let resolveContext!: (value: typeof context) => void;
    mocks.loadContext.mockReturnValue(new Promise((resolve) => {
      resolveContext = resolve;
    }));
    const api = chatwootApi();
    api.setUser.mockImplementation(() => {
      document.cookie = "cw_conversation=authenticated; Path=/";
      document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
    });
    window.$chatwoot = api;
    const firstFrame = document.getElementById(
      "chatwoot_live_chat_widget",
    ) as HTMLIFrameElement;
    const firstFrameWindow = firstFrame.contentWindow;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "ownership_confirmed",
    });
    expect(api.setUser).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveContext(context);
      await Promise.resolve();
      await Promise.resolve();
    });
    const replacementFrame = document.getElementById(
      "chatwoot_live_chat_widget",
    ) as HTMLIFrameElement;
    expect(replacementFrame).not.toBe(firstFrame);
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "waiting_for_frame",
    });
    expect(api.setUser).toHaveBeenCalledTimes(1);

    const permissiveSdkHandler = vi.fn(() => {
      window.dispatchEvent(new CustomEvent("chatwoot:error"));
    });
    window.onmessage = permissiveSdkHandler;
    act(() => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: config.baseUrl,
        source: firstFrameWindow,
        data: 'chatwoot-widget:{"event":"error","errorType":"SET_USER_ERROR"}',
      }));
    });
    expect(permissiveSdkHandler).not.toHaveBeenCalled();
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({
      phase: "waiting_for_frame",
    });

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: config.baseUrl,
        source: replacementFrame.contentWindow,
        data: 'chatwoot-widget:{"event":"loaded"}',
      }));
      await Promise.resolve();
    });
    expect(api.setUser).toHaveBeenCalledTimes(2);
    expect(api.setUser).toHaveBeenLastCalledWith(
      "user-123",
      expect.objectContaining({
        custom_attributes: {
          ...config.user.customAttributes,
          ...context.customAttributes,
        },
      }),
    );

    await act(async () => {
      window.dispatchEvent(new MessageEvent("message", {
        origin: config.baseUrl,
        source: replacementFrame.contentWindow,
        data: 'chatwoot-widget:{"event":"setAuthCookie","data":{"widgetAuthToken":"B"}}',
      }));
      await Promise.resolve();
    });
    expect(getChatwootPendingIdentityAttempt()).toBeUndefined();
    expect(window.localStorage.length).toBe(1);
    expect(api.toggleBubbleVisibility).toHaveBeenLastCalledWith("show");
  });

  it("requests one session refresh and stops probing when access refresh is required", async () => {
    vi.useFakeTimers();
    mocks.loadContext.mockResolvedValue(null);
    mocks.verifyIdentity.mockResolvedValue("refresh_required");
    window.history.replaceState({}, "", "/cabinet?tab=payments");
    const api = chatwootApi();
    api.setUser.mockImplementation(() => undefined);
    window.$chatwoot = api;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });

    expect(mocks.navigateTo).toHaveBeenCalledWith(
      "/auth/session/refresh?return_to=%2Fcabinet%3Ftab%3Dpayments",
    );
    expect(mocks.navigateTo).toHaveBeenCalledTimes(1);
    expect(mocks.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(window.cleanPayChatwootFailedIdentity).toBeUndefined();

    act(() => {
      window.dispatchEvent(new CustomEvent("chatwoot:ready"));
      window.dispatchEvent(new CustomEvent("chatwoot:opened"));
      window.dispatchEvent(new CustomEvent("chatwoot:error"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS * 2);
    });
    expect(mocks.navigateTo).toHaveBeenCalledTimes(1);
    expect(mocks.verifyIdentity).toHaveBeenCalledTimes(1);
    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(window.cleanPayChatwootFailedIdentity).toBeUndefined();
  });

  it("keeps a late Chatwoot identity error fail-closed after an ownership probe", async () => {
    vi.useFakeTimers();
    mocks.loadContext.mockResolvedValue(null);
    const api = chatwootApi();
    api.setUser.mockImplementation(() => {
      document.cookie = "cw_conversation=authenticated; Path=/";
      document.cookie = `cw_user_${config.websiteToken}=identified; Path=/`;
    });
    window.$chatwoot = api;

    render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(750);
    });
    expect(api.toggleBubbleVisibility).toHaveBeenCalledWith("show");

    act(() => window.dispatchEvent(new CustomEvent("chatwoot:error")));
    expect(api.toggleBubbleVisibility).toHaveBeenLastCalledWith("hide");

    act(() => {
      window.dispatchEvent(new CustomEvent("chatwoot:ready"));
      window.dispatchEvent(new CustomEvent("chatwoot:opened"));
    });
    await flushWidgetEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS * 2);
    });
    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(api.toggleBubbleVisibility).toHaveBeenLastCalledWith("hide");
  });

  it("cancels the component timer on unmount without launching a background retry", async () => {
    vi.useFakeTimers();
    mocks.verifyIdentity.mockResolvedValue("pending");
    const api = chatwootApi();
    api.setUser.mockImplementation(() => undefined);
    window.$chatwoot = api;
    const frame = document.getElementById("chatwoot_live_chat_widget");
    const view = render(createElement(ChatwootWidget, { config }));
    await flushWidgetEffects();

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS * 2);
    });

    expect(api.setUser).toHaveBeenCalledTimes(1);
    expect(document.getElementById("chatwoot_live_chat_widget")).toBe(frame);
    expect(getChatwootPendingIdentityAttempt()).toMatchObject({ retryCount: 0 });
  });
});
