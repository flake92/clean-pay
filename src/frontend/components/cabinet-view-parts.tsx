import type { ReactNode } from "react";

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
    <div className="card mb-0 h-full">
      <div className="flex h-full justify-content-between gap-3">
        <div className="min-w-0">
          <span className="block text-500 font-medium mb-3">{label}</span>
          <div className="text-900 font-medium text-xl break-words">{value}</div>
        </div>
        <div
          className={`flex flex-shrink-0 align-items-center justify-content-center bg-${tone}-100 border-round`}
          style={{ width: "2.5rem", height: "2.5rem" }}
        >
          <i className={`${icon} text-${tone}-500 text-xl`} />
        </div>
      </div>
    </div>
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
