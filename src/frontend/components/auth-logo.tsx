"use client";

import Image from "next/image";
import { useCallback } from "react";

const AUTH_LOGO_SIZE = 68;
const CSS_FREE_FALLBACK_ALT = "Clean Pay";

function HydrationAwareDecorativeLogo({
  alt,
  src,
  unoptimized,
}: {
  alt: "";
  src: string;
  unoptimized: boolean;
}) {
  const restoreHydratedSemantics = useCallback((node: HTMLImageElement | null) => {
    if (!node) return;
    node.alt = alt;
    node.removeAttribute("aria-hidden");
  }, [alt]);

  return (
    <Image
      alt={CSS_FREE_FALLBACK_ALT}
      aria-hidden="true"
      className="mb-3 flex-shrink-0 clean-auth-logo"
      height={AUTH_LOGO_SIZE}
      ref={restoreHydratedSemantics}
      src={src}
      unoptimized={unoptimized}
      width={AUTH_LOGO_SIZE}
    />
  );
}

export function AuthLogo({
  src,
  unoptimized,
}: {
  src: string;
  unoptimized: boolean;
}) {
  return (
    <HydrationAwareDecorativeLogo
      alt=""
      src={src}
      unoptimized={unoptimized}
    />
  );
}
