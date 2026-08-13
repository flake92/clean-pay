import {
  AuthGatewayError,
  type AuthCommands,
  type AuthProviderSession,
} from "@/application/auth/ports/auth-commands";
import type { AuthCommand, AuthCommandResult } from "@/application/models/auth-actions";

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

type AuthCommandFailure = Extract<AuthCommandResult, { ok: false }>;
type ParsedAuthCommand = {
  command: AuthCommand;
  email: string;
  turnstileToken: string | null;
};

function errorResult(error: unknown): AuthCommandResult {
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
      return {
        command: { kind: "register", ...common, password: input.password },
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

async function authenticate(
  commands: AuthCommands,
  input: { operation: "login" | "register"; email: string; password: string },
) {
  return commands.withUpstreamConcurrency("remnashop_auth", () => commands.authenticate(input));
}

async function register(commands: AuthCommands, email: string, password: string) {
  let providerSession: AuthProviderSession;
  let flow: "created" | "existing_email_login" = "created";
  try {
    providerSession = await authenticate(commands, { operation: "register", email, password });
  } catch (error) {
    if (!(error instanceof AuthGatewayError) || error.code !== "EMAIL_ALREADY_EXISTS") throw error;
    flow = "existing_email_login";
    providerSession = await authenticate(commands, { operation: "login", email, password });
  }

  const session = await commands.withUpstreamConcurrency(
    "remnashop_auth",
    () => commands.establishSession(providerSession),
  );
  let verificationDelivery: "not_required" | "sent" | "failed" = "not_required";
  if (!session.emailVerified) {
    try {
      await commands.withUpstreamConcurrency(
        "remnashop_auth",
        () => commands.requestEmailVerification(providerSession, email),
      );
      verificationDelivery = "sent";
    } catch {
      verificationDelivery = "failed";
    }
  }
  await commands.audit({
    action: "auth_register_success",
    userId: session.userId,
    metadata: { flow, verificationDelivery },
  });
  return {
    emailVerified: session.emailVerified,
    verificationRequired: !session.emailVerified,
    verificationDeliveryFailed: verificationDelivery === "failed",
  };
}

export async function executeAuthCommand(commands: AuthCommands, input: unknown): Promise<AuthCommandResult> {
  const parsed = parseAuthCommand(input);
  if ("ok" in parsed) return parsed;
  const { command, email, turnstileToken } = parsed;

  try {
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
      case "login": {
        await commands.rateLimit({ action: "auth_login", email, limit: 5, windowSeconds: 15 * 60 });
        const providerSession = await authenticate(commands, { operation: "login", email, password: command.password });
        const session = await commands.withUpstreamConcurrency(
          "remnashop_auth",
          () => commands.establishSession(providerSession),
        );
        await commands.audit({ action: "auth_login_success", userId: session.userId });
        return { ok: true, kind: "authenticated", emailVerified: session.emailVerified, verificationRequired: false, verificationDeliveryFailed: false };
      }
      case "register": {
        await commands.rateLimit({ action: "auth_register", email, limit: 5, windowSeconds: 15 * 60 });
        return { ok: true, kind: "authenticated", ...await register(commands, email, command.password) };
      }
      case "request-password-reset":
        await commands.rateLimit({ action: "password_reset_start", email, limit: 5, windowSeconds: 15 * 60 });
        await commands.withUpstreamConcurrency(
          "remnashop_auth",
          () => commands.requestPasswordReset(email),
        );
        return { ok: true, kind: "password-reset-requested" };
      case "confirm-password-reset": {
        await commands.rateLimit({ action: "password_reset_confirm", email, limit: 5, windowSeconds: 15 * 60 });
        const providerSession = await commands.withUpstreamConcurrency(
          "remnashop_auth",
          () => commands.authenticate({
            operation: "confirm-password-reset",
            email,
            code: command.code,
            password: command.newPassword,
          }),
        );
        const session = await commands.withUpstreamConcurrency(
          "remnashop_auth",
          () => commands.establishSession(providerSession, {
            replaceExistingSessions: true,
            replacementIdentityEmail: email,
          }),
        );
        await commands.audit({ action: "password_reset_success", userId: session.userId });
        return { ok: true, kind: "authenticated", emailVerified: session.emailVerified, verificationRequired: false, verificationDeliveryFailed: false };
      }
    }
  } catch (error) {
    return errorResult(error);
  }
}
