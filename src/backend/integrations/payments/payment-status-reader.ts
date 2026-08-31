import {
  PaymentStatusGatewayError,
  type PaymentStatusAuthorization,
  type PaymentStatusReader,
  type PaymentStatusTransaction,
} from "@/application/payments/ports/payment-status-reader";
import { prismaPaymentQueryRepository } from "@/backend/integrations/payments/prisma-payment-query-repository";
import { remnashopValidatedRequest } from "@/backend/integrations/remnashop/api-client-runtime";
import { getAuthorizedRemnashopTokens, getRemnashopUserIdFromAccessToken } from "@/backend/integrations/remnashop/client";
import { ServiceError } from "@/backend/errors/service-error";
import { getExactTransaction, getLegacyTransactions, getPaymentCapabilities } from "@/backend/integrations/remnashop/payment-recovery";
import { isPaymentManualRequired } from "@/backend/payments/manual-review";
import { assertPaymentUpstreamIdentity } from "@/backend/integrations/payments/payment-owner-service";
import { serializePaymentRecord, syncExactPaymentRecordFromRemnashop, syncPaymentRecordsFromRemnashopTransactions } from "@/backend/integrations/payments/payment-record-service";
import { getCurrentUser } from "@/backend/integrations/sessions/web-session-service";
import type { CurrentSubscriptionResponse, PaymentTransactionResponse } from "@/backend/integrations/remnashop/contracts";

type AuthorizationContext = Awaited<ReturnType<typeof getAuthorizedRemnashopTokens>>;
type UserReader = () => ReturnType<typeof getCurrentUser>;
type Authorizer = () => Promise<AuthorizationContext>;
function authorization(value: PaymentStatusAuthorization) { return value.context as AuthorizationContext; }
function transaction(value: PaymentStatusTransaction) { return value.context as PaymentTransactionResponse; }

function translate(error: unknown): never {
  if (error instanceof PaymentStatusGatewayError) throw error;
  throw new PaymentStatusGatewayError(error instanceof ServiceError ? error.code : "INTERNAL_ERROR");
}
async function adapt<T>(work: () => Promise<T>): Promise<T> {
  try { return await work(); } catch (error) { translate(error); }
}

async function operation(userId: string, operationId: string | null) {
  const record = await prismaPaymentQueryRepository.findOperation(userId, operationId);
  return record ? {
    id: record.id,
    status: record.status,
    manualRequired: isPaymentManualRequired(record),
    paymentId: record.paymentRecord?.paymentId ?? null,
    paymentStatus: record.paymentRecord?.status ?? null,
    payment: record.paymentRecord ? serializePaymentRecord(record.paymentRecord) : null,
  } : null;
}

export function createProductionPaymentStatusReader(
  readUser: UserReader = getCurrentUser,
  authorizeSession: Authorizer = getAuthorizedRemnashopTokens,
): PaymentStatusReader {
  return {
  async loadActor() {
    const user = await adapt(readUser);
    if (!user) return null;
    return { id: user.id, emailVerified: user.emailVerified, telegramId: user.telegramId };
  },
  findOperation: operation,
  async authorize() {
    const authorized = await adapt(authorizeSession);
    return { context: authorized, upstreamAccountId: getRemnashopUserIdFromAccessToken(authorized.accessToken) };
  },
  async assertUpstreamOwner(userId, upstreamAccountId) {
    await adapt(() => assertPaymentUpstreamIdentity(userId, upstreamAccountId));
  },
  async loadCapabilities(value) {
    const capabilities = await adapt(() => getPaymentCapabilities(authorization(value).accessToken));
    return capabilities ? { maxPageSize: capabilities.transactions.max_page_size } : null;
  },
  async loadExactTransaction(value, paymentId) {
    const item = await adapt(() => getExactTransaction({ accessToken: authorization(value).accessToken, paymentId }));
    return item ? { context: item } : null;
  },
  async persistExactTransaction(userId, upstreamAccountId, value) {
    await adapt(() => syncExactPaymentRecordFromRemnashop({ userId, upstreamAccountId, transaction: transaction(value) }));
  },
  async loadLegacyTransactions(value) {
    return (await adapt(() => getLegacyTransactions(authorization(value).accessToken))).map((item) => ({ context: item }));
  },
  async persistLegacyTransactions(userId, upstreamAccountId, values) {
    await adapt(() => syncPaymentRecordsFromRemnashopTransactions({ userId, upstreamAccountId, transactions: values.map(transaction) }));
  },
  async loadSubscription(value) {
    return adapt(() => remnashopValidatedRequest<CurrentSubscriptionResponse | null>("/subscription/current", { accessToken: authorization(value).accessToken }));
  },
  async findPayment(userId, paymentId) {
    const record = await prismaPaymentQueryRepository.findRecord(userId, paymentId);
    return record ? serializePaymentRecord(record) : null;
  },
  async findLatestPayment(userId) {
    const record = await prismaPaymentQueryRepository.findLatestRecord(userId);
    return record ? serializePaymentRecord(record) : null;
  },
  isSubscriptionMissing(error) {
    return error instanceof PaymentStatusGatewayError && error.code === "SUBSCRIPTION_NOT_FOUND";
  },
  };
}
