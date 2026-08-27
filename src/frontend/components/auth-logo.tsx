"use client";

import Image from "next/image";

const AUTH_LOGO_SIZE = 68;
const CSS_FREE_BROKEN_IMAGE_SIZE = 14;

function restoreHydratedIntrinsicSize(node: HTMLImageElement | null) {
  if (!node) return;
  node.height = AUTH_LOGO_SIZE;
  node.width = AUTH_LOGO_SIZE;
}

export function AuthLogo({
  src,
  unoptimized,
}: {
  src: string;
  unoptimized: boolean;
}) {
  return (
    <Image
      alt=""
      className="mb-3 flex-shrink-0 clean-auth-logo"
      height={CSS_FREE_BROKEN_IMAGE_SIZE}
      ref={restoreHydratedIntrinsicSize}
      src={src}
      unoptimized={unoptimized}
      width={CSS_FREE_BROKEN_IMAGE_SIZE}
    />
  );
}
