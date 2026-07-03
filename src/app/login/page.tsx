import { AuthTurnstileProvider, LoginForm, TelegramLoginButton } from "@/frontend/components/auth-forms";
import { AuthShell } from "@/frontend/components/layout";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled} siteKey={turnstileSiteKey}>
      <AuthShell
        description="Введите e-mail. Если аккаунт уже есть, покажем вход по паролю или быстрый вход. Если аккаунта нет, создадим его здесь же."
        footer={<TelegramLoginButton redirectTo="/cabinet" />}
        title="Вход"
      >
        <LoginForm />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
