import { InstallAppButton } from "@/frontend/components/install-app-button";
import { AuthShell } from "@/frontend/components/auth-shell";
import { getBranding } from "@/shared/branding";

export default function InstallPage() {
  const branding = getBranding();

  return (
    <AuthShell
      title={`Установить ${branding.name}`}
      description={`Добавьте кабинет на главный экран с названием и логотипом ${branding.name}.`}
    >
      <div className="flex flex-column gap-3 align-items-center text-center">
        <p className="m-0 text-600 line-height-3">
          На Android нажмите кнопку ниже и подтвердите установку. На iPhone подробная инструкция откроется автоматически и покажет все действия в Safari.
        </p>
        <InstallAppButton alwaysVisible />
      </div>
    </AuthShell>
  );
}
