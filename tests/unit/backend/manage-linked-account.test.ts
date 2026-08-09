import { describe, expect, it, vi } from "vitest";

import {
  confirmLinkedTelegram,
  linkAccountEmail,
} from "@/application/auth/manage-linked-account";
import { ServiceError } from "@/backend/errors/service-error";

function mockCommands(overrides: Record<string, () => Promise<void>> = {}) {
  return {
    linkEmail: vi.fn(async () => ({ linked: true })),
    confirmTelegramMerge: vi.fn(async () => undefined),
    cancelTelegramMerge: vi.fn(async () => undefined),
    deletePasskey: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("failed() error message mapping", () => {
  it("uses ServiceError.prodMessage for ACCOUNT_MERGE_REQUIRED", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("ACCOUNT_MERGE_REQUIRED", 409, "custom debug message");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "ACCOUNT_MERGE_REQUIRED",
      message: "Этот Telegram уже привязан к другой почте. Сначала объедините аккаунты через поддержку.",
    });
  });

  it("uses ServiceError.prodMessage for NOT_FOUND", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("NOT_FOUND", 404, "confirmation expired");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "Данные не найдены.",
    });
  });

  it("uses ServiceError.prodMessage for CONFLICT", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("CONFLICT", 409, "already processing");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Не удалось выполнить действие. Проверьте данные и попробуйте снова.",
    });
  });

  it("uses ServiceError.prodMessage for UPSTREAM_UNAVAILABLE", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("UPSTREAM_UNAVAILABLE", 502, "remnashop down");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "UPSTREAM_UNAVAILABLE",
      message: "Сервис временно недоступен. Попробуйте позже.",
    });
  });

  it("uses specific message for AUTH_FAILED", async () => {
    const commands = mockCommands({
      linkEmail: vi.fn(async () => {
        throw new ServiceError("AUTH_FAILED", 401, "bad credentials");
      }),
    });

    const result = await linkAccountEmail(commands, { email: "test@test.com", password: "wrong" });
    expect(result).toEqual({
      ok: false,
      code: "AUTH_FAILED",
      message: "Неверный e-mail или пароль.",
    });
  });

  it("uses specific message for UNAUTHORIZED", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("UNAUTHORIZED", 401, "no session");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "Сессия завершилась. Войдите снова.",
    });
  });

  it("falls back to generic message for non-ServiceError", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new Error("something unexpected");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "Не удалось объединить аккаунты.",
    });
  });

  it("uses ServiceError.prodMessage for ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT", 409, "both have subs");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "ACCOUNT_MERGE_SUBSCRIPTIONS_CONFLICT",
      message: "В обеих учётных записях есть подписки. Данные не изменены — обратитесь в службу поддержки.",
    });
  });

  it("uses ServiceError.prodMessage for RATE_LIMITED", async () => {
    const commands = mockCommands({
      confirmTelegramMerge: vi.fn(async () => {
        throw new ServiceError("RATE_LIMITED", 429, "too many attempts");
      }),
    });

    const result = await confirmLinkedTelegram(commands);
    expect(result).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      message: "Слишком много попыток. Попробуйте позже.",
    });
  });
});
