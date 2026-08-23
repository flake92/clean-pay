"use client";

import { useEffect, useRef, useState } from "react";

import {
  loadChatwootSupportContextAction,
  verifyChatwootIdentityAction,
} from "@/app/actions/chatwoot";
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
  loadChatwootSupportContextCached,
  loadChatwootSdk,
  resetChatwootSession,
  retryChatwootIdentityAttempt,
} from "@/frontend/lib/chatwoot";
import { navigateTo } from "@/frontend/lib/browser-navigation";

export function ChatwootWidget({ config }: { config: ChatwootWidgetConfig }) {
  const [launcherState, setLauncherState] = useState<"loading" | "ready">("loading");
  const openRequestScopeRef = useRef<string | null>(null);
  const openRequestScope = JSON.stringify([
    config.baseUrl,
    config.websiteToken,
    config.user.identifier,
    config.user.identifierHash,
  ]);

  useEffect(() => {
    let active = true;
    let supportContext: ChatwootSupportContext | null = null;
    let identityAttemptTimer: ReturnType<typeof setTimeout> | null = null;
    let identityProbeTimer: ReturnType<typeof setTimeout> | null = null;
    const identityProbesInFlight = new Set<string>();
    const identityProbeCounts = new Map<string, number>();
    const identityProbeLimit = 6;
    const initialIdentityProbeDelayMs = 750;
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
    const openVerifiedConversation = () => {
      if (openRequestScopeRef.current !== openRequestScope) {
        return;
      }

      try {
        const chatwoot = window.$chatwoot;
        if (!chatwoot?.toggle) {
          return;
        }

        chatwoot.toggle("open");
        openRequestScopeRef.current = null;
      } catch {
        // The visible first-party launcher remains available for a retry.
      }
    };
    const scheduleIdentityAttemptTimeout = () => {
      cancelIdentityAttemptTimer();
      const pending = getChatwootPendingIdentityAttempt();

      if (!active || sessionRefreshRequested || !pending) {
        return;
      }

      const remainingMs = Math.max(
        0,
        pending.startedAt + CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS - Date.now(),
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
    const scheduleIdentityProbe = (delayMs = initialIdentityProbeDelayMs) => {
      const pending = getChatwootPendingIdentityAttempt();

      if (
        !active
        || sessionRefreshRequested
        || !pending
        || pending.phase !== "sent"
        || identityProbeTimer !== null
        || identityProbesInFlight.has(pending.attemptId)
        || (identityProbeCounts.get(pending.attemptId) ?? 0) >= identityProbeLimit
      ) {
        return;
      }

      const remainingMs = pending.startedAt
        + CHATWOOT_IDENTITY_ATTEMPT_TIMEOUT_MS
        - Date.now();
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
            const returnTo = `${window.location.pathname}${window.location.search}`;
            const search = new URLSearchParams({ return_to: returnTo });
            navigateTo(`/auth/session/refresh?${search.toString()}`);
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
              // in-memory generation remains unpersisted; identify() either
              // reveals it or queues newer context through a fresh iframe.
              identifyWithCurrentContext();
            }
            return;
          }

          if (result === "rejected") {
            identificationFailed();
            return;
          }

          const elapsedMs = Math.max(0, Date.now() - latest.startedAt);
          const retryDelayMs = Math.min(2_000, Math.max(400, elapsedMs));
          scheduleIdentityProbe(retryDelayMs);
        })();
      }, Math.min(Math.max(0, delayMs), remainingMs));
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
          if (status === "ready") {
            setLauncherState("ready");
            openVerifiedConversation();
          } else {
            setLauncherState("loading");
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
    const requestConversationOpen = () => {
      if (!active || sessionRefreshRequested) {
        return;
      }

      // A server action can refresh the RSC tree and restart this effect with
      // an equivalent config object before ownership verification resolves.
      // Keep the user's intent outside the effect, scoped to this exact signed
      // identity, so that refresh cannot lose the pending open request or
      // carry it over to another account.
      openRequestScopeRef.current = openRequestScope;
      setLauncherState("loading");
      identifyWithCurrentContext();
    };
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
      if (!active || sessionRefreshRequested) {
        return;
      }

      if (openRequestScopeRef.current === openRequestScope) {
        openRequestScopeRef.current = null;
      }
      cancelIdentityAttemptTimer();
      cancelIdentityProbeTimer();
      const attemptId = getChatwootPendingIdentityAttempt()?.attemptId;
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
    window.addEventListener("chatwoot:error", identificationFailed);
    window.addEventListener("chatwoot:opened", identifyAndRefresh);
    window.addEventListener("chatwoot:on-start-conversation", identifyAndRefresh);
    // The first message is emitted only after Chatwoot has created the actual
    // conversation. Reapplying here makes managed labels reliable for a new
    // contact; earlier label calls are harmless no-ops in the standard SDK.
    window.addEventListener("chatwoot:on-message", identifyAndRefresh);
    window.addEventListener("clean-pay:chatwoot-open", requestConversationOpen);

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
      window.removeEventListener("chatwoot:error", identificationFailed);
      window.removeEventListener("chatwoot:opened", identifyAndRefresh);
      window.removeEventListener("chatwoot:on-start-conversation", identifyAndRefresh);
      window.removeEventListener("chatwoot:on-message", identifyAndRefresh);
      window.removeEventListener("clean-pay:chatwoot-open", requestConversationOpen);
      // AppShell is a page-level wrapper. Do not reset here: ordinary client
      // navigation between authenticated pages may unmount this component.
    };
  }, [config, openRequestScope]);

  return (
    <button
      aria-label={launcherState === "ready" ? "Открыть чат поддержки" : "Подключить чат поддержки"}
      className="clean-pay-chatwoot-launcher"
      data-state={launcherState}
      onClick={() => window.dispatchEvent(new CustomEvent("clean-pay:chatwoot-open"))}
      title={launcherState === "ready" ? "Чат поддержки" : "Подключение чата поддержки"}
      type="button"
    >
      <i className="pi pi-comments" aria-hidden="true" />
    </button>
  );
}

export function ChatwootGuestBoundary() {
  useEffect(() => {
    enterChatwootGuestMode();
  }, []);

  return null;
}
