import type { PaymentRecordStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type { PaymentInitResponse, PlanOffer } from "@/lib/remnashop/types";

type RecordPaymentInput = {
  userId: string;
  gatewayType: string;
  durationDays?: number;
  plan?: PlanOffer;
  payment: PaymentInitResponse;
};

function toPaymentStatus(status: string): PaymentRecordStatus {
  const normalized = status.toUpperCase();

  if (
    normalized === "PENDING" ||
    normalized === "COMPLETED" ||
    normalized === "FAILED" ||
    normalized === "CANCELED" ||
    normalized === "REFUNDED"
  ) {
    return normalized;
  }

  return "UNKNOWN";
}

export async function recordPayment(input: RecordPaymentInput) {
  return prisma.paymentRecord.upsert({
    where: { paymentId: input.payment.payment_id },
    create: {
      userId: input.userId,
      paymentId: input.payment.payment_id,
      purchaseType: input.payment.purchase_type,
      status: toPaymentStatus(input.payment.status),
      finalAmount: input.payment.final_amount,
      currency: input.payment.currency,
      gatewayType: input.gatewayType,
      planCode: input.plan?.public_code,
      planName: input.plan?.name,
      durationDays: input.durationDays,
      deviceLimit: input.plan?.device_limit,
      trafficLimit: input.plan?.traffic_limit,
      paymentUrl: input.payment.payment_url,
      isFree: input.payment.is_free,
      raw: input.payment,
    },
    update: {
      purchaseType: input.payment.purchase_type,
      status: toPaymentStatus(input.payment.status),
      finalAmount: input.payment.final_amount,
      currency: input.payment.currency,
      gatewayType: input.gatewayType,
      planCode: input.plan?.public_code,
      planName: input.plan?.name,
      durationDays: input.durationDays,
      deviceLimit: input.plan?.device_limit,
      trafficLimit: input.plan?.traffic_limit,
      paymentUrl: input.payment.payment_url,
      isFree: input.payment.is_free,
      raw: input.payment,
    },
  });
}

export function serializePaymentRecord(record: {
  id: string;
  paymentId: string;
  purchaseType: string;
  status: PaymentRecordStatus;
  finalAmount: unknown;
  currency: string;
  gatewayType: string;
  planCode: string | null;
  planName: string | null;
  durationDays: number | null;
  deviceLimit: number | null;
  trafficLimit: number | null;
  isFree: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    payment_id: record.paymentId,
    purchase_type: record.purchaseType,
    status: record.status.toLowerCase(),
    final_amount: String(record.finalAmount),
    currency: record.currency,
    gateway_type: record.gatewayType,
    plan_code: record.planCode,
    plan_name: record.planName,
    duration_days: record.durationDays,
    device_limit: record.deviceLimit,
    traffic_limit: record.trafficLimit,
    is_free: record.isFree,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
