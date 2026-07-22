import { AppShell, PageHeader } from "@/frontend/components/layout";
import { LinkAccountPanel } from "@/frontend/components/link-account-panel";

export const dynamic = "force-dynamic";

export default function LinkAccountPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";
  const turnstileSiteKey = process.env.TURNSTILE_SITE_KEY;

  return (
    <AppShell>
      <div className="flex flex-column gap-4">
        <PageHeader
          description="Управляйте способами входа и восстановления доступа."
          title="Способы входа"
        />
        <LinkAccountPanel turnstileEnabled={turnstileEnabled} turnstileSiteKey={turnstileSiteKey} />
      </div>
    </AppShell>
  );
}
