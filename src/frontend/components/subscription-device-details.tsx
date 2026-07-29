import { formatSubscriptionDevice } from "@/frontend/lib/device-display";
import type { SubscriptionDevice } from "@/shared/remnashop/types";

type SubscriptionDeviceDetailsProps = {
  device: SubscriptionDevice;
};

export function SubscriptionDeviceDetails({
  device,
}: SubscriptionDeviceDetailsProps) {
  const presentation = formatSubscriptionDevice(device);

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
