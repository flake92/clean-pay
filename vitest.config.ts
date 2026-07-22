import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["./tests/setup/env.ts"],
    include: ["tests/unit/**/*.test.ts", "tests/integration/route-handlers/**/*.test.ts"],
    pool: "forks",
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      include: ["src/backend/**/*.ts"],
      exclude: [
        "src/backend/database/prisma.ts",
        "src/backend/observability/logger.ts",
      ],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 70,
        lines: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
