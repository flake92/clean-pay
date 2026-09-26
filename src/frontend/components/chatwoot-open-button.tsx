"use client";

import { useEffect, useRef, useState } from "react";

import {
  useSupportChatExpectedIdentity,
  useSupportChatSessionAuthenticated,
} from "@/frontend/components/chatwoot-session-context";
import {
  CHATWOOT_OPEN_REQUEST_CONSUMED_EVENT,
  CHATWOOT_STATE_CHANGED_EVENT,
} from "@/frontend/lib/chatwoot-state-events";
import {
  chatwootCookieValue,
  hasChatwootCookie,
} from "@/frontend/lib/chatwoot-storage";

type ChatwootActionState = "signed-out" | "connecting" | "failed" | "ready";

type ChatwootActionSnapshot = {
  scopeKey: string;
  state: ChatwootActionState;
};

type ExpectedChatwootIdentity = {
  baseUrl: string;
  core: string;
  websiteToken: string;
};

function chatwootIdentityKey(identity: ExpectedChatwootIdentity) {
  return `${identity.baseUrl}\n${identity.websiteToken}\n${identity.core}`;
}

function chatwootActionScopeKey(
  authenticated: boolean,
  identity: ExpectedChatwootIdentity | null,
) {
  return `${authenticated ? "authenticated" : "signed-out"}\n${
    identity ? chatwootIdentityKey(identity) : "unconfigured"
  }`;
}

function notifyChatwootOpenRequestConsumed(identity: ExpectedChatwootIdentity) {
  window.dispatchEvent(new CustomEvent(
    CHATWOOT_OPEN_REQUEST_CONSUMED_EVENT,
    { detail: chatwootIdentityKey(identity) },
  ));
}

function chatwootActionState(
  authenticated: boolean,
  expectedIdentity: ExpectedChatwootIdentity | null,
): ChatwootActionState {
  if (!authenticated || typeof window === "undefined") {
    return "signed-out";
  }

  if (
    expectedIdentity
    && window.cleanPayChatwootFailedIdentity?.core === expectedIdentity.core
  ) {
    return "failed";
  }

  if (!expectedIdentity || !window.cleanPayChatwootAuthorized) {
    return "connecting";
  }

  const chatwoot = window.$chatwoot;
  if (
    chatwoot?.baseUrl !== expectedIdentity.baseUrl
    || chatwoot.websiteToken !== expectedIdentity.websiteToken
  ) {
    return "connecting";
  }
  const pending = window.cleanPayChatwootPendingIdentity;
  if (pending && pending.core !== expectedIdentity.core) {
    return "connecting";
  }
  const conversation = chatwootCookieValue("cw_conversation");
  const identityConfirmed = Boolean(
    window.cleanPayChatwootIdentity?.core === expectedIdentity.core
    && hasChatwootCookie(`cw_user_${expectedIdentity.websiteToken}`)
    && conversation,
  );
  const ownershipConfirmed = Boolean(
    conversation
    && window.cleanPayChatwootOwnership?.core === expectedIdentity.core
    && window.cleanPayChatwootOwnership.conversation === conversation,
  );

  return (
    chatwoot?.hasLoaded
    && chatwoot.toggle
    && (identityConfirmed || ownershipConfirmed)
  ) ? "ready" : "connecting";
}

function useSupportChatActionState() {
  const authenticated = useSupportChatSessionAuthenticated();
  const expectedIdentity = useSupportChatExpectedIdentity();
  const scopeKey = chatwootActionScopeKey(authenticated, expectedIdentity);
  const initialState = authenticated ? "connecting" : "signed-out";
  const [snapshot, setSnapshot] = useState<ChatwootActionSnapshot>({
    scopeKey,
    state: initialState,
  });
  const state = snapshot.scopeKey === scopeKey
    ? snapshot.state
    : initialState;

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!active) return;

      setSnapshot({
        scopeKey,
        state: chatwootActionState(authenticated, expectedIdentity),
      });
    };
    const refreshAfterCurrentEvent = () => queueMicrotask(refresh);
    refresh();

    window.addEventListener(CHATWOOT_STATE_CHANGED_EVENT, refresh);
    window.addEventListener("chatwoot:ready", refreshAfterCurrentEvent);
    window.addEventListener("chatwoot:error", refreshAfterCurrentEvent);

    return () => {
      active = false;
      window.removeEventListener(CHATWOOT_STATE_CHANGED_EVENT, refresh);
      window.removeEventListener("chatwoot:ready", refreshAfterCurrentEvent);
      window.removeEventListener("chatwoot:error", refreshAfterCurrentEvent);
    };
  }, [authenticated, expectedIdentity, scopeKey]);

  return { authenticated, expectedIdentity, state };
}

function useSupportChatOpenAction() {
  const action = useSupportChatActionState();
  const { authenticated, expectedIdentity, state } = action;
  const [openRequested, setOpenRequested] = useState(false);
  const openRequestRef = useRef<ExpectedChatwootIdentity | null>(null);

  useEffect(() => {
    const consumeMatchingRequest = (event: Event) => {
      const requestedIdentity = openRequestRef.current;
      if (
        requestedIdentity
        && event instanceof CustomEvent
        && event.detail === chatwootIdentityKey(requestedIdentity)
      ) {
        openRequestRef.current = null;
        setOpenRequested(false);
      }
    };

    window.addEventListener(
      CHATWOOT_OPEN_REQUEST_CONSUMED_EVENT,
      consumeMatchingRequest,
    );
    return () => {
      openRequestRef.current = null;
      window.removeEventListener(
        CHATWOOT_OPEN_REQUEST_CONSUMED_EVENT,
        consumeMatchingRequest,
      );
    };
  }, []);

  useEffect(() => {
    const requestedIdentity = openRequestRef.current;
    if (!requestedIdentity) {
      if (openRequested) {
        queueMicrotask(() => setOpenRequested(false));
      }
      return;
    }

    const requestStillMatches = Boolean(
      expectedIdentity
      && requestedIdentity.baseUrl === expectedIdentity.baseUrl
      && requestedIdentity.websiteToken === expectedIdentity.websiteToken
      && requestedIdentity.core === expectedIdentity.core,
    );
    if (!authenticated || !requestStillMatches
      || state === "signed-out" || state === "failed") {
      openRequestRef.current = null;
      queueMicrotask(() => setOpenRequested(false));
      return;
    }

    const currentState = chatwootActionState(authenticated, expectedIdentity);
    if (currentState === "signed-out" || currentState === "failed") {
      openRequestRef.current = null;
      queueMicrotask(() => setOpenRequested(false));
      return;
    }

    if (state !== "ready" || currentState !== "ready") {
      return;
    }

    // The click may arrive while the server is still verifying ownership.
    // Recheck the complete identity gate after the state-change event, then
    // consume the request exactly once.
    openRequestRef.current = null;
    notifyChatwootOpenRequestConsumed(requestedIdentity);
    queueMicrotask(() => setOpenRequested(false));
    try {
      window.$chatwoot?.toggle?.("open");
    } catch {
      // A third-party UI failure must not replay the user's click later.
    }
  }, [authenticated, expectedIdentity, openRequested, state]);

  const requestOpen = () => {
    const currentState = chatwootActionState(authenticated, expectedIdentity);

    if (currentState === "ready" && expectedIdentity) {
      openRequestRef.current = null;
      notifyChatwootOpenRequestConsumed(expectedIdentity);
      setOpenRequested(false);
      try {
        window.$chatwoot?.toggle?.("open");
      } catch {
        // Keep the application shell usable if the third-party API throws.
      }
    } else if (currentState === "connecting" && expectedIdentity) {
      openRequestRef.current = { ...expectedIdentity };
      setOpenRequested(true);
    } else {
      openRequestRef.current = null;
      setOpenRequested(false);
    }
  };

  return { ...action, openRequested, requestOpen };
}

export function SupportChatOpenButton({
  hideWhenSignedOut = false,
}: {
  hideWhenSignedOut?: boolean;
} = {}) {
  const { openRequested, requestOpen, state } = useSupportChatOpenAction();

  if (state === "signed-out") {
    if (hideWhenSignedOut) {
      return null;
    }
    return (
      <p className="m-0 line-height-3 text-600">
        Войдите в аккаунт, чтобы написать нам в чате поддержки.
      </p>
    );
  }

  if (state === "failed") {
    return (
      <span className="line-height-3 text-600">
        Чат временно недоступен. Обновите страницу или попробуйте позже.
      </span>
    );
  }

  return (
    <button
      aria-busy={state === "connecting"}
      className="p-button p-component p-button-outlined"
      data-state={state}
      onClick={requestOpen}
      type="button"
    >
      <span className={`p-button-icon p-c pi ${
        state === "connecting" ? "pi-spin pi-spinner" : "pi-comments"
      }`} />
      <span className="p-button-label">
        {openRequested
          ? "Чат откроется после подключения…"
          : state === "connecting"
            ? "Подключаем чат поддержки…"
            : "Открыть чат поддержки"}
      </span>
    </button>
  );
}

export function SupportChatFloatingButton() {
  const {
    authenticated,
    expectedIdentity,
    openRequested,
    requestOpen,
    state,
  } = useSupportChatOpenAction();
  const [chatOpen, setChatOpen] = useState(false);
  const identityKey = expectedIdentity
    ? chatwootIdentityKey(expectedIdentity)
    : null;
  const chatOpenIdentityRef = useRef(identityKey);

  useEffect(() => {
    if (chatOpenIdentityRef.current !== identityKey) {
      chatOpenIdentityRef.current = identityKey;
      queueMicrotask(() => setChatOpen(false));
    }
  }, [identityKey]);

  useEffect(() => {
    const markOpen = () => setChatOpen(true);
    const markClosed = () => setChatOpen(false);

    window.addEventListener("chatwoot:opened", markOpen);
    window.addEventListener("chatwoot:closed", markClosed);

    return () => {
      window.removeEventListener("chatwoot:opened", markOpen);
      window.removeEventListener("chatwoot:closed", markClosed);
    };
  }, []);

  if (!expectedIdentity || state === "signed-out" || state === "failed") {
    return null;
  }

  const ready = state === "ready";
  const expanded = ready && chatOpen;
  const label = openRequested
    ? "Чат откроется после подключения"
    : ready
    ? (expanded ? "Закрыть чат поддержки" : "Открыть чат поддержки")
    : "Подключаем чат поддержки";

  return (
    <button
      aria-busy={!ready}
      aria-expanded={expanded}
      aria-label={label}
      className="clean-pay-chatwoot-launcher"
      data-state={state}
      onClick={() => {
        if (
          expanded
          && chatwootActionState(authenticated, expectedIdentity) === "ready"
        ) {
          window.$chatwoot?.toggle?.("close");
        } else {
          requestOpen();
        }
      }}
      title={label}
      type="button"
    >
      <i className={`pi ${
        ready ? (expanded ? "pi-times" : "pi-comments") : "pi-spin pi-spinner"
      }`} aria-hidden="true" />
    </button>
  );
}
