#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const targets = {
  build: ["build"],
  "prod-up": ["up"],
  "prod-up-debug": ["up", "-debug"],
  "prod-down": ["down"],
  "prod-logs": ["logs"],
  "prod-logs-debug": ["logs", "-debug"],
  "prod-verify": ["verify"],
  "prod-verify-debug": ["verify", "-debug"],
};

const requestedTargets = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
const selectedTargets = requestedTargets.length > 0 ? requestedTargets : ["build"];

for (const target of selectedTargets) {
  const prodArgs = targets[target];

  if (!prodArgs) {
    console.error(`Unknown make target: ${target}`);
    console.error(`Available targets: ${Object.keys(targets).join(", ")}`);
    process.exit(2);
  }

  const result = spawnSync(process.execPath, ["deploy/prod/prod.mjs", ...prodArgs], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
