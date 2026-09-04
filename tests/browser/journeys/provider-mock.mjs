import crypto from "node:crypto";
import http from "node:http";

const remnashopPort = Number(process.env.REMNASHOP_PORT ?? "5000");
const remnawavePort = Number(process.env.REMNAWAVE_PORT ?? "3000");
const controlPort = Number(process.env.CONTROL_PORT ?? "3100");
const oidcResetUrl = process.env.OIDC_RESET_URL
  ?? "http://browser-oidc-mock:8090/__reset";
const dbObserverUrl = process.env.DB_OBSERVER_URL ?? null;
const dbScope = process.env.CLEAN_PAY_BROWSER_DB_SCOPE ?? null;
if (dbObserverUrl && !/^clean-pay-browser-journey-[a-z0-9][a-z0-9-]{5,80}$/.test(dbScope ?? "")) {
  throw new Error("Provider mock requires the exact disposable DB observer project scope.");
}
const appOrigin = "https://pay.ci.clean-pay.dev";
const checkoutOrigin = "https://checkout.browser.clean-pay.dev";
const syntheticEmail = "synthetic.browser@clean-pay.dev";
const syntheticTelegramId = 900000001;
const linkedEmailFailureScenarioPrefix = "authorized-linked-email-feedback:";
const linkedEmailFailureTarget = "linked-email-existing@clean-pay.dev";
const fixedNow = "2026-08-27T00:00:00.000Z";
const fixedExpiry = "2030-01-01T00:00:00.000Z";
const fixedRefreshExpiry = "2031-01-01T00:00:00.000Z";
const remnashopApiKey = sha256("clean-pay-browser-journey:remnashop-api");
const remnashopAuthServiceKey = sha256("clean-pay-browser-journey:remnashop-auth");
const remnawaveToken = sha256("clean-pay-browser-journey:remnawave");
const oidcLedgerKey = sha256("clean-pay-browser-journey:oidc-ledger");
const turnstileSecret = sha256("clean-pay-browser-journey:turnstile");
const chatwootWebsiteToken = sha256("clean-pay-browser-journey:chatwoot-website");
const chatwootContactResponseDelayMs = boundedIntegerEnvironment(
  "CLEAN_PAY_BROWSER_CHATWOOT_CONTACT_RESPONSE_DELAY_MS",
  75,
  25,
  2_500,
);
const chatwootPreCabinetContactResponseDelayMs = boundedIntegerEnvironment(
  "CLEAN_PAY_BROWSER_CHATWOOT_PRE_CABINET_CONTACT_RESPONSE_DELAY_MS",
  1_800,
  25,
  2_500,
);
const chatwootContextResponseDelayMs = boundedIntegerEnvironment(
  "CLEAN_PAY_BROWSER_CHATWOOT_CONTEXT_RESPONSE_DELAY_MS",
  500,
  25,
  2_500,
);
const authenticatedChatwootScenarioSuffix = ":email-register-verify-and-login";
const cabinetReadOverlapTimeoutMs = boundedIntegerEnvironment(
  "CLEAN_PAY_BROWSER_CABINET_READ_OVERLAP_TIMEOUT_MS",
  5_000,
  100,
  10_000,
);
const cabinetReadOverlapAction = "cabinet_read_overlap_once";
const cabinetReadOverlapProbe = "cabinet-offers-devices-overlap";
const cabinetReadParticipants = Object.freeze([
  Object.freeze({
    key: "devices",
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/devices",
  }),
  Object.freeze({
    key: "offers",
    service: "remnashop",
    method: "GET",
    pathname: "/api/v1/public/subscription/offers",
  }),
]);

let sequence = 0;
let paymentSequence = 0;
let activeScenario = "contract-default";
const ledger = [];
const profiles = new Map();
const ownerProfiles = new Map();
const accessOwners = new Map();
const refreshOwners = new Map();
const payments = new Map();
const paymentIdempotency = new Map();
const registeredEmails = new Set();
const subscriptionlessOwners = new Set();
const telegramOwnerAliases = new Map();
const remnawaveUsers = new Map();
const consumedTurnstileTokens = new Set();
let disconnectCommittedPaymentOnce = false;
let rateLimitCommittedPaymentOnce = false;
let cabinetReadOverlapOccurrence = 0;
let activeCabinetReadOverlap = null;
const cabinetReadOverlapWindows = [];
let cabinetSurfaceObserved = false;

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function accessToken(owner) {
  return `${base64url({ alg: "none", typ: "JWT" })}.${base64url({ sub: owner, exp: 1893456000 })}.synthetic`;
}

function refreshToken(owner) {
  return `refresh-${sha256(`clean-pay-browser:${owner}`).slice(0, 40)}`;
}

function emailOwner(email) {
  const normalized = typeof email === "string" ? email.toLowerCase() : syntheticEmail;
  const numeric = Number.parseInt(sha256(normalized).slice(0, 8), 16);
  return String(100000000 + (numeric % 800000000));
}

function scenarioTelegramId(scenario) {
  if (scenario === "contract-default") return syntheticTelegramId;
  return 900000000 + (Number.parseInt(sha256(`telegram:${scenario}`).slice(0, 8), 16) % 99999999);
}

function linkedEmailFailureScenario() {
  return activeScenario.startsWith(linkedEmailFailureScenarioPrefix);
}

function paymentId(sequenceValue) {
  if (activeScenario === "contract-default") {
    return `00000000-0000-4000-8000-${String(sequenceValue).padStart(12, "0")}`;
  }
  const hex = sha256(`payment:${activeScenario}:${sequenceValue}`).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16], 16) % 4];
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function telegramIdentityFromRequest(path, input) {
  if (path === "/auth/telegram" && Number.isSafeInteger(input.id) && input.id > 0) {
    return Number(input.id);
  }
  if (path === "/auth/telegram/webapp" && typeof input.init_data === "string") {
    try {
      const user = JSON.parse(new URLSearchParams(input.init_data).get("user") ?? "null");
      if (user && Number.isSafeInteger(user.id) && user.id > 0) return Number(user.id);
    } catch {
      return null;
    }
  }
  return null;
}

function defaultProfile(overrides = {}) {
  return {
    telegram_id: syntheticTelegramId,
    auth_type: "telegram",
    email: syntheticEmail,
    is_email_verified: true,
    pending_email: null,
    name: "Synthetic Browser User",
    username: "synthetic_browser",
    language: "ru",
    has_password: true,
    ...overrides,
  };
}

function issueSession(response, owner, profile) {
  const access = accessToken(owner);
  const refresh = refreshToken(owner);
  profiles.set(access, profile);
  ownerProfiles.set(owner, profile);
  accessOwners.set(access, owner);
  refreshOwners.set(refresh, owner);
  response.setHeader("set-cookie", [
    `access_token=${access}; Path=/; HttpOnly; SameSite=Lax`,
    `refresh_token=${refresh}; Path=/; HttpOnly; SameSite=Lax`,
  ]);
  return {
    expires_at: fixedExpiry,
    refresh_expires_at: fixedRefreshExpiry,
  };
}

function cookie(request, name) {
  const header = request.headers.cookie ?? "";
  for (const pair of header.split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return null;
}

function currentProfile(request) {
  const access = cookie(request, "access_token");
  return access ? profiles.get(access) ?? null : null;
}

function updateCurrentProfile(request, profile) {
  const access = cookie(request, "access_token");
  if (!access) return false;
  const owner = accessOwners.get(access);
  if (!owner) return false;
  profiles.set(access, profile);
  ownerProfiles.set(owner, profile);
  return true;
}

function replaceOwnerProfile(owner, profile) {
  ownerProfiles.set(owner, profile);
  for (const [access, accessOwner] of accessOwners) {
    if (accessOwner === owner) profiles.set(access, profile);
  }
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024) {
        reject(new Error("request body exceeds browser fixture limit"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseJson(body) {
  if (!body) return {};
  try {
    const value = JSON.parse(body);
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function queryKeys(url) {
  return [...new Set(url.searchParams.keys())].sort();
}

function armCabinetReadOverlap() {
  if (activeCabinetReadOverlap) return false;

  const probe = {
    occurrence: ++cabinetReadOverlapOccurrence,
    entered: new Map(),
    duplicates: [],
    waiters: [],
    maxInFlight: 0,
    settled: false,
    timer: null,
  };
  activeCabinetReadOverlap = probe;
  probe.timer = setTimeout(() => {
    finishCabinetReadOverlap(probe, "timeout", "bounded-timeout");
  }, cabinetReadOverlapTimeoutMs);
  return true;
}

function enterCabinetReadOverlap(participantKey, ledgerSequence) {
  const probe = activeCabinetReadOverlap;
  if (!probe || probe.settled) return null;

  return new Promise((resolve) => {
    if (activeCabinetReadOverlap !== probe || probe.settled) {
      resolve();
      return;
    }

    probe.waiters.push(resolve);
    probe.maxInFlight = Math.max(probe.maxInFlight, probe.waiters.length);
    if (probe.entered.has(participantKey)) {
      probe.duplicates.push({ participantKey, ledgerSequence });
      finishCabinetReadOverlap(probe, "invalid", "invalid-duplicate");
      return;
    }

    probe.entered.set(participantKey, ledgerSequence);
    if (probe.entered.size === cabinetReadParticipants.length) {
      finishCabinetReadOverlap(probe, "proven", "all-entered");
    }
  });
}

function finishCabinetReadOverlap(probe, outcome, release) {
  if (
    activeCabinetReadOverlap !== probe
    || probe.settled
  ) {
    return;
  }

  probe.settled = true;
  clearTimeout(probe.timer);
  cabinetReadOverlapWindows.push({
    probe: cabinetReadOverlapProbe,
    occurrence: probe.occurrence,
    timeoutMs: cabinetReadOverlapTimeoutMs,
    participants: cabinetReadParticipants.map((participant) => ({
      service: participant.service,
      method: participant.method,
      pathname: participant.pathname,
      entered: probe.entered.has(participant.key),
      ledgerSequence: probe.entered.get(participant.key) ?? null,
    })),
    duplicates: probe.duplicates.map(({ participantKey, ledgerSequence }) => {
      const participant = cabinetReadParticipants.find(({ key }) => key === participantKey);
      if (!participant) throw new Error("Unknown cabinet read overlap participant.");
      return {
        service: participant.service,
        method: participant.method,
        pathname: participant.pathname,
        ledgerSequence,
      };
    }),
    enteredCount: probe.entered.size,
    maxInFlight: probe.maxInFlight,
    release,
    outcome,
  });
  activeCabinetReadOverlap = null;
  for (const resolve of probe.waiters) resolve();
}

function clearCabinetReadOverlapEvidence() {
  const probe = activeCabinetReadOverlap;
  if (probe) {
    probe.settled = true;
    clearTimeout(probe.timer);
    activeCabinetReadOverlap = null;
    for (const resolve of probe.waiters) resolve();
  }
  cabinetReadOverlapOccurrence = 0;
  cabinetReadOverlapWindows.length = 0;
}

function cabinetReadOverlapEvidence() {
  const probe = activeCabinetReadOverlap;
  return {
    contractVersion: 1,
    active: probe
      ? {
          probe: cabinetReadOverlapProbe,
          occurrence: probe.occurrence,
          timeoutMs: cabinetReadOverlapTimeoutMs,
          participants: cabinetReadParticipants.map((participant) => ({
            service: participant.service,
            method: participant.method,
            pathname: participant.pathname,
            entered: probe.entered.has(participant.key),
            ledgerSequence: probe.entered.get(participant.key) ?? null,
          })),
          enteredCount: probe.entered.size,
          maxInFlight: probe.maxInFlight,
        }
      : null,
    windows: cabinetReadOverlapWindows,
  };
}

function record(service, request, url, body, effect) {
  const idempotencyKey = request.headers["idempotency-key"];
  const entry = {
    sequence: ++sequence,
    service,
    method: request.method ?? "GET",
    pathname: sanitizedLedgerPath(service, url.pathname),
    query_keys: queryKeys(url),
    body_bytes: Buffer.byteLength(body, "utf8"),
    body_sha256: sha256(body),
    body_contract: sanitizedBodyContract(request, body),
    idempotency_key_present: typeof idempotencyKey === "string" && idempotencyKey.length > 0,
    idempotency_key_sha256: typeof idempotencyKey === "string" && idempotencyKey.length > 0
      ? sha256(idempotencyKey)
      : null,
    idempotency_key_contract: typeof idempotencyKey === "string" && idempotencyKey.length > 0
      ? dynamicValue("idempotency-key", idempotencyKey)
      : null,
    credential_contract: credentialContract(request),
    effect,
  };
  ledger.push(entry);
  return entry.sequence;
}

function credentialContract(request) {
  const authorization = request.headers.authorization;
  return {
    header_names: Object.keys(request.headers)
      .map((name) => name.toLowerCase())
      .filter((name) => ["authorization", "x-api-key", "x-auth-token", "x-remnashop-auth-service-key"]
        .includes(name))
      .sort(),
    authorization_scheme: typeof authorization === "string"
      ? authorization.split(/\s+/, 1)[0]
      : null,
    cookie_names: String(request.headers.cookie ?? "")
      .split(";")
      .map((pair) => pair.split("=", 1)[0]?.trim())
      .filter(Boolean)
      .sort(),
  };
}

function sanitizedLedgerPath(service, pathname) {
  if (service !== "remnawave") return pathname;
  return pathname
    .replace(/(\/api\/users\/by-email\/)[^/]+$/, (_match, prefix) => `${prefix}<email:${sha256(pathname).slice(0, 16)}>`)
    .replace(/(\/api\/users\/by-telegram-id\/)[^/]+$/, (_match, prefix) => `${prefix}<telegram-id:${sha256(pathname).slice(0, 16)}>`);
}

function sanitizedBodyContract(request, body) {
  if (!body) return null;
  const contentType = String(request.headers["content-type"] ?? "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType === "application/json") {
    try {
      const parsed = JSON.parse(body);
      return {
        encoding: "json",
        value: sanitizeContractValue(parsed),
      };
    } catch {
      return {
        encoding: "invalid-json",
        value: stableRedactedValue("invalid-json", body),
      };
    }
  }
  if (contentType === "application/x-www-form-urlencoded") {
    const fields = [...new URLSearchParams(body).entries()]
      .map(([name, value]) => ({
        name,
        value: sanitizeNamedContractValue(name, value),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return { encoding: "urlencoded", fields };
  }
  return {
    encoding: "opaque",
    value: stableRedactedValue("opaque", body),
  };
}

function sanitizeContractValue(value, name = "") {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (name === "auth_date" && Number.isSafeInteger(value) && value > 1_500_000_000) {
      return dynamicValue("unix-seconds", String(value));
    }
    if (/^(?:id|telegramId|telegram_id|user_id|source_user_id|target_user_id)$/i.test(name)) {
      return stableRedactedValue("synthetic-identity", String(value));
    }
    return value;
  }
  if (typeof value === "string") return sanitizeNamedContractValue(name, value);
  if (Array.isArray(value)) return value.map((entry) => sanitizeContractValue(entry));
  if (!value || typeof value !== "object") return stableRedactedValue("unsupported", String(value));
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, sanitizeContractValue(entry, key)]));
}

function sanitizeNamedContractValue(name, value) {
  if (/email/i.test(name) || /^[^@\s]+@[^@\s]+$/.test(value)) {
    return stableRedactedValue("email", value.toLowerCase());
  }
  if (/password|secret|token|code|verifier/i.test(name)) {
    return stableRedactedValue(name.toLowerCase(), value);
  }
  if (/^(?:id|telegramId|telegram_id|user_id|source_user_id|target_user_id)$/i.test(name)) {
    return stableRedactedValue("synthetic-identity", String(value));
  }
  if (/^(?:name|first_name|last_name|username|preferred_username)$/i.test(name)) {
    return stableRedactedValue("synthetic-profile-field", value);
  }
  if (/^(?:init_data|initData)$/i.test(name)) {
    return dynamicValue("telegram-init-data", value);
  }
  if (name === "hash") return dynamicValue("telegram-signature", value);
  if (/^https?:\/\//.test(value)) return sanitizedUrlContract(value);
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return dynamicValue("uuid", value.toLowerCase());
  }
  if (/^c[a-z0-9]{20,40}$/i.test(value)) return dynamicValue("cuid", value);
  return value;
}

function sanitizedUrlContract(value) {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.split("/").map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded)) {
        return dynamicValue("uuid", decoded.toLowerCase());
      }
      if (/^c[a-z0-9]{20,40}$/i.test(decoded)) return dynamicValue("cuid", decoded);
      return segment;
    });
    return {
      kind: "url",
      origin: [appOrigin, checkoutOrigin].includes(parsed.origin) ? parsed.origin : "<external-origin>",
      path,
      query: [...parsed.searchParams.entries()]
        .map(([key, entry]) => ({ key, value: sanitizeNamedContractValue(key, entry) }))
        .sort((left, right) => `${left.key}:${JSON.stringify(left.value)}`
          .localeCompare(`${right.key}:${JSON.stringify(right.value)}`)),
      fragment: parsed.hash ? stableRedactedValue("fragment", parsed.hash.slice(1)) : null,
    };
  } catch {
    return stableRedactedValue("invalid-url", value);
  }
}

function dynamicValue(format, value) {
  return {
    kind: "dynamic",
    format,
    bytes: Buffer.byteLength(value, "utf8"),
    sha256: sha256(value),
  };
}

function stableRedactedValue(format, value) {
  return {
    kind: "redacted",
    format,
    bytes: Buffer.byteLength(value, "utf8"),
    sha256: sha256(value),
  };
}

function authorized(request, response) {
  if (currentProfile(request)) return true;
  sendJson(response, 401, { detail: "Not authenticated" });
  return false;
}

const offers = {
  gateways: [{ gateway_type: "CARD", currency: "RUB", currency_symbol: "₽" }],
  plans: [{
    id: 1,
    public_code: "browser-basic",
    name: "Базовый",
    description: "Синтетический тариф browser journey",
    traffic_limit: 100,
    device_limit: 3,
    type: "PAID",
    recommended_purchase_type: "RENEW",
    renewal_terms_changed: false,
    durations: [{
      days: 30,
      prices: [{
        gateway_type: "CARD",
        currency: "RUB",
        currency_symbol: "₽",
        original_amount: "299.00",
        discount_percent: 0,
        final_amount: "299.00",
        is_free: false,
      }],
    }],
  }],
  has_current_subscription: true,
  current_subscription_status: "ACTIVE",
};

const currentSubscription = {
  user_remna_id: "rw-browser-1",
  status: "ACTIVE",
  is_trial: false,
  traffic_limit: 100,
  device_limit: 3,
  traffic_limit_strategy: "NO_RESET",
  expire_at: fixedExpiry,
  url: "https://subscription.ci.clean-pay.dev/synthetic-browser-token",
  plan_name: "Базовый",
  plan_duration_days: 30,
  used_traffic_bytes: 1048576,
  lifetime_used_traffic_bytes: 2097152,
  online_at: fixedNow,
};

const remnawaveUser = {
  uuid: "rw-browser-1",
  status: "ACTIVE",
  email: syntheticEmail,
  telegramId: syntheticTelegramId,
  expireAt: fixedExpiry,
  subscriptionUrl: currentSubscription.url,
};
remnawaveUsers.set(remnawaveUser.uuid, { ...remnawaveUser });

function paymentTransaction(payment) {
  return {
    payment_id: payment.payment_id,
    purchase_type: payment.purchase_type,
    status: payment.status,
    gateway_type: "CARD",
    final_amount: payment.final_amount,
    currency: payment.currency,
    plan_name: "Базовый",
    duration_days: 30,
    device_limit: 3,
    traffic_limit: 100,
    created_at: fixedNow,
    updated_at: fixedNow,
  };
}

async function handleRemnashop(request, response) {
  const body = await readBody(request);
  const url = new URL(request.url ?? "/", "http://remnashop.browser");
  const path = url.pathname.replace(/^\/api\/v1\/(?:public|admin)/, "") || "/";
  const method = request.method ?? "GET";
  const input = parseJson(body);

  if (path.startsWith("/auth/") && request.headers["x-remnashop-auth-service-key"] !== remnashopAuthServiceKey) {
    record("remnashop", request, url, body, "auth_service_credential_rejected");
    sendJson(response, 401, { detail: "Invalid auth service credential" });
    return;
  }

  if (path === "/users/merge" && request.headers["x-api-key"] !== remnashopApiKey) {
    record("remnashop", request, url, body, "admin_credential_rejected");
    sendJson(response, 401, { detail: "Invalid admin credential" });
    return;
  }

  if (path === "/plans/public" && method === "GET") {
    record("remnashop", request, url, body, "read_public_plans");
    sendJson(response, 200, { plans: offers.plans, gateways: offers.gateways });
    return;
  }

  if (["/auth/email/start", "/auth/identify", "/auth/service-session"].includes(path)
      && method === "POST" && Object.keys(input).length === 0) {
    record("remnashop", request, url, body, "probe_contract");
    sendJson(response, 422, { detail: "synthetic validation failure" });
    return;
  }

  if (path === "/auth/notification-preferences" && method === "POST") {
    record("remnashop", request, url, body, "probe_contract");
    sendJson(response, 405, { detail: "Method Not Allowed" }, { allow: "GET,PUT" });
    return;
  }

  if (["/auth/telegram", "/auth/telegram/webapp", "/auth/register", "/auth/login", "/auth/service-session", "/auth/password/confirm-reset"].includes(path)
      && method === "POST") {
    const isRegistration = path === "/auth/register";
    const normalizedEmail = typeof input.email === "string"
      ? input.email.trim().toLowerCase()
      : "";
    if (linkedEmailFailureScenario() && normalizedEmail === linkedEmailFailureTarget) {
      if (path === "/auth/login") {
        record("remnashop", request, url, body, "linked_email_login_auth_failed");
        sendJson(response, 401, { detail: "Request failed" });
        return;
      }
      if (path === "/auth/register") {
        record("remnashop", request, url, body, "linked_email_register_conflict");
        sendJson(response, 409, { detail: "Request failed" });
        return;
      }
    }
    const telegramId = telegramIdentityFromRequest(path, input);
    const requestedOwner = path === "/auth/service-session" && typeof input.user_id === "string"
      ? input.user_id
      : path === "/auth/register" || path === "/auth/login" || path === "/auth/password/confirm-reset"
        ? emailOwner(input.email)
        : telegramId === null ? "101" : String(telegramId);
    const owner = telegramOwnerAliases.get(String(requestedOwner)) ?? String(requestedOwner);
    const persistedProfile = ownerProfiles.get(owner);
    const profile = isRegistration
      ? defaultProfile({
          telegram_id: null,
          auth_type: "email",
          email: typeof input.email === "string" ? input.email : syntheticEmail,
          is_email_verified: false,
          username: null,
        })
      : persistedProfile ?? defaultProfile(path.includes("telegram")
        ? {
            auth_type: "telegram",
            telegram_id: telegramId ?? scenarioTelegramId(activeScenario),
            ...(linkedEmailFailureScenario()
              ? { email: null, is_email_verified: false }
              : {}),
          }
        : {
            telegram_id: null,
            auth_type: "email",
            email: typeof input.email === "string" ? input.email : syntheticEmail,
            username: null,
          });
    if (isRegistration && typeof input.email === "string") {
      registeredEmails.add(input.email.toLowerCase());
      subscriptionlessOwners.add(owner);
    }
    record("remnashop", request, url, body, "auth_session_issued");
    sendJson(response, 200, issueSession(response, owner, profile));
    return;
  }

  if (path === "/auth/refresh" && method === "POST") {
    const refresh = cookie(request, "refresh_token");
    const owner = refresh ? refreshOwners.get(refresh) : null;
    record("remnashop", request, url, body, owner ? "auth_session_refreshed" : "auth_refresh_rejected");
    if (!owner) {
      sendJson(response, 401, { detail: "Invalid refresh session" });
      return;
    }
    const profile = ownerProfiles.get(owner) ?? profiles.get(accessToken(owner)) ?? defaultProfile();
    sendJson(response, 200, issueSession(response, owner, profile));
    return;
  }

  if (path === "/auth/me" && method === "GET") {
    const profile = currentProfile(request);
    record("remnashop", request, url, body, profile ? "read_profile" : "auth_rejected");
    if (!profile) {
      sendJson(response, 401, { detail: "Not authenticated" });
      return;
    }
    sendJson(response, 200, profile);
    return;
  }

  if (path === "/auth/identify" && method === "POST") {
    record("remnashop", request, url, body, "identify_email");
    const email = typeof input.email === "string" ? input.email.toLowerCase() : "";
    sendJson(response, 200, {
      exists: registeredEmails.has(email) || !email.startsWith("new."),
    });
    return;
  }

  if (path === "/auth/password/request-reset" && method === "POST") {
    record("remnashop", request, url, body, "password_reset_requested");
    sendJson(response, 200, { success: true });
    return;
  }

  if (path === "/auth/change-password" && method === "POST") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "password_changed");
    const access = cookie(request, "access_token");
    const owner = access ? accessOwners.get(access) : null;
    const profile = currentProfile(request);
    if (!owner || !profile) {
      sendJson(response, 401, { detail: "Not authenticated" });
      return;
    }
    issueSession(response, owner, profile);
    sendJson(response, 200, { success: true });
    return;
  }

  if (path === "/users/merge" && method === "POST") {
    const sourceUserId = Number(input.source_user_id);
    const targetUserId = Number(input.target_user_id);
    const dryRun = url.searchParams.get("dry_run") === "true";
    const sourceProfile = ownerProfiles.get(String(sourceUserId)) ?? defaultProfile();
    const targetProfile = ownerProfiles.get(String(targetUserId)) ?? defaultProfile({
      telegram_id: null,
      auth_type: "email",
      username: null,
    });
    record("remnashop", request, url, body, dryRun ? "users_merge_dry_run" : "users_merged");
    if (!dryRun) {
      replaceOwnerProfile(String(targetUserId), {
        ...targetProfile,
        telegram_id: sourceProfile.telegram_id,
        username: sourceProfile.username,
      });
      if (sourceProfile.telegram_id !== null) {
        telegramOwnerAliases.set(String(sourceProfile.telegram_id), String(targetUserId));
      }
      subscriptionlessOwners.delete(String(targetUserId));
    }
    sendJson(response, 200, {
      dry_run: dryRun,
      source_user_id: sourceUserId,
      target_user_id: targetUserId,
      target: {
        id: targetUserId,
        email: targetProfile.email,
        telegram_id: targetProfile.telegram_id,
        is_email_verified: targetProfile.is_email_verified,
        current_subscription_id: 1,
      },
      moved: { payments: dryRun ? 0 : 1, sessions: dryRun ? 0 : 1 },
      conflicts: [],
      requires_relogin: true,
    });
    return;
  }

  if (path === "/auth/telegram/link" && method === "POST") {
    const profile = currentProfile(request);
    record("remnashop", request, url, body, profile ? "telegram_linked" : "auth_rejected");
    if (!profile) {
      sendJson(response, 401, { detail: "Not authenticated" });
      return;
    }
    const linked = { ...profile, telegram_id: syntheticTelegramId };
    updateCurrentProfile(request, linked);
    sendJson(response, 200, linked);
    return;
  }

  if (path === "/auth/notification-preferences" && method === "GET") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "read_notification_preferences");
    sendJson(response, 200, {
      subscription_expiration_email_enabled: true,
      email_eligible: true,
      sender_email: "support@clean-pay.dev",
      days_before: [7, 3, 1],
    });
    return;
  }

  if (path === "/auth/notification-preferences" && ["PUT", "PATCH"].includes(method)) {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "notification_preferences_updated");
    sendJson(response, 200, {
      subscription_expiration_email_enabled: Boolean(input.subscription_expiration_email_enabled),
      email_eligible: true,
      sender_email: "support@clean-pay.dev",
      days_before: [7, 3, 1],
    });
    return;
  }

  if (path === "/auth/email/request-verification" && method === "POST") {
    const profile = currentProfile(request);
    if (!profile) {
      sendJson(response, 401, { detail: "Not authenticated" });
      return;
    }
    record("remnashop", request, url, body, "verification_requested");
    sendJson(response, 200, { success: true, target_email: profile.email, expires_at: fixedExpiry });
    return;
  }

  if (path === "/auth/email/confirm" && method === "POST") {
    const profile = currentProfile(request);
    if (!profile) {
      sendJson(response, 401, { detail: "Not authenticated" });
      return;
    }
    const verified = { ...profile, is_email_verified: true, pending_email: null };
    updateCurrentProfile(request, verified);
    record("remnashop", request, url, body, "email_verified");
    sendJson(response, 200, { success: true, email: verified.email, already_verified: false, account_sync_pending: false });
    return;
  }

  if (path === "/auth/email/change" && method === "POST") {
    const profile = currentProfile(request);
    if (!profile) {
      sendJson(response, 401, { detail: "Not authenticated" });
      return;
    }
    const pendingEmail = typeof input.email === "string" ? input.email : syntheticEmail;
    updateCurrentProfile(request, { ...profile, pending_email: pendingEmail, is_email_verified: false });
    record("remnashop", request, url, body, "email_change_requested");
    sendJson(response, 200, { success: true, pending_email: pendingEmail });
    return;
  }

  if (path === "/subscription/current" && method === "GET") {
    if (!authorized(request, response)) return;
    const access = cookie(request, "access_token");
    const owner = access ? accessOwners.get(access) : null;
    const newlyRegisteredWithoutSubscription = Boolean(
      owner && subscriptionlessOwners.has(owner),
    );
    record("remnashop", request, url, body, "read_subscription");
    // The authenticated browser characterization reloads an already-owned
    // conversation. Keep its optional support context behind the real iframe
    // load so host scheduling cannot reorder the frozen boundary sequence.
    if (activeScenario.endsWith(authenticatedChatwootScenarioSuffix)) {
      await new Promise((resolve) => setTimeout(resolve, chatwootContextResponseDelayMs));
    }
    sendJson(response, 200, newlyRegisteredWithoutSubscription ? null : currentSubscription);
    return;
  }

  if (path === "/subscription/offers" && method === "GET") {
    if (!authorized(request, response)) return;
    cabinetSurfaceObserved = true;
    const ledgerSequence = record("remnashop", request, url, body, "read_offers");
    const overlap = enterCabinetReadOverlap("offers", ledgerSequence);
    if (overlap) await overlap;
    sendJson(response, 200, offers);
    return;
  }

  if (path === "/subscription/devices" && method === "GET") {
    if (!authorized(request, response)) return;
    cabinetSurfaceObserved = true;
    const ledgerSequence = record("remnashop", request, url, body, "read_devices");
    const overlap = enterCabinetReadOverlap("devices", ledgerSequence);
    if (overlap) await overlap;
    sendJson(response, 200, {
      devices: [{ hwid: "synthetic-device-1", platform: "ios", device_model: null, os_version: "18", user_agent: null }],
      current_count: 1,
      max_count: 3,
    });
    return;
  }

  if (path === "/subscription/devices" && method === "DELETE") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "all_devices_deleted");
    sendJson(response, 200, { success: true });
    return;
  }

  if (/^\/subscription\/devices\/[^/]+$/.test(path) && method === "DELETE") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "device_deleted");
    sendJson(response, 200, { deleted: true });
    return;
  }

  if (path === "/subscription/reissue" && method === "POST") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "subscription_reissued");
    sendJson(response, 200, { success: true });
    return;
  }

  if (path === "/subscription/promocode" && method === "POST") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "promocode_activated");
    sendJson(response, 200, { success: true, reward_type: "POINTS" });
    return;
  }

  if (["/subscription/purchase", "/subscription/extend"].includes(path) && method === "POST") {
    if (!authorized(request, response)) return;
    const kind = path.endsWith("purchase") ? "PURCHASE" : "EXTEND";
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 16 || idempotencyKey.length > 200) {
      record("remnashop", request, url, body, "payment_idempotency_rejected");
      sendJson(response, 422, { detail: "Invalid idempotency key" });
      return;
    }
    const fingerprint = sha256(`${kind}\0${body}`);
    const existing = paymentIdempotency.get(idempotencyKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        record("remnashop", request, url, body, "payment_idempotency_conflict");
        sendJson(response, 409, { detail: "Idempotency key is bound to another request" });
        return;
      }
      record("remnashop", request, url, body, kind === "PURCHASE"
        ? "purchase_replayed"
        : "extend_replayed");
      sendJson(response, 200, existing.payment);
      return;
    }
    if (!validPaymentRequest(kind, input)) {
      record("remnashop", request, url, body, "payment_contract_rejected");
      sendJson(response, 422, { detail: "Invalid payment request contract" });
      return;
    }
    paymentSequence += 1;
    const payment = {
      payment_id: paymentId(paymentSequence),
      payment_url: `${checkoutOrigin}/checkout?return_to=${encodeURIComponent(String(input.return_url ?? `${appOrigin}/payment/pending`))}`,
      purchase_type: kind === "PURCHASE" ? "NEW" : "RENEW",
      status: "PENDING",
      is_free: false,
      final_amount: "299.00",
      currency: "RUB",
      return_url: String(input.return_url ?? `${appOrigin}/payment/pending`),
    };
    payments.set(payment.payment_id, payment);
    paymentIdempotency.set(idempotencyKey, { fingerprint, payment });
    record("remnashop", request, url, body, kind === "PURCHASE" ? "purchase_initialized" : "extend_initialized");
    if (disconnectCommittedPaymentOnce) {
      disconnectCommittedPaymentOnce = false;
      response.destroy();
      return;
    }
    if (rateLimitCommittedPaymentOnce) {
      rateLimitCommittedPaymentOnce = false;
      sendJson(response, 429, { detail: "Synthetic rate limit after idempotent commit" });
      return;
    }
    sendJson(response, 200, payment);
    return;
  }

  if (path === "/subscription/capabilities" && method === "GET") {
    record("remnashop", request, url, body, "capabilities_absent");
    sendJson(response, 404, { detail: "Not Found" });
    return;
  }

  if (path === "/subscription/transactions" && method === "GET") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "read_payment_history");
    sendJson(response, 200, [...payments.values()].map(paymentTransaction));
    return;
  }

  if (path.startsWith("/subscription/transactions/by-id/") && method === "GET") {
    if (!authorized(request, response)) return;
    const paymentId = decodeURIComponent(path.slice("/subscription/transactions/by-id/".length));
    const payment = payments.get(paymentId);
    record("remnashop", request, url, body, payment ? "read_payment" : "payment_not_found");
    if (!payment) {
      sendJson(response, 404, { detail: "Not Found" });
      return;
    }
    sendJson(response, 200, paymentTransaction(payment));
    return;
  }

  if (path === "/referral/program" && method === "GET") {
    if (!authorized(request, response)) return;
    record("remnashop", request, url, body, "read_referral_program");
    sendJson(response, 200, {
      enabled: true,
      referral_code: "SYNTH42",
      web_referral_url: `${appOrigin}/invite/SYNTH42`,
      invited_count: 2,
      invited_with_payment_count: 1,
      points_balance: 25,
      total_points_issued: 25,
      total_days_issued: 0,
      reward_type: "POINTS",
      reward_strategy: "AMOUNT",
      accrual_strategy: "ON_FIRST_PAYMENT",
      max_level: 1,
      reward_levels: [{ level: 1, value: 25 }],
    });
    return;
  }

  record("remnashop", request, url, body, "route_rejected");
  sendJson(response, 404, { detail: "Not Found" });
}

async function handleRemnawave(request, response) {
  const body = await readBody(request);
  const url = new URL(request.url ?? "/", "http://remnawave.browser");
  const method = request.method ?? "GET";
  if (request.headers.authorization !== `Bearer ${remnawaveToken}`) {
    record("remnawave", request, url, body, "bearer_credential_rejected");
    sendJson(response, 401, { response: null });
    return;
  }
  const users = [...remnawaveUsers.values()];
  if (url.pathname === "/api/system/metadata" && method === "GET") {
    record("remnawave", request, url, body, "read_metadata");
    sendJson(response, 200, {
      version: "2.7.0",
      build: { time: "1970-01-01T00:00:00.000Z", number: "browser-journey" },
      git: { backend: { commitSha: "synthetic" }, frontend: { commitSha: "synthetic" } },
    });
    return;
  }
  if (url.pathname === "/api/users/rw-browser-1" && method === "GET") {
    const user = remnawaveUsers.get("rw-browser-1") ?? null;
    record("remnawave", request, url, body, "read_user_by_uuid");
    sendJson(response, user ? 200 : 404, { response: user });
    return;
  }
  if (url.pathname.startsWith("/api/users/by-telegram-id/") && method === "GET") {
    const requested = decodeURIComponent(url.pathname.slice("/api/users/by-telegram-id/".length));
    record("remnawave", request, url, body, "read_user_by_identity");
    sendJson(response, 200, { response: users.filter((user) => String(user.telegramId) === requested) });
    return;
  }
  if (url.pathname.startsWith("/api/users/by-email/") && method === "GET") {
    const requested = decodeURIComponent(url.pathname.slice("/api/users/by-email/".length)).toLowerCase();
    record("remnawave", request, url, body, "read_user_by_identity");
    sendJson(response, 200, { response: users.filter((user) => String(user.email).toLowerCase() === requested) });
    return;
  }
  if (url.pathname === "/api/users" && method === "GET") {
    record("remnawave", request, url, body, "read_users");
    sendJson(response, 200, { response: users });
    return;
  }
  if (url.pathname === "/api/users" && method === "PATCH") {
    const input = parseJson(body);
    const current = typeof input.uuid === "string" ? remnawaveUsers.get(input.uuid) : null;
    if (!current || typeof input.email !== "string" || !Number.isSafeInteger(input.telegramId)) {
      record("remnawave", request, url, body, "user_identity_patch_rejected");
      sendJson(response, 422, { response: null });
      return;
    }
    const updated = { ...current, email: input.email, telegramId: input.telegramId };
    remnawaveUsers.set(input.uuid, updated);
    record("remnawave", request, url, body, "user_identity_updated");
    sendJson(response, 200, { response: updated });
    return;
  }
  record("remnawave", request, url, body, "route_rejected");
  sendJson(response, 404, { response: null });
}

async function handleControl(request, response) {
  const body = await readBody(request);
  const url = new URL(request.url ?? "/", "http://browser-provider-control");
  if (url.pathname === "/api/v1/widget/contact" && request.method === "GET") {
    const conversation = request.headers["x-auth-token"];
    const authorized = url.searchParams.get("website_token") === chatwootWebsiteToken
      && typeof conversation === "string"
      && /^c[a-z0-9]{20,40}$/.test(conversation);
    record("chatwoot", request, url, body, authorized
      ? "contact_identity_probed"
      : "contact_identity_probe_rejected");
    if (!authorized) {
      sendJson(response, 401, { error: "fixture_credential_rejected" });
      return;
    }
    // Profile identity must first settle through the SDK's correlated reply.
    // Once real cabinet reads have occurred, ownership must win instead so the
    // same capture deterministically exercises the replacement-frame branch.
    const responseDelayMs = cabinetSurfaceObserved
      ? chatwootContactResponseDelayMs
      : chatwootPreCabinetContactResponseDelayMs;
    await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    sendJson(response, 200, { identifier: conversation });
    return;
  }
  if (url.pathname === "/__oidc-event" && request.method === "POST") {
    if (request.headers["x-browser-fixture-key"] !== oidcLedgerKey) {
      sendJson(response, 401, { error: "fixture_credential_rejected" });
      return;
    }
    const event = parseJson(body);
    if (!isSanitizedOidcEvent(event)) {
      sendJson(response, 422, { error: "invalid_oidc_event" });
      return;
    }
    ledger.push({ sequence: ++sequence, ...event });
    sendJson(response, 200, { status: "recorded" });
    return;
  }
  if (url.pathname === "/turnstile/v0/siteverify" && request.method === "POST") {
    const fields = new URLSearchParams(body);
    const token = fields.get("response") ?? "";
    const match = /^synthetic-turnstile-token:([a-z][a-z0-9_-]{0,63}):(synthetic-turnstile-[1-9]\d*):([1-9]\d*)$/.exec(token);
    const secretValid = fields.get("secret") === turnstileSecret;
    const singleUse = Boolean(match) && !consumedTurnstileTokens.has(token);
    if (match && secretValid && singleUse) consumedTurnstileTokens.add(token);
    record("turnstile", request, url, body, "challenge_verified");
    sendJson(response, 200, {
      success: Boolean(match && secretValid && singleUse),
      challenge_ts: fixedNow,
      hostname: "pay.ci.clean-pay.dev",
      ...(match ? { action: match[1] } : {}),
      ...((match && secretValid && singleUse) ? {} : { "error-codes": ["invalid-input-response"] }),
    });
    return;
  }
  if (url.pathname === "/__health" && request.method === "GET") {
    sendJson(response, 200, { status: "ok" });
    return;
  }
  if (url.pathname === "/__ledger" && request.method === "GET") {
    const database = dbObserverUrl
      ? await fetchObserverJson("/__snapshot", { method: "GET" })
      : null;
    sendJson(response, 200, { entries: ledger, ...(database ? { database } : {}) });
    return;
  }
  if (url.pathname === "/__concurrency" && request.method === "GET") {
    sendJson(response, 200, cabinetReadOverlapEvidence());
    return;
  }
  if (url.pathname === "/__inject" && request.method === "POST") {
    const input = parseJson(body);
    if (JSON.stringify(input) === JSON.stringify({ action: "payment_commit_disconnect_once" })) {
      disconnectCommittedPaymentOnce = true;
    } else if (JSON.stringify(input) === JSON.stringify({ action: "payment_commit_rate_limit_once" })) {
      rateLimitCommittedPaymentOnce = true;
    } else if (JSON.stringify(input) === JSON.stringify({ action: cabinetReadOverlapAction })) {
      if (!armCabinetReadOverlap()) {
        sendJson(response, 409, { error: "concurrency_probe_already_armed" });
        return;
      }
    } else {
      sendJson(response, 422, { error: "unsupported_injection" });
      return;
    }
    sendJson(response, 200, { status: "armed", action: input.action });
    return;
  }
  if (url.pathname === "/__reset" && request.method === "POST") {
    const input = parseJson(body);
    const scenario = input.scenario ?? "contract-default";
    if (typeof scenario !== "string" || !/^[a-z0-9][a-z0-9:-]{1,180}$/.test(scenario)) {
      sendJson(response, 422, { error: "invalid_scenario" });
      return;
    }
    clearCabinetReadOverlapEvidence();
    cabinetSurfaceObserved = false;
    activeScenario = scenario;
    const database = dbObserverUrl
      ? await fetchObserverJson("/__reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: dbScope }),
        })
      : null;
    ledger.length = 0;
    sequence = 0;
    paymentSequence = 0;
    payments.clear();
    paymentIdempotency.clear();
    profiles.clear();
    ownerProfiles.clear();
    accessOwners.clear();
    refreshOwners.clear();
    registeredEmails.clear();
    subscriptionlessOwners.clear();
    telegramOwnerAliases.clear();
    remnawaveUsers.clear();
    remnawaveUsers.set(remnawaveUser.uuid, {
      ...remnawaveUser,
      telegramId: scenarioTelegramId(scenario),
    });
    consumedTurnstileTokens.clear();
    disconnectCommittedPaymentOnce = false;
    rateLimitCommittedPaymentOnce = false;
    const oidcReset = await fetch(oidcResetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenario }),
      signal: AbortSignal.timeout(2_000),
    });
    if (!oidcReset.ok) {
      sendJson(response, 502, { error: "oidc_reset_failed" });
      return;
    }
    const oidcState = await oidcReset.json();
    sendJson(response, 200, {
      status: "reset",
      seed_sha256: sha256(`clean-pay-browser-journey-v1:${scenario}`),
      scenario_sha256: sha256(scenario),
      state: {
        ledger: ledger.length,
        payments: payments.size,
        payment_idempotency: paymentIdempotency.size,
        profiles: profiles.size,
        owner_profiles: ownerProfiles.size,
        access_owners: accessOwners.size,
        refresh_owners: refreshOwners.size,
        registered_emails: registeredEmails.size,
        subscriptionless_owners: subscriptionlessOwners.size,
        telegram_owner_aliases: telegramOwnerAliases.size,
        remnawave_users: remnawaveUsers.size,
        consumed_turnstile_tokens: consumedTurnstileTokens.size,
        payment_disconnect_injection_armed: disconnectCommittedPaymentOnce,
        payment_rate_limit_injection_armed: rateLimitCommittedPaymentOnce,
        sequence,
        payment_sequence: paymentSequence,
        scenario_telegram_id_format: "9-digit-synthetic",
      },
      oidc: oidcState,
      ...(database ? { database } : {}),
    });
    return;
  }
  if (url.pathname === "/checkout" && request.method === "GET") {
    const candidate = url.searchParams.get("return_to") ?? `${appOrigin}/payment/pending`;
    let returnTo = `${appOrigin}/payment/pending`;
    try {
      const parsed = new URL(candidate);
      if (parsed.origin === appOrigin && parsed.pathname.startsWith("/payment/")) {
        returnTo = parsed.toString();
      }
    } catch {
      // Keep the safe fixture fallback.
    }
    record("checkout", request, url, body, "checkout_opened");
    sendHtml(response, 200, `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Синтетическая оплата</title></head><body><main><h1>Синтетическая платёжная страница</h1><a id="return-to-clean-pay" href="${escapeHtml(returnTo)}">Вернуться в Clean Pay</a></main></body></html>`);
    return;
  }
  sendJson(response, 404, { error: "not_found" });
}

async function fetchObserverJson(pathname, init) {
  const response = await fetch(new URL(pathname, dbObserverUrl), {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`DB observer rejected ${pathname}`);
  return response.json();
}

function validPaymentRequest(kind, input) {
  const expectedKeys = kind === "PURCHASE"
    ? ["duration_days", "gateway_type", "plan_code", "return_url"]
    : ["duration_days", "gateway_type", "return_url"];
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expectedKeys)) return false;
  if (input.duration_days !== 30 || input.gateway_type !== "CARD") return false;
  if (kind === "PURCHASE" && input.plan_code !== "browser-basic") return false;
  if (typeof input.return_url !== "string") return false;
  try {
    const returnUrl = new URL(input.return_url);
    return returnUrl.origin === appOrigin
      && returnUrl.pathname === "/payment/pending"
      && [...returnUrl.searchParams.keys()].every((key) => key === "operation_id")
      && returnUrl.hash === "";
  } catch {
    return false;
  }
}

function isSanitizedOidcEvent(value) {
  const exactKeys = [
    "body_bytes", "body_contract", "body_sha256", "credential_contract", "effect",
    "idempotency_key_contract", "idempotency_key_present", "idempotency_key_sha256",
    "method", "pathname", "query_keys", "service",
  ].sort();
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactKeys)) return false;
  if (
    value.service !== "telegram-oidc"
    || !["GET", "POST"].includes(value.method)
    || !["/auth", "/token", "/.well-known/jwks.json"].includes(value.pathname)
    || !Array.isArray(value.query_keys)
    || !value.query_keys.every((key) => typeof key === "string")
    || !Number.isSafeInteger(value.body_bytes)
    || typeof value.body_sha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(value.body_sha256)
    || value.idempotency_key_present !== false
    || value.idempotency_key_sha256 !== null
    || value.idempotency_key_contract !== null
    || !["authorization_code_issued", "authorize_rejected", "jwks_read", "token_exchanged", "token_exchange_rejected"]
      .includes(value.effect)
  ) {
    return false;
  }
  const credentials = value.credential_contract;
  return credentials
    && typeof credentials === "object"
    && !Array.isArray(credentials)
    && JSON.stringify(Object.keys(credentials).sort())
      === JSON.stringify(["authorization_scheme", "cookie_names", "header_names"])
    && Array.isArray(credentials.cookie_names)
    && credentials.cookie_names.length === 0
    && Array.isArray(credentials.header_names)
    && (credentials.authorization_scheme === null || credentials.authorization_scheme === "Basic")
    && safeOidcContract(value.body_contract);
}

function safeOidcContract(value) {
  if (value === null) return true;
  const serialized = JSON.stringify(value);
  return serialized.length <= 16 * 1024
    && !serialized.includes(clientSecretLikeSentinel())
    && !/@/.test(serialized);
}

function clientSecretLikeSentinel() {
  return sha256("clean-pay-browser-journey:telegram-oidc");
}

function boundedIntegerEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a canonical positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function listen(port, handler, label) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: "fixture_failure" });
      else response.destroy();
    });
  });
  server.listen(port, "0.0.0.0", () => {
    process.stdout.write(`${label} ready\n`);
  });
}

listen(remnashopPort, handleRemnashop, "remnashop-browser-mock");
listen(remnawavePort, handleRemnawave, "remnawave-browser-mock");
listen(controlPort, handleControl, "provider-control");
