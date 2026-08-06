import { ServiceError, type ServiceErrorDebug } from "@/backend/errors/service-error";

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
  const debug: ServiceErrorDebug = {
    message,
    upstreamStatus: status,
    upstreamPath: context.path,
    upstreamDetail: detail,
  };

  if (
    status === 401 &&
    (lowerPath.includes('/auth/login') || lowerPath.includes('/auth/email/complete'))
  ) {
    return new ServiceError('AUTH_FAILED', 401, message, debug);
  }

  if (status === 401 && lowerPath.includes('/auth/change-password')) {
    return new ServiceError('CURRENT_PASSWORD_INVALID', 401, message, debug);
  }

  if (status === 401) {
    return new ServiceError('UNAUTHORIZED', 401, message, debug);
  }

  if (status === 403) {
    return new ServiceError('FORBIDDEN', 403, message, debug);
  }

  if (status === 404 && lowerPath.includes('/subscription/current')) {
    return new ServiceError('SUBSCRIPTION_NOT_FOUND', 404, message, debug);
  }

  if (lowerPath.includes('/subscription/promocode')) {
    if (status === 404) {
      return new ServiceError('PROMOCODE_NOT_FOUND', 404, message, debug);
    }

    if (includesAny(lowerMessage, ['already activated', 'already used'])) {
      return new ServiceError('PROMOCODE_ALREADY_ACTIVATED', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['expired'])) {
      return new ServiceError('PROMOCODE_EXPIRED', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['active subscription required'])) {
      return new ServiceError('PROMOCODE_ACTIVE_SUBSCRIPTION_REQUIRED', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['resource is already unlimited', 'already unlimited'])) {
      return new ServiceError('PROMOCODE_RESOURCE_UNLIMITED', 409, message, debug);
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
      return new ServiceError('PROMOCODE_NOT_AVAILABLE', 409, message, debug);
    }
  }

  if (status === 404) {
    return new ServiceError('NOT_FOUND', 404, message, debug);
  }

  if (status === 409 && includesAny(lowerMessage, ['email must be verified', 'email not verified'])) {
    return new ServiceError('EMAIL_NOT_VERIFIED', 409, message, debug);
  }

  if (
    status === 409 &&
    includesAny(lowerPath, ['/subscription/purchase', '/subscription/extend'])
  ) {
    if (includesAny(lowerMessage, ['idempotency-key is already in progress'])) {
      return new ServiceError('PAYMENT_OPERATION_IN_PROGRESS', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['payment outcome is unknown'])) {
      return new ServiceError('PAYMENT_OUTCOME_UNKNOWN', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['stored payment result cannot be replayed safely'])) {
      return new ServiceError('PAYMENT_OUTCOME_UNKNOWN', 409, message, debug);
    }

    if (includesAny(lowerMessage, ['idempotency-key was already used with a different request'])) {
      return new ServiceError('IDEMPOTENCY_KEY_REUSED', 409, message, debug);
    }
  }

  if (includesAny(lowerMessage, ['code expired', 'expired code', 'verification code expired'])) {
    return new ServiceError('EMAIL_CODE_EXPIRED', 400, message, debug);
  }

  if (includesAny(lowerMessage, ['invalid code', 'wrong code', 'incorrect code', 'verification code'])) {
    return new ServiceError('EMAIL_CODE_INVALID', 400, message, debug);
  }

  if (includesAny(lowerMessage, ['plan unavailable', 'plan is not available', 'tariff unavailable'])) {
    return new ServiceError('PLAN_UNAVAILABLE', 409, message, debug);
  }

  if (includesAny(lowerMessage, ['gateway unavailable', 'payment gateway', 'gateway is not available'])) {
    return new ServiceError('PAYMENT_GATEWAY_UNAVAILABLE', 409, message, debug);
  }

  if (includesAny(lowerMessage, ['user merge disabled during payment rollout gate'])) {
    return new ServiceError('ACCOUNT_MERGE_IN_PROGRESS', 409, message, debug);
  }

  if (lowerPath.includes('/subscription/devices') && status >= 400) {
    return new ServiceError('DEVICE_DELETE_UNAVAILABLE', status >= 500 ? 409 : status, message, debug);
  }

  if (
    status >= 500 &&
    lowerPath.includes('/users/merge') &&
    includesAny(lowerMessage, ['payment rollout gate', 'rollout gate', 'merge disabled'])
  ) {
    return new ServiceError('ACCOUNT_MERGE_IN_PROGRESS', 409, message, debug);
  }

  if (status === 409) {
    return new ServiceError('CONFLICT', 409, message, debug);
  }

  if (status === 422 || status === 400) {
    return new ServiceError('VALIDATION_ERROR', 400, message, debug);
  }

  if (status === 429) {
    return new ServiceError('RATE_LIMITED', 429, message, debug);
  }

  if (status >= 500) {
    return new ServiceError('UPSTREAM_UNAVAILABLE', 502, message, debug);
  }

  return new ServiceError('UPSTREAM_ERROR', 502, message, debug);
}

export function remnashopUnavailableError(path: string, cause: unknown) {
  return new ServiceError('UPSTREAM_UNAVAILABLE', 502, 'Upstream request failed', {
    message: cause instanceof Error ? cause.message : String(cause),
    upstreamPath: path,
    cause,
  });
}

export function remnashopInvalidJsonError(path: string, rawBody: string) {
  return new ServiceError('UPSTREAM_ERROR', 502, 'Upstream returned invalid JSON', {
    message: 'Invalid JSON response',
    upstreamPath: path,
    upstreamDetail: rawBody,
  });
}
