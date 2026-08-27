"use client";

import { Message } from "primereact/message";
import { ProgressSpinner } from "primereact/progressspinner";

import {
  useTurnstileWidgetController,
  type TurnstileHandle,
} from "@/frontend/hooks/use-turnstile-widget-controller";

export type { TurnstileHandle };
export { hasTurnstileSiteKey } from "@/frontend/lib/turnstile-transitions";

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
  const { containerRef, error, loading } = useTurnstileWidgetController({
    onToken,
    onReady,
    siteKey,
    action,
  });

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
