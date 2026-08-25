const fallbackOrigin = "https://clean-pay.local";

function decodedSafeAsciiPathname(pathname: string) {
  try {
    const decoded = decodeURIComponent(pathname);

    if (
      !/^\/[\x21-\x7e]*$/.test(decoded)
      || decoded.startsWith("//")
      || decoded.includes("\\")
      || decoded.includes("?")
      || decoded.includes("#")
      || pathname.includes("%")
    ) {
      return undefined;
    }

    return decoded;
  } catch {
    return undefined;
  }
}

export function safeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  try {
    const url = new URL(value, fallbackOrigin);
    const decodedPathname = decodedSafeAsciiPathname(url.pathname);

    if (
      url.origin !== fallbackOrigin
      || url.username
      || url.password
      || !decodedPathname
    ) {
      return undefined;
    }

    if (
      decodedPathname === "/login" ||
      decodedPathname === "/register" ||
      decodedPathname.startsWith("/auth/")
    ) {
      return undefined;
    }

    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}
