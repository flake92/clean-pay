import { useEffect, useState } from "react";

import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

export function useWebAuthnSupport(
  supportsWebAuthn: () => boolean = browserSupportsWebAuthn,
) {
  const [supported, setSupported] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSupported(supportsWebAuthn());
    }, 0);

    return () => window.clearTimeout(timer);
  }, [supportsWebAuthn]);

  return supported;
}
