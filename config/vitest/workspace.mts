import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const srcPath = path.join(projectRoot, "src");

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          globals: true,
          setupFiles: [path.join(projectRoot, "tests/setup/env.ts")],
          include: ["tests/unit/**/*.test.ts"],
          pool: "forks",
        },
        resolve: {
          alias: {
            "@": srcPath,
          },
        },
      },
      path.join(import.meta.dirname, "vitest.integration.config.mts"),
      path.join(import.meta.dirname, "vitest.e2e.config.mts"),
    ],
  },
  resolve: {
    alias: {
      "@": srcPath,
    },
  },
});
