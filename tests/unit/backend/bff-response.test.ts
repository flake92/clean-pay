import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  logTechnicalError: vi.fn(),
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
}));

vi.mock("@/backend/observability/audit", () => ({
  logTechnicalError: mocks.logTechnicalError,
}));

import { bffError, bffJson } from "@/backend/http/bff-response";
import { BffError } from "@/backend/integrations/remnashop/errors";

describe("BFF response logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not log successful response bodies", async () => {
    const response = bffJson({ email: "user@example.com", token: "secret-token" });

    await expect(response.json()).resolves.toEqual({
      data: { email: "user@example.com", token: "secret-token" },
    });
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "bff_response_sent",
      { status: 200, hasData: true },
      expect.objectContaining({ category: "bff" }),
    );
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain("user@example.com");
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain("secret-token");
  });

  it("logs only error status and code for BFF errors", async () => {
    const response = bffError(new BffError("VALIDATION_ERROR", 400, "bad email user@example.com"));

    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "bff_error_response_sent",
      { status: 400, code: "VALIDATION_ERROR" },
      expect.objectContaining({ category: "bff" }),
    );
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain("user@example.com");
  });

  it("handles serialized BFF-like errors without converting them to internal errors", async () => {
    const response = bffError({
      code: "VALIDATION_ERROR",
      status: 400,
      message: "Turnstile token is required",
      prodMessage: "Проверьте введённые данные.",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: expect.any(String),
      },
    });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "bff_error_response_sent",
      { status: 400, code: "VALIDATION_ERROR" },
      expect.objectContaining({ category: "bff" }),
    );
  });
});
