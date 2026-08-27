import { spawn } from "node:child_process";
import { chmod, lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import {
  journeyChromiumLaunchArgs,
  journeyConnectProxy,
} from "./journey-browser-policy.mjs";
import {
  assertJourneyConnectProxyGate,
  startJourneyConnectProxy,
  stopJourneyConnectProxy,
} from "./journey-connect-proxy-controller.mjs";
import { currentJourneyFixtureContractSha256Async } from "./journey-fixture-manifest.mjs";
import { attestJourneyComposeRuntime } from "./journey-compose-runtime-attestation.mjs";
import {
  assertProviderOverlapRedirect,
  classifyProviderOverlapBrowserRequest,
  finalizeProviderOverlapBrowserContract,
} from "./provider-overlap-browser-contract.mjs";
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
  scenario = requiredArgument(argumentsByName, "--scenario", /^provider-overlap-v1$/);
  outputPath = path.resolve(requiredArgument(argumentsByName, "--output", /.+/));
  await assertRepositoryRoot();
  await assertNewPrivateOutput(outputPath);
  const fixtureContractSha256 = await currentJourneyFixtureContractSha256Async();
  const playwrightVersion = await installedPlaywrightVersion();
  const baselineInput = await readStackInput("baseline");
  const candidateInput = await readStackInput("candidate");
  assertDistinctStackInputs(baselineInput, candidateInput);
  const [baselinePreflight, candidatePreflight] = await Promise.all([
    preflightStack(baselineInput, fixtureContractSha256),
    preflightStack(candidateInput, fixtureContractSha256),
  ]);
  assertDualPreflight(baselinePreflight, candidatePreflight);
  const proxyHandles = await startBothConnectProxies([baselineInput, candidateInput]);
  let runs;
  let proxySummaries;
  try {
    runs = await Promise.all([
      proveStack(baselineInput, baselinePreflight, playwrightVersion),
      proveStack(candidateInput, candidatePreflight, playwrightVersion),
    ]);
  } finally {
    proxySummaries = await stopBothConnectProxies(proxyHandles);
  }
  const [baseline, candidate] = runs.map((run, index) => createProviderOverlapStackReport({
    ...run,
    connectProxyCounters: assertJourneyConnectProxyGate(proxySummaries[index]),
  }));
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
  const contractBytes = await readBoundedBytes(contractPath, 64 * 1024, `${role} contract`);
  const contract = assertJourneyStackContract(parseJson(contractBytes, `${role} contract`), role);
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
  const expectedMigrationImageDigest = requiredArgument(
    argumentsByName,
    `--${role}-migration-image-digest`,
    /^sha256:[a-f0-9]{64}$/,
  );
  return {
    role,
    contract,
    controlUrl,
    resolverIp,
    expectedImageDigest,
    expectedMigrationImageDigest,
    contractPath,
    journeyContractSha256: sha256(contractBytes),
  };
}

async function proveStack(input, preflight, playwrightVersion) {
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
    `http://${input.contract.publications.connectProxy}`,
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
  return {
    role: input.role,
    contract: input.contract,
    journeyContractSha256: input.journeyContractSha256,
    fixtureContractSha256: input.contract.fixtureContract.sha256,
    scenario,
    imageIdentity: preflight.imageIdentity,
    runtimeBinding: preflight.runtimeBinding,
    reset,
    browser: browserRun.browser,
    navigation: browserRun.navigation,
    providerOverlap,
  };
}

async function exerciseCabinet(resolverIp, connectProxyUrl, playwrightVersion, armOverlap) {
  const maximumUnexpectedEvents = 32;
  const browser = await chromium.launch({
    headless: true,
    args: journeyChromiumLaunchArgs(resolverIp),
    proxy: journeyConnectProxy(connectProxyUrl),
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
    const unexpectedPages = [];
    const unexpectedConsole = [];
    const unexpectedPageErrors = [];
    let unexpectedPageOverflow = false;
    let unexpectedConsoleOverflow = false;
    let unexpectedPageErrorOverflow = false;
    context.on("page", (candidate) => {
      if (candidate === page) return;
      if (unexpectedPages.length < maximumUnexpectedEvents) {
        unexpectedPages.push(sha256(candidate.url()));
      } else {
        unexpectedPageOverflow = true;
      }
    });
    page.on("console", (message) => {
      if (unexpectedConsole.length < maximumUnexpectedEvents) {
        unexpectedConsole.push({ type: message.type(), sha256: sha256(message.text()) });
      } else {
        unexpectedConsoleOverflow = true;
      }
    });
    page.on("pageerror", (error) => {
      if (unexpectedPageErrors.length < maximumUnexpectedEvents) {
        unexpectedPageErrors.push(sha256(String(error?.message ?? error)));
      } else {
        unexpectedPageErrorOverflow = true;
      }
    });
    const unexpectedRequests = [];
    let unexpectedRequestOverflow = false;
    const browserRequests = [];
    const browserRequestByIdentity = new Map();
    let cabinetDocumentAllowed = false;
    let cabinetDocumentConsumed = false;
    let unexpectedWebSocketCount = 0;
    let unexpectedServiceWorkerCount = 0;
    await context.routeWebSocket("**/*", async (webSocket) => {
      unexpectedWebSocketCount = Math.min(unexpectedWebSocketCount + 1, maximumUnexpectedEvents + 1);
      await webSocket.close({ code: 1008, reason: "provider-overlap-contract" });
    });
    context.on("serviceworker", () => {
      unexpectedServiceWorkerCount = Math.min(
        unexpectedServiceWorkerCount + 1,
        maximumUnexpectedEvents + 1,
      );
    });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const rawUrl = request.url();
      let requestPage;
      try {
        requestPage = request.frame().page();
      } catch {
        requestPage = undefined;
      }
      if (requestPage !== page) {
        if (unexpectedRequests.length < maximumUnexpectedEvents) {
          unexpectedRequests.push(sha256(rawUrl));
        } else {
          unexpectedRequestOverflow = true;
        }
        await route.abort("blockedbyclient");
        return;
      }
      try {
        const classification = classifyProviderOverlapBrowserRequest({
          url: rawUrl,
          method: request.method(),
          resourceType: request.resourceType(),
          isNavigation: request.isNavigationRequest(),
          isMainFrame: request.frame() === page.mainFrame(),
        }, { cabinetDocumentAllowed });
        if (classification.key === "app-cabinet-document") {
          if (cabinetDocumentConsumed) {
            throw new Error("Synthetic browser requested the cabinet document more than once.");
          }
          cabinetDocumentConsumed = true;
        }
        const entry = { classification, request };
        browserRequests.push(entry);
        browserRequestByIdentity.set(request, entry);
        if (browserRequests.length > 256) {
          throw new Error("Synthetic browser request ledger exceeded its bounded contract.");
        }
        if (classification.disposition === "abort") {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
        return;
      } catch {
        // The emitted report never contains the rejected URL. Retain only its
        // digest for bounded local failure diagnosis.
        if (unexpectedRequests.length < maximumUnexpectedEvents) {
          unexpectedRequests.push(sha256(rawUrl));
        } else {
          unexpectedRequestOverflow = true;
        }
        await route.abort("blockedbyclient");
        return;
      }
    });
    await page.goto(
      "https://pay.ci.clean-pay.dev/login?redirect_to=%2Fprofile",
      { waitUntil: "domcontentloaded", timeout: 30_000 },
    );
    const telegram = page.getByRole("button", { name: "Войти через Telegram" });
    await telegram.waitFor({ state: "visible", timeout: 15_000 });
    await waitUntil(async () => telegram.isEnabled(), 15_000);
    await telegram.click();
    await page.waitForURL(
      (url) => url.href === "https://pay.ci.clean-pay.dev/profile",
      { timeout: 30_000 },
    );
    await page.getByRole("heading", { name: "Профиль", level: 1 })
      .waitFor({ state: "visible", timeout: 15_000 });
    await armOverlap();
    cabinetDocumentAllowed = true;
    await page.goto("https://pay.ci.clean-pay.dev/cabinet", {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForURL(
      (url) => url.href === "https://pay.ci.clean-pay.dev/cabinet",
      { timeout: 30_000 },
    );
    const heading = page.getByRole("heading", { name: "Личный кабинет", level: 1 });
    await heading.waitFor({ state: "visible", timeout: 15_000 });
    const userAgent = await page.evaluate(() => navigator.userAgent);
    if (!cabinetDocumentConsumed) {
      throw new Error("Synthetic browser did not consume the exact cabinet proof navigation.");
    }
    if (unexpectedRequests.length > 0 || unexpectedRequestOverflow) {
      throw new Error("Synthetic browser isolation blocked an unexpected request.");
    }
    if (unexpectedWebSocketCount > 0 || unexpectedServiceWorkerCount > 0) {
      throw new Error("Synthetic browser opened an unexpected WebSocket or service worker.");
    }
    if (
      unexpectedConsole.length > 0
      || unexpectedPageErrors.length > 0
      || unexpectedPages.length > 0
      || unexpectedPageOverflow
      || unexpectedConsoleOverflow
      || unexpectedPageErrorOverflow
    ) {
      throw new Error("Synthetic browser emitted unexpected console or pageerror diagnostics.");
    }
    const requestContract = await finishBrowserRequestContract(
      browserRequests,
      browserRequestByIdentity,
    );
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
        finalUrl: page.url(),
        headingVisible: await heading.isVisible(),
        unexpectedRequestCount: unexpectedRequests.length,
        unexpectedConsoleCount: unexpectedConsole.length,
        unexpectedPageErrorCount: unexpectedPageErrors.length,
        requestCount: requestContract.requestCount,
        requestContractSha256: requestContract.requestContractSha256,
      },
    };
  } finally {
    await browser.close();
  }
}

async function preflightStack(input, fixtureContractSha256) {
  if (
    input.contract.fixtureContract.domain !== "clean-pay-browser-journey-fixture-v5"
    || input.contract.fixtureContract.sha256 !== fixtureContractSha256
  ) {
    throw new Error(`${input.role} live stack contract is not bound to the current fixture bytes.`);
  }
  const composeRuntime = await attestJourneyComposeRuntime({
    repositoryRoot,
    contractPath: input.contractPath,
    contract: input.contract,
    expectedApplicationImageDigest: input.expectedImageDigest,
    expectedMigrationImageDigest: input.expectedMigrationImageDigest,
    runDocker: docker,
  });
  const serviceNames = [
    "app",
    "browser-provider-mock",
    "browser-proxy",
    "browser-oidc-mock",
    "browser-db-observer",
  ];
  const containers = Object.fromEntries(await Promise.all(serviceNames.map(async (service) => [
    service,
    await inspectProjectService(input.contract.project, service),
  ])));
  for (const [service, container] of Object.entries(containers)) {
    assertRunningService(container, input.contract.project, service, {
      healthRequired: service !== "browser-proxy",
    });
  }
  assertExactPublication(containers.app, "4000/tcp", input.contract.publications.app, input.role);
  assertExactPublication(
    containers["browser-provider-mock"],
    "3100/tcp",
    input.contract.publications.providerControl,
    input.role,
  );
  assertExactPublication(
    containers["browser-proxy"],
    "443/tcp",
    input.contract.publications.browserTls,
    input.role,
  );
  assertNoPublishedPorts(containers["browser-oidc-mock"], input.role);
  assertNoPublishedPorts(containers["browser-db-observer"], input.role);

  const syntheticEnvironmentContractSha256 = await assertSyntheticApplicationEnvironment(
    containers.app.Config.Env,
    input.contract,
    input.role,
    input.contractPath,
  );
  const imageIdentity = assertApplicationImageIdentity(
    await inspectRunningApplicationImage(input.contract, containers.app),
    input.contract,
    input.expectedImageDigest,
    input.role,
  );
  return Object.freeze({
    imageIdentity,
    runtimeBinding: Object.freeze({
      status: "preflight-proven",
      projectSha256: sha256(input.contract.project),
      journeyContractSha256: input.journeyContractSha256,
      networkSha256: composeRuntime.networkSha256,
      publicationsSha256: sha256(JSON.stringify(input.contract.publications)),
      serviceIdentitySha256: composeRuntime.serviceIdentitySha256,
      fixtureMountContractSha256: composeRuntime.fixtureMountContractSha256,
      syntheticEnvironmentContractSha256,
      composeRuntimeContractSha256: composeRuntime.composeRuntimeContractSha256,
    }),
  });
}

function assertDualPreflight(baseline, candidate) {
  if (
    baseline.runtimeBinding.projectSha256 === candidate.runtimeBinding.projectSha256
    || baseline.runtimeBinding.networkSha256 === candidate.runtimeBinding.networkSha256
    || baseline.runtimeBinding.publicationsSha256 === candidate.runtimeBinding.publicationsSha256
    || baseline.runtimeBinding.serviceIdentitySha256 === candidate.runtimeBinding.serviceIdentitySha256
    || baseline.runtimeBinding.composeRuntimeContractSha256
      === candidate.runtimeBinding.composeRuntimeContractSha256
  ) {
    throw new Error("Dual provider proof requires two simultaneously distinct live runtime bindings.");
  }
  if (
    baseline.runtimeBinding.fixtureMountContractSha256
      !== candidate.runtimeBinding.fixtureMountContractSha256
    || baseline.runtimeBinding.syntheticEnvironmentContractSha256
      !== candidate.runtimeBinding.syntheticEnvironmentContractSha256
  ) {
    throw new Error("Dual provider proof live fixture and synthetic environment contracts differ.");
  }
}

async function inspectProjectService(project, service) {
  const ids = splitLines(await docker([
    "ps",
    "--all",
    "--no-trunc",
    "--quiet",
    "--filter", `label=com.docker.compose.project=${project}`,
    "--filter", `label=com.docker.compose.service=${service}`,
  ]));
  if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) {
    throw new Error(`Expected exactly one project-owned ${service} container.`);
  }
  const inspected = parseJson(
    Buffer.from(await docker(["container", "inspect", ids[0]], 256 * 1024), "utf8"),
    `${service} Docker inspection`,
  );
  if (!Array.isArray(inspected) || inspected.length !== 1) {
    throw new Error(`${service} Docker inspection returned an invalid contract.`);
  }
  return inspected[0];
}

function assertRunningService(container, project, service, { healthRequired }) {
  if (
    container?.Id?.length !== 64
    || container.Config?.Labels?.["com.docker.compose.project"] !== project
    || container.Config?.Labels?.["com.docker.compose.service"] !== service
    || container.State?.Status !== "running"
    || container.HostConfig?.ReadonlyRootfs !== true
    || JSON.stringify(Object.keys(container.NetworkSettings?.Networks ?? {}))
      !== JSON.stringify([`${project}_default`])
    || (healthRequired && container.State?.Health?.Status !== "healthy")
  ) {
    throw new Error(`${service} does not match the exact project-owned running sandbox contract.`);
  }
}

function assertExactPublication(container, target, publication, label) {
  const [hostIp, hostPort] = publication.split(":");
  const published = Object.entries(container.NetworkSettings?.Ports ?? {})
    .flatMap(([containerPort, bindings]) => (bindings ?? []).map((binding) => ({
      containerPort,
      hostIp: binding.HostIp,
      hostPort: binding.HostPort,
    })));
  if (
    published.length !== 1
    || published[0].containerPort !== target
    || published[0].hostIp !== hostIp
    || published[0].hostPort !== hostPort
  ) {
    throw new Error(`${label} ${target} publication is not bound to its exact project service.`);
  }
}

function assertNoPublishedPorts(container, label) {
  const published = Object.values(container.NetworkSettings?.Ports ?? {})
    .flatMap((bindings) => bindings ?? []);
  if (published.length !== 0) {
    throw new Error(`${label} internal fixture service unexpectedly publishes a host port.`);
  }
}

async function assertSyntheticApplicationEnvironment(environment, contract, label, contractPath) {
  const digest = (value) => sha256(value);
  const secret = (name) => `browser-journey-${name}-${digest(`secret:${name}`)}`;
  const expected = {
    APP_URL: "https://pay.ci.clean-pay.dev",
    AUDIT_IP_HASH_SECRET: secret("audit-ip"),
    AUTH_CONCURRENCY_LIMIT: "64",
    AUTH_RATE_LIMIT_CAPACITY: "1000",
    CHATWOOT_BASE_URL: "https://chatwoot.browser.clean-pay.dev",
    CHATWOOT_HMAC_TOKEN: digest("clean-pay-browser-journey:chatwoot-hmac"),
    CHATWOOT_WEBSITE_TOKEN: digest("clean-pay-browser-journey:chatwoot-website"),
    CLEAN_PAY_DEPLOY_SOURCE: "build",
    CLEAN_PAY_IMAGE: contract.images.application,
    CLEAN_PAY_MIGRATION_IMAGE: contract.images.migration,
    CLEAN_PAY_READINESS_MAILPIT_URL: "",
    CLEAN_PAY_READINESS_REMNAWAVE_URL: "https://panel.ci.clean-pay.dev",
    CLEAN_PAY_RELEASE: `browser-journey-${contract.revision.slice(0, 12)}`,
    CLEAN_PAY_REVISION: contract.revision,
    COOKIE_SAMESITE: "lax",
    COOKIE_SECURE: "true",
    DATABASE_CONNECTION_TIMEOUT_MS: "5000",
    DATABASE_IDLE_TIMEOUT_MS: "30000",
    DATABASE_IDLE_TRANSACTION_TIMEOUT_MS: "10000",
    DATABASE_LOCK_TIMEOUT_MS: "5000",
    DATABASE_POOL_MAX: "8",
    DATABASE_QUERY_TIMEOUT_MS: "15000",
    DATABASE_STATEMENT_TIMEOUT_MS: "15000",
    DATABASE_URL: `postgresql://clean_pay_app:${secret("database-application")}@postgres:5432/clean_pay?schema=public`,
    LOG_LEVEL: "error",
    NEXT_PUBLIC_APP_URL: "https://pay.ci.clean-pay.dev",
    NEXT_PUBLIC_BRAND_LOGO_URL: "/clean-pay-logo.png",
    NEXT_PUBLIC_BRAND_NAME: "Clean Pay",
    PAYMENT_RECONCILIATION_BATCH_SIZE: "10",
    PAYMENT_RECONCILIATION_ENABLED: "false",
    PAYMENT_RECONCILIATION_INTERNAL_URL: "http://app:4000/api/internal/payments/reconcile",
    PAYMENT_RECONCILIATION_INTERVAL_SECONDS: "30",
    PAYMENT_RECONCILIATION_SECRET: "",
    PAYMENT_REDIRECT_ORIGINS: "https://checkout.browser.clean-pay.dev",
    RATE_LIMIT_IDENTITY_SECRET: secret("rate-limit"),
    READINESS_INTERNAL_SECRET: secret("readiness"),
    REDIS_URL: "redis://redis:6379/0",
    REMNASHOP_ADMIN_API_BASE_URL: "https://remnashop.browser.clean-pay.dev/api/v1/admin",
    REMNASHOP_API_BASE_URL: "https://remnashop.browser.clean-pay.dev/api/v1/public",
    REMNASHOP_API_KEY: digest("clean-pay-browser-journey:remnashop-api"),
    REMNASHOP_AUTH_SERVICE_KEY: digest("clean-pay-browser-journey:remnashop-auth"),
    REMNAWAVE_API_BASE_URL: "https://panel.ci.clean-pay.dev",
    REMNAWAVE_SUBSCRIPTION_ORIGINS: "https://subscription.ci.clean-pay.dev",
    REMNAWAVE_TOKEN: digest("clean-pay-browser-journey:remnawave"),
    SUPPORT_EMAIL: "support@clean-pay.dev",
    SUPPORT_ENABLED: "true",
    SUPPORT_FAQ_URL: "https://pay.ci.clean-pay.dev/support",
    SUPPORT_TELEGRAM_USERNAME: "cleanpay_support",
    TELEGRAM_BOT_TOKEN: `7654321098:${digest("clean-pay-browser-journey:telegram-bot")}`,
    TELEGRAM_OIDC_AUTHORIZATION_ENDPOINT: "https://oauth.telegram.org/auth",
    TELEGRAM_OIDC_CLIENT_ID: "7654321098",
    TELEGRAM_OIDC_CLIENT_SECRET: digest("clean-pay-browser-journey:telegram-oidc"),
    TELEGRAM_OIDC_ISSUER: "https://oauth.telegram.org",
    TELEGRAM_OIDC_JWKS_URI: "https://oauth.telegram.org/.well-known/jwks.json",
    TELEGRAM_OIDC_TOKEN_ENDPOINT: "https://oauth.telegram.org/token",
    TRUSTED_PROXY_HOPS: "1",
    TURNSTILE_ENABLED: "true",
    TURNSTILE_SECRET_KEY: digest("clean-pay-browser-journey:turnstile"),
    TURNSTILE_SITE_KEY: "0x4AAAAABrowserJourneyOnly8Wp4Jz7Lc2",
    TURNSTILE_VERIFY_URL: "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    WEB_JWT_SECRET: secret("web-jwt"),
    WEB_REFRESH_KEY_ID: "browser-journey-primary",
    WEB_REFRESH_SECRET: secret("web-refresh"),
  };
  assertRequiredEnvironmentProjection(environment, {
    ...expected,
    CLEAN_PAY_RUNTIME_ROLE: "application",
    NODE_ENV: "production",
  }, `${label} application`);
  const roleSource = await exactExternalFile(
    path.join(path.dirname(contractPath), ".env.app"),
    `${label} synthetic application role source`,
  );
  const roleAssignments = parseExactEnvironmentAssignments(
    await readBoundedBytes(roleSource, 64 * 1024, `${label} synthetic application role source`),
    `${label} synthetic application role source`,
  );
  const sortedExpected = Object.fromEntries(Object.entries(expected).sort(([left], [right]) => (
    left.localeCompare(right)
  )));
  if (JSON.stringify(roleAssignments) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} application role source is not the exact deterministic fixture.`);
  }
  const sharedProjection = Object.fromEntries(Object.entries(roleAssignments).filter(([name]) => ![
    "CLEAN_PAY_IMAGE",
    "CLEAN_PAY_MIGRATION_IMAGE",
    "CLEAN_PAY_RELEASE",
    "CLEAN_PAY_REVISION",
  ].includes(name)));
  return sha256(JSON.stringify(sharedProjection));
}

function parseExactEnvironmentAssignments(bytes, label) {
  const source = bytes.toString("utf8");
  if (!source.endsWith("\n") || source.includes("\r") || source.startsWith("\uFEFF")) {
    throw new Error(`${label} has non-canonical bytes.`);
  }
  const result = {};
  for (const line of source.slice(0, -1).split("\n")) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || Object.hasOwn(result, match[1])) {
      throw new Error(`${label} contains an invalid or duplicate assignment.`);
    }
    result[match[1]] = match[2];
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => (
    left.localeCompare(right)
  )));
}

function assertRequiredEnvironmentProjection(environment, expected, label) {
  const actual = new Map();
  for (const assignment of environment ?? []) {
    const separator = assignment.indexOf("=");
    const name = assignment.slice(0, separator);
    if (separator < 1 || actual.has(name)) {
      throw new Error(`${label} environment contains an invalid or duplicate assignment.`);
    }
    actual.set(name, assignment.slice(separator + 1));
  }
  if (Object.entries(expected).some(([name, value]) => actual.get(name) !== value)) {
    throw new Error(`${label} environment is not the deterministic synthetic contract.`);
  }
}

async function inspectRunningApplicationImage(contract, appContainer) {
  const [localImageDigest] = await Promise.all([
    docker(["image", "inspect", "--format", "{{.Id}}", contract.images.application]),
  ]);
  const labels = appContainer.Config.Labels;
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error("Application container labels are invalid.");
  }
  const exactDigest = appContainer.Image;
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
    reference: appContainer.Config.Image,
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

async function finishBrowserRequestContract(requests, requestByIdentity) {
  const records = [];
  const redirectedSources = new Set();
  for (const { classification, request } of requests) {
    const response = await request.response();
    const redirectedFrom = request.redirectedFrom();
    let redirectEdge = null;
    if (redirectedFrom) {
      const source = requestByIdentity.get(redirectedFrom);
      const sourceResponse = await redirectedFrom.response();
      const location = sourceResponse?.headers()?.location;
      if (!source || !sourceResponse || typeof location !== "string") {
        throw new Error("Synthetic browser redirect chain is incomplete.");
      }
      redirectEdge = assertProviderOverlapRedirect({
        from: { classification: source.classification, url: redirectedFrom.url() },
        to: { classification, url: request.url() },
        status: sourceResponse.status(),
        location,
      });
      redirectedSources.add(redirectedFrom);
    }
    records.push({
      classification,
      redirectEdge,
      responseContentType: response
        ? normalizeResponseContentType(response.headers()["content-type"])
        : null,
      responseStatus: response?.status() ?? null,
    });
  }
  for (const { classification, request } of requests) {
    const response = await request.response();
    if (
      response
      && response.status() >= 300
      && response.status() <= 399
      && !redirectedSources.has(request)
      && classification.disposition !== "abort"
    ) {
      throw new Error("Synthetic browser redirect response has no exact successor.");
    }
  }
  return finalizeProviderOverlapBrowserContract(records);
}

function normalizeResponseContentType(value) {
  if (value === undefined) return null;
  const normalized = String(value).split(";", 1)[0].trim().toLowerCase();
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized)) {
    throw new Error("Synthetic browser response content type is invalid.");
  }
  return normalized;
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
  return parseJson(await readBoundedBytes(target, maximumBytes, label), label);
}

async function readBoundedBytes(target, maximumBytes, label) {
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded file contract.`);
  }
  const bytes = await readFile(target);
  if (bytes.byteLength !== metadata.size || bytes.byteLength > maximumBytes) {
    throw new Error(`${label} changed while its bounded bytes were read.`);
  }
  return bytes;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
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
    "--baseline-migration-image-digest",
    "--baseline-resolver-ip",
    "--candidate-contract",
    "--candidate-control-url",
    "--candidate-image-digest",
    "--candidate-migration-image-digest",
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
  const baselinePublications = Object.values(baseline.contract.publications);
  const candidatePublications = Object.values(candidate.contract.publications);
  if (
    baseline.contract.project === candidate.contract.project
    || baseline.controlUrl.href === candidate.controlUrl.href
    || baseline.resolverIp === candidate.resolverIp
    || baseline.expectedImageDigest === candidate.expectedImageDigest
    || baseline.expectedMigrationImageDigest === candidate.expectedMigrationImageDigest
    || baseline.contract.revision === candidate.contract.revision
    || baseline.contractPath === candidate.contractPath
    || baselinePublications.some((publication) => candidatePublications.includes(publication))
  ) {
    throw new Error("Baseline and candidate inputs must identify two distinct isolated image stacks.");
  }
  if (
    JSON.stringify(baseline.contract.publicBuildContract)
      !== JSON.stringify(candidate.contract.publicBuildContract)
  ) {
    throw new Error("Baseline and candidate public build contracts must be byte-identical.");
  }
  if (
    JSON.stringify(baseline.contract.fixtureContract)
      !== JSON.stringify(candidate.contract.fixtureContract)
  ) {
    throw new Error("Baseline and candidate fixture contracts must be byte-identical.");
  }
}

async function startBothConnectProxies(inputs) {
  const settled = await Promise.allSettled(inputs.map((input) => {
    const [listenHost, listenPort] = input.contract.publications.connectProxy.split(":");
    return startJourneyConnectProxy({
      environment: process.env,
      listenHost,
      listenPort,
      repositoryRoot,
      targetHost: input.resolverIp,
      targetPort: "443",
    });
  }));
  const handles = settled.filter(({ status }) => status === "fulfilled").map(({ value }) => value);
  if (settled.some(({ status }) => status === "rejected")) {
    await Promise.allSettled(handles.map((handle) => stopJourneyConnectProxy(handle)));
    throw new Error("Both isolated CONNECT proxies must become ready before browser actions.");
  }
  return handles;
}

async function stopBothConnectProxies(handles) {
  const settled = await Promise.allSettled(handles.map((handle) => stopJourneyConnectProxy(handle)));
  if (settled.some(({ status }) => status === "rejected")) {
    throw new Error("Both isolated CONNECT proxies must stop with exact sanitized summaries.");
  }
  return settled.map(({ value }) => value);
}

function docker(args, maximumBytes = 64 * 1024, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd: repositoryRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stdoutBytes = 0;
    let stderr = "";
    let overflow = false;
    let settled = false;
    const finish = (operation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      operation();
    };
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill();
      finish(() => reject(new Error("Read-only Docker identity query timed out.")));
    }, 15_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      const chunkBytes = Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes + chunkBytes > maximumBytes) {
        overflow = true;
        child.kill();
        return;
      }
      stdout += chunk;
      stdoutBytes += chunkBytes;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 4 * 1024) stderr += chunk.slice(0, 4 * 1024 - stderr.length);
    });
    child.once("error", () => finish(() => reject(new Error(
      "Read-only Docker identity query failed to start.",
    ))));
    child.once("exit", (code) => {
      if (code === 0 && !overflow && stdoutBytes <= maximumBytes) {
        finish(() => resolve(stdout.trim()));
      } else {
        finish(() => reject(new Error(
          `Read-only Docker identity query failed (${code ?? "unknown"}:${sha256(stderr)}).`,
        )));
      }
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
