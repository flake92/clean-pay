import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  remnashopRequest: vi.fn(),
  authDebugLog: vi.fn(),
}));

vi.mock("@/backend/integrations/remnashop/client", () => ({
  remnashopRequest: mocks.remnashopRequest,
}));
vi.mock("@/backend/observability/auth-debug-log", () => ({
  authDebugLog: mocks.authDebugLog,
}));

import { ServiceError } from "@/backend/errors/service-error";
import { requestRemnashopEmailVerification } from "@/backend/integrations/auth/email-verification-delivery";

const input = {
  accessToken: "access-token",
  body: { email: "user@example.com" },
  source: "profile_change_email",
};

describe("Remnashop email verification delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns the provider response without scheduling a retry", async () => {
    const response = { message: "sent" };
    mocks.remnashopRequest.mockResolvedValue(response);

    await expect(requestRemnashopEmailVerification(input)).resolves.toBe(response);
    expect(mocks.remnashopRequest).toHaveBeenCalledWith(
      "/auth/email/request-verification",
      { method: "POST", accessToken: "access-token", body: input.body },
    );
    expect(mocks.authDebugLog).not.toHaveBeenCalled();
  });

  it("retries a transient delivery failure and records each scheduled retry", async () => {
    vi.useFakeTimers();
    const transient = new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Provider unavailable",
      { message: "Failed to send verification email" },
    );
    mocks.remnashopRequest
      .mockRejectedValueOnce(transient)
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ message: "sent" });

    const request = requestRemnashopEmailVerification(input);
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual({ message: "sent" });
    expect(mocks.remnashopRequest).toHaveBeenCalledTimes(3);
    expect(mocks.authDebugLog).toHaveBeenNthCalledWith(1, "email_verification_request_retry_scheduled", {
      source: "profile_change_email", attempt: 1, nextAttempt: 2, maxAttempts: 3,
    });
    expect(mocks.authDebugLog).toHaveBeenNthCalledWith(2, "email_verification_request_retry_scheduled", {
      source: "profile_change_email", attempt: 2, nextAttempt: 3, maxAttempts: 3,
    });
  });

  it("stops after three transient failures", async () => {
    vi.useFakeTimers();
    const transient = new ServiceError(
      "UPSTREAM_UNAVAILABLE",
      503,
      "Failed to send verification email",
    );
    mocks.remnashopRequest.mockRejectedValue(transient);

    const request = requestRemnashopEmailVerification(input);
    const rejection = expect(request).rejects.toBe(transient);
    await vi.runAllTimersAsync();

    await rejection;
    expect(mocks.remnashopRequest).toHaveBeenCalledTimes(3);
    expect(mocks.authDebugLog).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated provider errors", async () => {
    const rejected = new ServiceError("VALIDATION_ERROR", 422, "Invalid email");
    mocks.remnashopRequest.mockRejectedValue(rejected);

    await expect(requestRemnashopEmailVerification(input)).rejects.toBe(rejected);
    expect(mocks.remnashopRequest).toHaveBeenCalledTimes(1);
    expect(mocks.authDebugLog).not.toHaveBeenCalled();
  });
});
