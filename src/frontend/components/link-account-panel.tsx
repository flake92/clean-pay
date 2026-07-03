"use client";

import { useEffect, useMemo, useState } from "react";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";

import { TurnstileWidget, type TurnstileHandle, hasTurnstileSiteKey } from "@/frontend/components/turnstile-widget";
import { readBffError } from "@/frontend/lib/client-api";

type ProfileUser = {
  email: string | null;
  emailVerified?: boolean;
  is_email_verified?: boolean;
  telegramId?: string | null;
  telegram_id?: string | number | null;
};

type PasskeyCredential = {
  id: string;
  name: string | null;
  createdAt: string;
  lastUsedAt: string | null;
};

async function readError(response: Response) {
  return (await readBffError(response, "Не удалось выполнить действие.")).message;
}

function missingTurnstileTokenMessage(siteKey?: string | null) {
  return hasTurnstileSiteKey(siteKey)
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Cloudflare Turnstile site key is not configured.";
}

function statusSeverity(active: boolean, pending = false) {
  if (active) {
    return "success" as const;
  }

  return pending ? ("warning" as const) : ("secondary" as const);
}

function statusLabel(active: boolean, pending = false) {
  if (active) {
    return "Подключено";
  }

  return pending ? "Нужно подтвердить" : "Не подключено";
}

function AuthMethodTile({
  icon,
  title,
  description,
  active,
  pending,
  meta,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  active: boolean;
  pending?: boolean;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="account-method-card">
      <div className="account-method-card__header">
        <span className="account-method-icon">
          <i className={icon} />
        </span>
        <div className="account-method-heading">
          <h3 className="account-method-title">{title}</h3>
          <p className="account-method-description">{description}</p>
        </div>
        <Tag className="account-method-status" severity={statusSeverity(active, pending)} value={statusLabel(active, pending)} />
      </div>
      {meta ? <div className="account-method-meta">{meta}</div> : null}
      {children ? <div className="account-method-actions">{children}</div> : null}
    </section>
  );
}

export function LinkAccountPanel({
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean | null>(null);

  const emailVerified = Boolean(profile?.emailVerified ?? profile?.is_email_verified);
  const telegramId = profile?.telegramId ?? profile?.telegram_id ?? null;
  const hasEmail = Boolean(profile?.email);
  const hasTelegram = Boolean(telegramId);
  const hasPasskey = passkeys.length > 0;

  const passkeyDescription = useMemo(() => {
    if (webAuthnSupported === false) {
      return "На этом устройстве быстрый вход недоступен. Можно пользоваться e-mail, паролем или Telegram.";
    }

    return hasPasskey
      ? "Быстрый вход уже настроен для этого аккаунта."
      : "Можно добавить вход по Face ID, отпечатку или PIN-коду устройства.";
  }, [hasPasskey, webAuthnSupported]);

  async function loadState() {
    setLoading(true);
    setError(null);

    try {
      const profileResponse = await fetch("/api/bff/auth/me");

      if (!profileResponse.ok) {
        throw new Error(await readError(profileResponse));
      }

      const profileBody = await profileResponse.json();
      setProfile(profileBody.data.user);

      const passkeyResponse = await fetch("/api/bff/auth/passkey/credentials");

      if (passkeyResponse.ok) {
        const passkeyBody = await passkeyResponse.json();
        setPasskeys(passkeyBody.data.credentials ?? []);
      } else {
        setPasskeys([]);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось загрузить способы входа.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWebAuthnSupported(browserSupportsWebAuthn());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadState();
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  function linkTelegram() {
    setMessage(null);
    setError(null);

    if (turnstileEnabled && !turnstileToken) {
      setError(missingTurnstileTokenMessage(turnstileSiteKey));
      return;
    }

    setActionLoading("telegram");
    const url = new URL("/auth/telegram/start", window.location.origin);
    url.searchParams.set("redirect_to", "/link-account");
    if (turnstileToken) {
      url.searchParams.set("turnstile_token", turnstileToken);
      url.searchParams.set("cf-turnstile-response", turnstileToken);
    }
    window.location.assign(url.toString());
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionLoading("email");
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/bff/link/remnashop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: formData.get("email"),
        password: formData.get("password"),
      }),
    });

    setActionLoading(null);

    if (!response.ok) {
      turnstile?.reset();
      setTurnstileToken(null);
      setError(await readError(response));
      return;
    }

    setMessage("E-mail сохранён, код подтверждения отправлен.");
    await loadState();
  }

  if (loading) {
    return <Message severity="info" text="Загружаем способы входа..." />;
  }

  return (
    <div className="link-account-panel">
      {error ? <Message severity="error" text={error} /> : null}
      {message ? <Message severity="success" text={message} /> : null}

      <div className="account-method-grid">
        <AuthMethodTile
          active={hasEmail && emailVerified}
          description={hasEmail ? "Используется для входа по паролю и восстановления доступа." : "Добавьте e-mail, чтобы входить по паролю и восстановить доступ при необходимости."}
          icon="pi pi-envelope"
          meta={hasEmail ? <span>{profile?.email}</span> : null}
          pending={hasEmail && !emailVerified}
          title="E-mail"
        >
          {hasEmail && !emailVerified ? (
            <Button label="Подтвердить e-mail" onClick={() => window.location.assign("/verify-email")} outlined type="button" />
          ) : !hasEmail ? (
            <form className="account-method-form" onSubmit={onSubmit}>
              <InputText name="email" placeholder="user@example.com" required type="email" />
              <Password
                className="w-full"
                feedback={false}
                inputClassName="w-full"
                minLength={8}
                name="password"
                placeholder="Пароль"
                required
                toggleMask
              />
              <Button disabled={actionLoading === "email"} label="Привязать e-mail" loading={actionLoading === "email"} type="submit" />
            </form>
          ) : null}
        </AuthMethodTile>

        <AuthMethodTile
          active={hasTelegram}
          description="Дополнительный вход и восстановление доступа через Telegram."
          icon="pi pi-send"
          meta={hasTelegram ? <span>Telegram ID: {telegramId}</span> : null}
          title="Telegram"
        >
          {!hasTelegram ? (
            <div className="account-method-actions-stack">
              {turnstileEnabled ? (
                <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
              ) : null}
              <Button
                disabled={actionLoading === "telegram"}
                icon="pi pi-send"
                label="Привязать Telegram"
                loading={actionLoading === "telegram"}
                onClick={linkTelegram}
                severity="info"
                type="button"
              />
            </div>
          ) : null}
        </AuthMethodTile>

        <AuthMethodTile
          active={hasPasskey}
          description={passkeyDescription}
          icon="pi pi-lock"
          meta={hasPasskey ? <span>Сохранено ключей: {passkeys.length}</span> : null}
          title="Быстрый вход"
        >
          {webAuthnSupported !== false && !hasPasskey ? (
            <div className="account-method-action-row">
              <Button
                icon="pi pi-lock"
                label="Настроить"
                onClick={() => window.location.assign("/passkey/setup")}
                type="button"
              />
              <Button
                label="Позже"
                onClick={() => window.location.assign("/cabinet")}
                outlined
                severity="secondary"
                type="button"
              />
            </div>
          ) : webAuthnSupported === false ? (
            <Message severity="info" text="Этот способ скрывается на устройствах без поддержки WebAuthn." />
          ) : null}
        </AuthMethodTile>
      </div>
    </div>
  );
}
