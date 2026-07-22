import { AuthShell } from "@/frontend/components/layout";
import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";

export const dynamic = "force-dynamic";

export default function RegisterVerifyEmailPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AuthShell
      description="Введите 6 цифр из письма, чтобы завершить регистрацию."
      title="Подтверждение e-mail"
    >
      <RegisterEmailConfirmForm turnstileEnabled={turnstileEnabled} turnstileSiteKey={turnstileSiteKey} />
    </AuthShell>
  );
}
