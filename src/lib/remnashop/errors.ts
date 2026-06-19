export type BffErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "EMAIL_NOT_VERIFIED"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR";

export class BffError extends Error {
  constructor(
    public readonly code: BffErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function normalizeRemnashopError(status: number, detail: unknown) {
  const message =
    typeof detail === "string"
      ? detail
      : Array.isArray(detail)
        ? "Validation error"
        : "Request failed";
  const lowerMessage = message.toLowerCase();

  if (status === 401) {
    return new BffError("UNAUTHORIZED", 401, "Нужно войти в аккаунт.");
  }

  if (status === 403) {
    return new BffError("FORBIDDEN", 403, "Действие недоступно.");
  }

  if (status === 404) {
    return new BffError("NOT_FOUND", 404, "Данные не найдены.");
  }

  if (status === 409 && lowerMessage.includes("email must be verified")) {
    return new BffError(
      "EMAIL_NOT_VERIFIED",
      409,
      "Подтвердите e-mail перед покупкой или продлением подписки.",
    );
  }

  if (status === 409) {
    return new BffError("CONFLICT", 409, message);
  }

  if (status === 422 || status === 400) {
    return new BffError("VALIDATION_ERROR", 400, "Проверьте введённые данные.");
  }

  if (status === 429) {
    return new BffError("RATE_LIMITED", 429, "Слишком много попыток. Попробуйте позже.");
  }

  if (status >= 500) {
    return new BffError(
      "UPSTREAM_UNAVAILABLE",
      502,
      "Сервис временно недоступен. Попробуйте позже.",
    );
  }

  return new BffError("UPSTREAM_ERROR", 502, "Не удалось выполнить запрос.");
}
