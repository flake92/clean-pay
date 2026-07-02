import { TelegramWebAppLogin } from "@/frontend/components/telegram-webapp-login";
import { AuthShell } from "@/frontend/components/layout/auth-shell";

export default function TelegramWebAppLoginPage() {
  return (
    <AuthShell
      title="Вход через Telegram"
      description="Открываем личный кабинет из Telegram."
    >
      <TelegramWebAppLogin />
    </AuthShell>
  );
}
