"use client";

import { Card } from "primereact/card";
import { Tag } from "primereact/tag";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { ProfileEmailChangeFields } from "@/frontend/components/profile-email-change-fields";
import { ProfilePasswordChangeFields } from "@/frontend/components/profile-password-change-fields";
import { Message } from "@/frontend/components/sakai/form-foundation";
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
            <ProfileEmailChangeFields
              email={email}
              emailFeedbackRef={emailFeedbackRef}
              emailTurnstileAction={emailTurnstileAction}
              message={message}
              messageSeverity={messageSeverity}
              onEmailChange={changeEmailInput}
              onTurnstileReady={setTurnstile}
              onTurnstileToken={setTurnstileToken}
              pendingAction={pendingAction}
              turnstileEnabled={turnstileEnabled}
              turnstileSiteKey={turnstileSiteKey}
            />
          </form>
        </Card>
      ) : null}

      {canChangePassword ? (
        <Card title="Смена пароля">
          <form className="flex flex-column gap-3" onSubmit={changePassword}>
            <ProfilePasswordChangeFields
              currentPassword={currentPassword}
              newPassword={newPassword}
              onCurrentPasswordChange={changeCurrentPassword}
              onNewPasswordChange={changeNewPassword}
              passwordMessage={passwordMessage}
              passwordMessageSeverity={passwordMessageSeverity}
              pendingAction={pendingAction}
            />
          </form>
        </Card>
      ) : null}
    </div>
  );
}
