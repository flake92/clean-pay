#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

import {
  ProductionEnvironmentError,
  parseProductionEnvironmentFile,
  validateProductionEnvironment,
} from "./production-env-rules.mjs";

try {
  const envFile = parseArguments(process.argv.slice(2));
  const environment = envFile
    ? readIsolatedEnvironmentFile(envFile)
    : process.env;

  if (envFile && Object.hasOwn(environment, "CLEAN_PAY_BAKED_PUBLIC_APP_URL")) {
    throw new ProductionEnvironmentError(
      "CLEAN_PAY_BAKED_PUBLIC_APP_URL is image metadata and must not be set in an env file",
    );
  }

  validateProductionEnvironment(environment);
  console.log("Production environment validation passed.");
} catch (error) {
  const message =
    error instanceof ProductionEnvironmentError || error instanceof Error
      ? error.message
      : String(error);

  console.error(`Production environment validation failed: ${message}`);
  process.exit(1);
}

function parseArguments(args) {
  if (args.length === 0) {
    return null;
  }

  if (args.length !== 2 || args[0] !== "--env-file" || !args[1]) {
    throw new ProductionEnvironmentError(
      "usage: validate-env.mjs [--env-file PATH]",
    );
  }

  return args[1];
}

function readIsolatedEnvironmentFile(file) {
  if (!existsSync(file)) {
    throw new ProductionEnvironmentError(`Missing env file: ${file}`);
  }

  return parseProductionEnvironmentFile(readFileSync(file, "utf8"), file);
}
