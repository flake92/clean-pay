const loginPattern = /^[a-z0-9][a-z0-9._-]{2,63}$/i;
const campaignIdPattern = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const adLinkCodePattern = /^[A-Za-z0-9_-]{3,64}$/;

function required(name, source = process.env) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function jsonArray(name, source) {
  let value;
  try {
    value = JSON.parse(required(name, source));
  } catch (error) {
    throw new Error(`${name} must be a valid JSON array`, { cause: error });
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must contain at least one item`);
  }
  return value;
}

function normalizeBasePath(value) {
  const normalized = `/${value.trim().replace(/^\/+|\/+$/g, "")}`;
  if (!/^\/[a-z0-9/_-]+$/i.test(normalized) || normalized === "/") {
    throw new Error("BASE_PATH must be a non-root URL path");
  }
  return normalized;
}

export function loadConfig(source = process.env) {
  const campaigns = jsonArray("ADVERTISER_CAMPAIGNS_JSON", source).map((item) => {
    const id = String(item?.id || "").trim();
    const name = String(item?.name || "").trim();
    const adLinkCode = String(item?.adLinkCode || "").trim();
    const telegramUrl = String(item?.telegramUrl || "").trim();
    if (!campaignIdPattern.test(id) || !name || !adLinkCodePattern.test(adLinkCode)) {
      throw new Error("Every campaign needs a valid id, name and adLinkCode");
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(telegramUrl);
    } catch {
      throw new Error(`Campaign ${id} has an invalid telegramUrl`);
    }
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "t.me") {
      throw new Error(`Campaign ${id} telegramUrl must be an https://t.me link`);
    }
    return Object.freeze({ id, name, adLinkCode, telegramUrl: parsedUrl.toString() });
  });

  const campaignIds = new Set(campaigns.map(({ id }) => id));
  if (campaignIds.size !== campaigns.length) throw new Error("Campaign ids must be unique");
  if (new Set(campaigns.map(({ adLinkCode }) => adLinkCode.toUpperCase())).size !== campaigns.length) {
    throw new Error("Campaign ad-link codes must be unique");
  }

  const accounts = jsonArray("ADVERTISER_ACCOUNTS_JSON", source).map((item) => {
    const login = String(item?.login || "").trim().toLowerCase();
    const name = String(item?.name || "").trim();
    const role = item?.role;
    const passwordHash = String(item?.passwordHash || "").trim();
    const assigned = Array.isArray(item?.campaignIds) ? item.campaignIds.map(String) : [];
    if (!loginPattern.test(login) || !name || !["admin", "advertiser"].includes(role)) {
      throw new Error("Every account needs a valid login, name and role");
    }
    if (!/^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(passwordHash)) {
      throw new Error(`Account ${login} has an invalid passwordHash`);
    }
    if (role === "advertiser" && (assigned.length === 0 || assigned.some((id) => !campaignIds.has(id)))) {
      throw new Error(`Advertiser ${login} must reference existing campaigns`);
    }
    return Object.freeze({ login, name, role, passwordHash, campaignIds: Object.freeze(assigned) });
  });
  if (new Set(accounts.map(({ login }) => login)).size !== accounts.length) {
    throw new Error("Account logins must be unique");
  }
  if (!accounts.some(({ role }) => role === "admin")) throw new Error("At least one admin is required");

  const sessionSecret = required("ADVERTISER_SESSION_SECRET", source);
  if (sessionSecret.length < 48) throw new Error("ADVERTISER_SESSION_SECRET must contain at least 48 characters");

  const attributionDays = Number(source.ATTRIBUTION_DAYS || "30");
  if (!Number.isInteger(attributionDays) || attributionDays < 1 || attributionDays > 365) {
    throw new Error("ATTRIBUTION_DAYS must be between 1 and 365");
  }

  return Object.freeze({
    host: source.HOST?.trim() || "0.0.0.0",
    port: Number(source.PORT || "4100"),
    basePath: normalizeBasePath(source.BASE_PATH || "/partners"),
    cookieSecure: source.COOKIE_SECURE !== "false",
    timezone: source.STATS_TIMEZONE?.trim() || "Europe/Moscow",
    attributionDays,
    databaseUrl: required("REMNASHOP_STATS_DATABASE_URL", source),
    sessionSecret,
    accounts: Object.freeze(accounts),
    campaigns: Object.freeze(campaigns),
  });
}
