import type { ReactNode } from "react";

import { MetricValue } from "@/frontend/components/metric-value";
import { TiltCard } from "@/frontend/components/tilt-card";

export function Metric({
  icon,
  label,
  tone,
  value,
}: {
  icon: string;
  label: string;
  tone: "blue" | "orange" | "cyan" | "purple";
  value: ReactNode;
}) {
  return (
    <TiltCard className="card mb-0 h-full cabinet-metric" tone={tone}>
      <div className="cabinet-metric-head">
        <span aria-hidden="true" className="cabinet-metric-icon">
          <i className={icon} />
        </span>
        <span className="text-500 font-medium">{label}</span>
      </div>
      <MetricValue>{value}</MetricValue>
    </TiltCard>
  );
}

export function DetailLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="py-2 border-bottom-1 surface-border">
      <div className="text-xs uppercase text-500">{label}</div>
      <div className="mt-1 font-medium text-900 break-words">{value}</div>
    </div>
  );
}
