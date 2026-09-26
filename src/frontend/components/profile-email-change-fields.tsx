import type { ChangeEventHandler, Ref } from "react";

import {
  Button,
  InputText,
  Message,
} from "@/frontend/components/sakai/form-foundation";
import type {
  ProfileMessageSeverity,
  ProfileTurnstileHandle,
} from "@/frontend/components/profile-transitions";
import { TurnstileWidget } from "@/frontend/components/turnstile-widget";

type ProfileEmailChangeFieldsProps = {
  email: string;
  emailFeedbackRef: Ref<HTMLDivElement>;
  emailTurnstileAction: string;
  message: string | null;
  messageSeverity: ProfileMessageSeverity;
  onEmailChange: ChangeEventHandler<HTMLInputElement>;
  onTurnstileReady: (turnstile: ProfileTurnstileHandle) => void;
  onTurnstileToken: (token: string | null) => void;
  pendingAction: string | null;
  turnstileEnabled: boolean;
  turnstileSiteKey?: string | null;
};

export function ProfileEmailChangeFields({
  email,
  emailFeedbackRef,
  emailTurnstileAction,
  message,
  messageSeverity,
  onEmailChange,
  onTurnstileReady,
  onTurnstileToken,
  pendingAction,
  turnstileEnabled,
  turnstileSiteKey,
}: ProfileEmailChangeFieldsProps) {
  return (
    <>
      {message ? (
        <div aria-live="assertive" ref={emailFeedbackRef} tabIndex={-1}>
          <Message severity={messageSeverity} text={message} />
        </div>
      ) : null}
      {turnstileEnabled ? (
        <TurnstileWidget
          action={emailTurnstileAction}
          key={emailTurnstileAction}
          onReady={onTurnstileReady}
          onToken={onTurnstileToken}
          siteKey={turnstileSiteKey}
        />
      ) : null}
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Новый e-mail</span>
        <InputText
          autoComplete="email"
          maxLength={255}
          name="email"
          onChange={onEmailChange}
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
    </>
  );
}
