import path from "node:path";
import { defineConfig } from "vitest/config";

const projectRoot = path.resolve(import.meta.dirname, "../..");

export default defineConfig({
  test: {
    name: "e2e-full-stack",
    environment: "node",
    globals: true,
    include: ["tests/e2e/full-stack/**/*.test.ts"],
    pool: "forks",
    // The devcontainer app runs Turbopack in development, so a route pays its
    // first-compile cost inside whichever test reaches it first. The
    // authenticated journey alone compiles six protected pages and needs ~29s
    // against an already warm cache, so a 30s budget failed on every cold or
    // loaded runner, and a cold compile of the heaviest pages is slower still.
    // Keep this under the 600s bound the runner puts on the whole vitest
    // process.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.join(projectRoot, "src"),
    },
  },
});
