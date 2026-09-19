import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const buildId = process.env.CLEAN_PAY_BUILD_ID?.trim()
  || process.env.GITHUB_SHA?.trim()
  || randomUUID();

const configuredPublicHost = (() => {
  const value = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return undefined;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
      return undefined;
    }
    return url.host;
  } catch {
    return undefined;
  }
})();

const serverActionAllowedOrigins = [...new Set([
  configuredPublicHost,
  "cleanvpn.edge-connect.uk",
  "oplata.clear-vpn.org",
].filter((host): host is string => Boolean(host)))];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Keep the mutation envelope aligned with the former BFF contract. The
      // proxy enforces the same byte limit so oversized actions receive a
      // stable external 413 instead of Next's generic RSC 500 response.
      bodySizeLimit: "64kb",
      // Next performs its own Origin-versus-forwarded-host check after the
      // application proxy has accepted a mutation. Both public hostnames are
      // exact aliases of this installation, so keep that second gate aligned
      // without granting a wildcard or trusting forwarding metadata in the
      // application-level policy.
      allowedOrigins: serverActionAllowedOrigins,
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
