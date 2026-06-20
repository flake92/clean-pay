"use client";

import Link from "next/link";

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="surface-ground flex align-items-center justify-content-center min-h-screen min-w-screen overflow-hidden p-4">
      <div className="w-full flex justify-content-center">
        <div
          className="w-full auth-card-frame"
          style={{
            border: "1px solid var(--surface-border)",
            borderRadius: "24px",
            padding: "0.25rem",
            background: "var(--surface-card)",
          }}
        >
          <div
            className="w-full surface-card auth-card"
            style={{ borderRadius: "20px" }}
          >
            <div className="auth-card-content">
              <div className="text-center mb-4">
                <img
                  alt="Clean Pay"
                  className="mb-3 flex-shrink-0 clean-auth-logo"
                  src="/clean_vpn_logo.jpg"
                />
                <div className="text-900 text-3xl font-medium mb-2">{title}</div>
                <span className="text-600 font-medium line-height-3">{description}</span>
              </div>
              {children}
              {footer ? <div className="mt-4 flex flex-column gap-2">{footer}</div> : null}
              <div className="text-center mt-3">
                <Link className="font-medium no-underline" href="/" style={{ color: "var(--primary-color)" }}>
                  Clean Pay
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
