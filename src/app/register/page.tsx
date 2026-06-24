import { AuthTurnstileProvider, RegisterForm } from "@/components/auth-forms";
import { AuthShell } from "@/components/layout";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled}>
      <AuthShell
        description="Создайте e-mail аккаунт для оплаты и управления подпиской."
        title="Регистрация"
      >
        <RegisterForm />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
