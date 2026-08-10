import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  test: {
    name: "integration",
    environment: "node",
    globals: true,
    setupFiles: [path.join(projectRoot, "tests/setup/env.ts")],
    include: ["tests/integration/**/*.test.ts"],
    pool: "forks",
    testTimeout: 60_000,
    hookTimeout: 360_000,
  },
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
});
