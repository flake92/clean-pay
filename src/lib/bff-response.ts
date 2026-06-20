import { NextResponse } from 'next/server';

import { BffError } from '@/lib/remnashop/errors';

function isDevelopment() {
  return process.env.NODE_ENV !== 'production';
}

function debugPayload(error: BffError) {
  if (!isDevelopment()) {
    return undefined;
  }

  return {
    message: error.message,
    ...error.debug,
  };
}

export function bffJson<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function bffError(error: unknown) {
  if (error instanceof BffError) {
    const debug = debugPayload(error);

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: isDevelopment() ? error.message : error.prodMessage,
          ...(debug ? { debug } : {}),
        },
      },
      { status: error.status },
    );
  }

  const debug = isDevelopment()
    ? { message: error instanceof Error ? error.message : String(error) }
    : undefined;

  return NextResponse.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: isDevelopment()
          ? (debug?.message ?? 'Internal service error')
          : 'Внутренняя ошибка сервиса.',
        ...(debug ? { debug } : {}),
      },
    },
    { status: 500 },
  );
}
