import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    name: "e2e-full-stack",
    environment: "node",
    globals: true,
    include: ["tests/e2e/full-stack/**/*.test.ts"],
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
