import { AuthShell } from "@/components/layout";
import { RegisterEmailConfirmForm } from "@/components/register-email-confirm-form";

export const dynamic = "force-dynamic";

export default function RegisterVerifyEmailPage() {
  return (
    <AuthShell
      description="Введите 6 цифр из письма, чтобы завершить регистрацию."
      title="Подтверждение e-mail"
    >
      <RegisterEmailConfirmForm />
    </AuthShell>
  );
}
