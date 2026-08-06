"use client";

import { useEffect, useRef, useState } from "react";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import {
  beginPasskeyLoginAction,
  beginPasskeyRegistrationAction,
  verifyPasskeyLoginAction,
  verifyPasskeyRegistrationAction,
} from "@/app/actions/passkeys";
import { navigateTo } from "@/frontend/lib/browser-navigation";

function useWebAuthnSupport() {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupported(browserSupportsWebAuthn());
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  return supported;
}

function isUserCancelled(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return (
    name.includes("notallowed") ||
    name.includes("abort") ||
    message.includes("not allowed") ||
    message.includes("timed out") ||
    message.includes("cancel")
  );
}

function isWebAuthnTransportError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return (
    (name.includes("typeerror") && message.includes("failed to fetch")) ||
    message.includes("bluetooth") ||
    message.includes("networkerror")
  );
}

function isUnavailableCredential(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const name = error.name.toLowerCase();
  const message = error.message.toLowerCase();

  return (
    name.includes("unknownerror") ||
    name.includes("notreadable") ||
    message.includes("credential manager") ||
    message.includes("credential not found") ||
    message.includes("no credentials")
  );
}

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
  const supported = useWebAuthnSupport();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loginPendingRef = useRef(false);

  async function login() {
    if (loginPendingRef.current) {
      return;
    }

    const turnstileToken = turnstileEnabled ? consumeTurnstileToken?.() ?? null : null;
    if (turnstileEnabled && !turnstileToken) {
      setError("Пройдите единую проверку безопасности.");
      return;
    }
    loginPendingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      const optionsResult = await beginPasskeyLoginAction({ email, ...(turnstileToken ? { turnstileToken } : {}) });
      resetTurnstile?.();

      if (!optionsResult.ok) {
        setError(optionsResult.message);
        return;
      }

      const assertion = await startAuthentication({ optionsJSON: optionsResult.options });
      const verifyResult = await verifyPasskeyLoginAction(assertion);

      if (!verifyResult.ok) {
        setError(verifyResult.message);
        return;
      }

      window.location.assign(redirectTo);
    } catch (error) {
      resetTurnstile?.();
      setError(
        isUserCancelled(error)
          ? "Окно быстрого входа закрыто. Можно войти по паролю."
          : isUnavailableCredential(error)
            ? "Сохранённый на устройстве ключ больше не связан с этим стендом. Войдите через e-mail или Telegram и создайте новый ключ в профиле."
          : isWebAuthnTransportError(error)
            ? "Браузер не смог связаться с ключом. Для входа через телефон включите Bluetooth на компьютере и телефоне, затем повторите попытку."
            : "Не удалось войти быстрым способом.",
      );
    } finally {
      loginPendingRef.current = false;
      setLoading(false);
    }
  }

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
  const supported = useWebAuthnSupport();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const setupPendingRef = useRef(false);

  function continueWithoutPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    navigateTo(redirectTo);
  }

  async function createPasskey() {
    if (setupPendingRef.current) {
      return;
    }
    setupPendingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (!browserSupportsWebAuthn()) {
        setError("Это устройство не поддерживает быстрый вход. Продолжите в кабинете или используйте другое устройство.");
        return;
      }

      const optionsResult = await beginPasskeyRegistrationAction();

      if (!optionsResult.ok) {
        setError(optionsResult.message);
        return;
      }

      const attestation = await startRegistration({ optionsJSON: optionsResult.options });
      const verifyResult = await verifyPasskeyRegistrationAction({ ...attestation, name: name.trim() || undefined });

      if (!verifyResult.ok) {
        setError(verifyResult.message);
        return;
      }

      navigateTo(redirectTo);
    } catch (error) {
      setError(
        isUserCancelled(error)
          ? "Окно быстрого входа закрыто. Это не проблема, можно продолжить без него."
          : isWebAuthnTransportError(error)
            ? "Браузер не смог связаться с ключом. Для ключа на телефоне включите Bluetooth на компьютере и телефоне, держите телефон рядом и повторите попытку."
            : error instanceof Error
            ? error.message
            : "Не удалось создать быстрый вход.",
      );
    } finally {
      setupPendingRef.current = false;
      setLoading(false);
    }
  }

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
          Это необязательный способ входа через Face ID, отпечаток или PIN-код устройства.
          Если окно не открылось или вы передумали, просто продолжите в кабинет.
        </div>
      </div>
      {error ? <Message severity="warn" text={error} /> : null}
      <label className="flex flex-column gap-2">
        <span className="text-sm font-medium text-700">Название ключа</span>
        <InputText
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
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
