export type ServiceErrorCode =
  | "UNAUTHORIZED"
  | "AUTH_FAILED"
  | "PASSKEY_REQUIRED"
  | "CURRENT_PASSWORD_INVALID"
  | "PASSWORD_UNCHANGED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "EMAIL_REQUIRED"
  | "EMAIL_NOT_VERIFIED"
  | "EMAIL_LINK_REQUIRES_VERIFICATION"
  | "EMAIL_CODE_INVALID"
  | "EMAIL_CODE_EXPIRED"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "PAYMENT_OPERATION_IN_PROGRESS"
  | "PAYMENT_OUTCOME_UNKNOWN"
  | "OFFER_CHANGED"
  | "ACCOUNT_MERGE_REQUIRED"
  | "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT"
  | "ACCOUNT_MERGE_IN_PROGRESS"
  | "PLAN_UNAVAILABLE"
  | "PAYMENT_GATEWAY_UNAVAILABLE"
  | "PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED"
  | "PROMOCODE_ALREADY_ACTIVATED"
  | "PROMOCODE_EXPIRED"
  | "PROMOCODE_NOT_AVAILABLE"
  | "PROMOCODE_NOT_FOUND"
  | "PROMOCODE_RESOURCE_UNLIMITED"
  | "SUBSCRIPTION_NOT_FOUND"
  | "SUBSCRIPTION_URL_UNAVAILABLE"
  | "DEVICE_DELETE_UNAVAILABLE"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export type ServiceErrorDebug = {
  message?: string;
  upstreamStatus?: number;
  upstreamPath?: string;
  upstreamDetail?: unknown;
  retryAfterSeconds?: number;
  cause?: unknown;
};

const PROD_MESSAGES: Record<ServiceErrorCode, string> = {
  UNAUTHORIZED: "Войдите в аккаунт, чтобы продолжить.",
  AUTH_FAILED: "Не удалось войти. Проверьте данные.",
  PASSKEY_REQUIRED: "Создайте ключ доступа, чтобы продолжить.",
  CURRENT_PASSWORD_INVALID: "Текущий пароль неверный.",
  PASSWORD_UNCHANGED: "Новый пароль должен отличаться от текущего.",
  FORBIDDEN: "Действие недоступно.",
  NOT_FOUND: "Данные не найдены.",
  VALIDATION_ERROR: "Проверьте введённые данные.",
  EMAIL_REQUIRED: "Привяжите e-mail к Telegram-аккаунту, чтобы продолжить.",
  EMAIL_NOT_VERIFIED: "Подтвердите e-mail, чтобы продолжить.",
  EMAIL_LINK_REQUIRES_VERIFICATION: "Для привязки e-mail нужно подтвердить доступ к почте. Если код не приходит, обратитесь в поддержку.",
  EMAIL_CODE_INVALID: "Код не подошёл. Проверьте его и попробуйте снова.",
  EMAIL_CODE_EXPIRED: "Код истёк. Запросите новый.",
  RATE_LIMITED: "Слишком много попыток. Попробуйте позже.",
  CONFLICT: "Не удалось выполнить действие. Проверьте данные и попробуйте снова.",
  IDEMPOTENCY_KEY_REQUIRED: "Не удалось безопасно начать оплату. Обновите страницу и попробуйте снова.",
  IDEMPOTENCY_KEY_INVALID: "Не удалось безопасно начать оплату. Обновите страницу и попробуйте снова.",
  IDEMPOTENCY_KEY_REUSED: "Эта попытка оплаты уже относится к другому запросу. Обновите страницу и повторите выбор.",
  PAYMENT_OPERATION_IN_PROGRESS: "Платёж уже создаётся. Повторите проверку через несколько секунд.",
  PAYMENT_OUTCOME_UNKNOWN: "Результат оплаты уточняется. Не создавайте новую оплату.",
  OFFER_CHANGED: "Цена или условия предложения изменились. Проверьте новую цену перед оплатой.",
  ACCOUNT_MERGE_REQUIRED: "Этот Telegram уже привязан к другой почте. Сначала объедините аккаунты через поддержку.",
  ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT: "В обеих учётных записях есть подписки. Данные не изменены — обратитесь в службу поддержки.",
  ACCOUNT_MERGE_IN_PROGRESS: "Платёж ещё обрабатывается. Дождитесь завершения и повторите объединение — данные не изменены.",
  PLAN_UNAVAILABLE: "Этот тариф сейчас недоступен.",
  PAYMENT_GATEWAY_UNAVAILABLE: "Этот способ оплаты сейчас недоступен.",
  PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED: "Для этого промокода нужна активная подписка.",
  PROMOCODE_ALREADY_ACTIVATED: "Этот промокод уже был активирован.",
  PROMOCODE_EXPIRED: "Срок действия промокода истёк.",
  PROMOCODE_NOT_AVAILABLE: "Этот промокод недоступен для текущего аккаунта.",
  PROMOCODE_NOT_FOUND: "Промокод не найден или уже отключён.",
  PROMOCODE_RESOURCE_UNLIMITED: "Промокод не применён: соответствующий лимит уже безлимитный.",
  SUBSCRIPTION_NOT_FOUND: "Активная подписка не найдена.",
  SUBSCRIPTION_URL_UNAVAILABLE: "Ссылка подключения недоступна. Попробуйте позже или обратитесь в поддержку.",
  DEVICE_DELETE_UNAVAILABLE: "Не удалось удалить устройство.",
  UPSTREAM_UNAVAILABLE: "Сервис временно недоступен. Попробуйте позже.",
  UPSTREAM_ERROR: "Не удалось выполнить действие. Попробуйте позже.",
  INTERNAL_ERROR: "Внутренняя ошибка сервиса.",
};

export function isServiceErrorCode(value: unknown): value is ServiceErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROD_MESSAGES, value);
}

export class ServiceError extends Error {
  public readonly prodMessage: string;

  constructor(
    public readonly code: ServiceErrorCode,
    public readonly status: number,
    message?: string,
    public readonly debug?: ServiceErrorDebug,
  ) {
    super(message ?? PROD_MESSAGES[code]);
    this.prodMessage = PROD_MESSAGES[code];
  }
}
