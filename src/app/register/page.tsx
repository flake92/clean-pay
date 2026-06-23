import { AuthTurnstileProvider, RegisterForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/layout";
import { LinkButton } from "@/components/prime/link-button";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled}>
      <AuthShell
      description="Создайте e-mail аккаунт для оплаты и управления подпиской."
      footer={
        <LinkButton href="/login" label="Уже есть аккаунт" text />
      }
      title="Регистрация"
    >
        <RegisterForm />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
