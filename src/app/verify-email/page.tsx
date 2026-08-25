import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import { VerifyEmailPanel } from "@/frontend/components/verify-email-panel";
import { safeReadiness } from "@/application/auth/execute-email-verification";
import { requestAuthProfileGateway } from "@/app/_composition/request-scoped-readers";
import {
  emailVerificationPath,
  resolveEmailVerificationSetup,
} from "@/shared/auth/account-setup-flow";
import {
  providerSessionRecoveryPath,
  sessionRefreshPath,
} from "@/shared/auth/session-navigation";
import { redirect } from "next/navigation";

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
  const verifyEmailReturnTo = guided
    ? emailVerificationPath(redirectTo)
    : "/verify-email";
  const initialReadiness = await safeReadiness(requestAuthProfileGateway);
  if (initialReadiness.status === "unauthorized") {
    redirect(sessionRefreshPath(verifyEmailReturnTo));
  }
  if (initialReadiness.status === "provider-session-recovery-required") {
    redirect(providerSessionRecoveryPath(verifyEmailReturnTo));
  }

  return (
    <AppShell requireAuth returnTo={verifyEmailReturnTo}>
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
