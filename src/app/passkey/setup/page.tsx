import { AuthShell } from "@/frontend/components/layout";
import { PasskeySetupPanel } from "@/frontend/components/passkey-actions";

export const dynamic = "force-dynamic";

export default function PasskeySetupPage() {
  return (
    <AuthShell
      description="Можно настроить вход по Face ID, отпечатку или PIN-коду. Это удобно, но не обязательно."
      title="Быстрый вход"
    >
      <PasskeySetupPanel />
    </AuthShell>
  );
}
