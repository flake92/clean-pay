import { Tag } from "primereact/tag";

function statusSeverity(active: boolean, pending = false) {
  if (active) {
    return "success" as const;
  }

  return pending ? ("warning" as const) : ("secondary" as const);
}

function statusLabel(active: boolean, pending = false) {
  if (active) {
    return "Подключено";
  }

  return pending ? "Нужно подтвердить" : "Не подключено";
}

/**
 * One sign-in method on the account-linking screen: its name, what it is for,
 * whether it is currently connected, and the controls that change that.
 * Extracted so each method can live in its own component instead of three of
 * them sharing one body.
 */
export function AuthMethodTile({
  icon,
  title,
  description,
  active,
  pending,
  meta,
  children,
}: {
  icon: string;
  title: string;
  description: string;
  active: boolean;
  pending?: boolean;
  meta?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="account-method-card">
      <div className="account-method-card__header">
        <span className="account-method-icon">
          <i className={icon} />
        </span>
        <div className="account-method-heading">
          <h3 className="account-method-title">{title}</h3>
          <p className="account-method-description">{description}</p>
        </div>
        <Tag className="account-method-status" severity={statusSeverity(active, pending)} value={statusLabel(active, pending)} />
      </div>
      {meta ? <div className="account-method-meta">{meta}</div> : null}
      {children ? <div className="account-method-actions">{children}</div> : null}
    </section>
  );
}

