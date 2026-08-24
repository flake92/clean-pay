import { AuthShell } from "@/frontend/components/auth-shell";
import { getBranding } from "@/shared/branding";

export default function OfflinePage() {
  const branding = getBranding();

  return (
    <AuthShell
      title="Нет подключения"
      description={`Проверьте интернет-соединение и откройте ${branding.name} снова.`}
    >
      <p className="m-0 text-center text-600 line-height-3">
        Для работы с подпиской и платежами требуется подключение к интернету.
      </p>
    </AuthShell>
  );
}
