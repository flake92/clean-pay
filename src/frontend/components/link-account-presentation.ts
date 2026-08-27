import type { TelegramMergeViewModel } from "@/application/models/link-account";
import {
  accountLinkPath,
  emailVerificationPath,
  isPaymentDestination,
} from "@/shared/auth/account-setup-flow";

export function telegramMergeConfirmationMessage(
  confirmation: TelegramMergeViewModel,
) {
  // Preserve compatibility with the former rolling-deployment payload where
  // sourceEmailMasked existed only when the source account had an e-mail.
  const emailWillBeReplaced = confirmation.emailWillBeReplaced
    ?? Boolean(confirmation.sourceEmailMasked);

  if (emailWillBeReplaced) {
    const sourceEmail = confirmation.sourceEmailMasked ?? "другой e-mail";
    return `Этот Telegram принадлежит отдельной учётной записи с e-mail ${sourceEmail}. После объединения ${confirmation.targetEmail} останется основным e-mail для входа, а ${sourceEmail} больше нельзя будет использовать для входа в объединённый аккаунт. Подписки, платежи и остальные данные будут перенесены. Продолжить?`;
  }

  return `Этот Telegram принадлежит отдельной учётной записи. После объединения текущий e-mail ${confirmation.targetEmail} останется без изменений, а подписки, платежи и остальные данные из Telegram-учётной записи будут перенесены. Продолжить?`;
}

export function authMethodStatusSeverity(active: boolean, pending = false) {
  if (active) return "success" as const;
  return pending ? ("warning" as const) : ("secondary" as const);
}

export function authMethodStatusLabel(active: boolean, pending = false) {
  if (active) return "Подключено";
  return pending ? "Нужно подтвердить" : "Не подключено";
}

export function linkAccountDestinations({
  guided,
  passwordRequired,
  redirectTo,
}: {
  guided: boolean;
  passwordRequired: boolean;
  redirectTo: string;
}) {
  const requiresPasswordReauth = guided && passwordRequired;
  const verificationDestination = guided
    ? emailVerificationPath(redirectTo)
    : "/verify-email";
  const setupDestination = guided
    ? accountLinkPath(redirectTo, {
        passwordRequired: requiresPasswordReauth,
      })
    : "/link-account";

  return {
    requiresPasswordReauth,
    returnsToPayment: isPaymentDestination(redirectTo),
    verificationDestination,
    setupDestination,
    loginDestination: `/login?${new URLSearchParams({
      redirect_to: setupDestination,
    }).toString()}`,
  };
}

export function linkAccountPasskeyDescription(
  hasPasskey: boolean,
  webAuthnSupported: boolean | null,
) {
  if (webAuthnSupported === false) {
    return "На этом устройстве быстрый вход недоступен. Можно пользоваться e-mail, паролем или Telegram.";
  }

  return hasPasskey
    ? "Быстрый вход уже настроен для этого аккаунта."
    : "Можно добавить вход по Face ID, отпечатку или PIN-коду устройства.";
}
