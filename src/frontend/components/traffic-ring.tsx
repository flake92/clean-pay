"use client";

import { motion, useReducedMotion } from "motion/react";

const SIZE = 132;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;

function ringTone(percent: number) {
  if (percent >= 90) return "danger";
  if (percent >= 70) return "warning";
  return "normal";
}

// Decorative traffic gauge. The accessible value is the text next to it, so
// the SVG is hidden from assistive technology; the centre label always shows
// the real percentage even if the arc animation never runs.
export function TrafficRing({ percent }: { percent: number }) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.min(100, Math.max(0, percent));
  const tone = ringTone(clamped);

  return (
    <div aria-hidden="true" className="traffic-ring" data-tone={tone}>
      <svg height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE}>
        <defs>
          <linearGradient id="traffic-ring-normal" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="traffic-ring-warning" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
          <linearGradient id="traffic-ring-danger" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>
        <circle className="traffic-ring-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} />
        <motion.circle
          animate={{ pathLength: clamped / 100 }}
          className="traffic-ring-value"
          cx={SIZE / 2}
          cy={SIZE / 2}
          initial={reduceMotion ? false : { pathLength: 0 }}
          r={RADIUS}
          stroke={`url(#traffic-ring-${tone})`}
          transition={{ duration: 1.4, ease: [0.2, 0.8, 0.2, 1], delay: 0.3 }}
        />
      </svg>
      <div className="traffic-ring-label">
        <span className="traffic-ring-percent">{Math.round(clamped)}%</span>
        <span className="traffic-ring-caption">трафика</span>
      </div>
    </div>
  );
}
