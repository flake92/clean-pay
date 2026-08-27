"use client";

import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";

import { TurnstileWidget } from "@/frontend/components/turnstile-widget";
import { LinkButton } from "@/frontend/components/prime/link-button";
import type { LinkAccountViewModel } from "@/application/models/link-account";
import {
  authMethodStatusLabel,
  authMethodStatusSeverity,
  telegramMergeConfirmationMessage,
} from "@/frontend/components/link-account-presentation";
import { useLinkAccountController } from "@/frontend/hooks/use-link-account-controller";

const defaultLinkAccountModel: LinkAccountViewModel = {
  status: "ready",
  profile: { email: null, emailVerified: false, telegramId: null },
  passkeys: [],
  mergeConfirmation: null,
  callbackError: null,
};

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
        <Tag className="account-method-status" severity={authMethodStatusSeverity(active, pending)} value={authMethodStatusLabel(active, pending)} />
      </div>
      {meta ? <div className="account-method-meta">{meta}</div> : null}
      {children ? <div className="account-method-actions">{children}</div> : null}
    </section>
  );
}

export function LinkAccountPanel({
  guided = false,
  model = defaultLinkAccountModel,
  passwordRequired = false,
  redirectTo = "/cabinet",
  turnstileEnabled = false,
  turnstileSiteKey,
}: {
  guided?: boolean;
  model?: LinkAccountViewModel;
  passwordRequired?: boolean;
  redirectTo?: string;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
}) {
  const {
    actionLoading,
    cancelTelegramMerge,
    confirmTelegramMerge,
    deletePasskey,
    emailVerified,
    error,
    hasEmail,
    hasPasskey,
    hasTelegram,
    loginDestination,
    linkTelegram,
    mergeConfirmation,
    message,
    onSubmit,
    passkeyDescription,
    passkeys,
    profile,
    requiresPasswordReauth,
    returnsToPayment,
    sessionExpired,
    setTurnstile,
    setTurnstileToken,
    setupPasskey,
    skipPasskey,
    telegramId,
    usesCurrentPassword,
    verifyEmail,
    webAuthnSupported,
  } = useLinkAccountController({
    guided,
    model,
    passwordRequired,
    redirectTo,
    turnstileEnabled,
    turnstileSiteKey,
  });

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
            Добавьте резервный вход
          </h2>
          <p className="line-height-3 text-700">
            {requiresPasswordReauth
                ? hasEmail
                  ? emailVerified
                    ? "Сессия подтверждения изменилась. Введите пароль личного кабинета, чтобы безопасно продолжить."
                    : "Сессия подтверждения изменилась. Введите пароль личного кабинета, затем подтвердите адрес шестизначным кодом из письма."
                  : "Сессия подтверждения изменилась. Снова введите e-mail и пароль личного кабинета, затем подтвердите адрес шестизначным кодом из письма."
                : hasEmail
                  ? "E-mail сохранён. Осталось подтвердить его шестизначным кодом из письма."
                  : "Вы вошли через Telegram. Добавьте e-mail и придумайте пароль для личного кабинета, чтобы не потерять доступ, если Telegram станет недоступен."}
          </p>
          <ol className="mb-0 pl-4 line-height-3 text-600">
            {!hasEmail ? <li>Введите e-mail и пароль для входа.</li> : null}
            {hasEmail && requiresPasswordReauth ? (
              <li>Подтвердите вход паролем личного кабинета.</li>
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
              disabled={actionLoading !== null}
              label="Подтвердить e-mail"
              onClick={verifyEmail}
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
                    ? "Пароль личного кабинета"
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
                disabled={actionLoading !== null}
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
                  action="telegram_auth_start"
                  onReady={setTurnstile}
                  onToken={setTurnstileToken}
                  siteKey={turnstileSiteKey}
                />
              ) : null}
              {hasTelegram ? (
                <Button
                  disabled={actionLoading !== null}
                  icon="pi pi-refresh"
                  label="Перепроверить связь Telegram"
                  loading={actionLoading === "telegram"}
                  onClick={linkTelegram}
                  outlined
                  type="button"
                />
              ) : (
                <Button
                  disabled={actionLoading !== null}
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
                  disabled={actionLoading !== null}
                  icon="pi pi-lock"
                  label="Настроить"
                  onClick={setupPasskey}
                  type="button"
                />
                <Button
                  disabled={actionLoading !== null}
                  label="Позже"
                  onClick={skipPasskey}
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
                {passkeys.map((credential, index) => (
                  <div className="passkey-list-item" key={credential.id}>
                    <div className="passkey-list-item__body">
                      <span className="passkey-list-item__name">{credential.name ?? "Ключ доступа"}</span>
                      <span className="passkey-list-item__meta">
                        {credential.lastUsedAt ? `Последний вход: ${new Date(credential.lastUsedAt).toLocaleDateString("ru-RU")}` : "Ещё не использовался"}
                      </span>
                    </div>
                    <Button
                      aria-label={`Удалить ключ ${credential.name ?? "Ключ доступа"} ${index + 1}`}
                      disabled={passkeys.length <= 1 || actionLoading !== null}
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
