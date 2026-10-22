"use client";

import { animate, stagger } from "animejs";
import { useEffect, useRef } from "react";

import { prefersReducedMotion } from "@/frontend/lib/reduced-motion";

const PIECES = 48;
const COLORS = ["#6366f1", "#8b5cf6", "#06b6d4", "#22c55e", "#f59e0b", "#ec4899"];

// A one-off confetti burst for a confirmed payment. Pieces start invisible and
// the layer ignores pointer events, so it can never cover or block the page.
export function PaymentCelebration() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || prefersReducedMotion()) return;

    const pieces = Array.from(layer.children) as HTMLElement[];
    const animation = animate(pieces, {
      opacity: [{ to: 1, duration: 120 }, { to: 0, duration: 700, delay: 1100 }],
      translateX: () => `${(Math.random() - 0.5) * 900}px`,
      translateY: [
        { to: () => `${-180 - Math.random() * 260}px`, duration: 700, ease: "outCubic" },
        { to: () => `${220 + Math.random() * 360}px`, duration: 1200, ease: "inQuad" },
      ],
      rotate: () => `${(Math.random() - 0.5) * 1080}deg`,
      delay: stagger(12),
      onComplete: () => {
        layer.hidden = true;
      },
    });

    return () => {
      animation.pause();
    };
  }, []);

  return (
    <div aria-hidden="true" className="payment-celebration" ref={layerRef}>
      {Array.from({ length: PIECES }, (_, index) => (
        <span
          className="payment-celebration-piece"
          key={index}
          style={{
            background: COLORS[index % COLORS.length],
            borderRadius: index % 3 === 0 ? "50%" : "2px",
          }}
        />
      ))}
    </div>
  );
}
