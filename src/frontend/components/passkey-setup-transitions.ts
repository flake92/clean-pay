export type PasskeySetupState = Readonly<{
  error: string | null;
  name: string;
  phase: "creating" | "idle" | "restarting";
}>;

export type PasskeySetupEvent =
  | { type: "failed"; message: string }
  | { type: "name-changed"; value: string }
  | { type: "settled" }
  | { type: "started"; operation: "create" | "restart" };

export const initialPasskeySetupState: PasskeySetupState = Object.freeze({
  error: null,
  name: "",
  phase: "idle",
});

export function reducePasskeySetup(
  state: PasskeySetupState,
  event: PasskeySetupEvent,
): PasskeySetupState {
  switch (event.type) {
    case "failed":
      return { ...state, error: event.message };
    case "name-changed":
      return { ...state, name: event.value };
    case "settled":
      return { ...state, phase: "idle" };
    case "started":
      return {
        ...state,
        error: null,
        phase: event.operation === "create" ? "creating" : "restarting",
      };
  }
}

export function selectPasskeySetupView(state: PasskeySetupState) {
  return {
    error: state.error,
    loading: state.phase === "creating",
    name: state.name,
    restarting: state.phase === "restarting",
  };
}
