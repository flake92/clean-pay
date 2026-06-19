type SameSite = "lax" | "strict" | "none";

type AppEnv = {
  databaseUrl: string;
  appUrl: string;
  publicAppUrl: string;
  remnashopApiBaseUrl: string;
  webJwtSecret: string;
  webRefreshSecret: string;
  cookieSecure: boolean;
  cookieSameSite: SameSite;
  smtp: {
    host: string;
    port: number;
    user: string;
    password: string;
    from: string;
  };
  telegramOidc: {
    issuer: string;
    authorizationEndpoint: string;
    tokenEndpoint: string;
    jwksUri: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  paymentReturnUrls: {
    success: string;
    fail: string;
    pending: string;
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

function number(name: string, defaultValue: number) {
  const value = process.env[name];

  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
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

export function getEnv(): AppEnv {
  const appUrl = url("APP_URL");

  return {
    databaseUrl: required("DATABASE_URL"),
    appUrl,
    publicAppUrl: url("NEXT_PUBLIC_APP_URL"),
    remnashopApiBaseUrl: url("REMNASHOP_API_BASE_URL"),
    webJwtSecret: required("WEB_JWT_SECRET"),
    webRefreshSecret: required("WEB_REFRESH_SECRET"),
    cookieSecure: bool("COOKIE_SECURE", true),
    cookieSameSite: sameSite("COOKIE_SAMESITE", "lax"),
    smtp: {
      host: required("SMTP_HOST"),
      port: number("SMTP_PORT", 587),
      user: required("SMTP_USER"),
      password: required("SMTP_PASSWORD"),
      from: required("SMTP_FROM"),
    },
    telegramOidc: {
      issuer: url("TELEGRAM_OIDC_ISSUER"),
      authorizationEndpoint: url("TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT"),
      tokenEndpoint: url("TELEGRAM_OIDC_TOKEN_ENDPOINT"),
      jwksUri: url("TELEGRAM_OIDC_JWKS_URI"),
      clientId: required("TELEGRAM_OIDC_CLIENT_ID"),
      clientSecret: required("TELEGRAM_OIDC_CLIENT_SECRET"),
      redirectUri: joinUrl(appUrl, "/auth/telegram/callback"),
    },
    paymentReturnUrls: {
      success: joinUrl(appUrl, "/payment/success"),
      fail: joinUrl(appUrl, "/payment/fail"),
      pending: joinUrl(appUrl, "/payment/pending"),
    },
  };
}
