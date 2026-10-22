// Loading placeholder shaped like the cabinet: four metric tiles and the two
// main cards. The visible text stays available to assistive technology.
export function CabinetSkeleton({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className="cabinet-skeleton">
      <span className="cabinet-skeleton-label">{label}</span>
      <div aria-hidden="true" className="grid">
        {[0, 1, 2, 3].map((index) => (
          <div className="col-12 lg:col-6 xl:col-3" key={index}>
            <div className="card mb-0 skeleton-card">
              <div className="skeleton-line skeleton-line-short" />
              <div className="skeleton-line skeleton-line-wide" />
            </div>
          </div>
        ))}
        <div className="col-12 xl:col-8">
          <div className="card skeleton-card skeleton-card-tall">
            <div className="skeleton-line skeleton-line-short" />
            <div className="skeleton-line skeleton-line-title" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line-wide" />
          </div>
        </div>
        <div className="col-12 xl:col-4">
          <div className="card skeleton-card skeleton-card-tall">
            <div className="skeleton-line skeleton-line-title" />
            <div className="skeleton-line" />
            <div className="skeleton-line skeleton-line-short" />
          </div>
        </div>
      </div>
    </div>
  );
}
