import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { LinkAccountPanel } from "@/frontend/components/link-account-panel";
import { loadLinkAccount } from "@/application/auth/manage-linked-account";
import { productionLinkAccountReader } from "@/backend/integrations/auth/link-account";
import { productionAuthProfileGateway } from "@/backend/integrations/auth/auth-profile-gateway";
import { productionPasskeyManagementGateway } from "@/backend/integrations/auth/passkey-management-gateway";
import {
  ACCOUNT_SETUP_PASSWORD_STEP,
  ACCOUNT_SETUP_REASON,
  safeAccountSetupDestination,
} from "@/shared/auth/account-setup-flow";

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
  const model = await loadLinkAccount(productionLinkAccountReader, productionAuthProfileGateway, productionPasskeyManagementGateway, firstSearchParam(params.auth) ?? null);

  return (
    <AppShell>
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
