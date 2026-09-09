import Image from "next/image";
import Link from "next/link";

import { APP_VERSION } from "@/shared/app-version";
import { getBranding } from "@/shared/branding";
import { ChatwootGuestBoundary } from "@/frontend/components/chatwoot-widget";

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
    <>
      <ChatwootGuestBoundary />
      <main className="surface-ground auth-page flex align-items-center justify-content-center w-full overflow-x-hidden">
        <div className="w-full flex justify-content-center">
          <div className="w-full auth-card-frame auth-card">
            <div className="auth-card-content">
              <div className="text-center mb-4">
                <Image
                  alt={branding.name}
                  className="mb-3 flex-shrink-0 clean-auth-logo"
                  height={68}
                  src={branding.logoUrl}
                  unoptimized
                  width={68}
                />
                <h1 className="text-900 text-3xl font-medium mb-2 auth-title">{title}</h1>
                <span className="text-600 font-medium line-height-3 auth-description">{description}</span>
              </div>
              {children}
              {footer ? (
                <>
                  {/* Two full-width solid buttons read as one block. Separate the
                      alternative sign-in from the primary action explicitly. */}
                  <p aria-hidden="true" className="auth-alt-divider">или</p>
                  <div className="flex flex-column gap-2">{footer}</div>
                </>
              ) : null}
              <p className="auth-card-meta">
                <Link className="auth-card-brand no-underline" href="/">{branding.name}</Link>
                <span aria-label={`Версия приложения ${APP_VERSION}`}>Версия {APP_VERSION}</span>
              </p>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
