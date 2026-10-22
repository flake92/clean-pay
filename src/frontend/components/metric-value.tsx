"use client";

import { animate } from "animejs";
import { useEffect, useRef } from "react";

import { prefersReducedMotion } from "@/frontend/lib/reduced-motion";

// "2 из 5", "1.2 GB / 50 GB": a leading number followed by text. Dates and
// plain words do not match and are never animated.
const LEADING_NUMBER = /^(\d+)(?:([.,])(\d+))?(\s[\s\S]*)$/u;

// Counts the leading number up from zero. Purely visual: the text node always
// ends with exactly the rendered value, and a React update stops the effect.
export function MetricValue({ children }: { children: React.ReactNode }) {
  const valueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = valueRef.current?.firstChild;
    if (!(node instanceof Text) || prefersReducedMotion()) return;
    const original = node.data;
    const match = LEADING_NUMBER.exec(original);
    if (!match) return;

    const [, whole, separator = "", fraction = "", rest] = match;
    const decimals = fraction.length;
    const target = Number(`${whole}.${fraction || "0"}`);
    if (!Number.isFinite(target) || target === 0) return;

    let written = original;
    const format = (value: number) =>
      `${value.toFixed(decimals).replace(".", separator || ".")}${rest}`;
    const counter = { value: 0 };
    const animation = animate(counter, {
      value: target,
      duration: 1400,
      delay: 250,
      ease: "outExpo",
      onUpdate: () => {
        if (node.data !== written) {
          animation.pause();
          return;
        }
        written = format(counter.value);
        node.data = written;
      },
      onComplete: () => {
        if (node.data === written) node.data = original;
      },
    });

    return () => {
      animation.pause();
      if (node.data === written) node.data = original;
    };
  }, [children]);

  return (
    <div className="text-900 font-medium text-xl break-words cabinet-metric-value" ref={valueRef}>
      {children}
    </div>
  );
}
