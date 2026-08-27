/** @vitest-environment jsdom */

import { createElement } from "react";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { ChatwootGuestBoundary } from "@/frontend/components/chatwoot-widget";
import {
  boundedChatwootIdentityProbeDelayMs,
  chatwootIdentityAttemptRemainingMs,
  chatwootIdentityProbeRemainingMs,
  chatwootIdentityProbeRetryDelayMs,
  chatwootSessionRefreshTarget,
} from "@/frontend/components/chatwoot-widget-state";
import * as chatwoot from "@/frontend/lib/chatwoot";
import {
  failedChatwootIdentityAttempt,
  ownershipConfirmedChatwootIdentityAttempt,
  projectChatwootIdentity,
  sentChatwootIdentityAttempt,
  waitingChatwootIdentityAttempt,
} from "@/frontend/lib/chatwoot-transitions";

const config: ChatwootWidgetConfig = {
  baseUrl: "https://chat.example.com",
  websiteToken: "website-token",
  user: {
    identifier: "user-123",
    identifierHash: "signed-identity",
    name: "Иван",
    email: "ivan@example.com",
    customAttributes: {
      source: "email",
      subscription_status: "INACTIVE",
    },
  },
};

describe("Chatwoot decomposition contracts", () => {
  beforeEach(() => {
    window.$chatwoot = undefined;
    window.chatwootSDK = undefined;
    window.chatwootSettings = undefined;
    window.cleanPayChatwootAuthorized = undefined;
    window.cleanPayChatwootIdentity = undefined;
    window.cleanPayChatwootOwnership = undefined;
    window.cleanPayChatwootPendingIdentity = undefined;
    window.cleanPayChatwootFailedIdentity = undefined;
    window.localStorage.clear();
    document.getElementById("clean-pay-chatwoot-sdk")?.remove();
    document.cookie = "cw_conversation=; Path=/; Max-Age=0";
    document.cookie = `cw_user_${config.websiteToken}=; Path=/; Max-Age=0`;
    vi.clearAllMocks();
  });

  it("preserves the exact runtime facade exports", () => {
    expect(Object.keys(chatwoot).sort()).toEqual([
      "CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS",
      "CHATWOOT_IDENTITY_MAX_RETRIES",
      "activateChatwootIdentityRetry",
      "applyChatwootManagedLabels",
      "clearChatwootIdentityState",
      "clearChatwootSupportContextCache",
      "confirmChatwootIdentity",
      "confirmChatwootIdentityOwnership",
      "enterChatwootAuthenticatedMode",
      "enterChatwootGuestMode",
      "failChatwootIdentity",
      "failChatwootPendingIdentityAttempt",
      "getChatwootPendingIdentityAttempt",
      "identifyChatwootUser",
      "isChatwootFrameReady",
      "isChatwootIdentityConfirmation",
      "isUnexpectedChatwootFrameMessage",
      "loadChatwootSdk",
      "loadChatwootSupportContextCached",
      "resetChatwootSession",
      "retainChatwootVerifiedOwnership",
      "retryChatwootIdentityAttempt",
    ]);
  });

  it("keeps the guest boundary renderless while entering guest mode", () => {
    window.cleanPayChatwootAuthorized = true;

    const view = render(createElement(ChatwootGuestBoundary));

    expect(view.container.innerHTML).toBe("");
    expect(window.cleanPayChatwootAuthorized).toBe(false);
  });

  it("projects the exact signed core and merged custom-attribute fingerprints", () => {
    expect(projectChatwootIdentity(config, {
      source: "telegram",
      subscription_status: "ACTIVE",
    })).toEqual({
      customAttributes: {
        source: "telegram",
        subscription_status: "ACTIVE",
      },
      identity: {
        core: "99:f270f3a9",
        customAttributes: "52:573f330f",
      },
    });
  });

  it("keeps sent, waiting, ownership, and failure transitions byte-stable", () => {
    const identity = { core: "core", customAttributes: "attributes" };
    const sent = sentChatwootIdentityAttempt(identity, "attempt-1", 1_000, 0);

    expect(sent).toEqual({
      core: "core",
      customAttributes: "attributes",
      attemptId: "attempt-1",
      startedAt: 1_000,
      retryCount: 0,
      phase: "sent",
    });
    expect(waitingChatwootIdentityAttempt(sent, "attempt-2", 2_000, 1)).toEqual({
      ...sent,
      attemptId: "attempt-2",
      startedAt: 2_000,
      retryCount: 1,
      phase: "waiting_for_frame",
    });
    expect(ownershipConfirmedChatwootIdentityAttempt(sent)).toEqual({
      ...sent,
      phase: "ownership_confirmed",
    });
    expect(failedChatwootIdentityAttempt(sent)).toEqual(identity);
  });

  it("preserves timeout, probe backoff, and session-refresh calculations", () => {
    expect(chatwootIdentityAttemptRemainingMs(1_000, 12_000, 500)).toBe(12_500);
    expect(chatwootIdentityAttemptRemainingMs(1_000, 12_000, 14_000)).toBe(0);
    expect(chatwootIdentityProbeRemainingMs(1_000, 12_000, 14_000)).toBe(-1_000);
    expect(chatwootIdentityProbeRetryDelayMs(1_000, 900)).toBe(400);
    expect(chatwootIdentityProbeRetryDelayMs(1_000, 1_401)).toBe(401);
    expect(chatwootIdentityProbeRetryDelayMs(1_000, 4_000)).toBe(2_000);
    expect(boundedChatwootIdentityProbeDelayMs(-1, 1_200)).toBe(0);
    expect(boundedChatwootIdentityProbeDelayMs(3_000, 1_200)).toBe(1_200);
    expect(chatwootSessionRefreshTarget("/cabinet", "?tab=payments")).toBe(
      "/auth/session/refresh?return_to=%2Fcabinet%3Ftab%3Dpayments",
    );
  });

  it("characterizes the stale resolved loader after an SDK restart", async () => {
    const uninitialized = chatwoot.loadChatwootSdk(config.baseUrl);
    document.getElementById("clean-pay-chatwoot-sdk")
      ?.dispatchEvent(new Event("load"));
    await expect(uninitialized).rejects.toThrow("Chatwoot SDK did not initialize");

    const loaded = chatwoot.loadChatwootSdk(config.baseUrl);
    const script = document.getElementById("clean-pay-chatwoot-sdk");
    window.chatwootSDK = { run: vi.fn() };
    script?.dispatchEvent(new Event("load"));
    await expect(loaded).resolves.toBeUndefined();

    window.chatwootSDK = undefined;
    script?.remove();
    const staleRestart = chatwoot.loadChatwootSdk(config.baseUrl);

    expect(staleRestart).toBe(loaded);
    await expect(staleRestart).resolves.toBeUndefined();
    expect(document.getElementById("clean-pay-chatwoot-sdk")).toBeNull();
  });

  it("characterizes logout cleanup failures as swallowed without a retry", () => {
    const reset = vi.fn(() => {
      throw new Error("reset failed");
    });
    const toggleBubbleVisibility = vi.fn(() => {
      throw new Error("hide failed");
    });
    window.$chatwoot = {
      baseUrl: config.baseUrl,
      websiteToken: config.websiteToken,
      hasLoaded: true,
      setUser: vi.fn(),
      reset,
      toggleBubbleVisibility,
    };
    window.cleanPayChatwootAuthorized = true;
    window.cleanPayChatwootPendingIdentity = {
      core: "core",
      customAttributes: "attributes",
      attemptId: "attempt-1",
      startedAt: 1_000,
      retryCount: 0,
      phase: "sent",
    };

    expect(() => chatwoot.resetChatwootSession()).not.toThrow();
    expect(reset).toHaveBeenCalledOnce();
    expect(toggleBubbleVisibility).toHaveBeenCalledOnce();
    expect(window.cleanPayChatwootAuthorized).toBe(false);
    expect(window.cleanPayChatwootPendingIdentity).toBeUndefined();
  });
});
