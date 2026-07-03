#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";

const commands = {
  build: {
    args: ["build"],
    env: {
      NODE_ENV: "production",
    },
  },
  dev: {
    args: ["dev", "--webpack", "-p", "4000"],
    env: {
      WATCHPACK_POLLING: "true",
    },
  },
};

const [commandName, ...passThroughArgs] = process.argv.slice(2);
const command = commands[commandName];

if (!command) {
  console.error(`Usage: node scripts/next-command.mjs <${Object.keys(commands).join("|")}>`);
  process.exit(2);
}

const nextBin = path.join("node_modules", "next", "dist", "bin", "next");
const result = spawnSync(process.execPath, [nextBin, ...command.args, ...passThroughArgs], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ...command.env,
  },
  shell: false,
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
