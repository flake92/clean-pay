"use client";

import { useEffect } from "react";

import {
  loadChatwootSupportContextAction,
  verifyChatwootIdentityAction,
} from "@/app/actions/chatwoot";
import type {
  ChatwootSupportContext,
  ChatwootWidgetConfig,
} from "@/application/models/chatwoot";
import {
  boundedChatwootIdentityProbeDelayMs,
  chatwootIdentityAttemptRemainingMs,
  CHATWOOT_IDENTITY_PROBE_LIMIT,
  chatwootIdentityProbeRemainingMs,
  chatwootIdentityProbeRetryDelayMs,
  CHATWOOT_INITIAL_IDENTITY_PROBE_DELAY_MS,
  chatwootSessionRefreshTarget,
} from "@/frontend/components/chatwoot-widget-state";
import {
  activateChatwootIdentityRetry,
  applyChatwootManagedLabels,
  CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS,
  CHATWOOT_IDENTITY_MAX_RETRIES,
  clearChatwootIdentityState,
  confirmChatwootIdentity,
  confirmChatwootIdentityOwnership,
  enterChatwootAuthenticatedMode,
  enterChatwootGuestMode,
  failChatwootIdentity,
  failChatwootPendingIdentityAttempt,
  getChatwootPendingIdentityAttempt,
  identifyChatwootUser,
  isChatwootFrameReady,
  isChatwootIdentityConfirmation,
  isUnexpectedChatwootFrameMessage,
  loadChatwootSdk,
  loadChatwootSupportContextCached,
  resetChatwootSession,
  retainChatwootVerifiedOwnership,
  retryChatwootIdentityAttempt,
} from "@/frontend/lib/chatwoot";
import { navigateTo } from "@/frontend/lib/browser-navigation";

function loadProductionSupportContext(config: ChatwootWidgetConfig) {
  return loadChatwootSupportContextCached(
    config.user.identifier,
    () => loadChatwootSupportContextAction(config.user.identifier),
  );
}

export function useChatwootWidgetController(
  config: ChatwootWidgetConfig,
  loadSupportContext: (
    config: ChatwootWidgetConfig,
  ) => Promise<ChatwootSupportContext | null> = loadProductionSupportContext,
) {
  useEffect(() => {
    let active = true;
    let supportContext: ChatwootSupportContext | null = null;
    let identityAttemptTimer: ReturnType<typeof setTimeout> | null = null;
    let identityProbeTimer: ReturnType<typeof setTimeout> | null = null;
    const identityProbesInFlight = new Set<string>();
    const identityProbeCounts = new Map<string, number>();
    let sessionRefreshRequested = false;
    let conversationResetRequested = false;

    enterChatwootAuthenticatedMode();
    window.chatwootSettings = {
      ...(window.chatwootSettings ?? {}),
      locale: "ru",
      position: "right",
      useBrowserLanguage: false,
      hideMessageBubble: true,
    };

    const cancelIdentityAttemptTimer = () => {
      if (identityAttemptTimer !== null) {
        clearTimeout(identityAttemptTimer);
        identityAttemptTimer = null;
      }
    };
    const cancelIdentityProbeTimer = () => {
      if (identityProbeTimer !== null) {
        clearTimeout(identityProbeTimer);
        identityProbeTimer = null;
      }
    };
    const hideLauncher = () => {
      try {
        window.$chatwoot?.toggleBubbleVisibility("hide");
      } catch {
        // Keep support failures isolated from the application shell.
      }
    };
    const scheduleIdentityAttemptTimeout = () => {
      cancelIdentityAttemptTimer();
      const pending = getChatwootPendingIdentityAttempt();

      if (!active || sessionRefreshRequested || !pending) {
        return;
      }

      const remainingMs = chatwootIdentityAttemptRemainingMs(
        pending.startedAt,
        CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS,
        Date.now(),
      );
      const attemptId = pending.attemptId;
      identityAttemptTimer = setTimeout(() => {
        identityAttemptTimer = null;
        cancelIdentityProbeTimer();
        const current = getChatwootPendingIdentityAttempt();

        if (!active || current?.attemptId !== attemptId) {
          return;
        }

        let retryStarted = false;
        if (current.retryCount < CHATWOOT_IDENTITY_MAX_RETRIES) {
          try {
            retryStarted = retryChatwootIdentityAttempt(attemptId, config);
          } catch {
            retryStarted = false;
          }
        }

        if (retryStarted) {
          scheduleIdentityAttemptTimeout();
          return;
        }

        failChatwootPendingIdentityAttempt(attemptId, config.websiteToken);
        hideLauncher();
      }, remainingMs);
    };
    const scheduleIdentityProbe = (
      delayMs = CHATWOOT_INITIAL_IDENTITY_PROBE_DELAY_MS,
    ) => {
      const pending = getChatwootPendingIdentityAttempt();

      if (
        !active
        || sessionRefreshRequested
        || !pending
        || pending.phase !== "sent"
        || identityProbeTimer !== null
        || identityProbesInFlight.has(pending.attemptId)
        || (identityProbeCounts.get(pending.attemptId) ?? 0)
          >= CHATWOOT_IDENTITY_PROBE_LIMIT
      ) {
        return;
      }

      const remainingMs = chatwootIdentityProbeRemainingMs(
        pending.startedAt,
        CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS,
        Date.now(),
      );
      if (remainingMs <= 0) {
        return;
      }

      const attemptId = pending.attemptId;
      identityProbeTimer = setTimeout(() => {
        identityProbeTimer = null;
        const current = getChatwootPendingIdentityAttempt();

        if (
          !active
          || current?.attemptId !== attemptId
          || current.phase !== "sent"
        ) {
          return;
        }

        identityProbeCounts.set(
          attemptId,
          (identityProbeCounts.get(attemptId) ?? 0) + 1,
        );
        identityProbesInFlight.add(attemptId);
        void (async () => {
          let result: Awaited<ReturnType<typeof verifyChatwootIdentityAction>> = "pending";

          try {
            result = await verifyChatwootIdentityAction(config.user.identifier);
          } catch {
            // The existing bounded attempt timer owns transient probe failure.
          } finally {
            identityProbesInFlight.delete(attemptId);
          }

          const latest = getChatwootPendingIdentityAttempt();
          if (
            !active
            || latest?.attemptId !== attemptId
            || latest.phase !== "sent"
          ) {
            return;
          }

          if (result === "refresh_required") {
            sessionRefreshRequested = true;
            cancelIdentityAttemptTimer();
            cancelIdentityProbeTimer();
            identityProbeCounts.delete(attemptId);
            hideLauncher();
            navigateTo(chatwootSessionRefreshTarget(
              window.location.pathname,
              window.location.search,
            ));
            return;
          }

          if (result === "reset_required") {
            cancelIdentityAttemptTimer();
            cancelIdentityProbeTimer();
            identityProbeCounts.delete(attemptId);

            if (conversationResetRequested) {
              identificationFailed();
              return;
            }

            // The first-party session is valid, but the browser still owns a
            // Chatwoot conversation for another Clean Pay identity. Reset
            // only the third-party state, then let the fresh iframe's ready
            // event identify the authenticated user again.
            conversationResetRequested = true;
            resetChatwootSession();
            enterChatwootAuthenticatedMode();
            return;
          }

          if (result === "confirmed") {
            if (confirmChatwootIdentityOwnership(attemptId)) {
              cancelIdentityAttemptTimer();
              cancelIdentityProbeTimer();
              identityProbeCounts.delete(attemptId);
              // Ownership permits revealing this contact, but does not prove
              // that Chatwoot applied the complete setUser payload. The
              // bounded fingerprint restores only this exact conversation;
              // identify() reveals it or queues newer context separately.
              identifyWithCurrentContext();
            }
            return;
          }

          if (result === "rejected") {
            identificationFailed();
            return;
          }

          scheduleIdentityProbe(chatwootIdentityProbeRetryDelayMs(
            latest.startedAt,
            Date.now(),
          ));
        })();
      }, boundedChatwootIdentityProbeDelayMs(delayMs, remainingMs));
    };
    const identify = (applyLabels = true) => {
      if (active && !sessionRefreshRequested) {
        try {
          const status = identifyChatwootUser(
            config,
            supportContext?.customAttributes,
          );
          if (status === "ready" && applyLabels && supportContext) {
            applyChatwootManagedLabels(supportContext);
          }
          if (status === "pending") {
            scheduleIdentityAttemptTimeout();
            scheduleIdentityProbe();
          } else {
            cancelIdentityAttemptTimer();
            cancelIdentityProbeTimer();
          }
          return status;
        } catch {
          cancelIdentityAttemptTimer();
          cancelIdentityProbeTimer();
          clearChatwootIdentityState(true);
          hideLauncher();
        }
      }
      return "unavailable";
    };
    const identifyWithCurrentContext = () => identify();
    const refreshSupportContext = () => {
      void loadSupportContext(config).then((context) => {
        if (active && context) {
          supportContext = context;
          identifyWithCurrentContext();
        }
      }).catch(() => {
        // Optional context must never affect the base support widget.
      });
    };
    const identifyAndRefresh = () => {
      // Keep the signed identity current, but do not mutate labels from the
      // possibly old in-memory snapshot. The cached loader below applies them
      // only after confirming that the one-minute cache is still valid or
      // obtaining a fresh server result.
      identify(false);
      refreshSupportContext();
    };
    const identificationFailed = () => {
      if (!active || sessionRefreshRequested) {
        return;
      }

      const attemptId = getChatwootPendingIdentityAttempt()?.attemptId;
      if (retainChatwootVerifiedOwnership(
        config,
        supportContext?.customAttributes,
      )) {
        cancelIdentityAttemptTimer();
        cancelIdentityProbeTimer();
        if (attemptId) {
          identityProbeCounts.delete(attemptId);
        }
        return;
      }

      cancelIdentityAttemptTimer();
      cancelIdentityProbeTimer();
      if (attemptId) {
        failChatwootPendingIdentityAttempt(attemptId, config.websiteToken);
      } else {
        // A successful ownership probe can precede the SDK's eventual error
        // for an already-bound contact. Latch that late error to the current
        // desired identity so ready/open events cannot reveal or retry it.
        failChatwootIdentity(config, supportContext?.customAttributes);
      }
      clearChatwootIdentityState(true);
      if (attemptId) {
        identityProbeCounts.delete(attemptId);
      }
      hideLauncher();
    };
    const identityTransportFailed = () => {
      if (!active || sessionRefreshRequested) {
        return;
      }

      const pending = getChatwootPendingIdentityAttempt();
      if (pending?.phase === "sent") {
        if (retainChatwootVerifiedOwnership(
          config,
          supportContext?.customAttributes,
        )) {
          cancelIdentityAttemptTimer();
          cancelIdentityProbeTimer();
          identityProbeCounts.delete(pending.attemptId);
          return;
        }

        // Chatwoot emits an uncorrelated error before its contact endpoint is
        // necessarily queryable. Keep the bounded server verification alive:
        // it can safely restore the official launcher for the same actor, or
        // the existing timeout/retry path will still fail closed.
        hideLauncher();
        scheduleIdentityAttemptTimeout();
        scheduleIdentityProbe(0);
        return;
      }

      identificationFailed();
    };
    const chatwootMessage = (event: MessageEvent) => {
      // The upstream SDK installs a permissive window.onmessage handler. Stop
      // stale frames (including the one replaced for retry) before that
      // handler can mutate cookies or confirm the wrong identity attempt.
      if (isUnexpectedChatwootFrameMessage(event, config.baseUrl)) {
        event.stopImmediatePropagation();
        return;
      }

      if (sessionRefreshRequested) {
        return;
      }

      if (isChatwootFrameReady(event, config.baseUrl)) {
        queueMicrotask(() => {
          if (!active) {
            return;
          }

          try {
            if (activateChatwootIdentityRetry(
              config,
              supportContext?.customAttributes,
            )) {
              scheduleIdentityAttemptTimeout();
              scheduleIdentityProbe();
            }
          } catch {
            identificationFailed();
          }
        });
      }

      if (isChatwootIdentityConfirmation(event, config.baseUrl)) {
        const attemptId = getChatwootPendingIdentityAttempt()?.attemptId;

        queueMicrotask(() => {
          if (active && attemptId && confirmChatwootIdentity(attemptId)) {
            // setAuthCookie is emitted by Chatwoot 4.16 only from the awaited
            // setUser response that rotates the contact. Unlike an ownership
            // GET, it is a correlated success for the complete payload.
            cancelIdentityAttemptTimer();
            cancelIdentityProbeTimer();
            identityProbeCounts.delete(attemptId);
            identifyWithCurrentContext();
          }
        });
      }
    };

    window.addEventListener("message", chatwootMessage, { capture: true });
    window.addEventListener("chatwoot:ready", identifyWithCurrentContext);
    window.addEventListener("chatwoot:error", identityTransportFailed);
    window.addEventListener("chatwoot:opened", identifyAndRefresh);
    window.addEventListener("chatwoot:on-start-conversation", identifyAndRefresh);
    // The first message is emitted only after Chatwoot has created the actual
    // conversation. Reapplying here makes managed labels reliable for a new
    // contact; earlier label calls are harmless no-ops in the standard SDK.
    window.addEventListener("chatwoot:on-message", identifyAndRefresh);

    refreshSupportContext();

    void loadChatwootSdk(config.baseUrl).then(() => {
      if (!active || !window.cleanPayChatwootAuthorized) {
        return;
      }

      if (!window.$chatwoot) {
        window.chatwootSDK?.run({
          baseUrl: config.baseUrl,
          websiteToken: config.websiteToken,
        });
        return;
      }

      if (
        window.$chatwoot.baseUrl !== config.baseUrl ||
        window.$chatwoot.websiteToken !== config.websiteToken
      ) {
        // A running SDK cannot switch inboxes safely without reloading the
        // document. Hide a stale deployment instead of mixing conversations.
        enterChatwootGuestMode();
        return;
      }

      if (window.$chatwoot.hasLoaded) {
        identifyWithCurrentContext();
      }
    }).catch(() => {
      if (active) {
        clearChatwootIdentityState(true);
      }
    });

    return () => {
      active = false;
      cancelIdentityAttemptTimer();
      cancelIdentityProbeTimer();
      identityProbesInFlight.clear();
      identityProbeCounts.clear();
      window.removeEventListener("message", chatwootMessage, { capture: true });
      window.removeEventListener("chatwoot:ready", identifyWithCurrentContext);
      window.removeEventListener("chatwoot:error", identityTransportFailed);
      window.removeEventListener("chatwoot:opened", identifyAndRefresh);
      window.removeEventListener("chatwoot:on-start-conversation", identifyAndRefresh);
      window.removeEventListener("chatwoot:on-message", identifyAndRefresh);
      // AppShell is a page-level wrapper. Do not reset here: ordinary client
      // navigation between authenticated pages may unmount this component.
    };
  }, [config, loadSupportContext]);

}

export function useChatwootGuestBoundaryController() {
  useEffect(() => {
    enterChatwootGuestMode();
  }, []);
}
