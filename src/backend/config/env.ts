type SameSite = "lax" | "strict" | "none";

type AppEnv = {
  databaseUrl: string;
  appUrl: string;
  publicAppUrl: string;
  remnashopApiBaseUrl: string;
  webJwtSecret: string;
  webRefreshSecret: string;
  auditIpHashSecret: string;
  cookieSecure: boolean;
  cookieSameSite: SameSite;
  telegramOidc: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    jwksUri: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  telegramBotToken: string | null;
  paymentReturnUrls: {
    success: string;
    fail: string;
    pending: string;
  };
  turnstile: {
    enabled: boolean;
    siteKey: string | null;
    secretKey: string | null;
    verifyUrl: string;
  };
  support: {
    enabled: boolean;
    email: string | null;
    telegramUsername: string | null;
    faqUrl: string | null;
  };
  readiness: {
    mailpitUrl: string | null;
    remnawaveUrl: string | null;
  };
};

function required(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function url(name: string) {
  const value = required(name);

  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

function bool(name: string, defaultValue: boolean) {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  throw new Error(`${name} must be "true" or "false"`);
}

function sameSite(name: string, defaultValue: SameSite) {
  const value = process.env[name]?.toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (value === "lax" || value === "strict" || value === "none") {
    return value;
  }

  throw new Error(`${name} must be "lax", "strict", or "none"`);
}

function joinUrl(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl}/`).toString();
}

function optional(name: string) {
  return process.env[name]?.trim() || null;
}

function optionalUrl(name: string) {
  const value = optional(name);

  if (!value) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
}

export function getEnv(): AppEnv {
  const appUrl = url("APP_URL");

  return {
    databaseUrl: required("DATABASE_URL"),
    appUrl,
    publicAppUrl: url("NEXT_PUBLIC_APP_URL"),
    remnashopApiBaseUrl: url("REMNASHOP_API_BASE_URL"),
    webJwtSecret: required("WEB_JWT_SECRET"),
    webRefreshSecret: required("WEB_REFRESH_SECRET"),
    auditIpHashSecret: optional("AUDIT_IP_HASH_SECRET") ?? required("WEB_JWT_SECRET"),
    cookieSecure: bool("COOKIE_SECURE", true),
    cookieSameSite: sameSite("COOKIE_SAMESITE", "lax"),
    telegramOidc: {
      issuer: url("TELEGRAM_OIDC_ISSUER"),
      authorizationEndpoint: url("TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT"),
      tokenEndpoint: url("TELEGRAM_OIDC_TOKEN_ENDPOINT"),
      jwksUri: url("TELEGRAM_OIDC_JWKS_URI"),
      clientId: required("TELEGRAM_OIDC_CLIENT_ID"),
      clientSecret: required("TELEGRAM_OIDC_CLIENT_SECRET"),
      redirectUri: joinUrl(appUrl, "/auth/telegram/callback"),
    },
    telegramBotToken: optional("TELEGRAM_BOT_TOKEN"),
    paymentReturnUrls: {
      success: joinUrl(appUrl, "/payment/success"),
      fail: joinUrl(appUrl, "/payment/fail"),
      pending: joinUrl(appUrl, "/payment/pending"),
    },
    turnstile: {
      enabled: bool("TURNSTILE_ENABLED", false),
      siteKey: optional("NEXT_PUBLIC_TURNSTILE_SITE_KEY") ?? optional("TURNSTILE_SITE_KEY"),
      secretKey: optional("TURNSTILE_SECRET_KEY"),
      verifyUrl: optionalUrl("TURNSTILE_VERIFY_URL") ?? "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    },
    support: {
      enabled: bool("SUPPORT_ENABLED", false),
      email: optional("SUPPORT_EMAIL"),
      telegramUsername: optional("SUPPORT_TELEGRAM_USERNAME"),
      faqUrl: optionalUrl("SUPPORT_FAQ_URL"),
    },
    readiness: {
      mailpitUrl: optionalUrl("CLEAN_PAY_READINESS_MAILPIT_URL"),
      remnawaveUrl: optionalUrl("CLEAN_PAY_READINESS_REMNAWAVE_URL"),
    },
  };
}
