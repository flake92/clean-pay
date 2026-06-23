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
const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

function loadTurnstileScript() {
  if (typeof window === "undefined" || window.turnstile) {
    return Promise.resolve();
  }

  const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

  if (existing) {
    return new Promise<void>((resolve, reject) => {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), { once: true });
    });
  }

  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");

    script.id = scriptId;
    script.async = true;
    script.defer = true;
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener("error", () => reject(new Error("Turnstile script failed to load")), { once: true });
    document.head.appendChild(script);
  });
}

export type TurnstileHandle = {
  reset: () => void;
};

export function hasPublicTurnstileKey() {
  return Boolean(siteKey);
}

export function TurnstileWidget({
  onToken,
  onReady,
}: {
  onToken: (token: string | null) => void;
  onReady?: (handle: TurnstileHandle) => void;
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
    };
  }, [onReady, onToken, reset]);

  if (!siteKey) {
    return <Message severity="error" text="Cloudflare Turnstile site key is not configured." />;
  }

  return (
    <div className="flex flex-column gap-2">
      <div ref={containerRef} />
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
