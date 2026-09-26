function containsUnsafePathSyntax(value: string) {
  const normalized = value.trim();

  return normalized.length === 0
    || normalized === "."
    || normalized === ".."
    || normalized.includes("/")
    || normalized.includes("\\")
    || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized);
}

/**
 * The current Remnashop contract puts HWID in a URL path segment. WHATWG URL
 * parsing removes dot-segments before the request is sent, and reverse proxies
 * may decode percent-encoded paths more than once. Keep the operation
 * fail-closed until Remnashop accepts the identifier in a JSON body.
 */
export function hasUnsafeDeviceHwidPathSegment(value: string) {
  let candidate = value;

  // A proxy can decode every percent escape, not only escapes that are already
  // recognizable as path syntax. Decode the complete value so split encodings
  // such as `%25%32%65` cannot become `%2e` in a later hop unnoticed. Every
  // successful pass shortens the string, so this bound covers nested encodings
  // without an open-ended normalization loop.
  for (let attempt = 0; attempt <= value.length; attempt += 1) {
    if (containsUnsafePathSyntax(candidate)) return true;
    if (!candidate.includes("%")) return false;

    let decoded: string;
    try {
      decoded = decodeURIComponent(candidate);
    } catch {
      // Different URL parsers disagree on malformed escapes and invalid UTF-8.
      // Keep an opaque path identifier fail-closed instead of guessing which
      // representation Remnashop or an intermediate proxy will observe.
      return true;
    }

    if (decoded === candidate) return true;
    candidate = decoded;
  }

  return true;
}
