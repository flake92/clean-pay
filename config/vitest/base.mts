import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    setupFiles: [path.join(projectRoot, "tests/setup/env.ts")],
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
        statements: 94.5,
        branches: 85.5,
        functions: 100,
        lines: 95,
        "src/application/payments/execute-payment-workflow.ts": {
          statements: 95,
          branches: 80,
          functions: 100,
          lines: 100,
        },
        "src/backend/integrations/payments/payment-workflow-gateway.ts": {
          statements: 95,
          branches: 85,
          functions: 100,
          lines: 95,
        },
        "src/backend/integrations/payments/payment-status-reader.ts": {
          statements: 95,
          branches: 75,
          functions: 100,
          lines: 95,
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
      "@": path.join(projectRoot, "src"),
    },
  },
});
