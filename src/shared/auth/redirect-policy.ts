const fallbackOrigin = "https://clean-pay.local";

export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const url = new URL(value, fallbackOrigin);

    if (url.origin !== fallbackOrigin || url.username || url.password) {
      return undefined;
    }

    if (
      url.pathname === "/login" ||
      url.pathname === "/register" ||
      url.pathname.startsWith("/auth/")
    ) {
      return undefined;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}
