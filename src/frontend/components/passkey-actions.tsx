"use client";

import {
  Button,
  InputText,
  Message,
} from "@/frontend/components/sakai/form-foundation";

import {
  usePasskeyLoginController,
  usePasskeySetupController,
} from "@/frontend/hooks/use-passkey-actions-controller";

export function PasskeyLoginButton({
  consumeTurnstileToken,
  email,
  redirectTo = "/cabinet",
  resetTurnstile,
  turnstileEnabled = false,
}: {
  consumeTurnstileToken?: () => string | null;
  email: string;
  redirectTo?: string;
  resetTurnstile?: () => void;
  turnstileEnabled?: boolean;
}) {
  const { error, loading, login, supported } = usePasskeyLoginController({
    consumeTurnstileToken,
    email,
    redirectTo,
    resetTurnstile,
    turnstileEnabled,
  });

  if (supported !== true) {
    return null;
  }

  return (
    <div className="flex flex-column gap-2 surface-50 border-1 surface-border border-round p-3">
      <div className="flex align-items-center gap-2">
        <i className="pi pi-bolt text-primary" />
        <div className="font-medium text-900">Быстрый вход доступен</div>
      </div>
      <div className="text-sm text-600 line-height-3">
        Можно войти через Face ID, отпечаток или PIN-код устройства.
      </div>
      <div className="text-xs text-500 line-height-3">
        Passkey восстанавливает вход на этом устройстве. Перед оплатой или управлением подпиской система при необходимости запросит подтверждение через e-mail либо Telegram.
      </div>
      {error ? <Message severity="warn" text={error} /> : null}
      <Button
        className="w-full"
        disabled={loading}
        icon="pi pi-lock"
        label="Войти быстро"
        loading={loading}
        onClick={login}
        outlined
        severity="secondary"
        type="button"
      />
    </div>
  );
}

export function PasskeySetupPanel({
  redirectTo = "/cabinet",
}: {
  redirectTo?: string;
}) {
  const {
    changeName,
    continueWithoutPasskey,
    createPasskey,
    error,
    loading,
    name,
    supported,
  } = usePasskeySetupController({ redirectTo });

  if (supported === false) {
    return (
      <div className="flex flex-column gap-3">
        <Message
          severity="info"
          text="Это устройство не поддерживает быстрый вход. Вы можете пользоваться кабинетом через e-mail, пароль или Telegram."
        />
        <Button
          label="Продолжить без быстрого входа"
          onClick={continueWithoutPasskey}
          type="button"
        />
        {error ? <Message severity="warn" text={error} /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-column gap-3">
      <div className="surface-50 border-1 surface-border border-round p-3">
        <div className="flex align-items-center gap-2 mb-2">
          <i className="pi pi-lock text-primary" />
          <div className="font-medium text-900">Быстрый вход</div>
        </div>
        <div className="text-sm text-600 line-height-3">
          Это необязательный способ входа через Face ID, отпечаток или PIN-код устройства. Если окно не открылось или вы передумали, просто продолжите в кабинет.
        </div>
      </div>
      {error ? <Message severity="warn" text={error} /> : null}
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Название ключа</span>
        <InputText
          maxLength={80}
          onChange={changeName}
          placeholder="Например: Android Chrome или ноутбук"
          value={name}
        />
      </label>
      <div className="flex flex-column sm:flex-row gap-2">
        <Button
          disabled={loading}
          icon="pi pi-lock"
          label="Настроить быстрый вход"
          loading={loading}
          onClick={createPasskey}
          type="button"
        />
        <Button
          disabled={loading}
          label="Продолжить без него"
          onClick={continueWithoutPasskey}
          outlined
          severity="secondary"
          type="button"
        />
      </div>
      <Message
        severity="info"
        text="Быстрый вход можно настроить позже в профиле."
      />
    </div>
  );
}
