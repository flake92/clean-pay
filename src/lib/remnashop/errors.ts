export type BffErrorCode =
  | 'UNAUTHORIZED'
  | 'AUTH_FAILED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_CODE_INVALID'
  | 'EMAIL_CODE_EXPIRED'
  | 'RATE_LIMITED'
  | 'CONFLICT'
  | 'PLAN_UNAVAILABLE'
  | 'PAYMENT_GATEWAY_UNAVAILABLE'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'DEVICE_DELETE_UNAVAILABLE'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_ERROR'
  | 'INTERNAL_ERROR';

type BffErrorDebug = {
  message?: string;
  upstreamStatus?: number;
  upstreamPath?: string;
  upstreamDetail?: unknown;
  cause?: unknown;
};

const PROD_MESSAGES: Record<BffErrorCode, string> = {
  UNAUTHORIZED: 'Войдите в аккаунт, чтобы продолжить.',
  AUTH_FAILED: 'Не удалось войти. Проверьте данные.',
  FORBIDDEN: 'Действие недоступно.',
  NOT_FOUND: 'Данные не найдены.',
  VALIDATION_ERROR: 'Проверьте введённые данные.',
  EMAIL_NOT_VERIFIED: 'Подтвердите e-mail, чтобы продолжить.',
  EMAIL_CODE_INVALID: 'Код не подошёл. Проверьте его и попробуйте снова.',
  EMAIL_CODE_EXPIRED: 'Код истёк. Запросите новый.',
  RATE_LIMITED: 'Слишком много попыток. Попробуйте позже.',
  CONFLICT: 'Не удалось выполнить действие. Проверьте данные и попробуйте снова.',
  PLAN_UNAVAILABLE: 'Этот тариф сейчас недоступен.',
  PAYMENT_GATEWAY_UNAVAILABLE: 'Этот способ оплаты сейчас недоступен.',
  SUBSCRIPTION_NOT_FOUND: 'Активная подписка не найдена.',
  DEVICE_DELETE_UNAVAILABLE: 'Не удалось удалить устройство.',
  UPSTREAM_UNAVAILABLE: 'Сервис временно недоступен. Попробуйте позже.',
  UPSTREAM_ERROR: 'Не удалось выполнить действие. Попробуйте позже.',
  INTERNAL_ERROR: 'Внутренняя ошибка сервиса.',
};

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

  if (status === 401) {
    return new BffError('UNAUTHORIZED', 401, message, debug);
  }

  if (status === 403) {
    return new BffError('FORBIDDEN', 403, message, debug);
  }

  if (status === 404 && lowerPath.includes('/subscription/current')) {
    return new BffError('SUBSCRIPTION_NOT_FOUND', 404, message, debug);
  }

  if (status === 404) {
    return new BffError('NOT_FOUND', 404, message, debug);
  }

  if (status === 409 && includesAny(lowerMessage, ['email must be verified', 'email not verified'])) {
    return new BffError('EMAIL_NOT_VERIFIED', 409, message, debug);
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
    return new BffError('DEVICE_DELETE_UNAVAILABLE', status >= 500 ? 502 : status, message, debug);
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
