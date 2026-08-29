"use client";

import { Message } from "primereact/message";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { useAccountActionRequiredController } from "@/frontend/hooks/use-account-action-required-controller";
import {
  accountLinkPath,
  safeAccountSetupDestination,
} from "@/shared/auth/account-setup-flow";
import {
  providerSessionRecoveryPath,
  sessionRefreshPath,
} from "@/shared/auth/session-navigation";

type AccountActionRequiredProps = {
  action: "login" | "recover-session" | "linkEmail";
  message?: string;
  redirectTo?: string;
};

export function AccountActionRequired({
  action,
  message,
  redirectTo = "/cabinet",
}: AccountActionRequiredProps) {
  const destination = safeAccountSetupDestination(redirectTo);
  const linkEmailHref = accountLinkPath(destination);
  const recoveryHref = providerSessionRecoveryPath(destination);

  useAccountActionRequiredController({
    action,
    linkEmailHref,
    recoveryHref,
  });

  if (action === "linkEmail") {
    return (
      <div className="flex flex-column gap-4">
        <Message
          severity="warn"
          text="Чтобы продолжить, добавьте e-mail и пароль, затем подтвердите адрес кодом из письма. Перенаправляем на настройку резервного входа."
        />
        <LinkButton
          className="w-fit"
          href={linkEmailHref}
          icon="pi pi-link"
          label="Добавить e-mail и пароль"
        />
      </div>
    );
  }

  if (action === "recover-session") {
    return (
      <div className="flex flex-column gap-4">
        <Message severity="info" text="Восстанавливаем защищённую сессию." />
        <LinkButton className="w-fit" href={recoveryHref} label="Продолжить" />
      </div>
    );
  }

  const loginHref = sessionRefreshPath(destination);

  return (
    <div className="flex flex-column gap-4">
      <Message severity="error" text={message ?? "Войдите в аккаунт, чтобы продолжить."} />
      <LinkButton className="w-fit" href={loginHref} label="Войти" />
    </div>
  );
}
