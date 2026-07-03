#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const envFileIndex = args.indexOf("--env-file");

if (envFileIndex >= 0) {
  const envFile = args[envFileIndex + 1];

  if (!envFile) {
    fail("--env-file requires a path");
  }

  loadEnvFile(envFile);
}

const requiredNames = [
  "DATABASE_URL",
  "REDIS_URL",
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "REMNASHOP_API_BASE_URL",
  "WEB_JWT_SECRET",
  "WEB_REFRESH_SECRET",
  "TELEGRAM_OIDC_ISSUER",
  "TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT",
  "TELEGRAM_OIDC_TOKEN_ENDPOINT",
  "TELEGRAM_OIDC_JWKS_URI",
  "TELEGRAM_OIDC_CLIENT_ID",
  "TELEGRAM_OIDC_CLIENT_SECRET",
];

for (const name of requiredNames) {
  required(name);
}

httpUrl("APP_URL");
httpUrl("NEXT_PUBLIC_APP_URL");
httpUrl("REMNASHOP_API_BASE_URL");
httpUrl("TELEGRAM_OIDC_ISSUER");
httpUrl("TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT");
httpUrl("TELEGRAM_OIDC_TOKEN_ENDPOINT");
httpUrl("TELEGRAM_OIDC_JWKS_URI");
optionalHttpUrl("REMNAWAVE_API_BASE_URL");
optionalHttpUrl("TURNSTILE_VERIFY_URL");
optionalHttpUrl("SUPPORT_FAQ_URL");
optionalHttpUrl("CLEAN_PAY_READINESS_MAILPIT_URL");
optionalHttpUrl("CLEAN_PAY_READINESS_REMNAWAVE_URL");
optionalPublicPath("NEXT_PUBLIC_BRAND_LOGO_URL");

urlWithProtocols("DATABASE_URL", ["postgresql:", "postgres:"]);
urlWithProtocols("REDIS_URL", ["redis:", "rediss:"]);

const cookieSecure = bool("COOKIE_SECURE", true);
const cookieSameSite = sameSite("COOKIE_SAMESITE", "lax");
const turnstileEnabled = bool("TURNSTILE_ENABLED", false);
bool("SUPPORT_ENABLED", false);

if (optional("NEXT_PUBLIC_BRAND_NAME") && optional("NEXT_PUBLIC_BRAND_NAME").length > 80) {
  fail("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");
}

if (turnstileEnabled) {
  if (!optional("NEXT_PUBLIC_TURNSTILE_SITE_KEY") && !optional("TURNSTILE_SITE_KEY")) {
    fail("NEXT_PUBLIC_TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");
  }

  if (!optional("TURNSTILE_SECRET_KEY")) {
    fail("TURNSTILE_SECRET_KEY is required when TURNSTILE_ENABLED=true");
  }
}

if (cookieSameSite === "none" && !cookieSecure) {
  fail('COOKIE_SECURE must be "true" when COOKIE_SAMESITE="none"');
}

if (!optional("REMNAWAVE_API_BASE_URL") || !optional("REMNAWAVE_TOKEN")) {
  fail("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN are required in production");
}

if (Boolean(optional("REMNAWAVE_API_BASE_URL")) !== Boolean(optional("REMNAWAVE_TOKEN"))) {
  fail("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN must be configured together");
}

if (optional("TELEGRAM_BOT_TOKEN")) {
  const botId = optional("TELEGRAM_BOT_TOKEN").split(":")[0];

  if (botId && botId !== required("TELEGRAM_OIDC_CLIENT_ID")) {
    fail("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");
  }
}

console.log("Production environment validation passed.");

function loadEnvFile(file) {
  if (!existsSync(file)) {
    fail(`Missing env file: ${file}`);
  }

  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");

    if (separator < 0) {
      continue;
    }

    const name = line.slice(0, separator).trim();
    const value = unquote(line.slice(separator + 1).trim());

    process.env[name] = value;
  }
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function optional(name) {
  return process.env[name]?.trim() || null;
}

function required(name) {
  const value = optional(name);

  if (!value) {
    fail(`${name} is required`);
  }

  return value;
}

function bool(name, defaultValue) {
  const value = optional(name);

  if (!value) {
    return defaultValue;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  fail(`${name} must be "true" or "false"`);
}

function sameSite(name, defaultValue) {
  const value = optional(name)?.toLowerCase();

  if (!value) {
    return defaultValue;
  }

  if (value === "lax" || value === "strict" || value === "none") {
    return value;
  }

  fail(`${name} must be "lax", "strict", or "none"`);
}

function httpUrl(name) {
  return urlWithProtocols(name, ["http:", "https:"]);
}

function optionalHttpUrl(name) {
  if (!optional(name)) {
    return null;
  }

  return httpUrl(name);
}

function optionalPublicPath(name) {
  const value = optional(name);

  if (!value) {
    return null;
  }

  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\0")) {
    fail(`${name} must be a root-relative public path like /brand/logo.png`);
  }

  return value;
}

function urlWithProtocols(name, protocols) {
  const value = required(name);

  try {
    const parsed = new URL(value);

    if (!protocols.includes(parsed.protocol)) {
      throw new Error();
    }

    return parsed;
  } catch {
    fail(`${name} must be a valid ${protocols.join(" or ")} URL`);
  }
}

function fail(message) {
  console.error(`Production environment validation failed: ${message}`);
  process.exit(1);
}
