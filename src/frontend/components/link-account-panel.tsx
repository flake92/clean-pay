"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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

type MergeConfirmation = {
  targetEmail: string;
  sourceEmailMasked: string | null;
  telegramId: string;
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

function telegramCallbackError(status: string | null) {
  if (status === "telegram_merge_subscriptions") {
    return "В обеих учётных записях есть подписки. Данные не изменены — обратитесь в службу поддержки.";
  }

  if (status === "telegram_merge_required") {
    return "Telegram уже связан с другой учётной записью и подпиской. Автоматическое объединение остановлено: существующие данные не изменены. Обратитесь в поддержку для безопасного объединения.";
  }

  if (status === "telegram_failed") {
    return "Не удалось завершить привязку Telegram. Повторите попытку или обратитесь в поддержку.";
  }

  return null;
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
  const searchParams = useSearchParams();
  const callbackStatus = searchParams.get("auth");
  const callbackError = telegramCallbackError(callbackStatus);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean | null>(null);
  const [mergeConfirmation, setMergeConfirmation] = useState<MergeConfirmation | null>(null);

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

  const loadState = useCallback(async () => {
    setLoading(true);
    setError(callbackError);

    try {
      const profileResponse = await fetch("/api/bff/auth/me");

      if (!profileResponse.ok) {
        throw new Error(await readError(profileResponse));
      }

      const profileBody = await profileResponse.json();
      setProfile(profileBody.data.user);

      if (
        callbackStatus === "telegram_email_replace" ||
        callbackStatus === "telegram_processing"
      ) {
        let confirmationResponse: Response | null = null;
        const attempts = callbackStatus === "telegram_processing" ? 8 : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          confirmationResponse = await fetch(
            "/api/bff/auth/telegram/merge-confirmation",
          );
          if (confirmationResponse.ok || confirmationResponse.status !== 404) {
            break;
          }
          if (attempt + 1 < attempts) {
            await new Promise((resolve) => window.setTimeout(resolve, 250));
          }
        }

        if (!confirmationResponse) {
          throw new Error("Не удалось получить подтверждение объединения.");
        }
        if (!confirmationResponse.ok) {
          throw new Error(await readError(confirmationResponse));
        }

        const confirmationBody = await confirmationResponse.json();
        setMergeConfirmation(confirmationBody.data);
      } else {
        setMergeConfirmation(null);
      }

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
  }, [callbackError, callbackStatus]);

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
  }, [loadState]);

  async function confirmTelegramMerge() {
    setActionLoading("telegram-merge-confirm");
    setError(null);

    try {
      const response = await fetch("/api/bff/auth/telegram/merge-confirmation", {
        method: "POST",
      });

      if (!response.ok) {
        const responseError = await readBffError(
          response,
          "Не удалось объединить аккаунты.",
        );
        setError(responseError.message);
        if (
          responseError.code === "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT" ||
          responseError.code === "ACCOUNT_MERGE_REQUIRED"
        ) {
          setMergeConfirmation(null);
          window.history.replaceState({}, "", "/link-account");
        }
        return;
      }

      window.location.assign("/cabinet");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось объединить аккаунты.");
    } finally {
      setActionLoading(null);
    }
  }

  async function cancelTelegramMerge() {
    setActionLoading("telegram-merge-cancel");
    setError(null);

    try {
      const response = await fetch("/api/bff/auth/telegram/merge-confirmation", {
        method: "DELETE",
      });

      if (!response.ok) {
        const deleteError = await readError(response);
        if (response.status === 403 || response.status === 409) {
          await loadState();
        }
        setError(deleteError);
        return;
      }

      setMergeConfirmation(null);
      window.history.replaceState({}, "", "/link-account");
      setMessage("Объединение аккаунтов отменено. Данные не изменены.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось отменить объединение.");
    } finally {
      setActionLoading(null);
    }
  }

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

  async function deletePasskey(id: string) {
    setActionLoading(`passkey-${id}`);
    setMessage(null);
    setError(null);

    try {
      const response = await fetch(`/api/bff/auth/passkey/credentials/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        setError(await readError(response));
        return;
      }

      setMessage("Ключ быстрого входа удалён.");
      await loadState();
    } finally {
      setActionLoading(null);
    }
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
      const responseError = await readError(response);
      turnstile?.reset();
      setTurnstileToken(null);
      await loadState();
      setError(responseError);
      return;
    }

    const body = (await response.json()) as {
      data?: {
        linked?: boolean;
        pendingVerification?: boolean;
      };
    };

    if (body.data?.linked) {
      setMessage("E-mail привязан.");
      window.location.assign("/cabinet");
      return;
    }

    window.location.assign("/verify-email");
  }

  if (loading) {
    return <Message severity="info" text="Загружаем способы входа..." />;
  }

  return (
    <div className="link-account-panel">
      {error ? <Message severity="error" text={error} /> : null}
      {mergeConfirmation ? (
        <section className="account-method-card border-orange-400">
          <Message
            severity="warn"
            text={`В выбранной учётной записи Telegram уже указан e-mail ${mergeConfirmation.sourceEmailMasked ?? "другой e-mail"}. После объединения он будет заменён на ${mergeConfirmation.targetEmail}, а подписка, платежи и остальные данные будут перенесены. Вы точно хотите продолжить?`}
          />
          <div className="account-method-actions mt-3">
            <Button
              label="Да, заменить e-mail и объединить"
              loading={actionLoading === "telegram-merge-confirm"}
              disabled={actionLoading !== null}
              onClick={() => void confirmTelegramMerge()}
              severity="warning"
              type="button"
            />
            <Button
              label="Отмена"
              loading={actionLoading === "telegram-merge-cancel"}
              disabled={actionLoading !== null}
              onClick={() => void cancelTelegramMerge()}
              outlined
              type="button"
            />
          </div>
        </section>
      ) : null}
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
          <div className="account-method-actions-stack">
            {turnstileEnabled ? (
              <TurnstileWidget onReady={setTurnstile} onToken={setTurnstileToken} siteKey={turnstileSiteKey} />
            ) : null}
            {hasTelegram ? (
              <Button
                disabled={actionLoading === "telegram"}
                icon="pi pi-refresh"
                label="Перепроверить связь Telegram"
                loading={actionLoading === "telegram"}
                onClick={linkTelegram}
                outlined
                type="button"
              />
            ) : (
              <Button
                disabled={actionLoading === "telegram"}
                icon="pi pi-send"
                label="Привязать Telegram"
                loading={actionLoading === "telegram"}
                onClick={linkTelegram}
                severity="info"
                type="button"
              />
            )}
          </div>
        </AuthMethodTile>

        <AuthMethodTile
          active={hasPasskey}
          description={passkeyDescription}
          icon="pi pi-lock"
          meta={hasPasskey ? <span>Сохранено ключей: {passkeys.length}</span> : null}
          title="Быстрый вход"
        >
          {webAuthnSupported !== false ? (
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
            <Message severity="info" text="На этом устройстве нельзя добавить новый ключ. Сохранённые ключи можно удалить ниже." />
          ) : null}

            {passkeys.length > 0 ? (
              <div className="passkey-list">
                {passkeys.map((credential) => (
                  <div className="passkey-list-item" key={credential.id}>
                    <div className="passkey-list-item__body">
                      <span className="passkey-list-item__name">{credential.name ?? "Ключ доступа"}</span>
                      <span className="passkey-list-item__meta">
                        {credential.lastUsedAt ? `Последний вход: ${new Date(credential.lastUsedAt).toLocaleDateString("ru-RU")}` : "Ещё не использовался"}
                      </span>
                    </div>
                    <Button
                      aria-label="Удалить ключ"
                      disabled={passkeys.length <= 1 || actionLoading === `passkey-${credential.id}`}
                      icon="pi pi-trash"
                      loading={actionLoading === `passkey-${credential.id}`}
                      onClick={() => deletePasskey(credential.id)}
                      outlined
                      severity="danger"
                      type="button"
                    />
                  </div>
                ))}
              </div>
            ) : null}
        </AuthMethodTile>
      </div>
    </div>
  );
}
