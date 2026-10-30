"use client";

import { useState } from "react";

import { unsubscribeEmailAction } from "@/app/actions/notifications";
import type { EmailUnsubscribeResult } from "@/application/models/notifications";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { Button, Message } from "@/frontend/components/sakai/form-foundation";

// Opening the link changes nothing: mail scanners prefetch links, so the
// opt-out happens only on the button press (or the RFC 8058 one-click POST).
export function UnsubscribePanel({ token }: { token: string }) {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<EmailUnsubscribeResult | null>(null);

  async function confirm() {
    setPending(true);
    try {
      setResult(await unsubscribeEmailAction(token));
    } catch {
      setResult({ ok: false, code: "INTERNAL_ERROR", message: "Не удалось отписаться. Попробуйте позже." });
    } finally {
      setPending(false);
    }
  }

  if (result?.ok) {
    return (
      <div className="flex flex-column gap-3 align-items-center text-center">
        <Message severity="success" text={result.message} />
        <p className="m-0 text-600 line-height-3">
          Подписку можно вернуть в профиле личного кабинета, в разделе «Уведомления по e-mail».
        </p>
        <LinkButton href="/profile" label="Открыть профиль" />
      </div>
    );
  }

  return (
    <div className="flex flex-column gap-3 align-items-center text-center">
      {result ? <Message severity="warn" text={result.message} /> : null}
      <Button
        disabled={pending || !token}
        icon="pi pi-envelope"
        label="Отписаться"
        loading={pending}
        onClick={() => void confirm()}
      />
      <LinkButton href="/profile" label="Настроить уведомления в профиле" />
    </div>
  );
}
