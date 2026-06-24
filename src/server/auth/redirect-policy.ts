export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const url = new URL(value, "https://clean-pay.local");

    if (url.origin !== "https://clean-pay.local") {
      return undefined;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}
