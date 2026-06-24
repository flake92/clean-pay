import { NextResponse } from 'next/server';

import { logTechnicalError } from '@/lib/audit';
import { logger } from '@/lib/logger';
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
  logger.info("bff_response_sent", {
    status: init?.status ?? 200,
    body: { data },
  }, {
    category: "bff",
    source: "bff.response",
    message: `BFF Response -> ${init?.status ?? 200}`,
  });

  return NextResponse.json({ data }, init);
}

export function bffError(error: unknown) {
  logTechnicalError('bff_error', error);
  if (error instanceof BffError) {
    const debug = debugPayload(error);
    const body = {
      error: {
        code: error.code,
        message: isDevelopment() ? error.message : error.prodMessage,
        ...(debug ? { debug } : {}),
      },
    };

    logger.warn("bff_error_response_sent", {
      status: error.status,
      body,
    }, {
      category: "bff",
      source: "bff.response",
      message: `BFF Error Response -> ${error.status} ${error.code}`,
    });

    return NextResponse.json(
      body,
      { status: error.status },
    );
  }

  const debug = isDevelopment()
    ? { message: error instanceof Error ? error.message : String(error) }
    : undefined;
  const body = {
    error: {
      code: 'INTERNAL_ERROR',
      message: isDevelopment()
        ? (debug?.message ?? 'Internal service error')
        : 'Внутренняя ошибка сервиса.',
      ...(debug ? { debug } : {}),
    },
  };

  logger.error("bff_error_response_sent", {
    status: 500,
    body,
  }, {
    category: "bff",
    source: "bff.response",
    message: "BFF Error Response -> 500 INTERNAL_ERROR",
  });

  return NextResponse.json(
    body,
    { status: 500 },
  );
}
