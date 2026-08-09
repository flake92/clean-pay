import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { VerifyEmailPanel } from "@/frontend/components/verify-email-panel";
import { safeReadiness } from "@/application/auth/execute-email-verification";
import { productionEmailVerificationCommands } from "@/backend/integrations/auth/email-verification";
import {
  resolveEmailVerificationSetup,
} from "@/shared/auth/account-setup-flow";

export const dynamic = "force-dynamic";

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{
    flow?: string | string[];
    redirect_to?: string | string[];
  }>;
}) {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
  const params = await searchParams;
  const { guided, redirectTo } = resolveEmailVerificationSetup(
    firstSearchParam(params.flow),
    firstSearchParam(params.redirect_to),
  );
  const initialReadiness = await safeReadiness(productionEmailVerificationCommands);

  return (
    <AppShell>
      <div className="flex flex-column gap-6">
        <PageHeader
          description={
            guided
              ? "Введите код из письма. После проверки мы автоматически вернём вас к выбранной оплате."
              : "Запросите код и подтвердите e-mail, чтобы разблокировать покупку."
          }
          title="Подтверждение e-mail"
        />
        <VerifyEmailPanel
          autoContinue={guided}
          initialReadiness={initialReadiness}
          redirectTo={redirectTo}
          turnstileEnabled={turnstileEnabled}
          turnstileSiteKey={turnstileSiteKey}
        />
      </div>
    </AppShell>
  );
}
