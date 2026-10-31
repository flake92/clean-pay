"use client";

import { useEffect, useState } from "react";

import { loadUnreadNotificationsAction } from "@/app/actions/notifications";

export const NOTIFICATIONS_READ_EVENT = "clean-pay:notifications-read";
const REFRESH_MS = 60_000;

export function useUnreadNotifications(enabled: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState === "hidden") return;
      void loadUnreadNotificationsAction().then((value) => {
        if (!cancelled) setCount(value);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, refresh);
    };
  }, [enabled]);

  return count;
}
