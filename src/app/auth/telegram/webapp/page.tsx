import { TelegramWebAppLogin } from "@/frontend/components/telegram-webapp-login";
import { AuthShell } from "@/frontend/components/layout/auth-shell";
import { safeRedirectPath } from "@/shared/auth/redirect-policy";

export default async function TelegramWebAppLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawRedirect = Array.isArray(params.redirect_to)
    ? params.redirect_to[0]
    : params.redirect_to;
  const redirectTo = safeRedirectPath(rawRedirect) ?? "/cabinet";

  return (
    <AuthShell
      title="Вход через Telegram"
      description="Открываем личный кабинет из Telegram."
    >
      <TelegramWebAppLogin redirectTo={redirectTo} />
    </AuthShell>
  );
}
