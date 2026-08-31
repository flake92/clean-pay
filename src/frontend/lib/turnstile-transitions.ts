export function hasTurnstileSiteKey(siteKey?: string | null) {
  return Boolean(siteKey);
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
        error: "Не удалось пройти проверку Cloudflare Turnstile.",
      };
    case "script-loaded":
      return { ...state, loading: false };
    case "script-load-failed":
      return {
        error: "Не удалось загрузить Cloudflare Turnstile.",
        loading: false,
      };
  }
}
