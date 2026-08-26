"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          action: string;
          size?: "normal" | "flexible" | "compact";
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const scriptId = "cloudflare-turnstile-script";
let turnstileScriptPromise: Promise<void> | null = null;

function waitForTurnstileApi(signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const startedAt = Date.now();
    const cleanup = () => {
      window.clearInterval(interval);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("Turnstile script loading was interrupted"));
    };
    const interval = window.setInterval(() => {
      if (window.turnstile?.render) {
        cleanup();
        resolve();
        return;
      }

      if (Date.now() - startedAt > 5000) {
        cleanup();
        reject(new Error("Turnstile API is unavailable"));
      }
    }, 50);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function loadTurnstileScript() {
  if (typeof window === "undefined" || window.turnstile) {
    return Promise.resolve();
  }

  if (turnstileScriptPromise) {
    return turnstileScriptPromise;
  }

  let existing = document.getElementById(scriptId) as HTMLScriptElement | null;
  if (existing?.dataset.cleanPayTurnstileState === "loaded") {
    existing.remove();
    existing = null;
  }
  let pending: Promise<void>;

  if (existing) {
    pending = new Promise<void>((resolve, reject) => {
      if (window.turnstile) {
        resolve();
        return;
      }

      // The load event may already have fired before a remount or HMR pass.
      // Polling the API also covers a script that is still downloading.
      const controller = new AbortController();
      const onError = () => {
        controller.abort();
        reject(new Error("Turnstile script failed to load"));
      };
      existing.addEventListener("error", onError, { once: true });
      void waitForTurnstileApi(controller.signal)
        .then(resolve)
        .catch(reject)
        .finally(() => existing.removeEventListener("error", onError));
    });
  } else {
    pending = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const controller = new AbortController();
      const onError = () => {
        controller.abort();
        reject(new Error("Turnstile script failed to load"));
      };

      script.id = scriptId;
      script.async = true;
      script.defer = true;
      script.dataset.cleanPayTurnstileState = "loading";
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.addEventListener("load", () => {
        void waitForTurnstileApi(controller.signal)
          .then(resolve)
          .catch(reject)
          .finally(() => script.removeEventListener("error", onError));
      }, { once: true });
      script.addEventListener("error", onError, { once: true });
      document.head.appendChild(script);
    });
  }

  turnstileScriptPromise = pending.then(
    () => {
      const loadedScript = document.getElementById(scriptId);
      if (loadedScript instanceof HTMLScriptElement) {
        loadedScript.dataset.cleanPayTurnstileState = "loaded";
      }
      turnstileScriptPromise = null;
    },
    (error: unknown) => {
      turnstileScriptPromise = null;
      document.getElementById(scriptId)?.remove();
      throw error;
    },
  );

  return turnstileScriptPromise;
}

export type TurnstileHandle = {
  reset: () => void;
};

export function hasTurnstileSiteKey(siteKey?: string | null) {
  return Boolean(siteKey);
}

export function TurnstileWidget({
  onToken,
  onReady,
  siteKey,
  action,
}: {
  onToken: (token: string | null) => void;
  onReady?: (handle: TurnstileHandle) => void;
  siteKey?: string | null;
  action: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(siteKey));

  const reset = useCallback(() => {
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
    onToken(null);
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) {
      return;
    }

    let mounted = true;

    loadTurnstileScript()
      .then(() => {
        if (!mounted || !containerRef.current || !window.turnstile || widgetIdRef.current) {
          return;
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          size: "flexible",
          callback: (token) => {
            setError(null);
            onToken(token);
          },
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            onToken(null);
            setError("Не удалось пройти проверку Cloudflare Turnstile.");
          },
        });
        setLoading(false);
        onReady?.({ reset });
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        setLoading(false);
        setError("Не удалось загрузить Cloudflare Turnstile.");
      });

    return () => {
      mounted = false;

      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, onReady, onToken, reset, siteKey]);

  if (!siteKey) {
    return <Message severity="error" text="Cloudflare Turnstile site key is not configured." />;
  }

  return (
    <div className="flex flex-column gap-2 turnstile-widget">
      <div ref={containerRef} className="turnstile-widget-container" />
      {loading ? (
        <div className="flex align-items-center gap-2 text-600">
          <ProgressSpinner style={{ height: "1.25rem", width: "1.25rem" }} strokeWidth="6" />
          <span className="text-sm">Загрузка проверки безопасности...</span>
        </div>
      ) : null}
      {error ? <Message severity="error" text={error} /> : null}
    </div>
  );
}
