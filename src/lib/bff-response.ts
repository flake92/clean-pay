import { NextResponse } from "next/server";

import { BffError } from "@/lib/remnashop/errors";

export function bffJson<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ data }, init);
}

export function bffError(error: unknown) {
  if (error instanceof BffError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Внутренняя ошибка сервиса.",
      },
    },
    { status: 500 },
  );
}
