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
import { LinkButton } from "@/frontend/components/prime/link-button";
import { navigateTo, replaceWith } from "@/frontend/lib/browser-navigation";
import { readBffError } from "@/frontend/lib/client-api";
import {
  accountLinkPath,
  accountSetupCompletePath,
  emailVerificationPath,
  isPaymentDestination,
} from "@/shared/auth/account-setup-flow";

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
  emailWillBeReplaced?: boolean;
  telegramId: string;
};

function telegramMergeConfirmationMessage(confirmation: MergeConfirmation) {
  // Keep the old payload compatible during a rolling deployment: previously
  // sourceEmailMasked was only returned when the source account had an e-mail.
  const emailWillBeReplaced = confirmation.emailWillBeReplaced
    ?? Boolean(confirmation.sourceEmailMasked);

  if (emailWillBeReplaced) {
    const sourceEmail = confirmation.sourceEmailMasked ?? "другой e-mail";
    return `Этот Telegram принадлежит отдельной учётной записи с e-mail ${sourceEmail}. После объединения ${confirmation.targetEmail} останется основным e-mail для входа, а ${sourceEmail} больше нельзя будет использовать для входа в объединённый аккаунт. Подписки, платежи и остальные данные будут перенесены. Продолжить?`;
  }

  return `Этот Telegram принадлежит отдельной учётной записи. После объединения текущий e-mail ${confirmation.targetEmail} останется без изменений, а подписки, платежи и остальные данные из Telegram-учётной записи будут перенесены. Продолжить?`;
}

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
    return "Автоматическое объединение остановлено из-за конфликта данных учётных записей. Ничего не изменено. Обновите страницу и повторите привязку; если ошибка сохраняется, обратитесь в поддержку.";
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
  guided = false,
  passwordRequired = false,
  redirectTo = "/cabinet",
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  guided?: boolean;
  passwordRequired?: boolean;
  redirectTo?: string;
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstile, setTurnstile] = useState<TurnstileHandle | null>(null);
  const [webAuthnSupported, setWebAuthnSupported] = useState<boolean | null>(null);
  const [mergeConfirmation, setMergeConfirmation] = useState<MergeConfirmation | null>(null);

  const emailVerified = Boolean(profile?.emailVerified ?? profile?.is_email_verified);
  const telegramId = profile?.telegramId ?? profile?.telegram_id ?? null;
  const hasEmail = Boolean(profile?.email);
  const hasTelegram = Boolean(telegramId);
  const hasPasskey = passkeys.length > 0;
  const requiresPasswordReauth = guided && passwordRequired;
  const usesCurrentPassword = hasEmail || requiresPasswordReauth;
  const returnsToPayment = isPaymentDestination(redirectTo);
  const verificationDestination = guided
    ? emailVerificationPath(redirectTo)
    : "/verify-email";
  const setupDestination = guided
    ? accountLinkPath(redirectTo, {
        passwordRequired: requiresPasswordReauth,
      })
    : "/link-account";
  const loginDestination = `/login?${new URLSearchParams({
    redirect_to: setupDestination,
  }).toString()}`;

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
        const responseError = await readBffError(
          profileResponse,
          "Не удалось загрузить способы входа.",
          { redirectOnUnauthorized: false },
        );

        if (
          responseError.status === 401 &&
          (!responseError.code || responseError.code === "UNAUTHORIZED")
        ) {
          setSessionExpired(true);
          setError(null);
          replaceWith(loginDestination);
          return;
        }

        throw responseError;
      }

      setSessionExpired(false);
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
  }, [callbackError, callbackStatus, loginDestination]);

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

      navigateTo(
        guided ? accountSetupCompletePath(redirectTo) : redirectTo,
      );
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
    setMessage(null);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const confirmPassword = String(formData.get("confirmPassword") ?? "");

    if (!hasEmail && password !== confirmPassword) {
      setError("Пароли не совпадают.");
      return;
    }

    setActionLoading("email");

    try {
      const response = await fetch("/api/bff/link/remnashop", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!response.ok) {
        const responseError = await readBffError(
          response,
          "Не удалось связать e-mail с аккаунтом.",
          { redirectOnUnauthorized: false },
        );

        if (
          responseError.status === 401 &&
          (!responseError.code || responseError.code === "UNAUTHORIZED")
        ) {
          setSessionExpired(true);
          setError(null);
          replaceWith(loginDestination);
          return;
        }

        turnstile?.reset();
        setTurnstileToken(null);
        await loadState();
        setError(responseError.message);
        return;
      }

      const body = (await response.json()) as {
        data?: {
          linked?: boolean;
          pendingVerification?: boolean;
        };
      };

      if (body.data?.linked) {
        setMessage("E-mail и пароль подключены.");
        navigateTo(accountSetupCompletePath(redirectTo));
        return;
      }

      navigateTo(verificationDestination);
    } catch {
      turnstile?.reset();
      setTurnstileToken(null);
      setError("Сеть недоступна. Не удалось связать e-mail с аккаунтом.");
    } finally {
      setActionLoading(null);
    }
  }

  if (loading) {
    return <Message severity="info" text="Загружаем способы входа..." />;
  }

  if (sessionExpired) {
    return (
      <div className="flex flex-column gap-4">
        <Message
          severity="warn"
          text="Сессия завершилась. Войдите снова — мы сохранили этот шаг и исходное действие."
        />
        <LinkButton
          className="w-fit"
          href={loginDestination}
          label="Войти и продолжить"
        />
      </div>
    );
  }

  return (
    <div className="link-account-panel">
      {error ? <Message severity="error" text={error} /> : null}
      {guided ? (
        <section
          aria-labelledby="guided-account-setup-title"
          className="surface-50 border-1 border-200 border-round-lg p-4"
        >
          <h2 className="mt-0 text-xl" id="guided-account-setup-title">
            {hasEmail && emailVerified
              ? "Подтвердите резервный вход"
              : "Добавьте резервный вход"}
          </h2>
          <p className="line-height-3 text-700">
            {hasEmail && emailVerified
              ? "E-mail уже подтверждён. Введите пароль от него, чтобы восстановить связь с сервисом и продолжить."
              : requiresPasswordReauth
                ? hasEmail
                  ? "Сессия подтверждения изменилась. Снова введите текущий пароль от e-mail, затем подтвердите адрес шестизначным кодом из письма."
                  : "Сессия подтверждения изменилась. Снова введите e-mail и его текущий пароль, затем подтвердите адрес шестизначным кодом из письма."
                : hasEmail
                  ? "E-mail сохранён. Осталось подтвердить его шестизначным кодом из письма."
                  : "Вы вошли через Telegram. Добавьте e-mail и пароль, чтобы не потерять доступ к кабинету, если Telegram станет недоступен."}
          </p>
          <ol className="mb-0 pl-4 line-height-3 text-600">
            {!hasEmail ? <li>Введите e-mail и пароль для входа.</li> : null}
            {hasEmail && !emailVerified && requiresPasswordReauth ? (
              <li>Подтвердите адрес его текущим паролем.</li>
            ) : null}
            {!emailVerified ? <li>Подтвердите адрес кодом из письма.</li> : null}
            <li>
              {returnsToPayment
                ? "После проверки мы вернём вас к выбранной оплате."
                : "После проверки мы вернём вас к прерванному действию."}
            </li>
          </ol>
        </section>
      ) : null}
      {mergeConfirmation ? (
        <section className="account-method-card border-orange-400">
          <Message
            severity="warn"
            text={telegramMergeConfirmationMessage(mergeConfirmation)}
          />
          <div className="account-method-actions mt-3">
            <Button
              label="Объединить аккаунты"
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
          description={
            usesCurrentPassword
              ? "Используется для входа по паролю и восстановления доступа."
              : "Если e-mail уже зарегистрирован, введите текущий пароль. Для нового e-mail придумайте пароль не короче 8 символов."
          }
          icon="pi pi-envelope"
          meta={hasEmail ? <span>{profile?.email}</span> : null}
          pending={hasEmail && !emailVerified}
          title="E-mail"
        >
          {hasEmail && !emailVerified && !requiresPasswordReauth ? (
            <Button
              label="Подтвердить e-mail"
              onClick={() => navigateTo(verificationDestination)}
              outlined
              type="button"
            />
          ) : !hasEmail || guided ? (
            <form className="account-method-form" onSubmit={onSubmit}>
              {!hasEmail ? (
                <>
                  <label className="flex flex-column gap-2">
                    <span className="text-sm font-medium text-700">E-mail</span>
                    <InputText
                      autoComplete="email"
                      maxLength={255}
                      name="email"
                      placeholder="user@example.com"
                      required
                      type="email"
                    />
                  </label>
                  <Message
                    severity="info"
                    text="Для существующего e-mail нужен его текущий пароль. Если адрес новый, этот пароль будет создан после регистрации."
                  />
                </>
              ) : (
                <input name="email" type="hidden" value={profile?.email ?? ""} />
              )}
              <label className="flex flex-column gap-2">
                <span className="text-sm font-medium text-700">
                  {usesCurrentPassword
                    ? "Пароль от e-mail"
                    : "Пароль для входа"}
                </span>
                <Password
                  autoComplete={
                    usesCurrentPassword ? "current-password" : "new-password"
                  }
                  className="w-full"
                  feedback={!usesCurrentPassword}
                  inputClassName="w-full"
                  maxLength={256}
                  minLength={usesCurrentPassword ? 1 : 8}
                  name="password"
                  placeholder="Пароль"
                  required
                  toggleMask
                />
              </label>
              {!hasEmail ? (
                <label className="flex flex-column gap-2">
                  <span className="text-sm font-medium text-700">
                    Повторите пароль
                  </span>
                  <Password
                    autoComplete="new-password"
                    className="w-full"
                    feedback={false}
                    inputClassName="w-full"
                    maxLength={256}
                    minLength={1}
                    name="confirmPassword"
                    placeholder="Повторите пароль"
                    required
                    toggleMask
                  />
                </label>
              ) : null}
              {!hasEmail ? (
                <Message
                  severity="warn"
                  text="Если этот e-mail относится к другому вашему аккаунту, данные будут безопасно объединены. На других устройствах может потребоваться повторный вход; конфликт двух активных подписок решается через поддержку."
                />
              ) : null}
              <Button
                disabled={actionLoading === "email"}
                label={
                  usesCurrentPassword
                    ? "Подтвердить паролем"
                    : "Сохранить e-mail и пароль"
                }
                loading={actionLoading === "email"}
                type="submit"
              />
            </form>
          ) : null}
        </AuthMethodTile>

        {!guided ? (
          <AuthMethodTile
            active={hasTelegram}
            description="Дополнительный вход и восстановление доступа через Telegram."
            icon="pi pi-send"
            meta={hasTelegram ? <span>Telegram ID: {telegramId}</span> : null}
            title="Telegram"
          >
            <div className="account-method-actions-stack">
              {turnstileEnabled ? (
                <TurnstileWidget
                  onReady={setTurnstile}
                  onToken={setTurnstileToken}
                  siteKey={turnstileSiteKey}
                />
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
        ) : null}

        {!guided ? (
          <AuthMethodTile
            active={hasPasskey}
            description={passkeyDescription}
            icon="pi pi-lock"
            meta={
              hasPasskey ? <span>Сохранено ключей: {passkeys.length}</span> : null
            }
            title="Быстрый вход"
          >
            {webAuthnSupported !== false ? (
              <div className="account-method-action-row">
                <Button
                  icon="pi pi-lock"
                  label="Настроить"
                  onClick={() => navigateTo("/passkey/setup")}
                  type="button"
                />
                <Button
                  label="Позже"
                  onClick={() => navigateTo("/cabinet")}
                  outlined
                  severity="secondary"
                  type="button"
                />
              </div>
            ) : webAuthnSupported === false ? (
              <Message
                severity="info"
                text="На этом устройстве нельзя добавить новый ключ. Сохранённые ключи можно удалить ниже."
              />
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
        ) : null}
      </div>
    </div>
  );
}
