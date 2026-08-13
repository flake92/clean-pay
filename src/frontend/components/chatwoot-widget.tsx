"use client";

import { useEffect } from "react";

import { loadChatwootSupportContextAction } from "@/app/actions/chatwoot";
import type {
  ChatwootSupportContext,
  ChatwootWidgetConfig,
} from "@/application/models/chatwoot";
import {
  activateChatwootIdentityRetry,
  applyChatwootManagedLabels,
  CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS,
  CHATWOOT_IDENTITY_MAX_RETRIES,
  clearChatwootIdentityState,
  confirmChatwootIdentity,
  enterChatwootAuthenticatedMode,
  enterChatwootGuestMode,
  failChatwootPendingIdentityAttempt,
  getChatwootPendingIdentityAttempt,
  identifyChatwootUser,
  isChatwootFrameReady,
  isChatwootIdentityConfirmation,
  isUnexpectedChatwootFrameMessage,
  loadChatwootSupportContextCached,
  loadChatwootSdk,
  retryChatwootIdentityAttempt,
} from "@/frontend/lib/chatwoot";

export function ChatwootWidget({ config }: { config: ChatwootWidgetConfig }) {
  useEffect(() => {
    let active = true;
    let supportContext: ChatwootSupportContext | null = null;
    let identityAttemptTimer: ReturnType<typeof setTimeout> | null = null;

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

      if (!active || !pending) {
        return;
      }

      const remainingMs = Math.max(
        0,
        pending.startedAt + CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS - Date.now(),
      );
      const attemptId = pending.attemptId;
      identityAttemptTimer = setTimeout(() => {
        identityAttemptTimer = null;
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
    const identify = (applyLabels = true) => {
      if (active) {
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
          } else {
            cancelIdentityAttemptTimer();
          }
        } catch {
          cancelIdentityAttemptTimer();
          clearChatwootIdentityState(true);
          hideLauncher();
        }
      }
    };
    const identifyWithCurrentContext = () => identify();
    const refreshSupportContext = () => {
      void loadChatwootSupportContextCached(
        config.user.identifier,
        () => loadChatwootSupportContextAction(config.user.identifier),
      ).then((context) => {
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
      cancelIdentityAttemptTimer();
      const attemptId = getChatwootPendingIdentityAttempt()?.attemptId;
      if (attemptId) {
        failChatwootPendingIdentityAttempt(attemptId, config.websiteToken);
      }
      clearChatwootIdentityState(true);
      hideLauncher();
    };
    const chatwootMessage = (event: MessageEvent) => {
      // The upstream SDK installs a permissive window.onmessage handler. Stop
      // stale frames (including the one replaced for retry) before that
      // handler can mutate cookies or confirm the wrong identity attempt.
      if (isUnexpectedChatwootFrameMessage(event, config.baseUrl)) {
        event.stopImmediatePropagation();
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
            cancelIdentityAttemptTimer();
            // A newer support snapshot may have arrived while the preceding
            // signed request was in flight. identify() serializes that update
            // and applies labels only once the final identity is confirmed.
            identifyWithCurrentContext();
          }
        });
      }
    };

    window.addEventListener("message", chatwootMessage, { capture: true });
    window.addEventListener("chatwoot:ready", identifyWithCurrentContext);
    window.addEventListener("chatwoot:error", identificationFailed);
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
      window.removeEventListener("message", chatwootMessage, { capture: true });
      window.removeEventListener("chatwoot:ready", identifyWithCurrentContext);
      window.removeEventListener("chatwoot:error", identificationFailed);
      window.removeEventListener("chatwoot:opened", identifyAndRefresh);
      window.removeEventListener("chatwoot:on-start-conversation", identifyAndRefresh);
      window.removeEventListener("chatwoot:on-message", identifyAndRefresh);
      // AppShell is a page-level wrapper. Do not reset here: ordinary client
      // navigation between authenticated pages may unmount this component.
    };
  }, [config]);

  return null;
}

export function ChatwootGuestBoundary() {
  useEffect(() => {
    enterChatwootGuestMode();
  }, []);

  return null;
}
