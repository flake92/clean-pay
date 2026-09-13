export const CHATWOOT_STATE_CHANGED_EVENT = "clean-pay:chatwoot-state-changed";

export function notifyChatwootStateChanged() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(CHATWOOT_STATE_CHANGED_EVENT));
}
