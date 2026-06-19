"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

type PaymentStatus = {
  payment_id: string;
  purchase_type: string;
  status: string;
  final_amount: string;
  currency: string;
  gateway_type: string;
  plan_name: string | null;
  created_at: string;
} | null;

type CurrentSubscription = {
  status: string;
  plan_name: string;
  expire_at: string;
} | null;

type StatusResponse = {
  payment: PaymentStatus;
  subscription: CurrentSubscription;
};

type Props = {
  kind: "success" | "fail" | "pending";
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function heading(kind: Props["kind"]) {
  if (kind === "success") {
    return "Оплата принята";
  }

  if (kind === "fail") {
    return "Оплата не завершена";
  }

  return "Платёж обрабатывается";
}

function intro(kind: Props["kind"]) {
  if (kind === "success") {
    return "Проверяем локальную запись платежа и актуальную подписку.";
  }

  if (kind === "fail") {
    return "Если платёж был отменён, можно выбрать тариф заново.";
  }

  return "Статус может обновиться после webhook-обработки на стороне Remnashop.";
}

function paymentStatusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Ожидает",
    completed: "Оплачен",
    failed: "Ошибка",
    canceled: "Отменён",
    refunded: "Возврат",
    unknown: "Неизвестно",
  };

  return labels[status] ?? status;
}

export function PaymentReturnStatus({ kind }: Props) {
  const searchParams = useSearchParams();
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const paymentId = useMemo(() => {
    return (
      searchParams.get("payment_id") ??
      searchParams.get("paymentId") ??
      searchParams.get("order_id") ??
      searchParams.get("id")
    );
  }, [searchParams]);

  useEffect(() => {
    const fallbackPaymentId = window.localStorage.getItem("cleanPayLastPaymentId");
    const resolvedPaymentId = paymentId ?? fallbackPaymentId;
    const query = resolvedPaymentId
      ? `?payment_id=${encodeURIComponent(resolvedPaymentId)}`
      : "";

    fetch(`/api/bff/payments/status${query}`)
      .then(async (response) => {
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(body?.error?.message ?? "Не удалось проверить статус.");
        }

        return body.data as StatusResponse;
      })
      .then(setData)
      .catch((err: Error) => setError(err.message));
  }, [paymentId]);

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-xl content-center px-6 py-16">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-700">
        CleanVPN
      </p>
      <h1 className="mt-4 text-3xl font-semibold">{heading(kind)}</h1>
      <p className="mt-4 text-zinc-600">{intro(kind)}</p>

      <section className="mt-8 grid gap-4 border border-zinc-200 bg-white p-5">
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        {!error && !data ? <p className="text-sm text-zinc-600">Проверка...</p> : null}
        {data?.payment ? (
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Платёж</dt>
              <dd className="break-all text-right">{data.payment.payment_id}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Статус</dt>
              <dd>{paymentStatusLabel(data.payment.status)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Сумма</dt>
              <dd>
                {data.payment.final_amount} {data.payment.currency}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-zinc-500">Дата</dt>
              <dd>{formatDate(data.payment.created_at)}</dd>
            </div>
          </dl>
        ) : null}
        {data && !data.payment ? (
          <p className="text-sm text-zinc-600">
            Локальная запись платежа не найдена. Проверьте кабинет позже.
          </p>
        ) : null}
        {data?.subscription ? (
          <p className="text-sm text-zinc-700">
            Текущая подписка: {data.subscription.plan_name}, до{" "}
            {formatDate(data.subscription.expire_at)}.
          </p>
        ) : null}
      </section>

      <div className="mt-8 flex flex-wrap gap-3">
        <a className="inline-flex h-11 items-center bg-zinc-950 px-4 text-white" href="/cabinet">
          Открыть кабинет
        </a>
        {kind === "fail" ? (
          <a className="inline-flex h-11 items-center border border-zinc-300 px-4" href="/tariffs">
            Вернуться к тарифам
          </a>
        ) : null}
      </div>
    </main>
  );
}
