"use client";

import { useState } from "react";
import { Button } from "primereact/button";
import { Column } from "primereact/column";
import { DataTable } from "primereact/datatable";
import { Message } from "primereact/message";
import { Tag } from "primereact/tag";

import {
  deviceDeleteLabel,
  formatDate,
  paymentStatusLabel,
  statusSeverity,
  type PaymentRecord,
} from "@/frontend/components/cabinet-presentation";
import { SubscriptionDeviceDetails } from "@/frontend/components/subscription-device-details";
import { formatSubscriptionDevice } from "@/frontend/lib/device-display";
import type { DevicesResponse } from "@/shared/domain/subscriptions";

export const MOBILE_PAYMENT_PREVIEW_COUNT = 5;

type CabinetDevicesSectionProps = {
  devices: DevicesResponse;
  onDelete: (hwid: string) => void;
  pendingAction: string | null;
};

export function CabinetDevicesSection({
  devices,
  onDelete,
  pendingAction,
}: CabinetDevicesSectionProps) {
  const deviceViews = devices.devices.map((device, index) => {
    const presentation = formatSubscriptionDevice(device);

    return {
      device,
      presentation,
      deleteLabel: deviceDeleteLabel(presentation, index + 1),
    };
  });

  return (
    <div className="col-12 xl:col-6">
      <section className="card cabinet-devices-section" aria-labelledby="cabinet-devices-title">
        <h5 id="cabinet-devices-title">Устройства</h5>
        {deviceViews.length > 0 ? (
          <div className="cabinet-device-list">
            {deviceViews.map(({ device, presentation, deleteLabel }) => (
              <article className="cabinet-mobile-record cabinet-device-record" key={device.hwid}>
                <div className="cabinet-mobile-record__header cabinet-device-record__header">
                  <div className="cabinet-mobile-record__title">
                    {presentation.summary}
                  </div>
                  <Button
                    aria-label={deleteLabel}
                    className="cabinet-device-record__delete"
                    disabled={pendingAction !== null}
                    icon="pi pi-trash"
                    label="Удалить"
                    loading={pendingAction === `delete-device-${device.hwid}`}
                    onClick={() => onDelete(device.hwid)}
                    outlined
                    severity="danger"
                    size="small"
                    type="button"
                  />
                </div>
                <SubscriptionDeviceDetails presentation={presentation} />
              </article>
            ))}
          </div>
        ) : (
          <Message severity="info" text="Подключенных устройств пока нет." />
        )}
      </section>
    </div>
  );
}

type CabinetPaymentHistorySectionProps = {
  error: string | null;
  payments: PaymentRecord[];
};

export function CabinetPaymentHistorySection({
  error,
  payments,
}: CabinetPaymentHistorySectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hiddenPaymentCount = Math.max(0, payments.length - MOBILE_PAYMENT_PREVIEW_COUNT);
  const mobilePayments = isExpanded
    ? payments
    : payments.slice(0, MOBILE_PAYMENT_PREVIEW_COUNT);

  return (
    <div className="col-12">
      <section className="card" aria-labelledby="cabinet-payments-title">
        <h5 id="cabinet-payments-title">История платежей</h5>
        {error ? <Message severity="warn" text={error} /> : null}
        {payments.length > 0 ? (
          <div className="cabinet-mobile-list cabinet-payment-list">
            <div
              className="cabinet-payment-list__records"
              id="cabinet-payment-history-mobile"
            >
              {mobilePayments.map((payment) => (
                <article className="cabinet-mobile-record" key={payment.payment_id}>
                  <div className="cabinet-mobile-record__header">
                    <div>
                      <div className="cabinet-mobile-record__title">
                        {payment.plan_name ?? payment.purchase_type}
                      </div>
                      <div className="cabinet-mobile-record__id">{payment.payment_id}</div>
                    </div>
                    <Tag
                      severity={payment.is_free ? "info" : statusSeverity(payment.status)}
                      value={payment.is_free ? "Бесплатно" : paymentStatusLabel(payment.status)}
                    />
                  </div>
                  <dl className="cabinet-mobile-record__details cabinet-payment-record__details">
                    <div className="cabinet-payment-record__date">
                      <dt>Дата</dt>
                      <dd>{formatDate(payment.created_at)}</dd>
                    </div>
                    <div>
                      <dt>Gateway</dt>
                      <dd>{payment.gateway_type}</dd>
                    </div>
                    <div>
                      <dt>Сумма</dt>
                      <dd>
                        {payment.final_amount} {payment.currency}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
            {hiddenPaymentCount > 0 ? (
              <Button
                aria-controls="cabinet-payment-history-mobile"
                aria-expanded={isExpanded}
                className="cabinet-payment-history__toggle"
                icon={isExpanded ? "pi pi-chevron-up" : "pi pi-chevron-down"}
                label={
                  isExpanded
                    ? "Свернуть историю"
                    : `Показать ещё (${hiddenPaymentCount})`
                }
                onClick={() => setIsExpanded((expanded) => !expanded)}
                outlined
                type="button"
              />
            ) : null}
          </div>
        ) : !error ? (
          <Message severity="info" text="Платежей через web-кабинет пока нет." />
        ) : null}
        <DataTable
          className="cabinet-desktop-table"
          emptyMessage={error ?? "Платежей через web-кабинет пока нет."}
          responsiveLayout="scroll"
          value={payments}
        >
          <Column
            body={(payment: PaymentRecord) => (
              <div>
                <div className="font-medium">{payment.plan_name ?? payment.purchase_type}</div>
                <div className="mt-1 text-xs text-500 break-all">{payment.payment_id}</div>
              </div>
            )}
            header="Платёж"
          />
          <Column body={(payment: PaymentRecord) => formatDate(payment.created_at)} header="Дата" />
          <Column field="gateway_type" header="Gateway" />
          <Column
            body={(payment: PaymentRecord) => (
              <span>
                {payment.final_amount} {payment.currency}
              </span>
            )}
            header="Сумма"
          />
          <Column
            body={(payment: PaymentRecord) => (
              <Tag
                severity={payment.is_free ? "info" : statusSeverity(payment.status)}
                value={payment.is_free ? "Бесплатно" : paymentStatusLabel(payment.status)}
              />
            )}
            header="Статус"
          />
        </DataTable>
      </section>
    </div>
  );
}
