import { NextResponse } from 'next/server';

import { logTechnicalError } from '@/backend/observability/audit';
import { logger } from '@/backend/observability/logger';
import { BffError } from '@/backend/integrations/remnashop/errors';

function isDevelopment() {
  return process.env.NODE_ENV !== 'production';
}

type BffErrorLike = {
  code: string;
  status: number;
  message?: string;
  prodMessage?: string;
  debug?: BffError["debug"];
};

function debugPayload(error: BffErrorLike) {
  if (!isDevelopment()) {
    return undefined;
  }

  return {
        message: error.message,
        ...error.debug,
      };
}

function isBffErrorLike(error: unknown): error is BffError | BffErrorLike {
  return (
    error instanceof BffError ||
    Boolean(
      error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string" &&
        "status" in error &&
        typeof (error as { status?: unknown }).status === "number",
    )
  );
}

export function bffJson<T>(data: T, init?: ResponseInit) {
  logger.info("bff_response_sent", {
    status: init?.status ?? 200,
    hasData: data !== undefined,
  }, {
    category: "bff",
    source: "bff.response",
    message: `BFF Response -> ${init?.status ?? 200}`,
  });

  return NextResponse.json({ data }, init);
}

export function bffError(error: unknown) {
  logTechnicalError('bff_error', error);
  if (isBffErrorLike(error)) {
    const debug = debugPayload(error);
    const message = error instanceof BffError || typeof error.prodMessage === "string"
      ? error.prodMessage
      : error instanceof Error
        ? error.message
        : "Request failed";
    const body = {
      error: {
        code: error.code,
        message: isDevelopment() ? error.message : message,
        ...(debug ? { debug } : {}),
      },
    };

    logger.warn("bff_error_response_sent", {
      status: error.status,
      code: error.code,
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
    code: "INTERNAL_ERROR",
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
