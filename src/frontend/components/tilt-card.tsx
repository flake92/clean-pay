"use client";

import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { PointerEvent, ReactNode } from "react";

const MAX_TILT_DEG = 6;
const SPRING = { stiffness: 220, damping: 20, mass: 0.6 };

// Tilts the card toward a mouse pointer in 3D. Touch and pen input, and
// visitors who prefer reduced motion, get a flat card.
export function TiltCard({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className: string;
  tone?: string;
}) {
  const reduceMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const rotateX = useSpring(useTransform(pointerY, [-0.5, 0.5], [MAX_TILT_DEG, -MAX_TILT_DEG]), SPRING);
  const rotateY = useSpring(useTransform(pointerX, [-0.5, 0.5], [-MAX_TILT_DEG, MAX_TILT_DEG]), SPRING);

  const track = (event: PointerEvent<HTMLDivElement>) => {
    if (reduceMotion || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set((event.clientX - bounds.left) / bounds.width - 0.5);
    pointerY.set((event.clientY - bounds.top) / bounds.height - 0.5);
  };

  const reset = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  return (
    <motion.div
      className={className}
      data-tone={tone}
      onPointerLeave={reset}
      onPointerMove={track}
      style={reduceMotion ? undefined : { rotateX, rotateY, transformPerspective: 900 }}
    >
      {children}
    </motion.div>
  );
}
