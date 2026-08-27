import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const buildId = process.env.CLEAN_PAY_BUILD_ID?.trim()
  || process.env.GITHUB_SHA?.trim()
  || randomUUID();

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Keep the mutation envelope aligned with the former BFF contract. The
      // proxy enforces the same byte limit so oversized actions receive a
      // stable external 413 instead of Next's generic RSC 500 response.
      bodySizeLimit: "64kb",
    },
  },
  env: {
    CLEAN_PAY_BUILD_ID: buildId,
  },
  generateBuildId: async () => buildId,
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        {
          key: "Strict-Transport-Security",
          value: "max-age=31536000; includeSubDomains",
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        {
          key: "Permissions-Policy",
          value: "camera=(), microphone=(), geolocation=(), payment=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)",
        },
      ],
    },
  ],
};

export default nextConfig;
