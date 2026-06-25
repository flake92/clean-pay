import { defineWorkspace } from "vitest/config";
import path from "node:path";

const srcPath = path.resolve(__dirname, "src");

export default defineWorkspace([
  {
    test: {
      name: "unit",
      environment: "node",
      globals: true,
      setupFiles: ["./tests/setup/env.ts"],
      include: ["tests/unit/**/*.test.ts"],
      pool: "forks",
    },
    resolve: {
      alias: {
        "@": srcPath,
      },
    },
  },
  {
    test: {
      name: "route-handlers",
      environment: "node",
      globals: true,
      setupFiles: ["./tests/setup/env.ts"],
      include: ["tests/route-handlers/**/*.test.ts"],
      pool: "forks",
    },
    resolve: {
      alias: {
        "@": srcPath,
      },
    },
  },
  "./vitest.integration.config.ts",
]);
