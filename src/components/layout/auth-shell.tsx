"use client";

import { useContext } from "react";
import Link from "next/link";
import { classNames } from "primereact/utils";
import { LayoutContext } from "@/layout/context/layoutcontext";

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
  const { layoutConfig } = useContext(LayoutContext);
  const containerClassName = classNames(
    "surface-ground flex align-items-center justify-content-center min-h-screen min-w-screen overflow-hidden",
    { "p-input-filled": layoutConfig.inputStyle === "filled" },
  );

  return (
    <div className={containerClassName}>
      <div className="flex flex-column align-items-center justify-content-center">
        <img
          alt="Clean Pay"
          className="mb-5 flex-shrink-0 clean-auth-logo"
          src="/clean_vpn_logo.jpg"
        />
        <div
          style={{
            border: "1px solid var(--surface-border)",
            borderRadius: "32px",
            padding: "0.25rem",
            background: "var(--surface-card)",
          }}
        >
          <div
            className="w-full surface-card py-8 px-5 sm:px-8"
            style={{ borderRadius: "28px" }}
          >
            <div className="text-center mb-5">
              <div className="text-900 text-3xl font-medium mb-3">{title}</div>
              <span className="text-600 font-medium">{description}</span>
            </div>
            {children}
            {footer ? <div className="mt-4 flex flex-column gap-2">{footer}</div> : null}
            <div className="text-center mt-4">
              <Link className="font-medium no-underline" href="/" style={{ color: "var(--primary-color)" }}>
                Clean Pay
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
