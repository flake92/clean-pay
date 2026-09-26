/** @vitest-environment jsdom */

import { createElement } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatwootWidgetConfig } from "@/application/models/chatwoot";
import { SupportChatGuestBoundary } from "@/frontend/components/chatwoot-widget";
import {
  boundedChatwootIdentityProbeDelayMs,
  chatwootIdentityAttemptRemainingMs,
  chatwootIdentityProbeRemainingMs,
  chatwootIdentityProbeRetryDelayMs,
  chatwootSessionRefreshTarget,
} from "@/frontend/components/chatwoot-widget-state";
import * as chatwoot from "@/frontend/lib/chatwoot";
import { chatwootDigest } from "@/frontend/lib/chatwoot-digest";
import {
  failedChatwootIdentityAttempt,
  ownershipConfirmedChatwootIdentityAttempt,
  projectChatwootIdentity,
  serializeChatwootAttributes,
  sentChatwootIdentityAttempt,
  waitingChatwootIdentityAttempt,
} from "@/frontend/lib/chatwoot-transitions";

const config: ChatwootWidgetConfig = {
  baseUrl: "https://chat.example.com",
  identityFingerprint: "1111111111111111111111111111111111111111111111111111111111111111",
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

  afterEach(() => {
    vi.useRealTimers();
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

    const view = render(createElement(SupportChatGuestBoundary));

    expect(view.container.innerHTML).toBe("");
    expect(window.cleanPayChatwootAuthorized).toBe(false);
  });

  it("projects the server-signed core and exact canonical custom attributes", () => {
    expect(projectChatwootIdentity(config, {
      source: "telegram",
      subscription_status: "ACTIVE",
    })).toEqual({
      customAttributes: {
        source: "telegram",
        subscription_status: "ACTIVE",
      },
      identity: {
        core: config.identityFingerprint,
        customAttributes: '[["source","telegram"],["subscription_status","ACTIVE"]]',
      },
    });
    expect(serializeChatwootAttributes({
      zeta: "last",
      alpha: "first",
    })).toBe('[["alpha","first"],["zeta","last"]]');
  });

  it("uses standard collision-resistant SHA-256 for persisted browser proofs", () => {
    expect(chatwootDigest("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(chatwootDigest("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(chatwootDigest("Clean Pay — поддержка")).toBe(
      "929d12b66965da416a52bd0d793d030a6c29e46746f229be5b2159cc5190034b",
    );
  });

  it("keeps distinct support contexts as distinct exact in-memory values", () => {
    const first = projectChatwootIdentity(config, {
      recent_payments: "costarring",
    }).identity;
    const second = projectChatwootIdentity(config, {
      recent_payments: "liquid",
    }).identity;

    expect(first.core).toBe(second.core);
    expect(first.customAttributes).not.toBe(second.customAttributes);
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

  it("reloads the SDK after an already-open cabinet loses its Chatwoot global", async () => {
    const uninitialized = chatwoot.loadChatwootSdk(config.baseUrl);
    const uninitializedScript = document.getElementById("clean-pay-chatwoot-sdk");
    const replacementDuringFailure = document.createElement("script");
    replacementDuringFailure.id = "clean-pay-chatwoot-sdk";
    document.head.appendChild(replacementDuringFailure);
    uninitializedScript?.dispatchEvent(new Event("load"));
    await expect(uninitialized).rejects.toThrow("Support chat did not initialize");
    expect(replacementDuringFailure.isConnected).toBe(true);

    const loaded = chatwoot.loadChatwootSdk(config.baseUrl);
    const concurrentLoad = chatwoot.loadChatwootSdk(config.baseUrl);
    const script = document.getElementById("clean-pay-chatwoot-sdk");
    expect(concurrentLoad).toBe(loaded);
    expect(document.querySelectorAll("#clean-pay-chatwoot-sdk")).toHaveLength(1);

    window.chatwootSDK = { run: vi.fn() };
    script?.dispatchEvent(new Event("load"));
    await expect(loaded).resolves.toBeUndefined();
    await expect(concurrentLoad).resolves.toBeUndefined();

    script?.dispatchEvent(new Event("error"));
    expect(script?.isConnected).toBe(true);

    window.chatwootSDK = undefined;
    const recovered = chatwoot.loadChatwootSdk(config.baseUrl);
    const replacement = document.getElementById("clean-pay-chatwoot-sdk");

    expect(recovered).not.toBe(loaded);
    expect(replacement).not.toBe(script);
    expect(replacement?.getAttribute("data-clean-pay-load-state")).toBe("loading");
    await expect(chatwoot.loadChatwootSdk("https://other-chat.example.com"))
      .rejects.toThrow("already loading from a different address");
    expect(document.querySelectorAll("#clean-pay-chatwoot-sdk")).toHaveLength(1);

    window.chatwootSDK = { run: vi.fn() };
    replacement?.dispatchEvent(new Event("load"));

    await expect(recovered).resolves.toBeUndefined();
    expect(replacement?.getAttribute("data-clean-pay-load-state")).toBe("loaded");
    expect(document.querySelectorAll("#clean-pay-chatwoot-sdk")).toHaveLength(1);
    await expect(chatwoot.loadChatwootSdk("https://other-chat.example.com"))
      .rejects.toThrow("reload the page before reconnecting");
  });

  it("bounds an SDK script that is removed without a load or error event", async () => {
    vi.useFakeTimers();
    const interrupted = chatwoot.loadChatwootSdk(config.baseUrl);
    const interruptedRejection = expect(interrupted).rejects.toThrow(
      "Support chat loading was interrupted",
    );
    document.getElementById("clean-pay-chatwoot-sdk")?.remove();
    const retry = chatwoot.loadChatwootSdk(config.baseUrl);
    await interruptedRejection;
    document.getElementById("clean-pay-chatwoot-sdk")
      ?.dispatchEvent(new Event("error"));
    await expect(retry).rejects.toThrow("Support chat failed to load");

    const abandoned = chatwoot.loadChatwootSdk(config.baseUrl);
    const rejected = expect(abandoned).rejects.toThrow(
      "Support chat loading timed out",
    );
    document.getElementById("clean-pay-chatwoot-sdk")?.remove();

    await vi.advanceTimersByTimeAsync(15_000);
    await rejected;

    const recovered = chatwoot.loadChatwootSdk(config.baseUrl);
    const replacement = document.getElementById("clean-pay-chatwoot-sdk");
    window.chatwootSDK = { run: vi.fn() };
    replacement?.dispatchEvent(new Event("load"));

    await expect(recovered).resolves.toBeUndefined();
    vi.useRealTimers();
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
