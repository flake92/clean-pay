import { AuthShell } from "@/frontend/components/layout";
import { PasskeySetupPanel } from "@/frontend/components/passkey-actions";
import {
  isPaymentDestination,
  safeAccountSetupDestination,
} from "@/shared/auth/account-setup-flow";

export const dynamic = "force-dynamic";

export default async function PasskeySetupPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_to?: string | string[] }>;
}) {
  const params = await searchParams;
  const rawRedirect = Array.isArray(params.redirect_to)
    ? params.redirect_to[0]
    : params.redirect_to;
  const redirectTo = safeAccountSetupDestination(rawRedirect);

  return (
    <AuthShell
      description={
        isPaymentDestination(redirectTo)
          ? "Можно настроить вход по Face ID, отпечатку или PIN-коду. После этого вернёмся к оплате; настройку также можно пропустить."
          : "Можно настроить вход по Face ID, отпечатку или PIN-коду. Это удобно, но не обязательно."
      }
      title="Быстрый вход"
    >
      <PasskeySetupPanel redirectTo={redirectTo} />
    </AuthShell>
  );
}
