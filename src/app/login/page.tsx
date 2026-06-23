import { AuthTurnstileProvider, LoginForm, TelegramLoginButton } from "@/components/auth-forms";
import { AuthShell } from "@/components/layout";
import { LinkButton } from "@/components/prime/link-button";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AuthTurnstileProvider enabled={turnstileEnabled}>
      <AuthShell
      description="Используйте e-mail и пароль или Telegram-вход."
      footer={
        <>
          <TelegramLoginButton redirectTo="/cabinet" />
          <LinkButton href="/register" label="Создать аккаунт" text />
        </>
      }
      title="Вход"
    >
        <LoginForm />
      </AuthShell>
    </AuthTurnstileProvider>
  );
}
