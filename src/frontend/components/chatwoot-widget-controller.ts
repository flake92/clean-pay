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

const CHATWOOT_RUNTIME_READY_TIMEOUT_MS = 12_000;
const CHATWOOT_RUNTIME_MAX_RESTARTS = 1;

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
    let runtimeReadyTimer: ReturnType<typeof setTimeout> | null = null;
    let runtimeRestartCount = 0;
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
    const cancelRuntimeReadyTimer = () => {
      if (runtimeReadyTimer !== null) {
        clearTimeout(runtimeReadyTimer);
        runtimeReadyTimer = null;
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
            cancelRuntimeReadyTimer();
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
              // Ownership permits the first-party support action to open this
              // contact, but does not prove that Chatwoot applied the complete
              // setUser payload. The server-bound, SHA-backed ownership proof
              // restores only this exact conversation; identify() updates
              // context separately.
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
        const runtime = window.$chatwoot;
        if (
          !runtime
          || runtime.baseUrl !== config.baseUrl
          || runtime.websiteToken !== config.websiteToken
          || !runtime.hasLoaded
        ) {
          return "unavailable";
        }

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
          failChatwootIdentity(config, supportContext?.customAttributes);
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

      cancelRuntimeReadyTimer();
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
    const runtimeMatchesConfiguration = () => (
      window.$chatwoot?.baseUrl === config.baseUrl
      && window.$chatwoot.websiteToken === config.websiteToken
    );
    const runtimeIsReady = () => (
      runtimeMatchesConfiguration() && window.$chatwoot?.hasLoaded === true
    );
    const runtimeFailed = () => {
      cancelRuntimeReadyTimer();
      failChatwootIdentity(config, supportContext?.customAttributes);
      hideLauncher();
    };
    const scheduleRuntimeReadyTimeout = () => {
      cancelRuntimeReadyTimer();
      runtimeReadyTimer = setTimeout(() => {
        runtimeReadyTimer = null;

        if (!active || sessionRefreshRequested) {
          return;
        }
        if (runtimeIsReady()) {
          runtimeRestartCount = 0;
          identifyWithCurrentContext();
          return;
        }
        if (window.$chatwoot && !runtimeMatchesConfiguration()) {
          runtimeFailed();
          return;
        }
        if (runtimeRestartCount >= CHATWOOT_RUNTIME_MAX_RESTARTS) {
          runtimeFailed();
          return;
        }

        runtimeRestartCount += 1;
        resetChatwootSession();
        enterChatwootAuthenticatedMode();
        try {
          if (!window.$chatwoot) {
            window.chatwootSDK?.run({
              baseUrl: config.baseUrl,
              websiteToken: config.websiteToken,
            });
          }
        } catch {
          runtimeFailed();
          return;
        }
        scheduleRuntimeReadyTimeout();
      }, CHATWOOT_RUNTIME_READY_TIMEOUT_MS);
    };
    const startRuntime = () => {
      if (!active || !window.cleanPayChatwootAuthorized) {
        return;
      }

      if (!window.$chatwoot) {
        try {
          window.chatwootSDK?.run({
            baseUrl: config.baseUrl,
            websiteToken: config.websiteToken,
          });
        } catch {
          runtimeFailed();
          return;
        }
        scheduleRuntimeReadyTimeout();
        return;
      }

      if (!runtimeMatchesConfiguration()) {
        // A running SDK cannot switch inboxes safely without reloading the
        // document. Hide a stale deployment instead of mixing conversations.
        enterChatwootGuestMode();
        failChatwootIdentity(config, supportContext?.customAttributes);
        return;
      }

      if (runtimeIsReady()) {
        cancelRuntimeReadyTimer();
        runtimeRestartCount = 0;
        identifyWithCurrentContext();
      } else {
        scheduleRuntimeReadyTimeout();
      }
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
        // it can safely restore the first-party support action for the same
        // actor, or the existing timeout/retry path will still fail closed.
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
    const chatwootReady = () => {
      queueMicrotask(() => {
        if (!active) {
          return;
        }
        if (!runtimeMatchesConfiguration()) {
          runtimeFailed();
          return;
        }
        if (!runtimeIsReady()) {
          return;
        }

        cancelRuntimeReadyTimer();
        runtimeRestartCount = 0;
        identifyWithCurrentContext();
      });
    };

    window.addEventListener("message", chatwootMessage, { capture: true });
    window.addEventListener("chatwoot:ready", chatwootReady);
    window.addEventListener("chatwoot:error", identityTransportFailed);
    window.addEventListener("chatwoot:opened", identifyAndRefresh);
    window.addEventListener("chatwoot:closed", hideLauncher);
    window.addEventListener("chatwoot:on-start-conversation", identifyAndRefresh);
    // The first message is emitted only after Chatwoot has created the actual
    // conversation. Reapplying here makes managed labels reliable for a new
    // contact; earlier label calls are harmless no-ops in the standard SDK.
    window.addEventListener("chatwoot:on-message", identifyAndRefresh);

    refreshSupportContext();

    void loadChatwootSdk(config.baseUrl).then(startRuntime).catch(() => {
      if (active) {
        runtimeFailed();
      }
    });

    return () => {
      active = false;
      cancelRuntimeReadyTimer();
      cancelIdentityAttemptTimer();
      cancelIdentityProbeTimer();
      identityProbesInFlight.clear();
      identityProbeCounts.clear();
      window.removeEventListener("message", chatwootMessage, { capture: true });
      window.removeEventListener("chatwoot:ready", chatwootReady);
      window.removeEventListener("chatwoot:error", identityTransportFailed);
      window.removeEventListener("chatwoot:opened", identifyAndRefresh);
      window.removeEventListener("chatwoot:closed", hideLauncher);
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
