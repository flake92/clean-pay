export function isAllowedPaymentRedirectUrl(
  value: string,
  allowedOrigins: readonly string[],
) {
  try {
    const url = new URL(value);

    return url.protocol === "https:"
      && !url.username
      && !url.password
      && allowedOrigins.includes(url.origin);
  } catch {
    return false;
  }
}
