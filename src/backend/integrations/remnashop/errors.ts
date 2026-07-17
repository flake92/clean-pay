export type BffErrorCode =
  | 'UNAUTHORIZED'
  | 'AUTH_FAILED'
  | 'CURRENT_PASSWORD_INVALID'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'EMAIL_REQUIRED'
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_LINK_REQUIRES_VERIFICATION'
  | 'EMAIL_CODE_INVALID'
  | 'EMAIL_CODE_EXPIRED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'IDEMPOTENCY_KEY_INVALID'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'PAYMENT_OPERATION_IN_PROGRESS'
  | 'PAYMENT_OUTCOME_UNKNOWN'
  | 'ACCOUNT_MERGE_REQUIRED'
  | 'PLAN_UNAVAILABLE'
  | 'PAYMENT_GATEWAY_UNAVAILABLE'
  | 'PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED'
  | 'PROMOCODE_ALREADY_ACTIVATED'
  | 'PROMOCODE_EXPIRED'
  | 'PROMOCODE_NOT_AVAILABLE'
  | 'PROMOCODE_NOT_FOUND'
  | 'PROMOCODE_RESOURCE_UNLIMITED'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'SUBSCRIPTION_URL_UNAVAILABLE'
  | 'DEVICE_DELETE_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

type BffErrorDebug = {
  message?: string;
  upstreamStatus?: number;
  upstreamPath?: string;
  upstreamDetail?: unknown;
  retryAfterSeconds?: number;
  cause?: unknown;
};

const PROD_MESSAGES: Record<BffErrorCode, string> = {
  UNAUTHORIZED: 'Войдите в аккаунт, чтобы продолжить.',
  AUTH_FAILED: 'Не удалось войти. Проверьте данные.',
  CURRENT_PASSWORD_INVALID: 'Текущий пароль неверный.',
  FORBIDDEN: 'Действие недоступно.',
  NOT_FOUND: 'Данные не найдены.',
  VALIDATION_ERROR: 'Проверьте введённые данные.',
  EMAIL_REQUIRED: 'Привяжите e-mail к Telegram-аккаунту, чтобы продолжить.',
  EMAIL_NOT_VERIFIED: 'Подтвердите e-mail, чтобы продолжить.',
  EMAIL_LINK_REQUIRES_VERIFICATION: '\u0414\u043b\u044f \u043f\u0440\u0438\u0432\u044f\u0437\u043a\u0438 e-mail \u043d\u0443\u0436\u043d\u043e \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u0434\u043e\u0441\u0442\u0443\u043f \u043a \u043f\u043e\u0447\u0442\u0435. \u0415\u0441\u043b\u0438 \u043a\u043e\u0434 \u043d\u0435 \u043f\u0440\u0438\u0445\u043e\u0434\u0438\u0442, \u043e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u0432 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0443.',
  EMAIL_CODE_INVALID: 'Код не подошёл. Проверьте его и попробуйте снова.',
  EMAIL_CODE_EXPIRED: 'Код истёк. Запросите новый.',
  RATE_LIMITED: 'Слишком много попыток. Попробуйте позже.',
  CONFLICT: 'Не удалось выполнить действие. Проверьте данные и попробуйте снова.',
  IDEMPOTENCY_KEY_REQUIRED: 'Не удалось безопасно начать оплату. Обновите страницу и попробуйте снова.',
  IDEMPOTENCY_KEY_INVALID: 'Не удалось безопасно начать оплату. Обновите страницу и попробуйте снова.',
  IDEMPOTENCY_KEY_REUSED: 'Эта попытка оплаты уже относится к другому запросу. Обновите страницу и повторите выбор.',
  PAYMENT_OPERATION_IN_PROGRESS: 'Платёж уже создаётся. Повторите проверку через несколько секунд.',
  PAYMENT_OUTCOME_UNKNOWN: 'Результат оплаты уточняется. Не создавайте новую оплату.',
  ACCOUNT_MERGE_REQUIRED: '\u042d\u0442\u043e\u0442 Telegram \u0443\u0436\u0435 \u043f\u0440\u0438\u0432\u044f\u0437\u0430\u043d \u043a \u0434\u0440\u0443\u0433\u043e\u0439 \u043f\u043e\u0447\u0442\u0435. \u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u043e\u0431\u044a\u0435\u0434\u0438\u043d\u0438\u0442\u0435 \u0430\u043a\u043a\u0430\u0443\u043d\u0442\u044b \u0447\u0435\u0440\u0435\u0437 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0443.',
  PLAN_UNAVAILABLE: 'Этот тариф сейчас недоступен.',
  PAYMENT_GATEWAY_UNAVAILABLE: 'Этот способ оплаты сейчас недоступен.',
  PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED: 'Для этого промокода нужна активная подписка.',
  PROMOCODE_ALREADY_ACTIVATED: 'Этот промокод уже был активирован.',
  PROMOCODE_EXPIRED: 'Срок действия промокода истёк.',
  PROMOCODE_NOT_AVAILABLE: 'Этот промокод недоступен для текущего аккаунта.',
  PROMOCODE_NOT_FOUND: 'Промокод не найден или уже отключён.',
  PROMOCODE_RESOURCE_UNLIMITED: 'Промокод не применён: соответствующий лимит уже безлимитный.',
  SUBSCRIPTION_NOT_FOUND: 'Активная подписка не найдена.',
  SUBSCRIPTION_URL_UNAVAILABLE: 'Ссылка подключения недоступна. Попробуйте позже или обратитесь в поддержку.',
  DEVICE_DELETE_UNAVAILABLE: 'Не удалось удалить устройство.',
  UPSTREAM_UNAVAILABLE: 'Сервис временно недоступен. Попробуйте позже.',
  UPSTREAM_ERROR: 'Не удалось выполнить действие. Попробуйте позже.',
  INTERNAL_ERROR: 'Внутренняя ошибка сервиса.',
};

export function isBffErrorCode(value: unknown): value is BffErrorCode {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(PROD_MESSAGES, value)
  );
}

export class BffError extends Error {
  public readonly prodMessage: string;
  public readonly debug?: BffErrorDebug;

  constructor(
    public readonly code: BffErrorCode,
    public readonly status: number,
    message?: string,
    debug?: BffErrorDebug,
  ) {
    super(message ?? PROD_MESSAGES[code]);
    this.prodMessage = PROD_MESSAGES[code];
    this.debug = debug;
  }
}

function getDetailMessage(detail: unknown): string {
  if (typeof detail === 'string') {
    return detail;
  }

  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && 'msg' in item) {
          return String((item as { msg: unknown }).msg);
        }

        return null;
      })
      .filter(Boolean);

    return messages.length > 0 ? messages.join('; ') : 'Validation error';
  }

  if (detail && typeof detail === 'object') {
    const value = detail as { message?: unknown; error?: unknown; detail?: unknown };

    if (typeof value.message === 'string') {
      return value.message;
    }

    if (typeof value.error === 'string') {
      return value.error;
    }

    if (typeof value.detail === 'string') {
      return value.detail;
    }
  }

  return 'Request failed';
}

function includesAny(value: string, patterns: string[]) {
  return patterns.some((pattern) => value.includes(pattern));
}

export function normalizeRemnashopError(
  status: number,
  detail: unknown,
  context: { path?: string } = {},
) {
  const message = getDetailMessage(detail);
  const lowerMessage = message.toLowerCase();
  const lowerPath = context.path?.toLowerCase() ?? '';
  const debug: BffErrorDebug = {
    message,
    upstreamStatus: status,
    upstreamPath: context.path,
    upstreamDetail: detail,
  };

  if (status === 401 && lowerPath.includes('/auth/login')) {
    return new BffError('AUTH_FAILED', 401, message, debug);
  }

  if (status === 401 && lowerPath.includes('/auth/change-password')) {
    return new BffError('CURRENT_PASSWORD_INVALID', 401, message, debug);
  }

  if (status === 401) {
    return new BffError('UNAUTHORIZED', 401, message, debug);
  }

  if (status === 403) {
    return new BffError('FORBIDDEN', 403, message, debug);
  }

  if (status === 404 && lowerPath.includes('/subscription/current')) {
    return new BffError('SUBSCRIPTION_NOT_FOUND', 404, message, debug);
  }

  if (lowerPath.includes('/subscription/promocode')) {
    if (status === 404) {
      return new BffError('PROMOCODE_NOT_FOUND', 404, message, debug);
    }

    if (includesAny(lowerMessage, ['already activated', 'already used'])) {
      return new BffError('PROMOCODE_ALREADY_ACTIVATED', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['expired'])) {
      return new BffError('PROMOCODE_EXPIRED', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['active subscription required'])) {
      return new BffError('PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['resource is already unlimited', 'already unlimited'])) {
      return new BffError('PROMOCODE_RESOURCE_UNLIMITED', 409, message, debug);
    }

    if (
      includesAny(lowerMessage, [
        'activation limit',
        'for new users only',
        'for existing users only',
        'for invited users only',
        'not available',
      ])
    ) {
      return new BffError('PROMOCODE_NOT_AVAILABLE', 409, message, debug);
    }
  }

  if (status === 404) {
    return new BffError('NOT_FOUND', 404, message, debug);
  }

  if (status === 409 && includesAny(lowerMessage, ['email must be verified', 'email not verified'])) {
    return new BffError('EMAIL_NOT_VERIFIED', 409, message, debug);
  }

  if (
    status === 409 &&
    includesAny(lowerPath, ['/subscription/purchase', '/subscription/extend'])
  ) {
    if (includesAny(lowerMessage, ['idempotency-key is already in progress'])) {
      return new BffError('PAYMENT_OPERATION_IN_PROGRESS', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['payment outcome is unknown'])) {
      return new BffError('PAYMENT_OUTCOME_UNKNOWN', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['stored payment result cannot be replayed safely'])) {
      return new BffError('PAYMENT_OUTCOME_UNKNOWN', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['idempotency-key was already used with a different request'])) {
      return new BffError('IDEMPOTENCY_KEY_REUSED', 409, message, debug);
    }
  }

  if (includesAny(lowerMessage, ['code expired', 'expired code', 'verification code expired'])) {
    return new BffError('EMAIL_CODE_EXPIRED', 400, message, debug);
  }

  if (includesAny(lowerMessage, ['invalid code', 'wrong code', 'incorrect code', 'verification code'])) {
    return new BffError('EMAIL_CODE_INVALID', 400, message, debug);
  }

  if (includesAny(lowerMessage, ['plan unavailable', 'plan is not available', 'tariff unavailable'])) {
    return new BffError('PLAN_UNAVAILABLE', 409, message, debug);
  }

  if (includesAny(lowerMessage, ['gateway unavailable', 'payment gateway', 'gateway is not available'])) {
    return new BffError('PAYMENT_GATEWAY_UNAVAILABLE', 409, message, debug);
  }

  if (lowerPath.includes('/subscription/devices') && status >= 400) {
    return new BffError('DEVICE_DELETE_UNAVAILABLE', status >= 500 ? 409 : status, message, debug);
  }

  if (status === 409) {
    return new BffError('CONFLICT', 409, message, debug);
  }

  if (status === 422 || status === 400) {
    return new BffError('VALIDATION_ERROR', 400, message, debug);
  }

  if (status === 429) {
    return new BffError('RATE_LIMITED', 429, message, debug);
  }

  if (status >= 500) {
    return new BffError('UPSTREAM_UNAVAILABLE', 502, message, debug);
  }

  return new BffError('UPSTREAM_ERROR', 502, message, debug);
}

export function remnashopUnavailableError(path: string, cause: unknown) {
  return new BffError('UPSTREAM_UNAVAILABLE', 502, 'Upstream request failed', {
    message: cause instanceof Error ? cause.message : String(cause),
    upstreamPath: path,
    cause,
  });
}

export function remnashopInvalidJsonError(path: string, rawBody: string) {
  return new BffError('UPSTREAM_ERROR', 502, 'Upstream returned invalid JSON', {
    message: 'Invalid JSON response',
    upstreamPath: path,
    upstreamDetail: rawBody,
  });
}
