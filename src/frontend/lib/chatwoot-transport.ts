import type { ChatwootSupportContext } from "@/application/models/chatwoot";

const scriptId = "clean-pay-chatwoot-sdk";
const scriptStateAttribute = "data-clean-pay-load-state";
const sdkLoadTimeoutMs = 15_000;

type ActiveSdkLoad = {
  abort: (error: Error) => void;
  promise: Promise<void>;
  script: HTMLScriptElement;
  source: string;
};

let activeSdkLoad: ActiveSdkLoad | null = null;
let loadedSdkSource: string | null = null;

export function loadChatwootSdk(baseUrl: string) {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  const source = new URL(
    `${baseUrl.replace(/\/+$/, "")}/packs/js/sdk.js`,
    document.baseURI,
  ).href;

  if (activeSdkLoad && !activeSdkLoad.script.isConnected) {
    activeSdkLoad.abort(new Error("Support chat loading was interrupted"));
  }

  if (activeSdkLoad) {
    if (activeSdkLoad.source === source) {
      return activeSdkLoad.promise;
    }

    return Promise.reject(new Error(
      "Support chat is already loading from a different address",
    ));
  }

  if (loadedSdkSource && loadedSdkSource !== source) {
    return Promise.reject(new Error(
      "Support chat address changed; reload the page before reconnecting",
    ));
  }

  if (window.chatwootSDK) {
    loadedSdkSource = source;
    return Promise.resolve();
  }

  // Without an active in-memory load, an element using our reserved id has
  // already completed or belongs to an older module instance. Its load event
  // cannot be trusted to fire again, so it must not be reused.
  document.getElementById(scriptId)?.remove();

  const script = document.createElement("script");
  let resolveLoad!: () => void;
  let rejectLoad!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolveLoad = resolve;
    rejectLoad = reject;
  });
  let loadTimer: ReturnType<typeof setTimeout> | null = null;

  let settled = false;
  const finish = (result: "loaded" | "failed", error?: Error) => {
    if (settled) {
      return;
    }

    settled = true;
    if (loadTimer !== null) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
    script.removeEventListener("load", loaded);
    script.removeEventListener("error", failed);
    if (activeSdkLoad === load) {
      activeSdkLoad = null;
    }

    if (result === "failed") {
      script.remove();
      rejectLoad(error ?? new Error("Support chat failed to load"));
      return;
    }

    loadedSdkSource = source;
    script.setAttribute(scriptStateAttribute, "loaded");
    resolveLoad();
  };
  const loaded = () => {
    if (!window.chatwootSDK) {
      finish("failed", new Error("Support chat did not initialize"));
      return;
    }

    finish("loaded");
  };
  const failed = () => {
    finish("failed", new Error("Support chat failed to load"));
  };

  const load: ActiveSdkLoad = {
    abort: (error) => finish("failed", error),
    promise,
    script,
    source,
  };
  activeSdkLoad = load;

  script.id = scriptId;
  script.async = true;
  script.defer = true;
  script.src = source;
  script.setAttribute(scriptStateAttribute, "loading");
  script.addEventListener("load", loaded, { once: true });
  script.addEventListener("error", failed, { once: true });
  loadTimer = setTimeout(() => {
    finish("failed", new Error("Support chat loading timed out"));
  }, sdkLoadTimeoutMs);

  try {
    document.head.appendChild(script);
  } catch {
    failed();
  }

  return promise;
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
