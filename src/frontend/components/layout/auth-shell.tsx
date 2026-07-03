"use client";

import Image from "next/image";
import Link from "next/link";
import { getBranding } from "@/shared/branding";

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
  const branding = getBranding();

  return (
    <div className="surface-ground auth-page flex align-items-center justify-content-center w-full overflow-x-hidden">
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
                <Image
                  alt={branding.name}
                  className="mb-3 flex-shrink-0 clean-auth-logo"
                  height={68}
                  src={branding.logoUrl}
                  width={68}
                />
                <div className="text-900 text-3xl font-medium mb-2 auth-title">{title}</div>
                <span className="text-600 font-medium line-height-3 auth-description">{description}</span>
              </div>
              {children}
              {footer ? <div className="mt-4 flex flex-column gap-2">{footer}</div> : null}
              <div className="text-center mt-3">
                <Link className="font-medium no-underline" href="/" style={{ color: "var(--primary-color)" }}>
                  {branding.name}
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
