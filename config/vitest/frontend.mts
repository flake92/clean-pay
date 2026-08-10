import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: [path.join(projectRoot, "tests/setup/env.ts")],
    include: [
      "tests/unit/frontend/app-topbar-accessibility.test.ts",
      "tests/unit/frontend/critical-flow-components.test.ts",
      "tests/unit/frontend/payment-return-status-component.test.ts",
    ],
    pool: "forks",
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage/frontend",
      include: [
        "src/frontend/layout/AppTopbar.tsx",
        "src/frontend/components/link-account-panel.tsx",
        "src/frontend/components/passkey-actions.tsx",
        "src/frontend/components/payment-confirmation.tsx",
        "src/frontend/components/payment-return-status.tsx",
        "src/frontend/components/register-email-confirm-form.tsx",
      ],
      thresholds: {
        statements: 60,
        branches: 45,
        functions: 70,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
});
