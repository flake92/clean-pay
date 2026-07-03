type SameSite = "lax" | "strict" | "none";

type AppEnv = {
  databaseUrl: string;
  appUrl: string;
  publicAppUrl: string;
  branding: {
    name: string;
    logoUrl: string;
  };
  remnashopApiBaseUrl: string;
  remnawave: {
    apiBaseUrl: string | null;
    token: string | null;
  };
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
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
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
    const parsed = new URL(value);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error();
    }

    return parsed.toString();
  } catch {
    throw new Error(`${name} must be a valid http(s) URL`);
  }
}

function optionalPublicPath(name: string, fallback: string) {
  const value = optional(name);

  if (!value) {
    return fallback;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\0")) {
    throw new Error(`${name} must be a root-relative public path like /brand/logo.png`);
  }

  return value;
}

function validateEnv(env: AppEnv) {
  const isProduction = process.env.NODE_ENV === "production";

  if (env.turnstile.enabled) {
    if (!env.turnstile.siteKey) {
      throw new Error("NEXT_PUBLIC_TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");
    }

    if (!env.turnstile.secretKey) {
      throw new Error("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true");
    }
  }

  if (env.cookieSameSite === "none" && !env.cookieSecure) {
    throw new Error('COOKIE_SECURE must be "true" when COOKIE_SAMESITE="none"');
  }

  if (env.branding.name.length > 80) {
    throw new Error("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");
  }

  if (isProduction && (!env.remnawave.apiBaseUrl || !env.remnawave.token)) {
    throw new Error("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN are required in production");
  }

  if (Boolean(env.remnawave.apiBaseUrl) !== Boolean(env.remnawave.token)) {
    throw new Error("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN must be configured together");
  }

  if (env.telegramOidc.clientSecret.startsWith(`${env.telegramOidc.clientId}:`)) {
    return;
  }

  if (!env.telegramBotToken) {
    return;
  }

  const botId = env.telegramBotToken.split(":")[0];

  if (botId && botId !== env.telegramOidc.clientId) {
    throw new Error("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");
  }
}

export function getEnv(): AppEnv {
  const appUrl = url("APP_URL");

  const env = {
    databaseUrl: required("DATABASE_URL"),
    appUrl,
    publicAppUrl: url("NEXT_PUBLIC_APP_URL"),
    branding: {
      name: optional("NEXT_PUBLIC_BRAND_NAME") ?? "Clean Pay",
      logoUrl: optionalPublicPath("NEXT_PUBLIC_BRAND_LOGO_URL", "/clean_vpn_logo.jpg"),
    },
    remnashopApiBaseUrl: url("REMNASHOP_API_BASE_URL"),
    remnawave: {
      apiBaseUrl: optionalUrl("REMNAWAVE_API_BASE_URL"),
      token: optional("REMNAWAVE_TOKEN"),
    },
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

  validateEnv(env);

  return env;
}
