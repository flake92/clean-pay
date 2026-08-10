import { AuthTurnstileProvider, LoginForm, TelegramLoginButton } from "@/frontend/components/auth-forms";
import { AuthShell } from "@/frontend/components/layout";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export const dynamic = "force-dynamic";

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function loginError(auth: string | undefined) {
  return auth === "telegram_failed"
    ? "Не удалось завершить вход через Telegram. Повторите попытку или войдите по e-mail."
    : null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    auth?: string | string[];
    redirect_to?: string | string[];
  }>;
}) {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
  const params = await searchParams;
  const rawRedirect = firstSearchParam(params.redirect_to);
  const redirectTo = safeRedirectPath(rawRedirect) ?? "/cabinet";
  const initialError = loginError(firstSearchParam(params.auth));

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled} siteKey={turnstileSiteKey}>
      <AuthShell
        description="Введите e-mail. Если аккаунт уже есть, покажем вход по паролю или быстрый вход. Если аккаунта нет, создадим его."
        footer={<TelegramLoginButton redirectTo={redirectTo} />}
        title="Вход"
      >
        <LoginForm initialError={initialError} redirectTo={redirectTo} />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
