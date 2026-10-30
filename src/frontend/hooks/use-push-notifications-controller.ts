"use client";

import { useEffect, useRef, useState } from "react";

import {
  loadPushSetupAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
} from "@/app/actions/notifications";
import {
  applicationServerKey,
  pushCardStatus,
  sameServerKey,
  type PushEnvironment,
} from "@/frontend/components/push-notifications-state";
import {
  isAppleMobilePlatform,
  isStandaloneInstallMode,
} from "@/frontend/lib/install-app-transitions";

async function serviceWorkerRegistration() {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

function subscriptionPayload(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return {
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    userAgent: navigator.userAgent.slice(0, 256),
  };
}

export function usePushNotificationsController(serverAvailable: boolean) {
  const [env, setEnv] = useState<PushEnvironment>({
    serverAvailable,
    pushSupported: false,
    appleMobile: false,
    standalone: false,
    permission: null,
  });
  const [loaded, setLoaded] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ text: string; severity: "success" | "warn" } | null>(
    null,
  );
  const publicKey = useRef<string | null>(null);

  useEffect(() => {
    if (!serverAvailable) return;
    let cancelled = false;
    void (async () => {
      // Browser capabilities exist only on the client; read them after mount
      // so the server render and the first client render match.
      await Promise.resolve();
      if (cancelled) return;
      const pushSupported = "serviceWorker" in navigator
        && "PushManager" in window
        && "Notification" in window;
      const nextEnv: PushEnvironment = {
        serverAvailable,
        pushSupported,
        appleMobile: isAppleMobilePlatform(navigator.userAgent, navigator.maxTouchPoints),
        standalone: isStandaloneInstallMode(
          window.matchMedia("(display-mode: standalone)").matches,
          () => (navigator as Navigator & { standalone?: boolean }).standalone === true,
        ),
        permission: pushSupported ? Notification.permission : null,
      };
      setEnv(nextEnv);
      if (!pushSupported || nextEnv.permission === "denied") return;
      try {
        const setup = await loadPushSetupAction();
        if (cancelled) return;
        if (setup.status !== "ready") {
          setEnv((current) => ({ ...current, serverAvailable: false }));
          return;
        }
        publicKey.current = setup.publicKey;
        const registration = await serviceWorkerRegistration();
        let existing = await registration.pushManager.getSubscription();
        // A rotated VAPID key invalidates old subscriptions.
        if (existing && !sameServerKey(
          existing.options.applicationServerKey,
          applicationServerKey(setup.publicKey),
        )) {
          await existing.unsubscribe();
          existing = null;
        }
        if (existing && Notification.permission === "granted") {
          // Re-register on every visit: the server drops subscriptions that
          // expired or moved to another account on this device.
          await savePushSubscriptionAction(subscriptionPayload(existing));
        }
        if (!cancelled) setSubscribed(Boolean(existing));
      } catch {
        if (!cancelled) setSubscribed(false);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serverAvailable]);

  async function enable() {
    if (pending || !publicKey.current) return;
    setPending(true);
    setMessage(null);
    try {
      // Must run inside the click handler: iOS rejects permission requests
      // that do not come from a user gesture.
      const permission = await Notification.requestPermission();
      setEnv((current) => ({ ...current, permission }));
      if (permission !== "granted") {
        setMessage({
          text: "Разрешение не выдано. Включить уведомления можно в настройках браузера или телефона.",
          severity: "warn",
        });
        return;
      }
      const registration = await serviceWorkerRegistration();
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey.current) as BufferSource,
      });
      const result = await savePushSubscriptionAction(subscriptionPayload(subscription));
      if (!result.ok) {
        await subscription.unsubscribe().catch(() => undefined);
        setMessage({ text: result.message, severity: "warn" });
        return;
      }
      setSubscribed(true);
      setMessage({ text: result.message, severity: "success" });
    } catch {
      setMessage({
        text: "Не удалось включить уведомления на этом устройстве. Попробуйте ещё раз.",
        severity: "warn",
      });
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    if (pending) return;
    setPending(true);
    setMessage(null);
    try {
      const registration = await serviceWorkerRegistration();
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscriptionAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      setMessage({ text: "Уведомления на этом устройстве отключены.", severity: "success" });
    } catch {
      setMessage({ text: "Не удалось отключить уведомления. Попробуйте ещё раз.", severity: "warn" });
    } finally {
      setPending(false);
    }
  }

  return {
    status: pushCardStatus(env, { loaded, subscribed }),
    pending,
    message,
    enable,
    disable,
  };
}
