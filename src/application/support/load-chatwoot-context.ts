import type { ChatwootSupportContext } from "@/application/models/chatwoot";
import type {
  ChatwootContextGateway,
  ChatwootContextPayment,
  ChatwootContextPaymentSnapshot,
  ChatwootContextSubscription,
} from "@/application/support/ports/chatwoot-context";

const recentPaymentLimit = 5;
const stalePendingPaymentMs = 30 * 60 * 1000;
const paymentSnapshotMaximumAgeMs = 15 * 60 * 1000;

function normalized(value: string) {
  return value.trim().toLowerCase();
}

function bounded(value: string, maximum: number) {
  return value.replace(/[\r\n|]+/g, " ").trim().slice(0, maximum);
}

function isoDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function subscriptionExpired(subscription: ChatwootContextSubscription, now: Date) {
  const expiresAt = new Date(subscription.expiresAt);

  return normalized(subscription.status) === "expired"
    || (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now);
}

function paymentProblem(payment: ChatwootContextPayment | undefined, now: Date) {
  if (!payment) {
    return false;
  }

  const status = normalized(payment.status);

  if (["failed", "canceled", "cancelled", "unknown"].includes(status)) {
    return true;
  }

  if (status !== "pending") {
    return false;
  }

  const createdAt = new Date(payment.createdAt);

  return !Number.isNaN(createdAt.getTime())
    && now.getTime() - createdAt.getTime() >= stalePendingPaymentMs;
}

function paymentSummary(payment: ChatwootContextPayment) {
  return [
    isoDate(payment.createdAt) || "unknown-date",
    bounded(payment.status, 32) || "UNKNOWN",
    `${bounded(payment.finalAmount, 32)} ${bounded(payment.currency, 12)}`.trim(),
    bounded(payment.gatewayType, 64) || "unknown-gateway",
    bounded(payment.planName ?? "", 128) || "без тарифа",
  ].join(" | ");
}

function subscriptionAttributes(
  subscription: PromiseSettledResult<ChatwootContextSubscription | null>,
): {
  attributes: Record<string, string>;
  reliable: boolean;
  subscription: ChatwootContextSubscription | null;
} {
  if (subscription.status === "rejected") {
    return {
      attributes: {
        subscription_context_status: "unavailable",
      },
      reliable: false,
      subscription: null,
    };
  }

  if (!subscription.value) {
    return {
      attributes: {
        subscription_context_status: "ready",
        subscription_plan: "",
        subscription_status: "none",
        subscription_expires_at: "",
        subscription_is_trial: "false",
      },
      reliable: true,
      subscription: null,
    };
  }

  const expiresAt = isoDate(subscription.value.expiresAt);

  if (!expiresAt) {
    return {
      attributes: {
        subscription_context_status: "invalid",
        subscription_plan: bounded(subscription.value.planName, 128),
        subscription_status: bounded(subscription.value.status, 64),
        subscription_expires_at: "",
        subscription_is_trial: String(subscription.value.isTrial),
      },
      reliable: false,
      subscription: subscription.value,
    };
  }

  return {
    attributes: {
      subscription_context_status: "ready",
      subscription_plan: bounded(subscription.value.planName, 128),
      subscription_status: bounded(subscription.value.status, 64),
      subscription_expires_at: expiresAt,
      subscription_is_trial: String(subscription.value.isTrial),
    },
    reliable: true,
    subscription: subscription.value,
  };
}

function paymentAttributes(
  payments: PromiseSettledResult<ChatwootContextPaymentSnapshot>,
  now: Date,
): {
  attributes: Record<string, string>;
  reliable: boolean;
  latest: ChatwootContextPayment | undefined;
} {
  if (payments.status === "rejected") {
    return {
      attributes: {
        payment_context_status: "unavailable",
      },
      reliable: false,
      latest: undefined,
    };
  }

  const records = payments.value.records.slice(0, recentPaymentLimit);
  const latest = records[0];
  const synchronizedAt = payments.value.synchronizedAt
    ? new Date(payments.value.synchronizedAt)
    : null;
  const snapshotAgeMs = synchronizedAt
    ? now.getTime() - synchronizedAt.getTime()
    : Number.POSITIVE_INFINITY;
  const reliable = Boolean(
    synchronizedAt
    && !Number.isNaN(synchronizedAt.getTime())
    && snapshotAgeMs >= -60_000
    && snapshotAgeMs <= paymentSnapshotMaximumAgeMs,
  );

  return {
    attributes: {
      payment_context_status: reliable ? "ready" : "stale",
      last_payment_status: bounded(latest?.status ?? "none", 32),
      last_payment_at: latest ? isoDate(latest.createdAt) : "",
      last_payment_amount: latest
        ? `${bounded(latest.finalAmount, 32)} ${bounded(latest.currency, 12)}`.trim()
        : "",
      last_payment_gateway: bounded(latest?.gatewayType ?? "", 64),
      last_payment_plan: bounded(latest?.planName ?? "", 128),
      recent_payments: records.map(paymentSummary).join("\n").slice(0, 2_000),
    },
    reliable,
    latest,
  };
}

export async function loadChatwootSupportContext(
  gateway: ChatwootContextGateway,
  now = new Date(),
  expectedUserId?: string,
): Promise<ChatwootSupportContext | null> {
  let actor;

  try {
    actor = await gateway.loadActor();
  } catch {
    return null;
  }

  if (!actor || (expectedUserId && actor.userId !== expectedUserId)) {
    return null;
  }

  const [subscription, payments] = await Promise.allSettled([
    gateway.loadSubscription(actor.userId),
    gateway.loadRecentPayments(actor.userId, recentPaymentLimit),
  ]);
  let confirmedActor;

  try {
    confirmedActor = await gateway.loadActor();
  } catch {
    return null;
  }

  if (!confirmedActor || confirmedActor.userId !== actor.userId) {
    return null;
  }

  const subscriptionContext = subscriptionAttributes(subscription);
  const paymentContext = paymentAttributes(payments, now);
  const managedLabels: ChatwootSupportContext["managedLabels"] = [];

  if (subscriptionContext.reliable) {
    managedLabels.push({
      name: "subscription_expired",
      enabled: subscriptionContext.subscription
        ? subscriptionExpired(subscriptionContext.subscription, now)
        : false,
    });
  }

  if (paymentContext.reliable) {
    managedLabels.push({
      name: "payment_problem",
      enabled: paymentProblem(paymentContext.latest, now),
    });
  }

  return {
    customAttributes: {
      ...subscriptionContext.attributes,
      ...paymentContext.attributes,
    },
    managedLabels,
  };
}
