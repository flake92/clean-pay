#!/usr/bin/env node

import {
  ProductionEnvironmentError,
  validateProductionPublicBuildConfiguration,
} from "./production-env-rules.mjs";

try {
  const release = process.env.CLEAN_PAY_RELEASE ?? "";

  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(release)) {
    throw new ProductionEnvironmentError(
      "CLEAN_PAY_RELEASE must be a valid explicit Docker tag",
    );
  }

  if (/^(?:local|unknown|unset|none|dev|development|latest)$/i.test(release)) {
    throw new ProductionEnvironmentError(
      "CLEAN_PAY_RELEASE must identify a traceable immutable release",
    );
  }

  if (/^(?:sha|candidate)-/i.test(release)) {
    throw new ProductionEnvironmentError(
      "CLEAN_PAY_RELEASE must not use the reserved sha-* or candidate-* tag namespace",
    );
  }

  validateProductionPublicBuildConfiguration(process.env);
  process.stdout.write("Production public build inputs are valid.\n");
} catch (error) {
  const message =
    error instanceof ProductionEnvironmentError || error instanceof Error
      ? error.message
      : String(error);

  process.stderr.write(`Invalid production public build: ${message}\n`);
  process.exitCode = 1;
}
