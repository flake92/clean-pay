export type AuthFormStage =
  | "identify"
  | "password"
  | "register"
  | "resetStart"
  | "resetConfirm";

export type AuthFormCommand =
  | { kind: "identify"; email: string; turnstileToken?: string }
  | { kind: "login"; email: string; password: string; turnstileToken?: string }
  | { kind: "register"; email: string; password: string; turnstileToken?: string }
  | { kind: "request-password-reset"; email: string; turnstileToken?: string }
  | {
      kind: "confirm-password-reset";
      email: string;
      code: string;
      newPassword: string;
      turnstileToken?: string;
    };

export type AuthRejectedTransition = {
  canRecoverPassword: boolean;
  stage: AuthFormStage;
};

function optionalTurnstileToken(turnstileToken: string | null) {
  return turnstileToken ? { turnstileToken } : {};
}

export function authCommandForStage(
  stage: AuthFormStage,
  fields: { email: string; password: string; code: string },
  turnstileToken: string | null,
): AuthFormCommand {
  const challenge = optionalTurnstileToken(turnstileToken);

  if (stage === "identify") {
    return { kind: "identify", email: fields.email, ...challenge };
  }
  if (stage === "password") {
    return {
      kind: "login",
      email: fields.email,
      password: fields.password,
      ...challenge,
    };
  }
  if (stage === "register") {
    return {
      kind: "register",
      email: fields.email,
      password: fields.password,
      ...challenge,
    };
  }
  if (stage === "resetStart") {
    return {
      kind: "request-password-reset",
      email: fields.email,
      ...challenge,
    };
  }
  return {
    kind: "confirm-password-reset",
    email: fields.email,
    code: fields.code,
    newPassword: fields.password,
    ...challenge,
  };
}

export function authRejectedTransition(
  stage: AuthFormStage,
  code: string,
): AuthRejectedTransition {
  const canRecoverPassword =
    (stage === "password" || stage === "register") && code === "AUTH_FAILED";
  return {
    canRecoverPassword,
    stage: stage === "register" && canRecoverPassword ? "password" : stage,
  };
}

export function authStageAfterIdentification(exists: boolean): AuthFormStage {
  return exists ? "password" : "register";
}

export function authPasswordLabel(stage: AuthFormStage) {
  if (stage === "password") return "Пароль";
  if (stage === "register") return "Придумайте пароль";
  return "Новый пароль";
}

export function authSubmitLabel(stage: AuthFormStage) {
  if (stage === "register") return "Создать аккаунт";
  if (stage === "resetStart") return "Получить код восстановления";
  if (stage === "resetConfirm") return "Сохранить новый пароль";
  return "Продолжить";
}
