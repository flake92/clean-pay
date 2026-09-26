export const CHATWOOT_STATE_CHANGED_EVENT = "clean-pay:chatwoot-state-changed";
export const CHATWOOT_OPEN_REQUEST_CONSUMED_EVENT =
  "clean-pay:chatwoot-open-request-consumed";

export function notifyChatwootStateChanged() {
  if (typeof window === "undefined") return;

  window.dispatchEvent(new Event(CHATWOOT_STATE_CHANGED_EVENT));
}
