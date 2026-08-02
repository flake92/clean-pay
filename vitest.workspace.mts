import { defineConfig } from "vitest/config";
import path from "node:path";

const srcPath = path.resolve(import.meta.dirname, "src");

export default defineConfig({
  test: {
    projects: [
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
      "./vitest.integration.config.mts",
      "./vitest.e2e.config.mts",
    ],
  },
  resolve: {
    alias: {
      "@": srcPath,
    },
  },
});
