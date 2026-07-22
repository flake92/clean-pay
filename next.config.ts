import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const buildId = process.env.CLEAN_PAY_BUILD_ID?.trim()
  || process.env.GITHUB_SHA?.trim()
  || randomUUID();

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://telegram.org",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

const nextConfig: NextConfig = {
  env: {
    CLEAN_PAY_BUILD_ID: buildId,
  },
  generateBuildId: async () => buildId,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=(self), publickey-credentials-get=(self)",
        },
      ],
    },
  ],
};

export default nextConfig;
