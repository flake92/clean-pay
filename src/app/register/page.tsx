import { AuthTurnstileProvider, LoginForm } from "@/frontend/components/auth-forms";
import { AuthShell } from "@/frontend/components/layout";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string | string[] }>;
}) {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
  const params = await searchParams;
  const rawRedirect = Array.isArray(params.redirect_to)
    ? params.redirect_to[0]
    : params.redirect_to;
  const redirectTo = safeRedirectPath(rawRedirect) ?? "/cabinet";

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled} siteKey={turnstileSiteKey}>
      <AuthShell
        description="Создайте e-mail аккаунт для оплаты и управления подпиской."
        title="Регистрация"
      >
        <LoginForm redirectTo={redirectTo} />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
