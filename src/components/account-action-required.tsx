"use client";

import { Message } from "primereact/message";

import { LinkButton } from "@/components/prime/link-button";

type AccountActionRequiredProps = {
  action: "login" | "linkEmail";
  message?: string;
};

export function AccountActionRequired({ action, message }: AccountActionRequiredProps) {
  if (action === "linkEmail") {
    return (
      <div className="flex flex-column gap-4">
        <Message
          severity="warn"
          text="Для оплаты и управления подпиской нужно привязать e-mail к Telegram-аккаунту."
        />
        <LinkButton
          className="w-fit"
          href="/link-account"
          icon="pi pi-link"
          label="Привязать e-mail"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-column gap-4">
      <Message severity="error" text={message ?? "Войдите в аккаунт, чтобы продолжить."} />
      <LinkButton className="w-fit" href="/login" label="Войти" />
    </div>
  );
}
