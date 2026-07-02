import { defineConfig } from "vitest/config";
import path from "node:path";

const srcPath = path.resolve(__dirname, "src");

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
      "./vitest.integration.config.ts",
      "./vitest.e2e.config.ts",
    ],
  },
  resolve: {
    alias: {
      "@": srcPath,
    },
  },
});
