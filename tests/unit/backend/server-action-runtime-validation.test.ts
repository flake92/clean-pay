import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executePayment: vi.fn(),
  verifyPasskeyLogin: vi.fn(),
  verifyPasskeyRegistration: vi.fn(),
}));

vi.mock("@/application/payments/checkout", () => ({
  executePayment: mocks.executePayment,
}));
vi.mock("@/application/payments/execute-payment-workflow", () => ({
  executePaymentWorkflow: vi.fn(),
}));
vi.mock("@/application/auth/execute-passkey-command", () => ({
  beginPasskeyLogin: vi.fn(),
  beginPasskeyRegistration: vi.fn(),
  verifyPasskeyLogin: mocks.verifyPasskeyLogin,
  verifyPasskeyRegistration: mocks.verifyPasskeyRegistration,
}));
vi.mock("@/app/_composition/session-gateways", () => ({
  productionPaymentWorkflowGateway: {},
  productionPasskeyCommands: {},
}));
vi.mock("@/app/_composition/action-runtime", () => ({
  clearReferralAttributionCookie: vi.fn(),
}));

import { executePaymentAction } from "@/app/actions/payments";
import {
  verifyPasskeyLoginAction,
  verifyPasskeyRegistrationAction,
} from "@/app/actions/passkeys";
import {
  parseAuthenticationResponsePayload,
  parseEmailActionPayload,
  parseLinkAccountEmailPayload,
  parsePaymentCommandPayload,
  parsePaymentStatusPayload,
  parseProfilePasswordPayload,
  parseRegistrationResponsePayload,
} from "@/app/actions/runtime-payload";

const paymentCommand = {
  kind: "purchase" as const,
  idempotencyKey: "01890f47-a7df-7c2e-8b73-5d4c7f846e12",
  request: {
    plan_code: "basic",
    duration_days: 30,
    gateway_type: "CARD",
    confirmed_amount: "499.00",
    confirmed_currency: "RUB",
    offer_version: "offer-v1",
    return_url: "https://app.example.com/payment/return",
  },
};

describe("Server Action runtime payload boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["null", null],
    ["array", []],
    ["unknown command", { ...paymentCommand, kind: "refund" }],
    ["missing request", { kind: "purchase", idempotencyKey: paymentCommand.idempotencyKey }],
    ["fractional duration", {
      ...paymentCommand,
      request: { ...paymentCommand.request, duration_days: 30.5 },
    }],
    ["oversized offer", {
      ...paymentCommand,
      request: { ...paymentCommand.request, offer_version: "x".repeat(2_049) },
    }],
  ])("rejects malformed payment payload %s before the command gateway", async (_name, payload) => {
    await expect(executePaymentAction(payload as never)).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Не удалось подтвердить результат оплаты. Повторите попытку с тем же запросом.",
      retainIdempotencyKey: false,
    });
    expect(mocks.executePayment).not.toHaveBeenCalled();
  });

  it("projects a valid payment payload without changing its external contract", async () => {
    const result = {
      ok: true as const,
      status: "pending" as const,
      operationId: "operation-1",
      retryAfterSeconds: 5,
    };
    mocks.executePayment.mockResolvedValue(result);

    await expect(executePaymentAction(paymentCommand)).resolves.toBe(result);
    expect(mocks.executePayment).toHaveBeenCalledOnce();
    expect(mocks.executePayment.mock.calls[0]?.[1]).toEqual(paymentCommand);
  });

  it("validates and projects bounded email, account and status payloads", () => {
    expect(parseEmailActionPayload({
      email: "user@example.com",
      code: "123456",
      turnstileToken: "proof",
      ignored: "not-projected",
    }, { emailRequired: true, codeRequired: true })).toEqual({
      email: "user@example.com",
      code: "123456",
      turnstileToken: "proof",
    });
    expect(parseEmailActionPayload({ code: "12345" }, { codeRequired: true })).toBeNull();
    expect(parseLinkAccountEmailPayload({ email: "user@example.com", password: 7 })).toBeNull();
    expect(parseProfilePasswordPayload({
      currentPassword: "old-password",
      newPassword: "short",
    })).toBeNull();
    expect(parsePaymentStatusPayload({ paymentId: null, operationId: "operation_1" }))
      .toEqual({ paymentId: null, operationId: "operation_1" });
    expect(parsePaymentStatusPayload({ paymentId: null })).toBeNull();
  });

  it("requires the WebAuthn response envelope and bounds encoded values", () => {
    const authentication = {
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "client-data",
        authenticatorData: "authenticator-data",
        signature: "signature",
        userHandle: null,
        ignored: "not-projected",
      },
      ignored: "not-projected",
    };
    const registration = {
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "client-data",
        attestationObject: "attestation",
        transports: ["internal"],
      },
      name: "Ноутбук",
    };

    expect(parseAuthenticationResponsePayload(authentication)).toEqual({
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "client-data",
        authenticatorData: "authenticator-data",
        signature: "signature",
        userHandle: null,
      },
    });
    expect(parseRegistrationResponsePayload(registration)).toEqual(registration);
    expect(parseAuthenticationResponsePayload({ response: {} })).toBeNull();
    expect(parseRegistrationResponsePayload({
      ...registration,
      response: {
        ...registration.response,
        attestationObject: "x".repeat(262_145),
      },
    })).toBeNull();
  });

  it("rejects malformed WebAuthn actions before passkey gateway dispatch", async () => {
    await expect(verifyPasskeyLoginAction({ response: {} } as never)).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Быстрый вход не подошёл. Войдите по паролю.",
    });
    await expect(verifyPasskeyRegistrationAction({
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      clientExtensionResults: {},
      response: {
        clientDataJSON: "client-data",
        attestationObject: "x".repeat(262_145),
      },
    })).resolves.toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "Не удалось сохранить быстрый вход.",
    });
    expect(mocks.verifyPasskeyLogin).not.toHaveBeenCalled();
    expect(mocks.verifyPasskeyRegistration).not.toHaveBeenCalled();
  });

  it("rejects the legacy empty WebAuthn fixture at the production action boundary", async () => {
    vi.stubEnv("NODE_ENV", "production");

    try {
      await expect(verifyPasskeyLoginAction({} as never)).resolves.toEqual({
        ok: false,
        code: "VALIDATION_ERROR",
        message: "Быстрый вход не подошёл. Войдите по паролю.",
      });
      expect(mocks.verifyPasskeyLogin).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the payment parser fail-closed for non-record inputs", () => {
    expect(parsePaymentCommandPayload("purchase")).toBeNull();
    expect(parsePaymentCommandPayload({ ...paymentCommand, idempotencyKey: 42 })).toBeNull();
  });
});
