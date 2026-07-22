import { AuthTurnstileProvider, LoginForm, TelegramLoginButton } from "@/frontend/components/auth-forms";
import { AuthShell } from "@/frontend/components/layout";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const dynamic = "force-dynamic";

export default async function LoginPage({
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
        description="Введите e-mail. Если аккаунт уже есть, покажем вход по паролю или быстрый вход. Если аккаунта нет, создадим его здесь же."
        footer={<TelegramLoginButton redirectTo={redirectTo} />}
        title="Вход"
      >
        <LoginForm redirectTo={redirectTo} />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
