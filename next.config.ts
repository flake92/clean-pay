import type { NextConfig } from "next";

const isMockMode = process.env.CLEAN_PAY_MOCK_MODE === "1";

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: isMockMode ? ".next-mock" : ".next",
};

export default nextConfig;
