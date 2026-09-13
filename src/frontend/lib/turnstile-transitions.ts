export function hasTurnstileSiteKey(siteKey?: string | null) {
  return Boolean(siteKey);
}

export const securityCheckRequiredMessage = "Пройдите проверку безопасности.";
export const securityCheckUnavailableMessage =
  "Проверка безопасности временно недоступна. Попробуйте позже.";
export const securityCheckFailedMessage =
  "Не удалось пройти проверку безопасности. Попробуйте ещё раз.";
export const securityCheckLoadFailedMessage =
  "Не удалось загрузить проверку безопасности. Обновите страницу или попробуйте позже.";

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
