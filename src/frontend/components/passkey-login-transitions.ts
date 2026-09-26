export type PasskeyLoginState = Readonly<{
  error: string | null;
  phase: "idle" | "loading";
}>;

export type PasskeyLoginEvent =
  | { type: "failed"; message: string }
  | { type: "settled" }
  | { type: "started" };

export const initialPasskeyLoginState: PasskeyLoginState = Object.freeze({
  error: null,
  phase: "idle",
});

export function reducePasskeyLogin(
  state: PasskeyLoginState,
  event: PasskeyLoginEvent,
): PasskeyLoginState {
  switch (event.type) {
    case "failed":
      return { ...state, error: event.message };
    case "settled":
      return { ...state, phase: "idle" };
    case "started":
      return { error: null, phase: "loading" };
  }
}

export function selectPasskeyLoginView(state: PasskeyLoginState) {
  return {
    error: state.error,
    loading: state.phase === "loading",
  };
}
