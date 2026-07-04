"use client";

import { useEffect, useState } from "react";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Message } from "primereact/message";

import { readBffError } from "@/frontend/lib/client-api";

async function readError(response: Response, fallback: string) {
  return (await readBffError(response, fallback)).message;
}

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

export function PasskeyLoginButton() {
  const supported = useWebAuthnSupport();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function login() {
    setLoading(true);
    setError(null);

    try {
      const optionsResponse = await fetch("/api/bff/auth/passkey/login/options", { method: "POST" });

      if (!optionsResponse.ok) {
        setError(await readError(optionsResponse, "Не удалось начать быстрый вход."));
        return;
      }

      const optionsBody = await optionsResponse.json();
      const assertion = await startAuthentication({ optionsJSON: optionsBody.data });
      const verifyResponse = await fetch("/api/bff/auth/passkey/login/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });

      if (!verifyResponse.ok) {
        setError(await readError(verifyResponse, "Быстрый вход не подошел. Войдите по паролю."));
        return;
      }

      window.location.assign("/cabinet");
    } catch (error) {
      setError(
        isUserCancelled(error)
          ? "Окно быстрого входа закрыто. Можно войти по паролю."
          : error instanceof Error
            ? error.message
            : "Не удалось войти быстрым способом.",
      );
    } finally {
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

export function PasskeySetupPanel() {
  const supported = useWebAuthnSupport();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");

  function continueToCabinet() {
    window.location.assign("/cabinet");
  }

  async function createPasskey() {
    setLoading(true);
    setError(null);

    try {
      if (!browserSupportsWebAuthn()) {
        setError("Это устройство не поддерживает быстрый вход. Продолжите в кабинете или используйте другое устройство.");
        return;
      }

      const optionsResponse = await fetch("/api/bff/auth/passkey/register/options", { method: "POST" });

      if (!optionsResponse.ok) {
        setError(await readError(optionsResponse, "Не удалось подготовить быстрый вход."));
        return;
      }

      const optionsBody = await optionsResponse.json();
      const attestation = await startRegistration({ optionsJSON: optionsBody.data });
      const verifyResponse = await fetch("/api/bff/auth/passkey/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...attestation, name: name.trim() || undefined }),
      });

      if (!verifyResponse.ok) {
        setError(await readError(verifyResponse, "Не удалось сохранить быстрый вход."));
        return;
      }

      window.location.assign("/cabinet");
    } catch (error) {
      setError(
        isUserCancelled(error)
          ? "Окно быстрого входа закрыто. Это не проблема, можно продолжить без него."
          : error instanceof Error
            ? error.message
            : "Не удалось создать быстрый вход.",
      );
    } finally {
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
        <Button label="Продолжить в кабинет" onClick={continueToCabinet} type="button" />
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
          onClick={continueToCabinet}
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
