"use client";

import { useState, type FormEvent } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { Message } from "primereact/message";
import { Password } from "primereact/password";

import { changeProfilePasswordAction } from "@/app/actions/profile";

/**
 * Password change in the profile.
 *
 * Split out of ProfilePanel, which carried fourteen pieces of state across
 * four unrelated forms. The two password fields and the outcome of the
 * request belong to this form alone; the panel keeps only the single-action
 * lock, which the forms genuinely share because two must not run at once.
 */
export function ProfilePasswordCard({
  beginPendingAction,
  finishPendingAction,
  onStart,
  pendingAction,
}: {
  beginPendingAction: (action: string) => boolean;
  finishPendingAction: (action: string) => void;
  onStart: () => void;
  pendingAction: string | null;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [severity, setSeverity] = useState<"success" | "warn">("success");

  function show(text: string, nextSeverity: "success" | "warn") {
    setMessage(text);
    setSeverity(nextSeverity);
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!beginPendingAction("password")) {
      return;
    }

    onStart();
    setMessage(null);

    try {
      const result = await changeProfilePasswordAction({ currentPassword, newPassword });
      if (!result.ok) {
        show(result.message, "warn");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      show(result.message, "success");
    } catch {
      show("Сеть недоступна. Не удалось изменить пароль.", "warn");
    } finally {
      finishPendingAction("password");
    }
  }

  return (
    <Card title="Смена пароля">
      <form className="flex flex-column gap-3" onSubmit={changePassword}>
        {message ? <Message severity={severity} text={message} /> : null}
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Текущий пароль</span>
          <Password
            autoComplete="current-password"
            className="w-full"
            feedback={false}
            inputClassName="w-full"
            maxLength={256}
            name="currentPassword"
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
            toggleMask
            value={currentPassword}
          />
        </label>
        <label className="flex flex-column gap-2">
          <span className="text-sm font-medium text-700">Новый пароль</span>
          <Password
            autoComplete="new-password"
            className="w-full"
            inputClassName="w-full"
            maxLength={256}
            minLength={8}
            name="newPassword"
            onChange={(event) => setNewPassword(event.target.value)}
            required
            toggleMask
            value={newPassword}
          />
        </label>
        <Button
          className="w-fit"
          disabled={pendingAction !== null}
          label="Изменить пароль"
          loading={pendingAction === "password"}
          type="submit"
        />
      </form>
    </Card>
  );
}
