import { removePushSubscriptionAction } from "@/app/actions/notifications";

const RELEASE_TIMEOUT_MS = 2_500;

// Before logout this device stops receiving the account's notifications:
// the subscription is removed on the server (while the session still exists)
// and in the browser. Bounded and silent, so logout itself never waits long.
export async function releaseDevicePush() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  const release = (async () => {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await removePushSubscriptionAction(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  await Promise.race([
    release,
    new Promise((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS)),
  ]);
}
