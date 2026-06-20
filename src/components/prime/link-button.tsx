import Link from "next/link";

type LinkButtonProps = {
  href: string;
  label: string;
  icon?: string;
  outlined?: boolean;
  text?: boolean;
  severity?: "secondary" | "success" | "info" | "warning" | "danger" | "help";
  className?: string;
  external?: boolean;
};

function classes({
  outlined,
  text,
  severity,
  className,
}: Pick<LinkButtonProps, "outlined" | "text" | "severity" | "className">) {
  return [
    "p-button p-component no-underline",
    outlined ? "p-button-outlined" : "",
    text ? "p-button-text" : "",
    severity ? `p-button-${severity}` : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function LinkButton({
  href,
  label,
  icon,
  outlined,
  text,
  severity,
  className,
  external,
}: LinkButtonProps) {
  const content = (
    <>
      {icon ? <span className={`p-button-icon p-c ${icon}`} /> : null}
      <span className="p-button-label">{label}</span>
    </>
  );

  if (external || href.startsWith("mailto:") || href.startsWith("http")) {
    return (
      <a
        className={classes({ outlined, text, severity, className })}
        href={href}
        rel={href.startsWith("http") ? "noreferrer" : undefined}
        target={href.startsWith("http") ? "_blank" : undefined}
      >
        {content}
      </a>
    );
  }

  return (
    <Link className={classes({ outlined, text, severity, className })} href={href}>
      {content}
    </Link>
  );
}
