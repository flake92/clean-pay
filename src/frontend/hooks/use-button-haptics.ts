"use client";

import { useEffect } from "react";

import { prefersReducedMotion } from "@/frontend/lib/reduced-motion";

// A short vibration when an enabled button is pressed on a touch device.
// Purely tactile: it never prevents or changes the click.
export function useButtonHaptics() {
  useEffect(() => {
    if (typeof navigator.vibrate !== "function") return;
    if (!window.matchMedia?.("(pointer: coarse)").matches || prefersReducedMotion()) return;

    const vibrate = (event: PointerEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest(".p-button:not(:disabled):not(.p-disabled)")
        : null;
      if (target) navigator.vibrate(8);
    };

    document.addEventListener("pointerdown", vibrate, { passive: true });
    return () => document.removeEventListener("pointerdown", vibrate);
  }, []);
}
