import { AppShell, PageHeader } from "@/components/layout";
import { SupportPanel } from "@/components/support-panel";

export default function SupportPage() {
  return (
    <AppShell>
      <div className="grid max-w-4xl gap-6">
        <PageHeader
          description="Контакты, быстрые действия и краткая инструкция для подключения VPN через web-кабинет."
          title="Поддержка"
        />
        <SupportPanel />
      </div>
    </AppShell>
  );
}
