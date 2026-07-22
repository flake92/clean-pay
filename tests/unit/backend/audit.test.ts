import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  headers: new Headers(),
}));

const mocks = vi.hoisted(() => ({
  prisma: {
    auditLog: { create: vi.fn() },
  },
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
  sanitizeLogValue: vi.fn((value: unknown) => value),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => state.headers),
}));

vi.mock("@/backend/database/prisma", () => ({
  prisma: mocks.prisma,
}));

vi.mock("@/backend/observability/logger", () => ({
  logger: mocks.logger,
  sanitizeLogValue: mocks.sanitizeLogValue,
}));

import {
  auditLog,
  logTechnicalError,
  logTechnicalInfo,
  logTechnicalWarning,
} from "@/backend/observability/audit";
import { BffError } from "@/backend/integrations/remnashop/errors";

describe("audit logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    state.headers = new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2" });
  });

  it("writes sanitized audit log with hashed ip", async () => {
    await auditLog({
      action: "auth_login_success",
      userId: "user-1",
      metadata: { email: "user@example.com" },
    });

    expect(mocks.sanitizeLogValue).toHaveBeenCalledWith({ email: "user@example.com" });
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: "user-1",
        action: "auth_login_success",
        severity: "INFO",
        ipHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        metadata: { email: "user@example.com" },
      }),
    });
  });

  it("logs write failures without throwing", async () => {
    mocks.prisma.auditLog.create.mockRejectedValueOnce(new Error("db down"));

    await expect(auditLog({ action: "failed" })).resolves.toBeUndefined();
    expect(mocks.logger.error).toHaveBeenCalledWith("audit_write_failed", expect.objectContaining({ action: "failed" }), {
      category: "audit",
    });
  });

  it("logs technical errors, warnings and info", () => {
    logTechnicalError("bff_error", new BffError("UNAUTHORIZED", 401, "no"), { token: "secret" });
    logTechnicalWarning("warn_event", { ok: true });
    logTechnicalInfo("info_event", { ok: true });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "bff_error",
      expect.objectContaining({ code: "UNAUTHORIZED", status: 401, message: "no" }),
      { category: "technical" },
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith("warn_event", { metadata: { ok: true } }, { category: "technical" });
    expect(mocks.logger.info).toHaveBeenCalledWith("info_event", { metadata: { ok: true } }, { category: "technical" });
  });

  it("keeps production technical logs metadata-only and payload-free", () => {
    vi.stubEnv("NODE_ENV", "production");

    logTechnicalError(
      "bff_error",
      new BffError("VALIDATION_ERROR", 400, "email user@example.com token secret"),
      {
        email: "user@example.com",
        token: "secret-token",
        body: { password: "secret" },
      },
    );
    logTechnicalWarning("warn_event", { body: { token: "secret-token" } });
    logTechnicalInfo("info_event", { response: { idToken: "id-token" } });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "bff_error",
      {
        code: "VALIDATION_ERROR",
        status: 400,
        message: undefined,
      },
      { category: "technical" },
    );
    expect(mocks.logger.warn).toHaveBeenCalledWith("warn_event", {}, { category: "technical" });
    expect(mocks.logger.info).toHaveBeenCalledWith("info_event", {}, { category: "technical" });
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("user@example.com");
    expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain("secret-token");
  });
});
