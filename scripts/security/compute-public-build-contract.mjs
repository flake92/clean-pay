#!/usr/bin/env node

import { createHash } from "node:crypto";

const CONTRACT_DOMAIN = "clean-pay-public-build-contract";
const CONTRACT_VERSION = "1";
const FIELD_NAMES = Object.freeze([
  "NEXT_PUBLIC_APP_URL",
  "TURNSTILE_ENABLED",
  "TURNSTILE_SITE_KEY",
  "NEXT_PUBLIC_BRAND_NAME",
  "NEXT_PUBLIC_BRAND_LOGO_URL",
]);

function requiredEnvironmentValue(name) {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required to compute the public build contract`);
  }

  return value;
}

function lengthPrefixed(value) {
  const encoded = Buffer.from(value, "utf8");
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(encoded.length));
  return [length, encoded];
}

function canonicalContractBytes() {
  const chunks = [];

  for (const value of [CONTRACT_DOMAIN, CONTRACT_VERSION]) {
    chunks.push(...lengthPrefixed(value));
  }

  for (const name of FIELD_NAMES) {
    chunks.push(...lengthPrefixed(name), ...lengthPrefixed(requiredEnvironmentValue(name)));
  }

  return Buffer.concat(chunks);
}

try {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length > 0 || (mode !== undefined && mode !== "--version")) {
    throw new Error("usage: compute-public-build-contract.mjs [--version]");
  }
  if (mode === "--version") {
    process.stdout.write(`${CONTRACT_VERSION}\n`);
  } else {
    const digest = createHash("sha256").update(canonicalContractBytes()).digest("hex");
    process.stdout.write(`${digest}\n`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Cannot compute public build contract: ${message}\n`);
  process.exitCode = 1;
}
