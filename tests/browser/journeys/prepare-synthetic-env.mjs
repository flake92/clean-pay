import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";
import { buildJourneySyntheticEnvironment } from "./journey-synthetic-environment-contract.mjs";

const destination = requiredPath("CLEAN_PAY_BROWSER_JOURNEY_ENV_DIR");
const repositoryRoot = path.resolve(process.cwd());
if (isWithin(repositoryRoot, destination)) {
  throw new Error("Journey environment output must stay outside the repository.");
}
if (process.env.CLEAN_PAY_BROWSER_SYNTHETIC_ENV_SOURCE) {
  throw new Error("Journey environment is self-contained and refuses external env sources.");
}

const project = requiredValue(
  "CLEAN_PAY_BROWSER_COMPOSE_PROJECT",
  /^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/,
);
const appImage = requiredValue(
  "CLEAN_PAY_BROWSER_APP_IMAGE",
  /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/,
);
const migrationImage = requiredValue(
  "CLEAN_PAY_BROWSER_MIGRATION_IMAGE",
  /^[A-Za-z0-9][A-Za-z0-9._/:@-]{1,240}$/,
);
const revision = requiredValue("CLEAN_PAY_BROWSER_SOURCE_REVISION", /^[a-f0-9]{40}$/);
const appPort = optionalValue("CLEAN_PAY_BROWSER_APP_PORT", "4100", /^\d{4,5}$/);
const providerPort = optionalValue("CLEAN_PAY_BROWSER_PROVIDER_PORT", "13100", /^\d{4,5}$/);
const connectProxyPort = optionalValue(
  "CLEAN_PAY_BROWSER_CONNECT_PROXY_PORT",
  "14444",
  /^\d{4,5}$/,
);
const proxyBind = optionalValue(
  "CLEAN_PAY_BROWSER_PROXY_BIND",
  "127.0.0.2",
  /^127\.0\.0\.(?:[2-9]|[1-9]\d|1\d\d|2[0-4]\d|25[0-4])$/,
);
const turnstileSiteKey = optionalValue(
  "CLEAN_PAY_BROWSER_TURNSTILE_SITE_KEY",
  "0x4AAAAABrowserJourneyOnly8Wp4Jz7Lc2",
  /^[A-Za-z0-9_-]{20,100}$/,
);
const generated = buildJourneySyntheticEnvironment({
  appImage,
  appPort,
  connectProxyPort,
  directory: destination,
  migrationImage,
  project,
  providerPort,
  proxyBind,
  revision,
  turnstileSiteKey,
});
await mkdir(destination, { recursive: true, mode: 0o700 });
await chmod(destination, 0o700).catch(() => undefined);
for (const [filename, bytes] of Object.entries(generated.files)) {
  await privateWrite(path.join(destination, filename), bytes);
}

const publicBuildContractSha256 = generated.publicBuildContractSha256;
const fixtureContractSha256 = await currentJourneyFixtureContractSha256Async();
await privateWrite(path.join(destination, "browser-journey-contract.json"), `${JSON.stringify({
  schemaVersion: 1,
  kind: "self-contained-synthetic-browser-journey",
  project,
  revision,
  images: {
    application: appImage,
    migration: migrationImage,
  },
  publicBuildContract: { version: "1", sha256: publicBuildContractSha256 },
  fixtureContract: {
    domain: "clean-pay-browser-journey-fixture-v5",
    sha256: fixtureContractSha256,
  },
  publications: {
    app: `127.0.0.1:${appPort}`,
    providerControl: `127.0.0.1:${providerPort}`,
    browserTls: `${proxyBind}:443`,
    connectProxy: `127.0.0.1:${connectProxyPort}`,
  },
  secretSource: "deterministic synthetic fixture labels; no external env or credential file",
  ownedStateReset: {
    postgres: "transactional truncate of public application tables; migrations retained; schema has no sequences",
    redis: "flush DB 0 on the project-local redis service",
    scope: "exact COMPOSE_PROJECT_NAME label and internal service DNS only",
  },
}, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  status: "prepared",
  project,
  publicBuildContractSha256,
  fixtureContractSha256,
  roleFileCount: generated.productionRoleFileCount,
})}\n`);

async function privateWrite(target, value) {
  await writeFile(target, value, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await chmod(target, 0o600).catch(() => undefined);
}

function requiredPath(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return path.resolve(value);
}

function requiredValue(name, pattern) {
  const value = process.env[name]?.trim();
  if (!value || !pattern.test(value)) throw new Error(`${name} is required and must match ${pattern}.`);
  return value;
}

function optionalValue(name, fallback, pattern) {
  const value = process.env[name]?.trim() || fallback;
  if (!pattern.test(value)) throw new Error(`${name} must match ${pattern}.`);
  return value;
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
