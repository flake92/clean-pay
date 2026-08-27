import type {
  AccountReadiness,
  EmailVerificationResult,
} from "@/application/models/email-verification";

export type VerificationMessageSeverity = "success" | "warn";
export type VerificationSyncProblem =
  | "merge-conflict"
  | "unauthorized"
  | null;

export type VerificationViewState =
  | {
      kind: "confirmed";
      accountSyncPending: boolean;
      syncProblem: VerificationSyncProblem;
      message: string | null;
      messageSeverity: VerificationMessageSeverity;
    }
  | {
      kind: "entry";
      error: string | null;
      message: string | null;
      messageSeverity: VerificationMessageSeverity;
    };

export function selectVerificationViewState(input: {
  confirmed: boolean;
  accountSyncPending: boolean;
  syncProblem: VerificationSyncProblem;
  error: string | null;
  message: string | null;
  messageSeverity: VerificationMessageSeverity;
}): VerificationViewState {
  return input.confirmed
    ? {
        kind: "confirmed",
        accountSyncPending: input.accountSyncPending,
        syncProblem: input.syncProblem,
        message: input.message,
        messageSeverity: input.messageSeverity,
      }
    : {
        kind: "entry",
        error: input.error,
        message: input.message,
        messageSeverity: input.messageSeverity,
      };
}

export type InitialVerificationTransition =
  | { kind: "unchanged" }
  | {
      kind: "present";
      confirmed: true;
      accountSyncPending: boolean;
      syncProblemUpdate:
        | { kind: "set"; value: "merge-conflict" | "unauthorized" | null }
        | { kind: "preserve" };
      severity: "success" | "warn";
      message: string;
      continueToCompletedDestination: boolean;
    };

export function initialVerificationTransition(
  readiness: AccountReadiness,
  autoContinue: boolean,
): InitialVerificationTransition {
  if (readiness.status === "ready") {
    return {
      kind: "present",
      confirmed: true,
      accountSyncPending: false,
      syncProblemUpdate: { kind: "set", value: null },
      severity: "success",
      message: autoContinue
        ? "E-mail подтверждён. Возвращаем вас к прерванному действию."
        : "Ваш e-mail подтверждён.",
      continueToCompletedDestination: autoContinue,
    };
  }

  if (
    autoContinue &&
    readiness.status === "pending" &&
    readiness.emailVerified
  ) {
    return {
      kind: "present",
      confirmed: true,
      accountSyncPending: true,
      syncProblemUpdate: { kind: "preserve" },
      severity: "warn",
      message: "E-mail подтверждён. Синхронизация с Telegram ещё продолжается; оплату пока не создаём. Проверьте готовность ещё раз.",
      continueToCompletedDestination: false,
    };
  }

  if (
    autoContinue &&
    (
      readiness.status === "merge-conflict" ||
      readiness.status === "unauthorized" ||
      readiness.status === "unavailable"
    )
  ) {
    return {
      kind: "present",
      confirmed: true,
      accountSyncPending: true,
      syncProblemUpdate: {
        kind: "set",
        value: readiness.status === "unavailable" ? null : readiness.status,
      },
      severity: "warn",
      message: readiness.status === "merge-conflict"
        ? "Автоматическое объединение аккаунтов остановлено из-за конфликта данных. Оплата не создана; обратитесь в поддержку."
        : readiness.status === "unauthorized"
          ? "Сессия завершилась во время настройки. Войдите снова, чтобы безопасно продолжить с той же оплаты."
          : "Не удалось определить статус подтверждения. Пока не вводите код повторно; сначала повторите безопасную проверку.",
      continueToCompletedDestination: false,
    };
  }

  return { kind: "unchanged" };
}

export type RequestVerificationTransition =
  | { kind: "unchanged" }
  | {
      kind: "rejected";
      error: string | null;
      clearTargetEmail: true;
      continueToPasswordRecovery: boolean;
    }
  | {
      kind: "code-sent";
      targetEmail: string;
      severity: "success";
      message: string;
    };

export function requestVerificationTransition(
  result: EmailVerificationResult,
  autoContinue: boolean,
): RequestVerificationTransition {
  if (!result.ok) {
    if (result.code === "EMAIL_REQUIRED") {
      return {
        kind: "rejected",
        error: autoContinue
          ? "Связь с e-mail нужно восстановить. Возвращаем к вводу e-mail и пароля."
          : null,
        clearTargetEmail: true,
        continueToPasswordRecovery: autoContinue,
      };
    }

    return {
      kind: "rejected",
      error: result.message,
      clearTargetEmail: true,
      continueToPasswordRecovery: false,
    };
  }

  if (result.kind !== "code-sent") {
    return { kind: "unchanged" };
  }

  return {
    kind: "code-sent",
    targetEmail: result.targetEmail,
    severity: "success",
    message: `Код отправлен на ${result.targetEmail}.`,
  };
}

export type ConfirmVerificationTransition =
  | { kind: "unchanged" }
  | {
      kind: "rejected";
      error: string | null;
      continueToPasswordRecovery: boolean;
    }
  | {
      kind: "confirmed";
      accountSyncPending: boolean;
      syncProblem: VerificationSyncProblem;
      severity: VerificationMessageSeverity;
      message: string;
      continueToCompletedDestination: boolean;
    };

export function confirmVerificationTransition(
  result: EmailVerificationResult,
  autoContinue: boolean,
): ConfirmVerificationTransition {
  if (!result.ok) {
    if (result.code === "EMAIL_REQUIRED") {
      return {
        kind: "rejected",
        error: autoContinue
          ? "Связь с e-mail нужно восстановить. Возвращаем к вводу e-mail и пароля."
          : null,
        continueToPasswordRecovery: autoContinue,
      };
    }

    return {
      kind: "rejected",
      error: result.message,
      continueToPasswordRecovery: false,
    };
  }

  if (result.kind !== "confirmed") {
    return { kind: "unchanged" };
  }

  const readiness = result.readiness;
  const accountReady = readiness.status === "ready";
  const syncProblem = readiness.status === "merge-conflict"
    || readiness.status === "unauthorized"
    ? readiness.status
    : null;

  return {
    kind: "confirmed",
    accountSyncPending: !accountReady,
    syncProblem,
    severity: accountReady ? "success" : "warn",
    message: accountReady
      ? autoContinue
        ? "E-mail подтверждён. Возвращаем вас к прерванному действию."
        : "E-mail успешно подтверждён."
      : readiness.status === "merge-conflict"
        ? "E-mail подтверждён, но автоматическое объединение остановлено из-за конфликта данных. Оплата не создана; обратитесь в поддержку."
        : readiness.status === "unauthorized"
          ? "E-mail подтверждён, но сессия завершилась. Войдите снова, чтобы безопасно продолжить с той же оплаты."
          : readiness.status === "unavailable"
            ? "E-mail подтверждён, но готовность аккаунта сейчас проверить не удалось. Код повторно вводить не нужно; повторите проверку."
            : autoContinue
              ? "E-mail подтверждён. Синхронизация с Telegram ещё продолжается; оплату пока не создаём. Проверьте готовность ещё раз."
              : "E-mail подтверждён. Синхронизация аккаунта ещё продолжается; статус можно проверить в профиле.",
    continueToCompletedDestination: autoContinue && accountReady,
  };
}

export type AccountReadinessTransition =
  | { kind: "ready"; message: string }
  | { kind: "email-unverified"; message: string }
  | {
      kind: "pending";
      syncProblem: VerificationSyncProblem;
      message: string;
    };

export function accountReadinessTransition(
  readiness: AccountReadiness,
): AccountReadinessTransition {
  if (readiness.status === "ready") {
    return {
      kind: "ready",
      message: "Аккаунт готов. Возвращаем вас к прерванному действию.",
    };
  }

  if (readiness.status === "pending" && !readiness.emailVerified) {
    return {
      kind: "email-unverified",
      message: "E-mail ещё не подтверждён. Введите код из письма, чтобы продолжить.",
    };
  }

  return {
    kind: "pending",
    syncProblem: readiness.status === "merge-conflict"
      || readiness.status === "unauthorized"
      ? readiness.status
      : null,
    message: readiness.status === "merge-conflict"
      ? "Автоматическое объединение аккаунтов остановлено из-за конфликта данных. Повторная оплата не создавалась; обратитесь в поддержку."
      : readiness.status === "unauthorized"
        ? "Сессия завершилась. Войдите снова, чтобы продолжить с той же оплаты."
        : readiness.status === "unavailable"
          ? "Готовность аккаунта сейчас проверить не удалось. Код повторно вводить не нужно; повторите проверку позже."
          : "E-mail подтверждён, но синхронизация аккаунта ещё не завершена. Подождите немного и повторите проверку; повторная оплата не создавалась.",
  };
}

export function missingTurnstileTokenMessage(siteKeyConfigured: boolean) {
  return siteKeyConfigured
    ? "Пройдите проверку Cloudflare Turnstile."
    : "Ключ сайта Cloudflare Turnstile не настроен.";
}
