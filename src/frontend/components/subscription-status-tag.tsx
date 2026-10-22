"use client";

import { Tag } from "primereact/tag";
import { useEffect, useRef } from "react";

const EXPIRING_SOON_MS = 3 * 24 * 60 * 60 * 1000;

// Purely visual wrapper: a pulsing dot for an active subscription and an amber
// glow when it ends within three days. The tag text and severity are unchanged.
export function SubscriptionStatusTag({
  expireAt,
  severity,
  status,
  value,
}: {
  expireAt: string | null;
  severity: "success" | "warning" | "danger" | "info";
  status: string;
  value: string;
}) {
  const wrapperRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const expires = expireAt ? Date.parse(expireAt) : Number.NaN;
    const remaining = expires - Date.now();
    wrapper.classList.toggle(
      "is-expiring",
      status === "active" && Number.isFinite(remaining) && remaining > 0 && remaining < EXPIRING_SOON_MS,
    );
  }, [expireAt, status]);

  return (
    <span className="subscription-status" data-status={status} ref={wrapperRef}>
      <Tag severity={severity} value={value} />
    </span>
  );
}
