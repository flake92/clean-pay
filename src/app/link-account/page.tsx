import { AppShell, PageHeader } from "@/components/layout";
import { LinkAccountPanel } from "@/components/link-account-panel";

export const dynamic = "force-dynamic";

export default function LinkAccountPage() {
  const turnstileEnabled = process.env.TURNSTILE_ENABLED === "true";

  return (
    <AppShell>
      <div className="flex flex-column gap-4">
        <PageHeader
          description="Управляйте способами входа и восстановления доступа."
          title="Способы входа"
        />
        <LinkAccountPanel turnstileEnabled={turnstileEnabled} />
      </div>
    </AppShell>
  );
}
