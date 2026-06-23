"use client";

import { LoginForm, TelegramLoginButton } from "@/components/auth-forms";
import { AuthShell } from "@/components/layout";
import { LinkButton } from "@/components/prime/link-button";

export default function LoginPage() {
  return (
    <AuthShell
      description="Используйте e-mail и пароль или Telegram-вход."
      footer={
        <>
          <TelegramLoginButton redirectTo="/cabinet" />
          <LinkButton href="/register" label="Создать аккаунт" text />
        </>
      }
      title="Вход"
    >
      <LoginForm />
    </AuthShell>
  );
}
