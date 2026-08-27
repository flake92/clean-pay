import type { ChatwootSupportContext } from "@/application/models/chatwoot";

const scriptId = "clean-pay-chatwoot-sdk";
let sdkPromise: Promise<void> | null = null;

export function loadChatwootSdk(baseUrl: string) {
  if (typeof window === "undefined" || window.chatwootSDK) {
    return Promise.resolve();
  }

  if (sdkPromise) {
    return sdkPromise;
  }

  sdkPromise = new Promise<void>((resolve, reject) => {
    const loaded = () => {
      if (!window.chatwootSDK) {
        document.getElementById(scriptId)?.remove();
        reject(new Error("Chatwoot SDK did not initialize"));
        return;
      }

      resolve();
    };
    const failed = () => {
      document.getElementById(scriptId)?.remove();
      reject(new Error("Chatwoot SDK failed to load"));
    };
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener("load", loaded, { once: true });
      existing.addEventListener("error", failed, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = scriptId;
    script.async = true;
    script.defer = true;
    script.src = `${baseUrl}/packs/js/sdk.js`;
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", failed, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}

function chatwootFrameMessage(event: MessageEvent, baseUrl: string) {
  let origin: string;

  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return null;
  }

  const frame = document.getElementById(
    "chatwoot_live_chat_widget",
  ) as HTMLIFrameElement | null;

  if (
    event.origin !== origin
    || !frame?.contentWindow
    || event.source !== frame.contentWindow
    || typeof event.data !== "string"
    || !event.data.startsWith("chatwoot-widget:")
  ) {
    return null;
  }

  try {
    return JSON.parse(event.data.slice("chatwoot-widget:".length)) as {
      event?: unknown;
      data?: { widgetAuthToken?: unknown };
    };
  } catch {
    return null;
  }
}

export function isUnexpectedChatwootFrameMessage(
  event: MessageEvent,
  baseUrl: string,
) {
  if (
    typeof event.data !== "string"
    || !event.data.startsWith("chatwoot-widget:")
  ) {
    return false;
  }

  return chatwootFrameMessage(event, baseUrl) === null;
}

export function isChatwootFrameReady(event: MessageEvent, baseUrl: string) {
  return chatwootFrameMessage(event, baseUrl)?.event === "loaded";
}

export function isChatwootIdentityConfirmation(
  event: MessageEvent,
  baseUrl: string,
) {
  const message = chatwootFrameMessage(event, baseUrl);

  return message?.event === "setAuthCookie"
    && typeof message.data?.widgetAuthToken === "string"
    && message.data.widgetAuthToken.length > 0;
}

export function applyChatwootManagedLabels(context: ChatwootSupportContext) {
  const chatwoot = window.$chatwoot;

  if (!chatwoot || !window.cleanPayChatwootAuthorized) {
    return;
  }

  for (const label of context.managedLabels) {
    try {
      if (label.enabled) {
        chatwoot.setLabel?.(label.name);
      } else {
        chatwoot.removeLabel?.(label.name);
      }
    } catch {
      // Older or partially loaded SDKs may not expose label operations.
    }
  }
}
