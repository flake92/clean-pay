import { useCallback, useEffect, useReducer, useRef } from "react";

import { loadTurnstileScript } from "@/frontend/lib/turnstile-loader";
import {
  createTurnstileWidgetState,
  turnstileWidgetReducer,
} from "@/frontend/lib/turnstile-transitions";

export type TurnstileHandle = {
  reset: () => void;
};

type TurnstileWidgetDependencies = {
  loadScript: typeof loadTurnstileScript;
  readApi: () => Window["turnstile"];
};

const productionTurnstileWidgetDependencies: TurnstileWidgetDependencies = {
  loadScript: loadTurnstileScript,
  readApi: () => window.turnstile,
};

export function useTurnstileWidgetController({
  onToken,
  onReady,
  siteKey,
  action,
  dependencies = productionTurnstileWidgetDependencies,
}: {
  onToken: (token: string | null) => void;
  onReady?: (handle: TurnstileHandle) => void;
  siteKey?: string | null;
  action: string;
  dependencies?: TurnstileWidgetDependencies;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [state, dispatch] = useReducer(
    turnstileWidgetReducer,
    siteKey,
    createTurnstileWidgetState,
  );

  const reset = useCallback(() => {
    const turnstile = dependencies.readApi();
    if (widgetIdRef.current && turnstile) {
      turnstile.reset(widgetIdRef.current);
    }
    onToken(null);
  }, [dependencies, onToken]);

  useEffect(() => {
    if (!siteKey) {
      return;
    }

    let mounted = true;

    dependencies.loadScript()
      .then(() => {
        const turnstile = dependencies.readApi();
        if (
          !mounted
          || !containerRef.current
          || !turnstile
          || widgetIdRef.current
        ) {
          return;
        }

        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          size: "flexible",
          callback: (token) => {
            dispatch({ type: "challenge-accepted" });
            onToken(token);
          },
          "expired-callback": () => onToken(null),
          "error-callback": () => {
            onToken(null);
            dispatch({ type: "challenge-failed" });
          },
        });
        dispatch({ type: "script-loaded" });
        onReady?.({ reset });
      })
      .catch(() => {
        if (!mounted) {
          return;
        }
        dispatch({ type: "script-load-failed" });
      });

    return () => {
      mounted = false;

      const turnstile = dependencies.readApi();
      if (widgetIdRef.current && turnstile) {
        turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [action, dependencies, onReady, onToken, reset, siteKey]);

  return { containerRef, ...state };
}
