import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const sessionLifetimeSeconds = 8 * 60 * 60;

function hmac(value, secret) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(password), salt, 64, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$16384$8$1$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password, encoded) {
  const [algorithm, n, r, p, saltEncoded, hashEncoded] = String(encoded).split("$");
  if (algorithm !== "scrypt" || n !== "16384" || r !== "8" || p !== "1" || !saltEncoded || !hashEncoded) {
    return false;
  }
  const expected = Buffer.from(hashEncoded, "base64url");
  const actual = scryptSync(String(password), Buffer.from(saltEncoded, "base64url"), expected.length, {
    N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createSession(login, secret, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ sub: login, exp: Math.floor(now / 1000) + sessionLifetimeSeconds }))
    .toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

export function readSession(token, accounts, secret, now = Date.now()) {
  const [payload, signature, extra] = String(token || "").split(".");
  if (!payload || !signature || extra) return null;
  const expected = Buffer.from(hmac(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.sub !== "string" || !Number.isInteger(parsed.exp) || parsed.exp <= Math.floor(now / 1000)) return null;
    return accounts.find(({ login }) => login === parsed.sub) || null;
  } catch {
    return null;
  }
}

export function csrfToken(sessionToken, secret) {
  return hmac(`csrf:${sessionToken}`, secret);
}

export function verifyCsrf(value, sessionToken, secret) {
  const expected = Buffer.from(csrfToken(sessionToken, secret));
  const actual = Buffer.from(String(value || ""));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readCookie(header, name) {
  for (const item of String(header || "").split(";")) {
    const [key, ...rest] = item.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(token, config, clear = false) {
  const parts = [
    `cp_advertiser_session=${clear ? "" : encodeURIComponent(token)}`,
    `Path=${config.basePath}`,
    "HttpOnly",
    "SameSite=Strict",
    clear ? "Max-Age=0" : `Max-Age=${sessionLifetimeSeconds}`,
  ];
  if (config.cookieSecure) parts.push("Secure");
  return parts.join("; ");
}
