"use client";

import { Button } from "primereact/button";
import { Card } from "primereact/card";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";
import { Password } from "primereact/password";
import { Tag } from "primereact/tag";

import { passwordToggleA11y } from "@/frontend/components/password-toggle-a11y";
import { LinkButton } from "@/frontend/components/prime/link-button";
import { TurnstileWidget } from "@/frontend/components/turnstile-widget";
import type { ProfileViewModel } from "@/application/models/profile";
import {
  profileAuthTypeLabel,
  profileReminderDaysLabel,
} from "@/frontend/components/profile-presentation";
import { useProfileController } from "@/frontend/hooks/use-profile-controller";

type ProfilePanelProps = {
  model: ProfileViewModel;
  turnstileEnabled?: boolean;
  turnstileSiteKey?: string | null;
};

export function ProfilePanel(props: ProfilePanelProps) {
  // Keep local form state across ordinary renders, but remount it when a soft
  // RSC refresh supplies a genuinely different server snapshot.
  return <ProfilePanelContent key={JSON.stringify(props.model)} {...props} />;
}

function ProfilePanelContent({
  model,
  turnstileEnabled = false,
  turnstileSiteKey,
}: ProfilePanelProps) {
  const {
    changeCurrentPassword,
    changeEmail,
    changeEmailInput,
    changeEmailReminders,
    changeNewPassword,
    changePassword,
    currentPassword,
    email,
    emailFeedbackRef,
    emailReminderMessage,
    emailReminderSeverity,
    emailReminders,
    emailTurnstileAction,
    message,
    messageSeverity,
    newPassword,
    passwordMessage,
    passwordMessageSeverity,
    pendingAction,
    presentation,
    setTurnstile,
    setTurnstileToken,
    user,
  } = useProfileController({
    model,
    turnstileEnabled,
    turnstileSiteKey,
  });

  if (presentation.kind === "error") {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="error" text={presentation.message} />
        <LinkButton className="w-fit" href="/profile" label="Повторить" />
      </div>
    );
  }

  if (presentation.kind !== "ready" || !user) return null;
  const telegramId = user.telegramId;
  const {
    canChangePassword,
    canManageRemnashopEmail,
    hasEmail,
    isEmailVerified,
    isTelegramOnly,
  } = presentation;
  return (
    <div className="clean-profile-panel flex flex-column gap-4">
      <Card title="Данные аккаунта">
        <div className="grid">
          {[
            ["E-mail", user.email ?? "Не привязан"],
            ["Тип входа", profileAuthTypeLabel(user.authType)],
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

      <Card title="Напоминания об окончании подписки">
        {emailReminders ? (
          <div className="flex flex-column gap-3">
            <p className="m-0 line-height-3 text-600">
              При включённой настройке мы отправим письма{
              " "
              }{profileReminderDaysLabel(emailReminders.daysBefore)} до окончания подписки на
              подтверждённый адрес <strong>{user.email ?? "из профиля"}</strong>. Письма не
              запускают оплату и не включают автопродление.
            </p>
            {emailReminderMessage ? (
              <Message severity={emailReminderSeverity} text={emailReminderMessage} />
            ) : null}
            <label className="flex align-items-center gap-3" htmlFor="email-expiration-reminders">
              <input
                aria-describedby="email-expiration-reminders-help"
                checked={emailReminders.enabled}
                disabled={
                  pendingAction !== null
                  || (
                    !emailReminders.enabled
                    && !emailReminders.emailEligible
                  )
                }
                id="email-expiration-reminders"
                onChange={changeEmailReminders}
                role="switch"
                type="checkbox"
              />
              <span className="font-medium">Получать напоминания по e-mail</span>
            </label>
            {!emailReminders.emailEligible ? (
              <Message
                severity="warn"
                text="Remnashop сейчас не разрешает включить напоминания. Проверьте подтверждение e-mail или попробуйте позже; уже сохранённую настройку можно отключить."
              />
            ) : null}
            <p className="m-0 line-height-3 text-sm text-600" id="email-expiration-reminders-help">
              Если письмо попадёт в папку «Спам», отметьте его как «Не спам» и добавьте{
              " "
              }{emailReminders.senderEmail ? <code>{emailReminders.senderEmail}</code> : "адрес отправителя"}{
              " "
              }в контакты или белый список. Так следующие напоминания с большей вероятностью
              попадут во «Входящие».
            </p>
          </div>
        ) : (
          <Message
            severity="warn"
            text="Настройки e-mail-напоминаний временно недоступны. Их текущее состояние не изменено."
          />
        )}
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
            {message ? (
              <div aria-live="assertive" ref={emailFeedbackRef} tabIndex={-1}>
                <Message severity={messageSeverity} text={message} />
              </div>
            ) : null}
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
                autoComplete="email"
                maxLength={255}
                name="email"
                onChange={changeEmailInput}
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
                autoComplete="current-password"
                className="w-full"
                feedback={false}
                inputClassName="w-full"
                maxLength={256}
                name="currentPassword"
                onChange={changeCurrentPassword}
                pt={passwordToggleA11y.current}
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
                onChange={changeNewPassword}
                pt={passwordToggleA11y.next}
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
