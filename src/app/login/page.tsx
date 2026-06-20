"use client";

import { AuthShell } from "@/components/layout";
import { LoginForm } from "@/components/auth-forms";
import { LinkButton } from "@/components/prime/link-button";

export default function LoginPage() {
  return (
    <AuthShell
      description="Используйте e-mail и пароль Remnashop или Telegram-вход."
      footer={
        <>
          <LinkButton
            href="/auth/telegram/start?redirect_to=/cabinet"
            icon="pi pi-send"
            label="Войти через Telegram"
            severity="info"
          />
          <LinkButton href="/register" label="Создать аккаунт" text />
        </>
      }
      title="Вход"
    >
      <LoginForm />
    </AuthShell>
  );
}
