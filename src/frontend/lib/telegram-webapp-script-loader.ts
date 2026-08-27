import { getTelegramWebApp } from "@/frontend/lib/telegram-webapp-environment";

const telegramWebAppScriptSelector =
  "script[data-clean-pay-telegram-webapp]";
let telegramWebAppScriptPromise: Promise<void> | null = null;

function waitForTelegramWebAppApi(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const cleanup = () => {
      window.clearInterval(interval);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Telegram WebApp script loading was interrupted"));
    };
    const interval = window.setInterval(() => {
      if (getTelegramWebApp()) {
        cleanup();
        resolve();
        return;
      }

      if (Date.now() - startedAt > 5000) {
        cleanup();
        reject(new Error("Telegram WebApp API is unavailable"));
      }
    }, 50);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function waitForExistingTelegramScript(script: HTMLScriptElement) {
  const controller = new AbortController();
  return new Promise<void>((resolve, reject) => {
    const onError = () => {
      controller.abort();
      reject(new Error("Telegram WebApp script failed to load"));
    };
    script.addEventListener("error", onError, { once: true });
    void waitForTelegramWebAppApi(controller.signal)
      .then(resolve)
      .catch(reject)
      .finally(() => script.removeEventListener("error", onError));
  });
}

export function loadTelegramWebAppScript() {
  if (getTelegramWebApp()) {
    return Promise.resolve();
  }

  let script = document.querySelector<HTMLScriptElement>(
    telegramWebAppScriptSelector,
  );

  if (telegramWebAppScriptPromise) {
    if (script?.dataset.cleanPayTelegramWebappState !== "loaded") {
      return telegramWebAppScriptPromise;
    }

    // A resolved promise must not mask a global removed by HMR or a broken
    // SDK initialization. A fresh element gives the browser a real retry.
    telegramWebAppScriptPromise = null;
    script.remove();
    script = null;
  }

  if (script?.dataset.cleanPayTelegramWebappState === "loaded") {
    script.remove();
    script = null;
  } else if (
    script
    && script.dataset.cleanPayTelegramWebappState !== "loading"
    && script.dataset.cleanPayTelegramWebappState !== "initializing"
  ) {
    script.remove();
    script = null;
  }

  const appendScript = !script;
  if (!script) {
    script = document.createElement("script");
    script.async = true;
    script.dataset.cleanPayTelegramWebapp = "true";
    script.dataset.cleanPayTelegramWebappState = "loading";
    script.src = "https://telegram.org/js/telegram-web-app.js";
  }

  const loadingScript = script;
  const pending =
    loadingScript.dataset.cleanPayTelegramWebappState === "initializing"
    || !appendScript
      ? waitForExistingTelegramScript(loadingScript)
      : new Promise<void>((resolve, reject) => {
          const controller = new AbortController();
          const onLoad = () => {
            loadingScript.dataset.cleanPayTelegramWebappState = "initializing";
            void waitForTelegramWebAppApi(controller.signal)
              .then(resolve)
              .catch(reject)
              .finally(() =>
                loadingScript.removeEventListener("error", onError)
              );
          };
          const onError = () => {
            controller.abort();
            loadingScript.remove();
            reject(new Error("Telegram WebApp script failed to load"));
          };

          loadingScript.addEventListener("load", onLoad, { once: true });
          loadingScript.addEventListener("error", onError, { once: true });
          if (appendScript) {
            document.head.appendChild(loadingScript);
          }
        });

  telegramWebAppScriptPromise = pending.then(
    () => {
      loadingScript.dataset.cleanPayTelegramWebappState = "loaded";
      telegramWebAppScriptPromise = null;
    },
    (error: unknown) => {
      telegramWebAppScriptPromise = null;
      loadingScript.remove();
      throw error;
    },
  );

  return telegramWebAppScriptPromise;
}
