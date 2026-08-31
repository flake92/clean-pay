import { executeEmailLogin } from "@/application/auth/execute-email-login";
import { executeEmailRegistration } from "@/application/auth/execute-email-registration";
import { executePasswordResetConfirmation } from "@/application/auth/execute-password-reset-confirmation";
import { executePasswordResetStart } from "@/application/auth/execute-password-reset-start";
import {
  AuthGatewayError,
  type AuthCommands,
} from "@/application/auth/ports/auth-commands";
import type {
  AuthCommand,
  AuthExecutionCommand,
  AuthExecutionResult,
} from "@/application/models/auth-actions";
import { normalizeReferralCode } from "@/shared/domain/referrals";

const MAX_EMAIL_LENGTH = 254;
const MAX_EMAIL_INPUT_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 256;
const MAX_TURNSTILE_TOKEN_LENGTH = 4_096;
const AUTH_COMMAND_KINDS = new Set<AuthCommand["kind"]>([
  "identify",
  "login",
  "register",
  "request-password-reset",
  "confirm-password-reset",
]);

type AuthCommandFailure = Extract<AuthExecutionResult, { ok: false }>;
type ParsedAuthCommand = {
  command: AuthExecutionCommand;
  email: string;
  turnstileToken: string | null;
};

function errorResult(error: unknown): AuthExecutionResult {
  const code = error instanceof AuthGatewayError ? error.code : "INTERNAL_ERROR";
  const messages: Record<string, string> = {
    AUTH_FAILED: "Неверный e-mail или пароль.",
    RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
    VALIDATION_ERROR: "Проверьте введённые данные.",
    EMAIL_CODE_INVALID: "Код не подошёл. Проверьте его и попробуйте снова.",
    EMAIL_CODE_EXPIRED: "Код истёк. Запросите новый.",
    UPSTREAM_UNAVAILABLE: "Сервис временно недоступен. Попробуйте позже.",
  };
  return { ok: false, code, message: messages[code] ?? "Не удалось выполнить действие." };
}

function validationError(message: string): AuthCommandFailure {
  return { ok: false, code: "VALIDATION_ERROR", message };
}

function parseAuthCommand(value: unknown): ParsedAuthCommand | AuthCommandFailure {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationError("Проверьте введённые данные.");
  }

  const input = value as Record<string, unknown>;
  if (typeof input.kind !== "string" || !AUTH_COMMAND_KINDS.has(input.kind as AuthCommand["kind"])) {
    return validationError("Неизвестное действие авторизации.");
  }
  if (
    typeof input.email !== "string"
    || input.email.length > MAX_EMAIL_INPUT_LENGTH
  ) {
    return validationError("Проверьте e-mail.");
  }

  const email = input.email.trim().toLowerCase();
  if (!email) return validationError("Укажите e-mail.");
  if (email.length > MAX_EMAIL_LENGTH) return validationError("E-mail слишком длинный.");

  let turnstileToken: string | null = null;
  if (input.turnstileToken !== undefined) {
    if (
      typeof input.turnstileToken !== "string"
      || input.turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH
    ) {
      return validationError("Проверка безопасности передала некорректные данные.");
    }
    turnstileToken = input.turnstileToken.trim() || null;
  }

  const common = {
    email,
    ...(turnstileToken ? { turnstileToken } : {}),
  };
  switch (input.kind as AuthCommand["kind"]) {
    case "identify":
      return { command: { kind: "identify", ...common }, email, turnstileToken };
    case "request-password-reset":
      return { command: { kind: "request-password-reset", ...common }, email, turnstileToken };
    case "login":
      if (
        typeof input.password !== "string"
        || !input.password
        || input.password.length > MAX_PASSWORD_LENGTH
      ) {
        return validationError("Проверьте введённый пароль.");
      }
      return {
        command: { kind: "login", ...common, password: input.password },
        email,
        turnstileToken,
      };
    case "register":
      if (typeof input.password !== "string") {
        return validationError("Проверьте введённый пароль.");
      }
      if (input.password.length < 8) {
        return validationError("Пароль должен содержать не менее 8 символов.");
      }
      if (input.password.length > MAX_PASSWORD_LENGTH) {
        return validationError("Пароль слишком длинный.");
      }
      const referralCode = input.referralCode === undefined
        ? null
        : normalizeReferralCode(input.referralCode);
      if (input.referralCode !== undefined && !referralCode) {
        return validationError("Реферальная ссылка некорректна.");
      }
      return {
        command: {
          kind: "register",
          ...common,
          password: input.password,
          ...(referralCode ? { referralCode } : {}),
        },
        email,
        turnstileToken,
      };
    case "confirm-password-reset":
      if (typeof input.code !== "string" || !/^\d{6}$/.test(input.code)) {
        return validationError("Проверьте код восстановления.");
      }
      if (
        typeof input.newPassword !== "string"
        || input.newPassword.length < 8
        || input.newPassword.length > MAX_PASSWORD_LENGTH
      ) {
        return validationError("Новый пароль должен содержать от 8 до 256 символов.");
      }
      return {
        command: {
          kind: "confirm-password-reset",
          ...common,
          code: input.code,
          newPassword: input.newPassword,
        },
        email,
        turnstileToken,
      };
  }
}

export async function executeAuthCommand(commands: AuthCommands, input: unknown): Promise<AuthExecutionResult> {
  const parsed = parseAuthCommand(input);
  if ("ok" in parsed) return parsed;
  const { command, email, turnstileToken } = parsed;

  try {
    if (command.kind === "login") {
      return await executeEmailLogin(commands, {
        email,
        password: command.password,
        turnstileToken,
      });
    }
    if (command.kind === "register") {
      return await executeEmailRegistration(commands, {
        email,
        password: command.password,
        ...(command.referralCode ? { referralCode: command.referralCode } : {}),
        turnstileToken,
      });
    }
    if (command.kind === "request-password-reset") {
      return await executePasswordResetStart(commands, { email, turnstileToken });
    }
    if (command.kind === "confirm-password-reset") {
      return await executePasswordResetConfirmation(commands, {
        code: command.code,
        email,
        newPassword: command.newPassword,
        turnstileToken,
      });
    }
    await commands.preflightCapacity("auth_command");
    await commands.withUpstreamConcurrency(
      "turnstile_verify",
      () => commands.verifyHuman(turnstileToken, "auth_login"),
    );
    switch (command.kind) {
      case "identify": {
        await commands.rateLimit({ action: "auth_identify", email, limit: 20, windowSeconds: 15 * 60 });
        const [identity, hasPasskey] = await Promise.all([
          commands.withUpstreamConcurrency(
            "remnashop_auth",
            () => commands.identifyEmail(email),
          ),
          commands.hasPasskey(email),
        ]);
        return { ok: true, kind: "identified", exists: identity.exists, hasPasskey };
      }
    }
  } catch (error) {
    return errorResult(error);
  }
}
