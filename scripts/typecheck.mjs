import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  DATABASE_URL: process.env.DATABASE_URL
    ?? "postgresql://typecheck:typecheck@localhost:5432/typecheck?schema=public",
};

function run(script, args) {
  const result = spawnSync(process.execPath, [path.join(rootDir, script), ...args], {
    cwd: rootDir,
    env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("node_modules/prisma/build/index.js", ["generate"]);
run("node_modules/typescript/bin/tsc", ["--noEmit", "--pretty", "false"]);
