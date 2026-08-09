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
      include: [
        "src/application/**/*.ts",
        "src/backend/**/*.ts",
        "src/shared/domain/**/*.ts",
      ],
      exclude: [
        "src/backend/database/prisma.ts",
        "src/backend/observability/logger.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 85,
        lines: 80,
        "src/application/payments/execute-payment-workflow.ts": {
          statements: 85,
          branches: 65,
          functions: 85,
          lines: 85,
        },
        "src/backend/integrations/payments/payment-commands.ts": {
          statements: 60,
          branches: 30,
          functions: 65,
          lines: 65,
        },
        "src/backend/integrations/payments/payment-status-reader.ts": {
          statements: 80,
          branches: 60,
          functions: 90,
          lines: 85,
        },
        "src/backend/integrations/auth/auth-commands.ts": { statements: 95, branches: 50, functions: 95, lines: 95 },
        "src/backend/integrations/auth/email-verification.ts": { statements: 95, branches: 75, functions: 95, lines: 95 },
        "src/backend/integrations/auth/link-account.ts": { statements: 95, branches: 60, functions: 95, lines: 95 },
        "src/backend/integrations/auth/passkey-commands.ts": { statements: 95, branches: 45, functions: 95, lines: 95 },
        "src/backend/integrations/profile/profile-adapter.ts": { statements: 95, branches: 60, functions: 95, lines: 95 },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
