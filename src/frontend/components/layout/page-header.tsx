import { getBranding } from "@/shared/branding";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  const branding = getBranding();

  return (
    <div className="flex flex-column gap-3 md:flex-row md:align-items-end md:justify-content-between mb-4">
      <div>
        <span className="text-xs font-semibold uppercase text-cyan-700">{eyebrow ?? branding.name}</span>
        <h1 className="mt-2 mb-2 text-4xl font-semibold text-900">{title}</h1>
        {description ? (
          <p className="m-0 max-w-40rem line-height-3 text-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
