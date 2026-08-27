import { spawn } from "node:child_process";
import { chmod, lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";
import { JOURNEY_SYNTHETIC_HOSTNAMES } from "./journey-network-policy.mjs";
import {
  PROVIDER_OVERLAP_ACTION,
  PROVIDER_OVERLAP_BROWSER_PROJECT,
  assertApplicationImageIdentity,
  assertDeterministicReset,
  assertJourneyStackContract,
  assertLoopbackControlUrl,
  assertLoopbackResolver,
  createDualProviderOverlapProof,
  createProviderOverlapStackReport,
  extractProviderOverlapProof,
  sha256,
} from "./provider-overlap-proof-contract.mjs";

const repositoryRoot = path.resolve(process.cwd());
let argumentsByName;
let scenario;
let outputPath;

try {
  argumentsByName = parseArguments(process.argv.slice(2));
  scenario = requiredArgument(argumentsByName, "--scenario", /^[a-z0-9][a-z0-9:-]{1,180}$/);
  outputPath = path.resolve(requiredArgument(argumentsByName, "--output", /.+/));
  await assertRepositoryRoot();
  await assertNewPrivateOutput(outputPath);
  const fixtureContractSha256 = await currentJourneyFixtureContractSha256Async();
  const playwrightVersion = await installedPlaywrightVersion();
  const baselineInput = await readStackInput("baseline");
  const candidateInput = await readStackInput("candidate");
  assertDistinctStackInputs(baselineInput, candidateInput);

  const baseline = await proveStack(baselineInput, fixtureContractSha256, playwrightVersion);
  const candidate = await proveStack(candidateInput, fixtureContractSha256, playwrightVersion);
  const document = createDualProviderOverlapProof(baseline, candidate);
  const bytes = Buffer.from(`${JSON.stringify(document, null, 2)}\n`, "utf8");
  await writeFile(outputPath, bytes, { flag: "wx", mode: 0o600 });
  await chmod(outputPath, 0o600).catch(() => undefined);
  process.stdout.write(`${JSON.stringify({
    status: "dual_image_provider_overlap_proven",
    schemaVersion: document.schemaVersion,
    baselineImageDigest: document.stacks.baseline.applicationImage.digest,
    candidateImageDigest: document.stacks.candidate.applicationImage.digest,
    fixtureContractSha256,
    proofSha256: sha256(bytes),
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    status: "dual_image_provider_overlap_failed",
    errorClass: error?.constructor?.name ?? "Error",
    messageSha256: sha256(String(error?.message ?? "unknown")),
  })}\n`);
  process.exitCode = 1;
}

async function readStackInput(role) {
  const contractPath = await exactExternalFile(
    requiredArgument(argumentsByName, `--${role}-contract`, /.+/),
    `${role} contract`,
  );
  const contract = assertJourneyStackContract(
    await readBoundedJson(contractPath, 64 * 1024, `${role} contract`),
    role,
  );
  const controlUrl = assertLoopbackControlUrl(
    requiredArgument(argumentsByName, `--${role}-control-url`, /.+/),
    contract.publications.providerControl,
    `${role} control URL`,
  );
  const resolverIp = assertLoopbackResolver(
    requiredArgument(argumentsByName, `--${role}-resolver-ip`, /.+/),
    contract.publications.browserTls,
    `${role} resolver IP`,
  );
  const expectedImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  return {
    role,
    contract,
    controlUrl,
    resolverIp,
    expectedImageDigest,
  };
}

async function proveStack(input, fixtureContractSha256, playwrightVersion) {
  const imageIdentity = assertApplicationImageIdentity(
    await inspectRunningApplicationImage(input.contract),
    input.contract,
    input.expectedImageDigest,
    input.role,
  );
  const reset = assertDeterministicReset(
    await controlJson(input.controlUrl, "/__reset", {
      method: "POST",
      body: { scenario },
    }),
    scenario,
    input.contract.project,
    input.role,
  );
  const browserRun = await exerciseCabinet(
    input.resolverIp,
    playwrightVersion,
    async () => {
      const armed = await controlJson(input.controlUrl, "/__inject", {
        method: "POST",
        body: { action: PROVIDER_OVERLAP_ACTION },
      });
      if (
        JSON.stringify(armed)
          !== JSON.stringify({ status: "armed", action: PROVIDER_OVERLAP_ACTION })
      ) {
        throw new Error(`${input.role} overlap barrier did not return its exact armed contract.`);
      }
    },
  );
  const providerOverlap = extractProviderOverlapProof(
    await controlJson(input.controlUrl, "/__concurrency"),
    await controlJson(input.controlUrl, "/__ledger", {}, 2 * 1024 * 1024),
    input.role,
  );
  return createProviderOverlapStackReport({
    role: input.role,
    contract: input.contract,
    fixtureContractSha256,
    scenario,
    imageIdentity,
    reset,
    browser: browserRun.browser,
    navigation: browserRun.navigation,
    providerOverlap,
  });
}

async function exerciseCabinet(resolverIp, playwrightVersion, armOverlap) {
  const resolverRules = JOURNEY_SYNTHETIC_HOSTNAMES
    .map((hostname) => `MAP ${hostname} ${resolverIp}`)
    .join(", ");
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--ignore-certificate-errors",
      `--host-resolver-rules=${resolverRules}, MAP * ~NOTFOUND`,
    ],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      colorScheme: "light",
      reducedMotion: "reduce",
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const unexpectedRequests = [];
    let cabinetDocumentAllowed = false;
    let cabinetDocumentConsumed = false;
    await page.route("**/*", async (route) => {
      const rawUrl = route.request().url();
      const parsed = safeUrl(rawUrl);
      if (
        parsed?.origin === "https://pay.ci.clean-pay.dev"
        && parsed.pathname === "/cabinet"
      ) {
        const exactDocument = cabinetDocumentAllowed
          && !cabinetDocumentConsumed
          && route.request().method() === "GET"
          && route.request().isNavigationRequest()
          && route.request().frame() === page.mainFrame()
          && parsed.search === ""
          && parsed.hash === "";
        if (exactDocument) {
          cabinetDocumentConsumed = true;
          await route.continue();
        } else {
          await route.abort("blockedbyclient");
        }
        return;
      }
      if (allowedBrowserUrl(rawUrl)) {
        await route.continue();
        return;
      }
      unexpectedRequests.push(sha256(rawUrl));
      await route.abort("blockedbyclient");
    });
    await page.goto(
      "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile",
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    const telegram = page.getByRole("button", { name: "Войти через Telegram" });
    await telegram.waitFor({ state: "visible", timeout: 15_000 });
    await waitUntil(async () => telegram.isEnabled(), 15_000);
    await telegram.click();
    await page.waitForURL((url) => url.pathname === "/profile", { timeout: 30_000 });
    await page.getByRole("heading", { name: "Профиль", level: 1 })
      .waitFor({ state: "visible", timeout: 15_000 });
    await armOverlap();
    cabinetDocumentAllowed = true;
    await page.goto("https://pay.ci.clean-pay.dev/cabinet", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForURL((url) => url.pathname === "/cabinet", { timeout: 30_000 });
    const heading = page.getByRole("heading", { name: "Личный кабинет", level: 1 });
    await heading.waitFor({ state: "visible", timeout: 15_000 });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    if (!cabinetDocumentConsumed) {
      throw new Error("Synthetic browser did not consume the exact cabinet proof navigation.");
    }
    if (unexpectedRequests.length > 0) {
      throw new Error("Synthetic browser isolation blocked an unexpected request.");
    }
    return {
      browser: {
        project: PROVIDER_OVERLAP_BROWSER_PROJECT,
        playwrightVersion,
        chromiumVersion: browser.version(),
        userAgentSha256: sha256(userAgent),
        viewport: { width: 1440, height: 900 },
        locale: "ru-RU",
        timezoneId: "Europe/Moscow",
        colorScheme: "light",
      },
      navigation: {
        finalPath: new URL(page.url()).pathname,
        headingVisible: await heading.isVisible(),
        unexpectedRequestCount: unexpectedRequests.length,
      },
    };
  } finally {
    await browser.close();
  }
}

async function inspectRunningApplicationImage(contract) {
  const filters = [
    `label=com.docker.compose.project=${contract.project}`,
    "label=com.docker.compose.service=app",
    "status=running",
  ];
  const containerIds = splitLines(await docker([
    "ps",
    "--no-trunc",
    "--quiet",
    ...filters.flatMap((filter) => ["--filter", filter]),
  ]));
  if (containerIds.length !== 1 || !/^[a-f0-9]{64}$/.test(containerIds[0])) {
    throw new Error("Expected exactly one running project-owned application container.");
  }
  const containerId = containerIds[0];
  const [digest, reference, labelsBytes, localImageDigest] = await Promise.all([
    docker(["container", "inspect", "--format", "{{.Image}}", containerId]),
    docker(["container", "inspect", "--format", "{{.Config.Image}}", containerId]),
    docker(["container", "inspect", "--format", "{{json .Config.Labels}}", containerId]),
    docker(["image", "inspect", "--format", "{{.Id}}", contract.images.application]),
  ]);
  const labels = JSON.parse(labelsBytes);
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("Application container labels are invalid.");
  }
  const exactDigest = digest.trim();
  if (localImageDigest.trim() !== exactDigest) {
    throw new Error("Running container and referenced local image digests differ.");
  }
  if (
    labels["com.docker.compose.project"] !== contract.project
    || labels["com.docker.compose.service"] !== "app"
  ) {
    throw new Error("Application container ownership labels are invalid.");
  }
  return {
    digest: exactDigest,
    reference: reference.trim(),
    revision: labels["org.opencontainers.image.revision"],
    role: labels["io.clean-pay.role"],
    publicBuildContract: {
      version: labels["io.clean-pay.public-build-contract-version"],
      sha256: labels["io.clean-pay.public-build-contract-sha256"],
    },
  };
}

async function controlJson(baseUrl, pathname, options = {}, maximumBytes = 1024 * 1024) {
  const url = new URL(pathname, baseUrl);
  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Fixture control rejected ${pathname}.`);
  if (!/^application\/json(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    throw new Error(`Fixture control returned an invalid content type for ${pathname}.`);
  }
  const bytes = await boundedResponseBytes(response, maximumBytes);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Fixture control returned invalid JSON for ${pathname}.`);
  }
}

async function boundedResponseBytes(response, maximumBytes) {
  if (!response.body) throw new Error("Fixture control response has no body.");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error("Fixture control response exceeds its bounded evidence limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function allowedBrowserUrl(rawUrl) {
  const url = safeUrl(rawUrl);
  if (!url) return false;
  if (new Set(["about:", "blob:", "data:"]).has(url.protocol)) return true;
  return url.protocol === "https:"
    && url.port === ""
    && !url.username
    && !url.password
    && JOURNEY_SYNTHETIC_HOSTNAMES.includes(url.hostname);
}

function safeUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

async function installedPlaywrightVersion() {
  const packageValue = await readBoundedJson(
    path.join(repositoryRoot, "node_modules", "playwright", "package.json"),
    64 * 1024,
    "installed Playwright package",
  );
  const rootPackage = await readBoundedJson(
    path.join(repositoryRoot, "package.json"),
    64 * 1024,
    "root package",
  );
  const expected = rootPackage?.devDependencies?.["@playwright/test"];
  if (
    typeof packageValue?.version !== "string"
    || packageValue.version !== expected
    || !/^\d+\.\d+\.\d+$/.test(packageValue.version)
  ) {
    throw new Error("Installed Playwright does not match the exact local lock contract.");
  }
  return packageValue.version;
}

async function assertRepositoryRoot() {
  const packageValue = await readBoundedJson(
    path.join(repositoryRoot, "package.json"),
    64 * 1024,
    "repository package",
  );
  if (packageValue?.name !== "clean-pay" || packageValue?.private !== true) {
    throw new Error("Provider overlap proof must run from the Clean Pay repository root.");
  }
}

async function exactExternalFile(rawPath, label) {
  if (!path.isAbsolute(rawPath)) throw new Error(`${label} path must be absolute.`);
  const resolved = await realpath(rawPath);
  if (isWithin(repositoryRoot, resolved)) {
    throw new Error(`${label} must stay outside the repository and immutable baselines.`);
  }
  const metadata = await lstat(resolved);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`${label} must be a regular file.`);
  return resolved;
}

async function assertNewPrivateOutput(target) {
  if (!path.isAbsolute(target) || isWithin(repositoryRoot, target)) {
    throw new Error("Proof output must be an absolute new path outside the repository.");
  }
  const parent = await realpath(path.dirname(target));
  if (isWithin(repositoryRoot, parent)) {
    throw new Error("Proof output parent must stay outside the repository.");
  }
  try {
    await stat(target);
    throw new Error("Proof output already exists; evidence is write-once.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function readBoundedJson(target, maximumBytes, label) {
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded file contract.`);
  }
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function parseArguments(values) {
  if (values.length % 2 !== 0) throw new Error("Provider overlap proof requires exact flag/value pairs.");
  const allowed = new Set([
    "--baseline-contract",
    "--baseline-control-url",
    "--baseline-image-digest",
    "--baseline-resolver-ip",
    "--candidate-contract",
    "--candidate-control-url",
    "--candidate-image-digest",
    "--candidate-resolver-ip",
    "--output",
    "--scenario",
  ]);
  const result = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!allowed.has(name) || result.has(name) || !value || value.startsWith("--")) {
      throw new Error("Provider overlap proof arguments do not match the exact contract.");
    }
    result.set(name, value);
  }
  if (result.size !== allowed.size) {
    throw new Error("Provider overlap proof requires every exact input flag once.");
  }
  return result;
}

function requiredArgument(values, name, pattern) {
  const value = values.get(name);
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
  return value;
}

function assertDistinctStackInputs(baseline, candidate) {
  if (
    baseline.contract.project === candidate.contract.project
    || baseline.controlUrl.href === candidate.controlUrl.href
    || baseline.resolverIp === candidate.resolverIp
    || baseline.expectedImageDigest === candidate.expectedImageDigest
    || baseline.contract.revision === candidate.contract.revision
  ) {
    throw new Error("Baseline and candidate inputs must identify two distinct isolated image stacks.");
  }
  if (
    JSON.stringify(baseline.contract.publicBuildContract)
      !== JSON.stringify(candidate.contract.publicBuildContract)
  ) {
    throw new Error("Baseline and candidate public build contracts must be byte-identical.");
  }
}

function docker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length + chunk.length > 64 * 1024) {
        child.kill();
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4 * 1024) stderr += chunk.slice(0, 4 * 1024 - stderr.length);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0 && stdout.length <= 64 * 1024) resolve(stdout.trim());
      else reject(new Error(`Read-only Docker identity query failed (${code ?? "unknown"}:${sha256(stderr)}).`));
    });
  });
}

function splitLines(value) {
  return value.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);
}

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Synthetic browser state did not become ready within its bounded timeout.");
}
