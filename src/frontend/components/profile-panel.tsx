"use client";

import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";

import {
  changeProfileEmailAction,
  changeProfilePasswordAction,
  requestProfileEmailVerificationAction,
} from "@/app/actions/profile";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import type { ProfileViewModel } from "@/shared/presentation/profile";

function authTypeLabel(value: string) {
  const labels: Record<string, string> = {
    email: "E-mail",
    passkey: "Ключ доступа",
    telegram: "Telegram",
  };

  return labels[value] ?? value;
}

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}

export function ProfilePanel({
  model,
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  model: ProfileViewModel;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const user = model.status === "ready" ? model.user : null;
  const [email, setEmail] = useState(user?.pendingEmail ?? user?.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageSeverity, setMessageSeverity] = useState<"success" | "info" | "warn">("info");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordMessageSeverity, setPasswordMessageSeverity] = useState<"success" | "warn">("success");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const pendingActionRef = useRef<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const currentEmailTarget = user?.pendingEmail ?? user?.email ?? "";

  function turnstileActionForEmail(candidate: string) {
    return candidate.trim().toLowerCase() === currentEmailTarget.toLowerCase()
      ? "email_verification"
      : "email_change";
  }

  const emailTurnstileAction = turnstileActionForEmail(email);

  function beginPendingAction(action: string) {
    if (pendingActionRef.current) {
      return false;
    }

    pendingActionRef.current = action;
    setPendingAction(action);
    return true;
  }

  function finishPendingAction(action: string) {
    if (pendingActionRef.current !== action) {
      return;
    }

    pendingActionRef.current = null;
    setPendingAction(null);
  }

  function showMessage(text: string, severity: "success" | "info" | "warn" = "info") {
    setMessage(text);
    setMessageSeverity(severity);
  }

  function showPasswordMessage(text: string, severity: "success" | "warn") {
    setPasswordMessage(text);
    setPasswordMessageSeverity(severity);
  }

  function resetTurnstile() {
    turnstile?.reset();
    setTurnstileToken(null);
  }

  async function requestVerificationFor(nextTargetEmail: string) {
    return requestProfileEmailVerificationAction({
      ...(nextTargetEmail ? { email: nextTargetEmail } : {}),
      ...(turnstileToken ? { turnstileToken } : {}),
    });
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!beginPendingAction("email")) {
      return;
    }

    setMessage(null);

    const nextEmail = email.trim();
    const isSameEmail = turnstileActionForEmail(nextEmail) === "email_verification";

    if (turnstileEnabled && !turnstileToken) {
      finishPendingAction("email");
      showMessage(missingTurnstileTokenMessage(turnstileSiteKey), "warn");
      return;
    }

    try {
      if (isSameEmail) {
        const result = await requestVerificationFor(nextEmail);
        if (!result.ok) {
          showMessage(result.message, "warn");
          return;
        }
        showMessage(`E-mail уже указан. ${result.message}`, "success");
        window.location.assign("/verify-email");
        return;
      }

      const result = await changeProfileEmailAction({
        email: nextEmail,
        ...(turnstileToken ? { turnstileToken } : {}),
      });
      if (!result.ok) {
        showMessage(result.message, "warn");
        return;
      }
      showMessage(result.message, "success");
      window.location.assign("/verify-email");
    } catch (err) {
      showMessage(err instanceof Error ? err.message : "Не удалось изменить e-mail.", "warn");
    } finally {
      resetTurnstile();
      finishPendingAction("email");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!beginPendingAction("password")) {
      return;
    }

    setMessage(null);
    setPasswordMessage(null);

    try {
      const result = await changeProfilePasswordAction({
        currentPassword,
        newPassword,
      });
      if (!result.ok) {
        showPasswordMessage(result.message, "warn");
        return;
      }

      setCurrentPassword("");
      setNewPassword("");
      showPasswordMessage(result.message, "success");
    } catch (err) {
      showPasswordMessage(err instanceof Error ? err.message : "Не удалось изменить пароль.", "warn");
    } finally {
      finishPendingAction("password");
    }
  }

  if (model.status === "error") {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={model.message} />
        <LinkButton className="w-fit" href="/login" label="Войти" />
      </div>
    );
  }

  if (!user) return null;
  const telegramId = user.telegramId;
  const hasEmail = Boolean(user.email);
  const isEmailVerified = hasEmail && user.emailVerified;
  const isTelegramOnly = Boolean(telegramId) && !user.email;
  const canManageRemnashopEmail = Boolean(user.email);
  const canChangePassword = hasEmail;
  return (
    <div className="clean-profile-panel flex flex-column gap-4">
      {message ? <Message severity={messageSeverity} text={message} /> : null}

      <Card title="Данные аккаунта">
        <div className="grid">
          {[
            ["E-mail", user.email ?? "Не привязан"],
            ["Тип входа", authTypeLabel(user.authType)],
            ["Telegram", telegramId ?? "Не привязан"],
          ].map(([label, value]) => (
            <div className="col-12 md:col-6" key={label}>
              <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
                <div className="text-xs uppercase text-500">{label}</div>
                <div className="mt-1 font-medium text-900 break-words">{value}</div>
              </div>
            </div>
          ))}
          <div className="col-12 md:col-6">
            <div className="surface-50 border-1 border-200 border-round-lg p-3 h-full">
              <div className="text-xs uppercase text-500">E-mail подтвержден</div>
              <div className="mt-2">
                <Tag
                  severity={hasEmail ? (isEmailVerified ? "success" : "warning") : "secondary"}
                  value={hasEmail ? (isEmailVerified ? "Да" : "Нет") : "Не привязан"}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      {isTelegramOnly ? (
        <Card title="Добавить e-mail и пароль">
          <div className="flex flex-column gap-3">
            <p className="m-0 line-height-3 text-600">
              Вы вошли через Telegram. Добавьте e-mail, придумайте пароль и подтвердите адрес, чтобы не потерять доступ без Telegram и продолжить оплату.
            </p>
            <LinkButton className="w-fit" href="/link-account" label="Добавить e-mail и пароль" />
          </div>
        </Card>
      ) : null}

      {canManageRemnashopEmail ? (
        <Card title="Смена e-mail">
          <form className="flex flex-column gap-3" onSubmit={changeEmail}>
            {turnstileEnabled ? (
              <TurnstileWidget
                action={emailTurnstileAction}
                key={emailTurnstileAction}
                onReady={setTurnstile}
                onToken={setTurnstileToken}
                siteKey={turnstileSiteKey}
              />
            ) : null}
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Новый e-mail</span>
              <InputText
                onChange={(event) => {
                  const nextEmail = event.target.value;

                  if (
                    turnstileToken
                    && turnstileActionForEmail(nextEmail) !== emailTurnstileAction
                  ) {
                    resetTurnstile();
                  }
                  setEmail(nextEmail);
                }}
                required
                type="email"
                value={email}
              />
            </label>
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={pendingAction !== null}
                label="Сохранить и отправить код"
                loading={pendingAction === "email"}
                type="submit"
              />
            </div>
          </form>
        </Card>
      ) : null}

      {canChangePassword ? (
        <Card title="Смена пароля">
          <form className="flex flex-column gap-3" onSubmit={changePassword}>
            {passwordMessage ? <Message severity={passwordMessageSeverity} text={passwordMessage} /> : null}
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Текущий пароль</span>
              <Password
                className="w-full"
                feedback={false}
                inputClassName="w-full"
                onChange={(event) => setCurrentPassword(event.target.value)}
                required
                toggleMask
                value={currentPassword}
              />
            </label>
            <label className="flex flex-column gap-2">
              <span className="text-sm font-medium text-700">Новый пароль</span>
              <Password
                className="w-full"
                inputClassName="w-full"
                minLength={8}
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
      ) : null}
    </div>
  );
}
