"use client";

import { useEffect } from "react";

import { Message } from "primereact/message";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { replaceWith } from "@/frontend/lib/browser-navigation";
import {
  accountLinkPath,
  safeAccountSetupDestination,
} from "@/shared/auth/account-setup-flow";

type AccountActionRequiredProps = {
  action: "login" | "linkEmail";
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

  useEffect(() => {
    if (action === "linkEmail") {
      replaceWith(linkEmailHref);
    }
  }, [action, linkEmailHref]);

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

  const loginHref = `/login?${new URLSearchParams({
    redirect_to: destination,
  }).toString()}`;

  return (
    <div className="flex flex-column gap-4">
      <Message severity="error" text={message ?? "Войдите в аккаунт, чтобы продолжить."} />
      <LinkButton className="w-fit" href={loginHref} label="Войти" />
    </div>
  );
}
