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

const SETUP_CACHE_MS = 10 * 60 * 1000;
const SYNC_KEY_PREFIX = "clean-pay:push-synced:";
let cachedSetup: {
  at: number;
  value: ReturnType<typeof loadPushSetupAction>;
} | null = null;

// The check runs on every page, so one answer serves a whole visit.
function pushSetup() {
  if (!cachedSetup || Date.now() - cachedSetup.at > SETUP_CACHE_MS) {
    cachedSetup = { at: Date.now(), value: loadPushSetupAction() };
  }
  return cachedSetup.value;
}

function syncedInThisTab(endpoint: string) {
  try {
    return window.sessionStorage.getItem(SYNC_KEY_PREFIX + endpoint) !== null;
  } catch {
    return false;
  }
}

function rememberSynced(endpoint: string) {
  try {
    window.sessionStorage.setItem(SYNC_KEY_PREFIX + endpoint, "1");
  } catch {
    // Without storage the next page repeats a harmless save.
  }
}

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
        const setup = await pushSetup();
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
        if (Notification.permission === "granted") {
          // Permission stays but the browser dropped the subscription (or the
          // key rotated): restore it without bothering the user.
          existing ??= await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: applicationServerKey(setup.publicKey) as BufferSource,
          });
          // Re-register once a visit: the server drops subscriptions that
          // expired or moved to another account on this device.
          if (!syncedInThisTab(existing.endpoint)) {
            const saved = await savePushSubscriptionAction(subscriptionPayload(existing));
            if (saved.ok) rememberSynced(existing.endpoint);
          }
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
