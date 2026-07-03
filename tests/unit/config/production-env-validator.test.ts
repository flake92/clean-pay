import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

function envExampleKeys() {
  return readFileSync("deploy/prod/.env.example", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("=")[0])
    .filter(Boolean);
}

const validEnv = {
  DATABASE_URL: "postgresql://clean_pay:secret@postgres:5432/clean_pay?schema=public",
  REDIS_URL: "redis://redis:6379/0",
  APP_URL: "https://pay.example.com",
  NEXT_PUBLIC_APP_URL: "https://pay.example.com",
  REMNASHOP_API_BASE_URL: "https://bot.example.com/api/v1/public",
  REMNAWAVE_API_BASE_URL: "https://panel.example.com",
  REMNAWAVE_TOKEN: "token",
  WEB_JWT_SECRET: "jwt-secret",
  WEB_REFRESH_SECRET: "refresh-secret",
  TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
  TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
  TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
  TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
  TELEGRAM_OIDC_CLIENT_ID: "123456",
  TELEGRAM_OIDC_CLIENT_SECRET: "secret",
  TELEGRAM_BOT_TOKEN: "123456:test-token",
  COOKIE_SECURE: "true",
  COOKIE_SAMESITE: "lax",
  TURNSTILE_ENABLED: "false",
  SUPPORT_ENABLED: "false",
};

function runValidator(overrides: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "clean-pay-env-"));
  const envFile = path.join(dir, ".env");
  const values = { ...validEnv, ...overrides };
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  writeFileSync(envFile, content);

  const result = spawnSync(process.execPath, ["deploy/prod/validate-env.mjs", "--env-file", envFile], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  rmSync(dir, { recursive: true, force: true });

  return result;
}

describe("production env validator", () => {
  it("keeps the production env example limited to variables used by production code", () => {
    const source = [
      "deploy/prod/docker-compose.yml",
      "deploy/prod/validate-env.mjs",
      "start.sh",
      "src/backend/config/env.ts",
      "deploy/prod/Dockerfile",
    ]
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const key of envExampleKeys()) {
      expect(source, `${key} from .env.example must be used by production code, compose, or startup`).toContain(key);
    }
  });

  it("accepts the production env example", () => {
    const result = spawnSync(process.execPath, [
      "deploy/prod/validate-env.mjs",
      "--env-file",
      "deploy/prod/.env.example",
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production environment validation passed.");
  });

  it("keeps Docker build-time placeholders aligned with production env requirements", () => {
    const dockerfile = readFileSync("deploy/prod/Dockerfile", "utf8");

    expect(dockerfile).toContain("ENV REMNAWAVE_API_BASE_URL=https://remnawave.example.com");
    expect(dockerfile).toContain("ENV REMNAWAVE_TOKEN=build-time-placeholder");
    expect(dockerfile).toContain("ENV TURNSTILE_SECRET_KEY=build-time-placeholder");
  });

  it("fails with clear reasons for invalid env combinations", () => {
    expect(runValidator({
      TURNSTILE_ENABLED: "true",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
    }).stderr).toContain("NEXT_PUBLIC_TURNSTILE_SITE_KEY is required when TURNSTILE_ENABLED=true");

    expect(runValidator({
      COOKIE_SAMESITE: "none",
      COOKIE_SECURE: "false",
    }).stderr).toContain('COOKIE_SECURE must be "true" when COOKIE_SAMESITE="none"');

    expect(runValidator({
      REMNAWAVE_API_BASE_URL: "https://panel.example.com",
      REMNAWAVE_TOKEN: "",
    }).stderr).toContain("REMNAWAVE_API_BASE_URL and REMNAWAVE_TOKEN are required in production");

    expect(runValidator({
      TELEGRAM_OIDC_CLIENT_ID: "111111",
      TELEGRAM_BOT_TOKEN: "222222:test-token",
    }).stderr).toContain("TELEGRAM_OIDC_CLIENT_ID must match the bot id in TELEGRAM_BOT_TOKEN");

    expect(runValidator({
      NEXT_PUBLIC_BRAND_NAME: "x".repeat(81),
    }).stderr).toContain("NEXT_PUBLIC_BRAND_NAME must be 80 characters or less");

    expect(runValidator({
      NEXT_PUBLIC_BRAND_LOGO_URL: "https://cdn.example.com/logo.png",
    }).stderr).toContain("NEXT_PUBLIC_BRAND_LOGO_URL must be a root-relative public path");
  });
});
