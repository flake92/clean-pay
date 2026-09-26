import { AuthShell } from "@/frontend/components/auth-shell";
import { RegisterEmailConfirmForm } from "@/frontend/components/register-email-confirm-form";
import { safeAccountSetupDestination } from "@/shared/auth/account-setup-flow";
import { registrationEmailVerificationPath } from "@/shared/auth/account-setup-flow";
import {
  requestSessionHasNoEmailToConfirm,
  requireRequestSession,
} from "@/app/_composition/require-request-session";
import { redirect } from "next/navigation";

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
  const returnTo = registrationEmailVerificationPath(redirectTo, {
    deliveryFailed: rawDelivery === "failed",
  });
  const session = await requireRequestSession(returnTo);
  // A Telegram-linked account with nothing to confirm would only ever see
  // "add an e-mail first" here; return it to where it was going instead.
  if (requestSessionHasNoEmailToConfirm(session)) redirect(redirectTo);

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
