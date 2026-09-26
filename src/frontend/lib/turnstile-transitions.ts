import {
  securityCheckFailedMessage,
  securityCheckLoadFailedMessage,
  securityCheckRequiredMessage,
  securityCheckUnavailableMessage,
} from "@/application/models/security-check-messages";

export {
  securityCheckFailedMessage,
  securityCheckLoadFailedMessage,
  securityCheckRequiredMessage,
  securityCheckUnavailableMessage,
} from "@/application/models/security-check-messages";

export function hasTurnstileSiteKey(siteKey?: string | null) {
  return Boolean(siteKey);
}

export function missingSecurityCheckTokenMessage(siteKeyConfigured: boolean) {
  return siteKeyConfigured
    ? securityCheckRequiredMessage
    : securityCheckUnavailableMessage;
}

export type TurnstileWidgetState = {
  error: string | null;
  loading: boolean;
};

export type TurnstileWidgetEvent =
  | { type: "challenge-accepted" }
  | { type: "challenge-failed" }
  | { type: "script-loaded" }
  | { type: "script-load-failed" };

export function createTurnstileWidgetState(
  siteKey?: string | null,
): TurnstileWidgetState {
  return {
    error: null,
    loading: Boolean(siteKey),
  };
}

export function turnstileWidgetReducer(
  state: TurnstileWidgetState,
  event: TurnstileWidgetEvent,
): TurnstileWidgetState {
  switch (event.type) {
    case "challenge-accepted":
      return { ...state, error: null };
    case "challenge-failed":
      return {
        ...state,
        error: securityCheckFailedMessage,
      };
    case "script-loaded":
      return { ...state, loading: false };
    case "script-load-failed":
      return {
        error: securityCheckLoadFailedMessage,
        loading: false,
      };
  }
}
