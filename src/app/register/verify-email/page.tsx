import { AuthShell } from "@/frontend/components/layout";
import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";
import { safeAccountSetupDestination } from "@/shared/auth/account-setup-flow";

export const dynamic = "force-dynamic";

export default async function RegisterVerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    redirect_to?: string | string[];
    delivery?: string | string[];
  }>;
}) {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
  const params = await searchParams;
  const rawRedirect = Array.isArray(params.redirect_to)
    ? params.redirect_to[0]
    : params.redirect_to;
  const redirectTo = safeAccountSetupDestination(rawRedirect);
  const rawDelivery = Array.isArray(params.delivery)
    ? params.delivery[0]
    : params.delivery;

  return (
    <AuthShell
      description="Введите 6 цифр из письма, чтобы завершить регистрацию."
      title="Подтверждение e-mail"
    >
      <RegisterEmailConfirmForm
        redirectTo={redirectTo}
        turnstileEnabled={turnstileEnabled}
        turnstileSiteKey={turnstileSiteKey}
        verificationDeliveryFailed={rawDelivery === "failed"}
      />
    </AuthShell>
  );
}
