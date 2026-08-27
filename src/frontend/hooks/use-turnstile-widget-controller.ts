import { useCallback, useEffect, useRef, useState } from "react";

import { loadTurnstileScript } from "@/frontend/lib/turnstile-loader";

export type TurnstileHandle = {
  reset: () => void;
};

export function useTurnstileWidgetController({
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
        if (
          !mounted
          || !containerRef.current
          || !window.turnstile
          || widgetIdRef.current
        ) {
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

  return { containerRef, error, loading };
}
