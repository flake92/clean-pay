import { createHash } from "node:crypto";

const BASELINE_COMMIT = "f5cb6f543d85256e7733a1ade6a4f451d86cf378";
const JOURNEYS = new Set([
  "public-responsive-keyboard-install-offline-support",
  "email-register-verify-and-login",
  "telegram-oidc-cabinet-profile-link-referral-passkey",
  "email-account-links-and-merges-telegram",
  "tariffs-payment-returns-extend-idempotency",
  "telegram-webapp-browser-boundary",
]);
const DYNAMIC_COOKIE_NAMES = new Set([
  "clean_pay_access",
  "clean_pay_refresh",
  "clean_pay_tg_state",
  "clean_pay_tg_nonce",
  "clean_pay_tg_code_verifier",
  "clean_pay_tg_callback_receipt",
  "clean_pay_account_merge",
  "clean_pay_referral",
]);
const CUID = /^c[a-z0-9]{20,40}$/i;
const SHORT_DIGEST = /^<sha256:[a-f0-9]{16}>$/;

/**
 * Normalizes only generated identifiers in the isolated journey schema.
 * Raw evidence retains every digest. Symbols are assigned by first occurrence
 * and repeated values keep the same symbol, preserving referential equality.
 */
export function projectExactJourneyGeneratedValues(manifest: Record<string, unknown>) {
  if (!isExactJourneyManifest(manifest)) return;
  const references = new DynamicReferences();
  projectSyntheticResetScope(manifest.syntheticReset);
  projectProviderLedger(manifest.providerEffects, references);
  projectServerActions(manifest.network, references);
  projectCheckpointCookies(manifest.checkpoints, references);
  projectBoundaryCookies(manifest.boundaries, references);
  projectCanonicalUrls(manifest, references);
}

function projectSyntheticResetScope(value: unknown) {
  if (!isRecord(value) || !isRecord(value.database)) return;
  const database = value.database;
  if (
    !hasExactKeys(database, [
      "redis",
      "resetSequence",
      "schemaSha256",
      "sequenceCount",
      "scopeContract",
      "scopeSha256",
      "status",
      "tableCount",
      "transaction",
    ])
    || database.status !== "reset"
    || database.scopeContract !== "exact-compose-project-label"
    || typeof database.scopeSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.scopeSha256)
    || typeof database.schemaSha256 !== "string"
    || !/^[a-f0-9]{64}$/.test(database.schemaSha256)
    || !Number.isSafeInteger(database.tableCount)
    || Number(database.tableCount) <= 0
    || database.sequenceCount !== 0
    || !Number.isSafeInteger(database.resetSequence)
    || Number(database.resetSequence) <= 0
    || database.transaction
      !== "truncate-public-application-tables-cascade-no-sequences"
    || database.redis !== "flush-owned-db-0"
  ) {
    return;
  }
  database.scopeSha256 = "<exact-compose-project-label-sha256>";
}

class DynamicReferences {
  readonly #values = new Map<string, string>();
  #sequence = 0;

  symbol(format: string, digest: string) {
    const key = `${format}:${digest}`;
    const existing = this.#values.get(key);
    if (existing) return existing;
    const value = `<dynamic:${format}:${++this.#sequence}>`;
    this.#values.set(key, value);
    return value;
  }
}

function isExactJourneyManifest(manifest: Record<string, unknown>) {
  const source = manifest.source;
  return manifest.schemaVersion === 2
    && manifest.baselineCommit === BASELINE_COMMIT
    && typeof manifest.project === "string"
    && /^journey-(?:390x844|768x1024|1440x900)$/.test(manifest.project)
    && typeof manifest.journey === "string"
    && JOURNEYS.has(manifest.journey)
    && isRecord(source)
    && isRecord(source.fixtureContract)
    && source.fixtureContract.version === "journey-v5"
    && typeof source.fixtureContract.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(source.fixtureContract.sha256);
}

function projectProviderLedger(value: unknown, references: DynamicReferences) {
  if (!isRecord(value) || !Array.isArray(value.entries)) return;
  for (const entryValue of value.entries) {
    if (!isRecord(entryValue) || !isExactLedgerEnvelope(entryValue)) continue;
    const bodyContract = entryValue.body_contract;
    if (hasValidDynamicContract(bodyContract)) {
      projectDynamicContracts(bodyContract, references);
      entryValue.body_sha256 = "<derived-from-redacted-body-contract>";
    }
    const idempotencyContract = entryValue.idempotency_key_contract;
    if (
      entryValue.idempotency_key_present === true
      && isDynamicContract(idempotencyContract)
      && idempotencyContract.format === "idempotency-key"
      && typeof entryValue.idempotency_key_sha256 === "string"
      && entryValue.idempotency_key_sha256 === idempotencyContract.sha256
    ) {
      const symbol = references.symbol(
        idempotencyContract.format,
        idempotencyContract.sha256,
      );
      idempotencyContract.sha256 = symbol;
      entryValue.idempotency_key_sha256 = symbol;
    }
  }
}

function isExactLedgerEnvelope(entry: Record<string, unknown>) {
  return hasExactKeys(entry, [
    "body_bytes",
    "body_contract",
    "body_sha256",
    "credential_contract",
    "effect",
    "idempotency_key_contract",
    "idempotency_key_present",
    "idempotency_key_sha256",
    "method",
    "pathname",
    "query_keys",
    "sequence",
    "service",
  ])
    && Number.isSafeInteger(entry.sequence)
    && typeof entry.service === "string"
    && typeof entry.method === "string"
    && typeof entry.pathname === "string"
    && Array.isArray(entry.query_keys)
    && entry.query_keys.every((key) => typeof key === "string")
    && Number.isSafeInteger(entry.body_bytes)
    && typeof entry.body_sha256 === "string"
    && /^[a-f0-9]{64}$/.test(entry.body_sha256)
    && typeof entry.idempotency_key_present === "boolean"
    && (entry.idempotency_key_sha256 === null
      || (typeof entry.idempotency_key_sha256 === "string"
        && /^[a-f0-9]{64}$/.test(entry.idempotency_key_sha256)))
    && isCredentialContract(entry.credential_contract)
    && typeof entry.effect === "string";
}

function isCredentialContract(value: unknown) {
  return isRecord(value)
    && hasExactKeys(value, ["authorization_scheme", "cookie_names", "header_names"])
    && (value.authorization_scheme === null
      || value.authorization_scheme === "Bearer"
      || value.authorization_scheme === "Basic")
    && Array.isArray(value.cookie_names)
    && value.cookie_names.every((name) => typeof name === "string" && /^[A-Za-z0-9_.-]+$/.test(name))
    && Array.isArray(value.header_names)
    && value.header_names.every((name) => [
      "authorization", "x-api-key", "x-auth-token", "x-remnashop-auth-service-key",
    ].includes(String(name)));
}

function projectBoundaryCookies(value: unknown, references: DynamicReferences) {
  if (!Array.isArray(value)) return;
  const lifecycle = value.find((entry) => (
    isRecord(entry) && entry.label === "telegram-oidc-cookie-lifecycle"
  ));
  if (!isRecord(lifecycle) || !isRecord(lifecycle.value)) return;
  const contract = lifecycle.value;
  if (!Array.isArray(contract.preCallback) || !isRecord(contract.final)) return;
  const receipt = contract.final.callbackReceipt;
  const cookies = [...contract.preCallback, receipt];
  for (const cookie of cookies) {
    if (!isBoundaryCookie(cookie)) return;
  }
  for (const cookie of cookies) {
    const record = cookie as Record<string, unknown>;
    record.valueSha256 = references.symbol(
      `cookie-${String(record.name)}`,
      String(record.valueSha256),
    );
    (record.expiry as Record<string, unknown>).epochSeconds = "<bounded-cookie-expiry>";
  }
}

function isBoundaryCookie(value: unknown) {
  if (!isRecord(value) || !isRecord(value.expiry)) return false;
  return hasExactKeys(value, [
    "domain", "expiry", "httpOnly", "name", "path", "sameSite", "secure",
    "valueBytes", "valueSha256",
  ])
    && typeof value.name === "string"
    && DYNAMIC_COOKIE_NAMES.has(value.name)
    && value.domain === "pay.ci.clean-pay.dev"
    && ["/", "/auth/telegram/callback"].includes(String(value.path))
    && value.httpOnly === true
    && value.secure === true
    && value.sameSite === "Lax"
    && Number.isSafeInteger(value.valueBytes)
    && Number(value.valueBytes) >= 16
    && Number(value.valueBytes) <= 4096
    && typeof value.valueSha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.valueSha256)
    && hasExactKeys(value.expiry, ["boundedSeconds", "epochSeconds"])
    && ["1700..1950", "60..150"].includes(String(value.expiry.boundedSeconds))
    && typeof value.expiry.epochSeconds === "number"
    && Number.isFinite(value.expiry.epochSeconds)
    && value.expiry.epochSeconds > 0;
}

function hasValidDynamicContract(value: unknown) {
  let found = false;
  let valid = true;
  visit(value, (candidate) => {
    if (!isRecord(candidate) || candidate.kind !== "dynamic") return;
    found = true;
    valid &&= isDynamicContract(candidate);
  });
  return found && valid;
}

function projectDynamicContracts(value: unknown, references: DynamicReferences) {
  visit(value, (candidate) => {
    if (!isDynamicContract(candidate)) return;
    candidate.sha256 = references.symbol(candidate.format, candidate.sha256);
  });
}

function isDynamicContract(value: unknown): value is Record<string, unknown> & {
  format: string;
  sha256: string;
} {
  return isRecord(value)
    && hasExactKeys(value, ["bytes", "format", "kind", "sha256"])
    && value.kind === "dynamic"
    && typeof value.format === "string"
    && /^[a-z][a-z0-9-]{0,40}$/.test(value.format)
    && Number.isSafeInteger(value.bytes)
    && (value.bytes as number) > 0
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function projectServerActions(value: unknown, references: DynamicReferences) {
  if (!isRecord(value) || !Array.isArray(value.requests) || !Array.isArray(value.serverActions)) {
    return;
  }
  if (value.serverActionCount !== value.serverActions.length) return;
  for (const [order, actionValue] of value.serverActions.entries()) {
    if (!isRecord(actionValue) || actionValue.order !== order) return;
    const requestIndex = actionValue.requestIndex;
    if (!Number.isSafeInteger(requestIndex)) return;
    const request = value.requests[requestIndex as number];
    if (!isRecord(request) || request.index !== requestIndex || !isRecord(request.serverAction)) return;
    if (
      request.scope !== "application"
      || request.method !== "POST"
      || request.resourceType !== "fetch"
      || request.navigation !== false
      || request.serverAction.present !== true
      || !sameJson(request.serverAction.identifier, actionValue.identifier)
      || !sameJson(request.postData, actionValue.payload)
      || !isDigest(request.serverAction.identifier)
      || !isDigest(request.postData)
    ) {
      return;
    }
  }

  const actionIds = new Map<string, string>();
  const payloads = new Map<string, string>();
  for (const actionValue of value.serverActions) {
    const action = actionValue as Record<string, unknown>;
    const request = value.requests[action.requestIndex as number] as Record<string, unknown>;
    const identifier = action.identifier as Record<string, unknown>;
    const payload = action.payload as Record<string, unknown>;
    const idSymbol = sequenceSymbol(actionIds, "server-action-id", identifier.sha256 as string);
    const payloadSymbol = sequenceSymbol(payloads, "server-action-payload", payload.sha256 as string);
    identifier.sha256 = idSymbol;
    payload.sha256 = payloadSymbol;
    (request.serverAction as Record<string, unknown>).identifier = { ...identifier };
    request.postData = { ...payload };
  }

  function sequenceSymbol(values: Map<string, string>, format: string, digest: string) {
    const existing = values.get(digest);
    if (existing) return existing;
    const symbol = references.symbol(format, digest);
    values.set(digest, symbol);
    return symbol;
  }
}

function projectCheckpointCookies(value: unknown, references: DynamicReferences) {
  if (!Array.isArray(value)) return;
  for (const checkpoint of value) {
    if (!isRecord(checkpoint) || !Array.isArray(checkpoint.cookies)) continue;
    for (const cookie of checkpoint.cookies) {
      if (!isExactDynamicCookie(cookie)) continue;
      cookie.value.sha256 = references.symbol(`cookie-${cookie.name}`, cookie.value.sha256);
    }
  }
}

function isExactDynamicCookie(value: unknown): value is Record<string, unknown> & {
  name: string;
  value: { bytes: number; sha256: string };
} {
  return isRecord(value)
    && hasExactKeys(value, ["domain", "httpOnly", "name", "path", "sameSite", "secure", "value"])
    && typeof value.name === "string"
    && DYNAMIC_COOKIE_NAMES.has(value.name)
    && value.domain === "<app-host>"
    && value.path === "/"
    && value.secure === true
    && typeof value.httpOnly === "boolean"
    && ["Lax", "Strict", "None"].includes(String(value.sameSite))
    && isDigest(value.value)
    && value.value.bytes >= 16
    && value.value.bytes <= 4096;
}

function projectCanonicalUrls(manifest: Record<string, unknown>, references: DynamicReferences) {
  visit(manifest, (value) => {
    if (!isCanonicalUrl(value)) return;
    const segments = value.pathname.split("/");
    value.pathname = segments.map((segment) => {
      if (!CUID.test(segment)) return segment;
      return references.symbol("cuid", sha256(segment));
    }).join("/");

    for (const queryValue of value.query) {
      if (!isRecord(queryValue) || typeof queryValue.key !== "string") continue;
      if (
        !["code", "state", "return_to", "redirect_to"].includes(queryValue.key)
        || typeof queryValue.value !== "string"
        || !SHORT_DIGEST.test(queryValue.value)
      ) {
        continue;
      }
      queryValue.value = references.symbol(
        `query-${queryValue.key}`,
        queryValue.value.slice(8, -1),
      );
    }
  });
}

function isCanonicalUrl(value: Record<string, unknown>): value is Record<string, unknown> & {
  pathname: string;
  query: unknown[];
} {
  return hasExactKeys(value, ["fragment", "origin", "pathname", "query"])
    && typeof value.origin === "string"
    && typeof value.pathname === "string"
    && Array.isArray(value.query)
    && (value.fragment === null || typeof value.fragment === "string");
}

function isDigest(value: unknown): value is { bytes: number; sha256: string } {
  return isRecord(value)
    && hasExactKeys(value, ["bytes", "sha256"])
    && Number.isSafeInteger(value.bytes)
    && (value.bytes as number) >= 0
    && typeof value.sha256 === "string"
    && /^[a-f0-9]{64}$/.test(value.sha256);
}

function visit(value: unknown, callback: (value: Record<string, unknown>) => void) {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, callback);
    return;
  }
  if (!isRecord(value)) return;
  callback(value);
  for (const entry of Object.values(value)) visit(entry, callback);
}

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const keys = [...expected].sort();
  return actual.length === keys.length
    && actual.every((key, index) => key === keys[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
