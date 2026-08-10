import type { DevicePresentation } from "@/frontend/lib/device-display";

type SubscriptionDeviceDetailsProps = {
  presentation: DevicePresentation;
};

export function SubscriptionDeviceDetails({
  presentation,
}: SubscriptionDeviceDetailsProps) {
  return (
    <dl className="cabinet-mobile-record__details">
      <div>
        <dt>Тип устройства</dt>
        <dd>{presentation.deviceType}</dd>
      </div>
      <div>
        <dt>ОС</dt>
        <dd>{presentation.os}</dd>
      </div>
      <div>
        <dt>Клиент</dt>
        <dd>{presentation.client}</dd>
      </div>
    </dl>
  );
}
