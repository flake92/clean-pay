import { AuthShell } from "@/frontend/components/layout/auth-shell";

export default function OfflinePage() {
  return (
    <AuthShell
      title="Нет подключения"
      description="Проверьте интернет-соединение и откройте Clean Pay снова."
    >
      <p className="m-0 text-center text-600 line-height-3">
        Для работы с подпиской и платежами требуется подключение к интернету.
      </p>
    </AuthShell>
  );
}
