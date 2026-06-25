import { AuthShell } from "@/frontend/components/layout";
import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";

export const dynamic = "force-dynamic";

export default function RegisterVerifyEmailPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AuthShell
      description="Введите 6 цифр из письма, чтобы завершить регистрацию."
      title="Подтверждение e-mail"
    >
      <RegisterEmailConfirmForm turnstileEnabled={turnstileEnabled} />
    </AuthShell>
  );
}
