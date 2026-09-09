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
  return (
    <div className="flex flex-column gap-3 md:flex-row md:align-items-end md:justify-content-between mb-4">
      <div>
        {/* No page ever passed an eyebrow, so this fell back to the brand name
            and repeated it under the topbar on all ten pages -- in a stray cyan
            that belonged to no other part of the product. Render it only when a
            caller actually has something to say here. */}
        {eyebrow ? (
          <span className="page-header-eyebrow">{eyebrow}</span>
        ) : null}
        <h1 className="mt-0 mb-2 text-4xl font-semibold text-900">{title}</h1>
        {description ? (
          <p className="m-0 max-w-40rem line-height-3 text-600">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
