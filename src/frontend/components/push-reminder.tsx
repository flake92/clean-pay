"use client";

import { useEffect, useRef, useState } from "react";

import { LinkButton } from "@/frontend/components/prime/link-button";
import { isPushPromptClick } from "@/frontend/components/push-notifications-state";
import { Button } from "@/frontend/components/sakai/form-foundation";
import { usePushNotificationsController } from "@/frontend/hooks/use-push-notifications-controller";

const DISMISS_KEY = "clean-pay:push-reminder-dismissed-at";
const ASKED_KEY = "clean-pay:push-prompt-asked-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

// Without storage the visit cannot remember the question, so it is not asked.
function askedRecently() {
  try {
    return Date.now() - Number(window.localStorage.getItem(ASKED_KEY)) < DISMISS_MS;
  } catch {
    return true;
  }
}

function rememberAsked() {
  try {
    window.localStorage.setItem(ASKED_KEY, String(Date.now()));
  } catch {
    // Reading fails the same way, so the question is not repeated.
  }
}

function dismissedRecently() {
  try {
    const value = Number(window.localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(value) && Date.now() - value < DISMISS_MS;
  } catch {
    return false;
  }
}

// Runs the device check on every page of the cabinet: a lost subscription is
// restored silently, and someone without notifications is offered them here,
// not only after finding the setting in the profile.
export function PushReminder() {
  const { status, pending, message, enable } = usePushNotificationsController(true);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setDismissed(dismissedRecently());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enableRef = useRef(enable);
  useEffect(() => {
    enableRef.current = enable;
  });

  // The first click on a cabinet link also asks for the permission, at most
  // once a week and never after an answer: the status is then no longer
  // "off". The click itself goes on as usual.
  useEffect(() => {
    if (dismissed || status !== "off") return;
    const onClick = (event: MouseEvent) => {
      if (!isPushPromptClick(event.target) || askedRecently()) return;
      rememberAsked();
      void enableRef.current();
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [dismissed, status]);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Without storage the reminder simply returns on the next visit.
    }
  }

  if (dismissed || !["off", "ios-install", "denied"].includes(status)) return null;
  // After "Block" the browser never shows its prompt again, so a week later
  // only this hint can point to the settings.
  if (status === "denied" && askedRecently()) return null;

  return (
    <aside aria-label="Уведомления" className="push-reminder">
      <i aria-hidden className="pi pi-bell push-reminder__icon" />
      <div className="push-reminder__body">
        <strong>Уведомления на этом устройстве выключены</strong>
        <span>
          {message?.text ?? (status === "denied"
            ? "Они запрещены в настройках браузера: разрешите их для этого сайта, чтобы не пропустить окончание подписки."
            : status === "ios-install"
              ? "На iPhone и iPad они работают в установленном приложении."
              : "Включите их, чтобы не пропустить окончание подписки, оплату и новости.")}
        </span>
      </div>
      <div className="push-reminder__actions">
        {status === "off" ? (
          <Button
            disabled={pending}
            label="Включить"
            loading={pending}
            onClick={() => {
              rememberAsked();
              void enable();
            }}
            size="small"
          />
        ) : null}
        {status === "ios-install" ? <LinkButton href="/install" label="Установить" /> : null}
        <Button
          aria-label="Скрыть напоминание"
          icon="pi pi-times"
          onClick={dismiss}
          rounded
          severity="secondary"
          size="small"
          text
        />
      </div>
    </aside>
  );
}
