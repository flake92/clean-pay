import { passwordToggleA11y } from "@/frontend/components/password-toggle-a11y";
import {
  Button,
  InputText,
  Message,
  Password,
} from "@/frontend/components/sakai/form-foundation";

type LinkAccountEmailFieldsProps = {
  actionLoading: string | null;
  hasEmail: boolean;
  profileEmail?: string | null;
  usesCurrentPassword: boolean;
};

export function LinkAccountEmailFields({
  actionLoading,
  hasEmail,
  profileEmail,
  usesCurrentPassword,
}: LinkAccountEmailFieldsProps) {
  return (
    <>
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
        <input name="email" type="hidden" value={profileEmail ?? ""} />
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
          pt={passwordToggleA11y.primary}
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
            pt={passwordToggleA11y.confirmation}
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
    </>
  );
}
