#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

import {
  ProductionEnvironmentError,
  parseProductionEnvironmentFile,
  validateProductionEnvironment,
} from "./production-env-rules.mjs";
import { deployLog } from "./deploy-log.mjs";

const IMAGE_METADATA_NAMES = Object.freeze([
  "CLEAN_PAY_BAKED_PUBLIC_APP_URL",
  "CLEAN_PAY_BAKED_BRAND_NAME",
  "CLEAN_PAY_BAKED_BRAND_LOGO_URL",
  "CLEAN_PAY_BAKED_TURNSTILE_WIDGET_ID",
]);

try {
  const input = parseArguments(process.argv.slice(2));
  const environment = readValidationEnvironment(input);

  const imageMetadataName = IMAGE_METADATA_NAMES.find((name) =>
    Object.hasOwn(environment, name)
  );
  if (input.mode === "file" && imageMetadataName) {
    throw new ProductionEnvironmentError(
      `${imageMetadataName} is image metadata and must not be set in an env file`,
    );
  }

  validateProductionEnvironment(environment);
  deployLog(
    "info",
    "production_environment_validated",
    "Production environment validation passed. Configuration is safe to start.",
    { source: input.source },
  );
} catch (error) {
  const message =
    error instanceof ProductionEnvironmentError || error instanceof Error
      ? error.message
      : String(error);

  deployLog(
    "error",
    "production_environment_invalid",
    `Production environment validation failed: ${message}. Deployment stopped because configuration is invalid.`,
    { reason: message },
  );
  process.exit(1);
}

function parseArguments(args) {
  if (args.length === 0) {
    return { mode: "process", source: "process" };
  }

  // Do not call this flag --env-file: current Node versions consume that
  // built-in option themselves and may apply NODE_OPTIONS from an unvalidated
  // file before this script gets control.
  if (args.length === 2 && args[0] === "--clean-pay-env-file" && args[1]) {
    return { mode: "file", path: args[1], source: args[1] };
  }

  if (args.length === 1 && args[0] === "--runtime-env-stdin") {
    return { mode: "runtime-stdin", source: "runtime-env-stdin" };
  }

  throw new ProductionEnvironmentError(
    "usage: validate-env.mjs [--clean-pay-env-file PATH|--runtime-env-stdin]",
  );
}

function readValidationEnvironment(input) {
  if (input.mode === "process") {
    return process.env;
  }

  if (input.mode === "file") {
    return readIsolatedEnvironmentFile(input.path);
  }

  const environment = parseProductionEnvironmentFile(
    readFileSync(0, "utf8"),
    "runtime-env-stdin",
  );

  const injectedMetadataName = IMAGE_METADATA_NAMES.find((name) =>
    Object.hasOwn(environment, name)
  );

  if (injectedMetadataName) {
    throw new ProductionEnvironmentError(
      `${injectedMetadataName} is image metadata and must not be set in an env file`,
    );
  }

  for (const name of IMAGE_METADATA_NAMES) {
    if (Object.hasOwn(process.env, name)) {
      environment[name] = process.env[name];
    }
  }

  return environment;
}

function readIsolatedEnvironmentFile(file) {
  if (!existsSync(file)) {
    throw new ProductionEnvironmentError(`Missing env file: ${file}`);
  }

  return parseProductionEnvironmentFile(readFileSync(file, "utf8"), file);
}
