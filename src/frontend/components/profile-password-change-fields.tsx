import type { ChangeEventHandler } from "react";

import { passwordToggleA11y } from "@/frontend/components/password-toggle-a11y";
import type { ProfileFormMessageSeverity } from "@/frontend/components/profile-transitions";
import {
  Button,
  Message,
  Password,
} from "@/frontend/components/sakai/form-foundation";

type ProfilePasswordChangeFieldsProps = {
  currentPassword: string;
  newPassword: string;
  onCurrentPasswordChange: ChangeEventHandler<HTMLInputElement>;
  onNewPasswordChange: ChangeEventHandler<HTMLInputElement>;
  passwordMessage: string | null;
  passwordMessageSeverity: ProfileFormMessageSeverity;
  pendingAction: string | null;
};

export function ProfilePasswordChangeFields({
  currentPassword,
  newPassword,
  onCurrentPasswordChange,
  onNewPasswordChange,
  passwordMessage,
  passwordMessageSeverity,
  pendingAction,
}: ProfilePasswordChangeFieldsProps) {
  return (
    <>
      {passwordMessage ? (
        <Message severity={passwordMessageSeverity} text={passwordMessage} />
      ) : null}
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Текущий пароль</span>
        <Password
          autoComplete="current-password"
          className="w-full"
          feedback={false}
          inputClassName="w-full"
          maxLength={256}
          name="currentPassword"
          onChange={onCurrentPasswordChange}
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
          onChange={onNewPasswordChange}
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
    </>
  );
}
