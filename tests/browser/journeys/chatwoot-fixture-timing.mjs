import { createContext, runInContext } from "node:vm";

/** Observe scheduling in the checked-in synthetic widget. This is not an app test. */
export function observeSyntheticChatwootConfirmationDelays(caddySource) {
  if (typeof caddySource !== "string" || caddySource.length > 128 * 1024) {
    throw new Error("Synthetic Caddy source is missing or exceeds its bound.");
  }
  const widgetMatch = /respond @widget `([\s\S]*?)` 200/.exec(caddySource);
  const scripts = [...(widgetMatch?.[1] ?? "").matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error("Expected exactly one synthetic widget script.");
  const delays = [];
  for (const flag of [undefined, false, "true", 1, true]) {
    const scheduled = [];
    const parent = { postMessage() {} };
    const listeners = [];
    const context = createContext({
      parent,
      addEventListener(type, callback) {
        if (type !== "message" || typeof callback !== "function") {
          throw new Error("Unexpected synthetic widget listener.");
        }
        listeners.push(callback);
      },
      setTimeout(callback, delay) {
        if (typeof callback !== "function" || !Number.isSafeInteger(delay) || delay < 0) {
          throw new Error("Synthetic widget scheduled an invalid delay.");
        }
        scheduled.push(delay);
        return scheduled.length;
      },
      __listeners: listeners,
      __event: { origin: "https://pay.ci.clean-pay.dev", source: parent,
        data: { method: "identify", deliveryId: 1, confirmBeforeProbe: flag } },
    });
    runInContext(scripts[0][1], context, { timeout: 1000 });
    if (listeners.length !== 1 || scheduled.length !== 0) {
      throw new Error("Synthetic widget startup does not have an exact message boundary.");
    }
    runInContext("__listeners[0](__event)", context, { timeout: 1000 });
    if (scheduled.length !== 1) throw new Error("Expected exactly one identity confirmation timer.");
    delays.push(scheduled[0]);
  }
  return Object.freeze({
    fallbackDelaysMs: Object.freeze(delays.slice(0, 4)),
    identityConfirmationDelayMs: delays[0],
    fastIdentityConfirmationDelayMs: delays[4],
  });
}
