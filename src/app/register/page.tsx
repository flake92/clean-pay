import { AuthTurnstileProvider, RegisterForm } from "@/frontend/components/auth-forms";
import { AuthShell } from "@/frontend/components/layout";

export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled} siteKey={turnstileSiteKey}>
      <AuthShell
        description="Создайте e-mail аккаунт для оплаты и управления подпиской."
        title="Регистрация"
      >
        <RegisterForm />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
