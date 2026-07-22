import { AppShell, PageHeader } from "@/frontend/components/layout";
import { SupportPanel } from "@/frontend/components/support-panel";

export default function SupportPage() {
  return (
    <AppShell>
      <div className="grid max-w-4xl gap-6">
        <PageHeader
          description="Контакты поддержки пока не опубликованы."
          title="Поддержка"
        />
        <SupportPanel />
      </div>
    </AppShell>
  );
}
