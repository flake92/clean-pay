import type { NextConfig } from "next";
import { randomUUID } from "node:crypto";

const buildId = process.env.CLEAN_PAY_BUILD_ID?.trim()
  || process.env.GITHUB_SHA?.trim()
  || randomUUID();

const nextConfig: NextConfig = {
  env: {
    CLEAN_PAY_BUILD_ID: buildId,
  },
  generateBuildId: async () => buildId,
};

export default nextConfig;
