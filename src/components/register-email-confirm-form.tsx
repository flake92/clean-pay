"use client";

import { useState } from "react";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { readBffError } from "@/lib/client-api";

async function readError(response: Response) {
  return (await readBffError(response, "Не удалось подтвердить e-mail.")).message;
}

export function RegisterEmailConfirmForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/auth/email/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: formData.get("code"),
        registrationFlow: true,
      }),
    });

    setLoading(false);

    if (!response.ok) {
      setError(await readError(response));
      return;
    }

    window.location.assign("/cabinet");
  }

  return (
    <form className="flex flex-column gap-3" onSubmit={onSubmit}>
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Код подтверждения</span>
        <InputText
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="code"
          pattern="[0-9]{6}"
          placeholder="000000"
          required
        />
      </label>
      {error ? <Message severity="error" text={error} /> : null}
      <Button disabled={loading} label="Подтвердить e-mail" loading={loading} type="submit" />
    </form>
  );
}
