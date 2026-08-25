import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/page-header";
import { LinkAccountPanel } from "@/frontend/components/link-account-panel";
import { loadLinkAccount } from "@/application/auth/manage-linked-account";
import {
  requestAuthProfileGateway,
  requestLinkAccountReader,
  requestPasskeyManagementGateway,
} from "@/app/_composition/request-scoped-readers";
import {
  ACCOUNT_SETUP_PASSWORD_STEP,
  ACCOUNT_SETUP_REASON,
  safeAccountSetupDestination,
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

export default async function LinkAccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    reason?: string | string[];
    auth?: string | string[];
    redirect_to?: string | string[];
    step?: string | string[];
  }>;
}) {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;
  const params = await searchParams;
  const guided = firstSearchParam(params.reason) === ACCOUNT_SETUP_REASON;
  const passwordRequired =
    guided &&
    firstSearchParam(params.step) === ACCOUNT_SETUP_PASSWORD_STEP;
  const redirectTo = safeAccountSetupDestination(
    firstSearchParam(params.redirect_to),
  );
  const authStatus = firstSearchParam(params.auth) ?? null;
  const returnParams = new URLSearchParams();
  if (guided) returnParams.set("reason", ACCOUNT_SETUP_REASON);
  if (passwordRequired) returnParams.set("step", ACCOUNT_SETUP_PASSWORD_STEP);
  if (params.redirect_to !== undefined || guided) {
    returnParams.set("redirect_to", redirectTo);
  }
  if (authStatus && authStatus.length <= 100) returnParams.set("auth", authStatus);
  const linkAccountReturnTo = `/link-account${returnParams.size ? `?${returnParams}` : ""}`;
  const model = await loadLinkAccount(
    requestLinkAccountReader,
    requestAuthProfileGateway,
    requestPasskeyManagementGateway,
    authStatus,
  );
  if (model.status === "unauthorized") {
    redirect(sessionRefreshPath(linkAccountReturnTo));
  }
  if (model.status === "provider-session-recovery-required") {
    redirect(providerSessionRecoveryPath(linkAccountReturnTo));
  }

  return (
    <AppShell requireAuth returnTo={linkAccountReturnTo}>
      <div className="flex flex-column gap-4">
        <PageHeader
          description={
            guided
              ? "Добавьте резервный вход, подтвердите e-mail и вернитесь к прерванному действию."
              : "Управляйте способами входа и восстановления доступа."
          }
          title={guided ? "Сохраните доступ к аккаунту" : "Способы входа"}
        />
        <LinkAccountPanel
          guided={guided}
          model={model}
          passwordRequired={passwordRequired}
          redirectTo={redirectTo}
          turnstileEnabled={turnstileEnabled}
          turnstileSiteKey={turnstileSiteKey}
        />
      </div>
    </AppShell>
  );
}
