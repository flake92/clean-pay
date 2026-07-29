import { AppShell, PageHeader } from "@/frontend/components/layout";
import { VerifyEmailPanel } from "@/frontend/components/verify-email-panel";
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
          redirectTo={redirectTo}
          turnstileEnabled={turnstileEnabled}
          turnstileSiteKey={turnstileSiteKey}
        />
      </div>
    </AppShell>
  );
}
