"use client";

import { AuthShell } from "@/components/layout";
import { RegisterForm } from "@/components/auth-forms";
import { LinkButton } from "@/components/prime/link-button";

export default function RegisterPage() {
  return (
    <AuthShell
      description="Создайте e-mail аккаунт для оплаты и управления подпиской."
      footer={
        <LinkButton href="/login" label="Уже есть аккаунт" text />
      }
      title="Регистрация"
    >
      <RegisterForm />
    </AuthShell>
  );
}
