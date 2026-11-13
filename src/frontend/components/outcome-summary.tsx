import { Button, Message } from "@/frontend/components/sakai/form-foundation";
import type { OutcomeSummary } from "@/shared/domain/plan-change";

/** "What you will get": the same block for a plan change and for a gift code. */
export function OutcomeSummaryBlock({ summary }: { summary: OutcomeSummary }) {
  return (
    <div className="flex flex-column gap-2" data-testid="outcome-summary">
      <Message severity="info" text={summary.headline} />
      <ul className="m-0 pl-4 flex flex-column gap-1 text-900">
        {summary.lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

export function OutcomeConfirmation({
  confirmLabel,
  disabled,
  onCancel,
  onConfirm,
  summary,
  title,
}: {
  confirmLabel: string;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  summary: OutcomeSummary;
  title: string;
}) {
  return (
    <section aria-label={title} className="mt-3 flex flex-column gap-3 border-1 border-200 border-round-lg p-3">
      <h3 className="m-0 text-lg font-semibold break-all">{title}</h3>
      <OutcomeSummaryBlock summary={summary} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled} label={confirmLabel} onClick={onConfirm} type="button" />
        <Button disabled={disabled} label="Отмена" onClick={onCancel} outlined type="button" />
      </div>
    </section>
  );
}
