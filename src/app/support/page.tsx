import { loadSupportViewModel } from "@/backend/application/support/load-support";
import { productionSupportReader } from "@/backend/integrations/support/support-reader";
import { AppShell } from "@/app/_components/app-shell";
import { PageHeader } from "@/frontend/components/layout";
import { SupportPanel } from "@/frontend/components/support-panel";

export default function SupportPage() {
  const support = loadSupportViewModel(productionSupportReader);

  return (
    <AppShell>
      <div className="grid max-w-4xl gap-6">
        <PageHeader
          description="Контакты поддержки пока не опубликованы."
          title="Поддержка"
        />
        <SupportPanel support={support} />
      </div>
    </AppShell>
  );
}
