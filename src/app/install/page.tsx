import { InstallAppButton } from "@/frontend/components/install-app-button";
import { AuthShell } from "@/frontend/components/layout/auth-shell";

export default function InstallPage() {
  return (
    <AuthShell
      title="Установить Clean Pay"
      description="Добавьте кабинет на главный экран с названием и логотипом Clean Pay."
    >
      <div className="flex flex-column gap-3 align-items-center text-center">
        <p className="m-0 text-600 line-height-3">
          На Android нажмите кнопку ниже и подтвердите установку. На iPhone откройте меню «Поделиться» и выберите «На экран Домой».
        </p>
        <InstallAppButton alwaysVisible />
      </div>
    </AuthShell>
  );
}
