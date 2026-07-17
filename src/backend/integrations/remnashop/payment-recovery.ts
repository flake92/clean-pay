import {
  remnashopAdminRequestResult,
  remnashopRequest,
  remnashopRequestResult,
} from "@/backend/integrations/remnashop/client";
import { BffError } from "@/backend/integrations/remnashop/errors";
import type {
  PaymentInitResponse,
  PaymentTransactionResponse,
} from "@/shared/remnashop/types";

const RECOVERY_TIMEOUT_MS = 10_000;
const MAX_CURSOR_LENGTH = 8_192;
const MAX_TEXT_LENGTH = 2_048;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const PAYMENT_STATES = [
  "SUCCEEDED",
  "IN_PROGRESS",
  "UNKNOWN",
  "MANUAL_REQUIRED",
] as const;
const PURCHASE_TYPES = ["NEW", "RENEW", "CHANGE"] as const;

export type RemnashopPaymentOperation = "PURCHASE" | "EXTEND";
export type RemnashopPaymentRecoveryState = (typeof PAYMENT_STATES)[number];

export type RemnashopPaymentCapabilities = {
  contract_version: 1;
  transactions: {
    keyset_pagination: true;
    exact_lookup: true;
    max_page_size: number;
  };
  payment_reconciliation: {
    operation_lookup: true;
    user_reconcile: true;
    admin_reconcile: true;
    states: RemnashopPaymentRecoveryState[];
    auto_replay_gateways: string[];
  };
};

export type RemnashopTransactionPage = {
  items: PaymentTransactionResponse[];
  next_cursor: string | null;
};

export type RemnashopPaymentRecovery = {
  operation: RemnashopPaymentOperation;
  state: RemnashopPaymentRecoveryState;
  payment: PaymentInitResponse | null;
  transaction: PaymentTransactionResponse | null;
  retry_after_seconds: number | null;
};

function invalidContract(path: string, reason: string): never {
  throw new BffError(
    "UPSTREAM_ERROR",
    502,
    `Remnashop payment recovery response is invalid: ${reason}`,
    { upstreamPath: path },
  );
}

function objectValue(
  value: unknown,
  path: string,
  field = "response",
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidContract(path, `${field} must be an object`);
  }

  return value as Record<string, unknown>;
}

function textValue(
  value: unknown,
  path: string,
  field: string,
  nullable?: false,
): string;
function textValue(
  value: unknown,
  path: string,
  field: string,
  nullable: true,
): string | null;
function textValue(
  value: unknown,
  path: string,
  field: string,
  nullable = false,
) {
  if (nullable && value === null) {
    return null;
  }

  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TEXT_LENGTH
  ) {
    return invalidContract(path, `${field} must be a non-empty string`);
  }

  return value;
}

function nullableInteger(value: unknown, path: string, field: string) {
  if (value === null) {
    return null;
  }

  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return invalidContract(path, `${field} must be a non-negative integer or null`);
  }

  return Number(value);
}

function dateValue(value: unknown, path: string, field: string) {
  const text = textValue(value, path, field);
  const match = RFC3339_PATTERN.exec(text);

  if (!match) {
    return invalidContract(path, `${field} must be an RFC3339 date-time`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (daysInMonth[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return invalidContract(path, `${field} must be a valid RFC3339 date-time`);
  }

  const date = new Date(text);

  if (!Number.isFinite(date.getTime())) {
    return invalidContract(path, `${field} must be a valid RFC3339 date-time`);
  }

  return text;
}

function amountValue(value: unknown, path: string, field: string) {
  const text = textValue(value, path, field);

  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(text)) {
    return invalidContract(path, `${field} must be a non-negative decimal amount`);
  }

  return text;
}

export function parsePaymentTransaction(
  value: unknown,
  path = "/subscription/transactions",
): PaymentTransactionResponse {
  const item = objectValue(value, path, "transaction");

  const purchaseType = textValue(item.purchase_type, path, "purchase_type");
  const paymentId = textValue(item.payment_id, path, "payment_id");
  const status = textValue(item.status, path, "status");
  const gatewayType = textValue(item.gateway_type, path, "gateway_type");
  const currency = textValue(item.currency, path, "currency");

  if (!UUID_PATTERN.test(paymentId)) {
    return invalidContract(path, "payment_id must be a UUID");
  }

  if (!PURCHASE_TYPES.includes(purchaseType as (typeof PURCHASE_TYPES)[number])) {
    return invalidContract(path, "purchase_type is unsupported");
  }

  if (
    !["pending", "completed", "failed", "canceled", "refunded"].includes(
      status.toLowerCase(),
    )
  ) {
    return invalidContract(path, "status is unsupported");
  }

  if (!/^[A-Z][A-Z0-9_-]{0,63}$/.test(gatewayType)) {
    return invalidContract(path, "gateway_type is unsupported");
  }

  if (!/^[^\u0000-\u001F\u007F-\u009F]{1,16}$/u.test(currency)) {
    return invalidContract(path, "currency must be a bounded printable value");
  }

  const createdAt = dateValue(item.created_at, path, "created_at");
  const updatedAt = dateValue(item.updated_at, path, "updated_at");

  if (new Date(updatedAt) < new Date(createdAt)) {
    return invalidContract(path, "updated_at must not precede created_at");
  }

  return {
    payment_id: paymentId,
    purchase_type: purchaseType,
    status,
    gateway_type: gatewayType,
    final_amount: amountValue(item.final_amount, path, "final_amount"),
    currency,
    plan_name: textValue(item.plan_name, path, "plan_name", true),
    duration_days: nullableInteger(item.duration_days, path, "duration_days"),
    device_limit: nullableInteger(item.device_limit, path, "device_limit"),
    traffic_limit: nullableInteger(item.traffic_limit, path, "traffic_limit"),
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

export function parsePaymentInit(
  value: unknown,
  path: string,
): PaymentInitResponse {
  const payment = objectValue(value, path, "payment");

  if (typeof payment.is_free !== "boolean") {
    return invalidContract(path, "payment.is_free must be a boolean");
  }

  const purchaseType = textValue(
    payment.purchase_type,
    path,
    "payment.purchase_type",
  );
  const status = textValue(payment.status, path, "payment.status");
  const currency = textValue(payment.currency, path, "payment.currency");
  const paymentId = textValue(
    payment.payment_id,
    path,
    "payment.payment_id",
  );
  const paymentUrl = textValue(
    payment.payment_url,
    path,
    "payment.payment_url",
    true,
  );

  if (!UUID_PATTERN.test(paymentId)) {
    return invalidContract(path, "payment.payment_id must be a UUID");
  }

  if (paymentUrl !== null) {
    try {
      const parsedUrl = new URL(paymentUrl);

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error();
      }
    } catch {
      return invalidContract(path, "payment.payment_url must be an http(s) URL or null");
    }
  }

  if (!PURCHASE_TYPES.includes(purchaseType as (typeof PURCHASE_TYPES)[number])) {
    return invalidContract(path, "payment.purchase_type is unsupported");
  }

  if (
    !["pending", "completed", "failed", "canceled", "refunded"].includes(
      status.toLowerCase(),
    )
  ) {
    return invalidContract(path, "payment.status is unsupported");
  }

  if (!/^[^\u0000-\u001F\u007F-\u009F]{1,16}$/u.test(currency)) {
    return invalidContract(path, "payment.currency must be a bounded printable value");
  }

  const finalAmount = amountValue(
    payment.final_amount,
    path,
    "payment.final_amount",
  );
  const isZeroAmount = /^0+(?:\.0{1,2})?$/.test(finalAmount);

  if (payment.is_free !== isZeroAmount) {
    return invalidContract(
      path,
      "payment.is_free must match whether final_amount is zero",
    );
  }

  return {
    payment_id: paymentId,
    payment_url: paymentUrl,
    purchase_type: purchaseType,
    status,
    is_free: payment.is_free,
    final_amount: finalAmount,
    currency,
  };
}

export function parsePaymentCapabilities(
  value: unknown,
): RemnashopPaymentCapabilities {
  const path = "/subscription/capabilities";
  const root = objectValue(value, path);
  const transactions = objectValue(root.transactions, path, "transactions");
  const reconciliation = objectValue(
    root.payment_reconciliation,
    path,
    "payment_reconciliation",
  );
  const states = reconciliation.states;
  const autoReplayGateways = reconciliation.auto_replay_gateways;

  if (
    root.contract_version !== 1 ||
    transactions.keyset_pagination !== true ||
    transactions.exact_lookup !== true ||
    !Number.isSafeInteger(transactions.max_page_size) ||
    Number(transactions.max_page_size) < 1 ||
    Number(transactions.max_page_size) > 100 ||
    reconciliation.operation_lookup !== true ||
    reconciliation.user_reconcile !== true ||
    reconciliation.admin_reconcile !== true ||
    !Array.isArray(states) ||
    states.length !== PAYMENT_STATES.length ||
    !PAYMENT_STATES.every(
      (state) => states.filter((item: unknown) => item === state).length === 1,
    ) ||
    !Array.isArray(autoReplayGateways) ||
    !autoReplayGateways.every(
      (gateway) =>
        typeof gateway === "string" &&
        gateway.length > 0 &&
        gateway.length <= 100,
    )
  ) {
    return invalidContract(path, "unsupported or malformed v1 capabilities");
  }

  return {
    contract_version: 1,
    transactions: {
      keyset_pagination: true,
      exact_lookup: true,
      max_page_size: Number(transactions.max_page_size),
    },
    payment_reconciliation: {
      operation_lookup: true,
      user_reconcile: true,
      admin_reconcile: true,
      states: [...states] as RemnashopPaymentRecoveryState[],
      auto_replay_gateways: [...autoReplayGateways] as string[],
    },
  };
}

export function parseTransactionPage(
  value: unknown,
): RemnashopTransactionPage {
  const path = "/subscription/transactions/page";
  const root = objectValue(value, path);

  if (!Array.isArray(root.items) || root.items.length > 100) {
    return invalidContract(path, "items must be an array of at most 100 rows");
  }

  if (
    root.next_cursor !== null &&
    (typeof root.next_cursor !== "string" ||
      root.next_cursor.length === 0 ||
      root.next_cursor.length > MAX_CURSOR_LENGTH)
  ) {
    return invalidContract(path, "next_cursor must be a bounded string or null");
  }

  return {
    items: root.items.map((item) => parsePaymentTransaction(item, path)),
    next_cursor: root.next_cursor as string | null,
  };
}

export function parseLegacyTransactions(
  value: unknown,
): PaymentTransactionResponse[] {
  const path = "/subscription/transactions";

  if (!Array.isArray(value) || value.length > 20) {
    return invalidContract(path, "legacy response must contain at most 20 rows");
  }

  return value.map((item) => parsePaymentTransaction(item, path));
}

export function parsePaymentRecovery(
  value: unknown,
  expectedOperation: RemnashopPaymentOperation,
): RemnashopPaymentRecovery {
  const path = `/subscription/payment-operations/${expectedOperation}`;
  const root = objectValue(value, path);

  if (root.operation !== expectedOperation) {
    return invalidContract(path, "operation does not match the requested operation");
  }

  if (
    typeof root.state !== "string" ||
    !PAYMENT_STATES.includes(root.state as RemnashopPaymentRecoveryState)
  ) {
    return invalidContract(path, "state is unsupported");
  }

  const state = root.state as RemnashopPaymentRecoveryState;
  const retryAfter = nullableInteger(
    root.retry_after_seconds,
    path,
    "retry_after_seconds",
  );

  if (retryAfter !== null && (retryAfter < 1 || retryAfter > 86_400)) {
    return invalidContract(path, "retry_after_seconds is outside the safe range");
  }

  if (state === "SUCCEEDED") {
    if (retryAfter !== null) {
      return invalidContract(path, "SUCCEEDED must not include retry_after_seconds");
    }
    const payment = parsePaymentInit(root.payment, path);
    const transaction = parsePaymentTransaction(root.transaction, path);

    if (payment.payment_id !== transaction.payment_id) {
      return invalidContract(path, "payment and transaction ids differ");
    }

    if (
      payment.purchase_type !== transaction.purchase_type ||
      payment.status.toLowerCase() !== transaction.status.toLowerCase() ||
      payment.final_amount !== transaction.final_amount ||
      payment.currency !== transaction.currency
    ) {
      return invalidContract(
        path,
        "payment and transaction status/commercial fields differ",
      );
    }

    return {
      operation: expectedOperation,
      state,
      payment,
      transaction,
      retry_after_seconds: retryAfter,
    };
  }

  if (root.payment !== null || root.transaction !== null) {
    return invalidContract(path, "unsettled operation must not contain payment data");
  }

  if (
    (state === "IN_PROGRESS" || state === "UNKNOWN") &&
    retryAfter === null
  ) {
    return invalidContract(path, `${state} must include retry_after_seconds`);
  }

  if (
    state !== "IN_PROGRESS" &&
    state !== "UNKNOWN" &&
    retryAfter !== null
  ) {
    return invalidContract(path, `${state} must not include retry_after_seconds`);
  }

  return {
    operation: expectedOperation,
    state,
    payment: null,
    transaction: null,
    retry_after_seconds: retryAfter,
  };
}

export async function getPaymentCapabilities(accessToken: string) {
  const value = await remnashopRequest<unknown>(
    "/subscription/capabilities",
    { accessToken, timeoutMs: RECOVERY_TIMEOUT_MS, allowNotFound: true },
  );

  return value === null ? null : parsePaymentCapabilities(value);
}

export async function getTransactionPage(input: {
  accessToken: string;
  cursor: string | null;
  limit: number;
}) {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new BffError("INTERNAL_ERROR", 500, "Invalid transaction page size");
  }

  const params = new URLSearchParams({ limit: String(input.limit) });

  if (input.cursor) {
    params.set("cursor", input.cursor);
  }

  const value = await remnashopRequest<unknown>(
    `/subscription/transactions/page?${params.toString()}`,
    { accessToken: input.accessToken, timeoutMs: RECOVERY_TIMEOUT_MS },
  );

  return parseTransactionPage(value);
}

export async function getExactTransaction(input: {
  accessToken: string;
  paymentId: string;
}) {
  const paymentId = textValue(input.paymentId, "local", "paymentId");
  const value = await remnashopRequest<unknown>(
    `/subscription/transactions/by-id/${encodeURIComponent(paymentId)}`,
    {
      accessToken: input.accessToken,
      timeoutMs: RECOVERY_TIMEOUT_MS,
      allowNotFound: true,
    },
  );

  if (value === null) {
    return null;
  }

  const transaction = parsePaymentTransaction(
    value,
    "/subscription/transactions/by-id/{payment_id}",
  );

  if (transaction.payment_id !== paymentId) {
    return invalidContract(
      "/subscription/transactions/by-id/{payment_id}",
      "payment_id does not match the requested transaction",
    );
  }

  return transaction;
}

export async function getLegacyTransactions(accessToken: string) {
  const value = await remnashopRequest<unknown>("/subscription/transactions", {
    accessToken,
    timeoutMs: RECOVERY_TIMEOUT_MS,
  });

  return parseLegacyTransactions(value);
}

export async function reconcilePaymentOperation(input: {
  accessToken: string;
  operation: RemnashopPaymentOperation;
  idempotencyKey: string;
  trigger: boolean;
}) {
  const path = `/subscription/payment-operations/${input.operation}`;
  const result = await remnashopRequestResult<unknown>(path, {
    method: input.trigger ? "POST" : "GET",
    accessToken: input.accessToken,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: RECOVERY_TIMEOUT_MS,
    allowNotFound: true,
  });

  if (result.status === 404) {
    return null;
  }

  const recovery = parsePaymentRecovery(result.data, input.operation);
  const expectedStatus = recovery.state === "SUCCEEDED" ? 200 : 202;

  if (result.status !== expectedStatus) {
    return invalidContract(
      path,
      `${recovery.state} must use HTTP ${expectedStatus}`,
    );
  }

  return recovery;
}

export async function reconcilePaymentOperationAsAdmin(input: {
  remnashopUserId: string;
  operation: RemnashopPaymentOperation;
  idempotencyKey: string;
  trigger: boolean;
}) {
  const params = new URLSearchParams({ user_id: input.remnashopUserId });
  const path = `/payment-operations/${input.operation}?${params.toString()}`;
  const result = await remnashopAdminRequestResult<unknown>(path, {
    method: input.trigger ? "POST" : "GET",
    idempotencyKey: input.idempotencyKey,
    timeoutMs: RECOVERY_TIMEOUT_MS,
    allowNotFound: true,
  });

  if (result.status === 404) {
    return null;
  }

  const recovery = parsePaymentRecovery(result.data, input.operation);
  const expectedStatus = recovery.state === "SUCCEEDED" ? 200 : 202;

  if (result.status !== expectedStatus) {
    return invalidContract(
      `/payment-operations/${input.operation}`,
      `${recovery.state} must use HTTP ${expectedStatus}`,
    );
  }

  return recovery;
}
