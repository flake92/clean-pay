import { createHmac, randomBytes } from "node:crypto";

const hmacDomain = "clean-pay-chatwoot-phase-evidence-v1";
const phaseNames = Object.freeze(["gap", "stable", "recreated"]);

export const CHATWOOT_PHASE_EVIDENCE_CATEGORIES = Object.freeze([
  "accessibility",
  "boundaryCalls",
  "computedStyles",
  "dom",
  "interactive",
  "providerEffects",
  "providerLedger",
  "requestSequence",
  "serverActions",
  "storage",
]);

export const CHATWOOT_PHASE_EVIDENCE_CATEGORY_LIMITS = Object.freeze({
  accessibility: 50_000,
  boundaryCalls: 1_000,
  computedStyles: 50_000,
  dom: 50_000,
  interactive: 5_000,
  providerEffects: 5_000,
  providerLedger: 5_000,
  requestSequence: 10_000,
  serverActions: 200,
  storage: 2_000,
});

const hashNames = Object.freeze({
  accessibility: "accessibilityHmacSha256",
  boundaryCalls: "boundaryCallsHmacSha256",
  computedStyles: "computedStylesHmacSha256",
  dom: "domHmacSha256",
  interactive: "interactiveHmacSha256",
  providerEffects: "providerEffectsHmacSha256",
  providerLedger: "providerLedgerHmacSha256",
  requestSequence: "requestSequenceHmacSha256",
  serverActions: "serverActionsHmacSha256",
  storage: "storageHmacSha256",
});

const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_CATEGORY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_EVIDENCE_BYTES = 32 * 1024 * 1024;
const MAX_OPAQUE_BYTES = 4 * 1024;
const MAX_FIXTURE_STORAGE_BYTES = 64 * 1024;
const MAX_COOKIES = 32;
const MAX_COOKIE_NAME_BYTES = 256;
const MAX_COOKIE_DOMAIN_BYTES = 255;
const MAX_COOKIE_PATH_BYTES = 1_024;

export function createChatwootPhaseEvidenceSealer() {
  const key = randomBytes(32);
  const proofHmacScopeSha256 = hmac(key, ["proof-scope"]);

  return Object.freeze({
    proofHmacScopeSha256,
    sealClearedFixtureStorage({ beforeValue, afterValue }) {
      const before = boundedOpaqueBytes(
        beforeValue,
        "fixture storage",
        MAX_FIXTURE_STORAGE_BYTES,
      );
      const after = boundedOpaqueBytes(
        afterValue,
        "fixture storage",
        MAX_FIXTURE_STORAGE_BYTES,
      );
      if (!before.equals(after)) {
        throw new Error("Chatwoot clear changed the preserved fixture storage bytes.");
      }
      return Object.freeze({
        preservedFixtureStorageByteExact: true,
        preservedFixtureStorageByteLength: before.byteLength,
        preservedFixtureStorageHmacSha256: hmac(key, [
          "opaque",
          "preserved-fixture-storage",
          before,
        ]),
      });
    },
    sealPhase({ phase, orderedEvidence, conversationValue, userCookieValue, cookies }) {
      assertPhase(phase);
      const evidence = assertOrderedEvidence(orderedEvidence);
      const cookieJar = sealCookieJar(key, cookies);
      /** @type {Record<string, string | null>} */
      const hashes = {};
      /** @type {Record<string, number>} */
      const evidenceCounts = {};
      /** @type {Record<string, {firstHmacSha256: string, lastHmacSha256: string}>} */
      const evidenceRanges = {};

      for (const category of CHATWOOT_PHASE_EVIDENCE_CATEGORIES) {
        const entries = evidence[category];
        evidenceCounts[category] = entries.length;
        hashes[hashNames[category]] = sealSequence(key, phase, category, entries);
        evidenceRanges[category] = Object.freeze({
          firstHmacSha256: sealEntry(key, phase, category, 0, entries),
          lastHmacSha256: sealEntry(key, phase, category, entries.length - 1, entries),
        });
      }

      hashes.conversationHmacSha256 = sealOpaque(
        key,
        "conversation",
        conversationValue,
      );
      hashes.userCookieHmacSha256 = userCookieValue === null
        ? null
        : sealOpaque(key, "user-cookie", userCookieValue);
      hashes.cookieJarHmacSha256 = cookieJar.cookieJarHmacSha256;
      hashes.cookieDescriptorHmacSha256 = cookieJar.cookieDescriptorHmacSha256;

      return Object.freeze({
        hashes: Object.freeze(hashes),
        evidenceCounts: Object.freeze(evidenceCounts),
        evidenceRanges: Object.freeze(evidenceRanges),
        cookieDescriptorByteLength: cookieJar.cookieDescriptorByteLength,
        cookieDescriptorCount: cookieJar.cookieDescriptorCount,
        cookieValueByteLength: cookieJar.cookieValueByteLength,
      });
    },
  });
}

function sealCookieJar(key, value) {
  if (!isDenseArray(value) || value.length === 0 || value.length > MAX_COOKIES) {
    throw new Error("Chatwoot cookie jar is empty or outside its exact bound.");
  }
  const descriptors = value.map((cookie, index) => {
    exactKeys(cookie, [
      "domain",
      "expires",
      "httpOnly",
      "name",
      "path",
      "sameSite",
      "secure",
      "value",
    ], `cookie descriptor ${index}`);
    const name = boundedOpaqueBytes(cookie.name, "cookie name", MAX_COOKIE_NAME_BYTES);
    const domain = boundedOpaqueBytes(cookie.domain, "cookie domain", MAX_COOKIE_DOMAIN_BYTES);
    const cookiePath = boundedOpaqueBytes(cookie.path, "cookie path", MAX_COOKIE_PATH_BYTES);
    const cookieValue = boundedOpaqueBytes(cookie.value, "cookie value", MAX_OPAQUE_BYTES);
    if (typeof cookie.httpOnly !== "boolean" || typeof cookie.secure !== "boolean"
      || !new Set(["Strict", "Lax", "None"]).has(cookie.sameSite)
      || typeof cookie.expires !== "number" || !Number.isFinite(cookie.expires)
      || cookie.expires < -1 || cookie.expires > 253_402_300_799) {
      throw new Error(`Chatwoot cookie descriptor ${index} metadata is invalid.`);
    }
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]{1,256}$/.test(cookie.name)
      || !/^\.?[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?$/.test(cookie.domain)
      || !cookie.path.startsWith("/") || /[\u0000-\u001f\u007f;]/.test(cookie.path)) {
      throw new Error(`Chatwoot cookie descriptor ${index} scope is invalid.`);
    }
    return Object.freeze({
      domain: domain.toString("utf8"),
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      name: name.toString("utf8"),
      path: cookiePath.toString("utf8"),
      sameSite: cookie.sameSite,
      secure: cookie.secure,
      valueByteLength: cookieValue.byteLength,
      valueHmacSha256: hmac(key, ["cookie-value", name, cookieValue]),
    });
  });
  const canonical = Buffer.from(JSON.stringify(descriptors), "utf8");
  const descriptorOnly = Buffer.from(JSON.stringify(descriptors.map((descriptor) => ({
    domain: descriptor.domain,
    expires: descriptor.expires,
    httpOnly: descriptor.httpOnly,
    name: descriptor.name,
    path: descriptor.path,
    sameSite: descriptor.sameSite,
    secure: descriptor.secure,
  }))), "utf8");
  if (canonical.byteLength === 0 || canonical.byteLength > MAX_ENTRY_BYTES) {
    throw new Error("Chatwoot cookie descriptor ledger is outside its byte bound.");
  }
  return Object.freeze({
    cookieJarHmacSha256: hmac(key, ["cookie-jar", canonical]),
    cookieDescriptorHmacSha256: hmac(key, ["cookie-descriptors", descriptorOnly]),
    cookieDescriptorByteLength: canonical.byteLength,
    cookieDescriptorCount: descriptors.length,
    cookieValueByteLength: descriptors.reduce((total, entry) => total + entry.valueByteLength, 0),
  });
}

function assertOrderedEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Chatwoot ordered phase evidence must be an exact record.");
  }
  const actual = Object.keys(value);
  if (
    actual.length !== CHATWOOT_PHASE_EVIDENCE_CATEGORIES.length
    || CHATWOOT_PHASE_EVIDENCE_CATEGORIES.some((category) => (
      !Object.hasOwn(value, category)
    ))
  ) {
    throw new Error("Chatwoot ordered phase evidence has unexpected categories.");
  }
  const result = {};
  let totalBytes = 0;
  for (const category of CHATWOOT_PHASE_EVIDENCE_CATEGORIES) {
    const entries = value[category];
    if (
      !isDenseArray(entries)
      || entries.length === 0
      || entries.length > CHATWOOT_PHASE_EVIDENCE_CATEGORY_LIMITS[category]
    ) {
      throw new Error(`Chatwoot ${category} evidence is empty or outside its bound.`);
    }
    let categoryBytes = 0;
    result[category] = entries.map((entry, index) => {
      if (typeof entry !== "string") {
        throw new Error(`Chatwoot ${category} evidence entry ${index} is not canonical text.`);
      }
      const bytes = Buffer.from(entry, "utf8");
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_ENTRY_BYTES) {
        throw new Error(`Chatwoot ${category} evidence entry ${index} is outside its byte bound.`);
      }
      categoryBytes += bytes.byteLength;
      totalBytes += bytes.byteLength;
      if (categoryBytes > MAX_CATEGORY_BYTES || totalBytes > MAX_TOTAL_EVIDENCE_BYTES) {
        throw new Error(`Chatwoot ${category} evidence exceeded its aggregate byte bound.`);
      }
      return bytes;
    });
  }
  return result;
}

function sealSequence(key, phase, category, entries) {
  const context = createHmac("sha256", key);
  updateField(context, hmacDomain);
  updateField(context, phase);
  updateField(context, category);
  updateInteger(context, entries.length);
  for (let index = 0; index < entries.length; index += 1) {
    updateInteger(context, index);
    updateField(context, entries[index]);
  }
  return context.digest("hex");
}

function sealEntry(key, phase, category, index, entries) {
  return hmac(key, [
    "range",
    phase,
    category,
    String(index),
    String(entries.length),
    entries[index],
  ]);
}

function sealOpaque(key, category, value) {
  const bytes = boundedOpaqueBytes(value, category, MAX_OPAQUE_BYTES);
  return hmac(key, ["opaque", category, bytes]);
}

function boundedOpaqueBytes(value, category, maximumBytes) {
  if (typeof value !== "string" && !Buffer.isBuffer(value)) {
    throw new Error(`Chatwoot ${category} value is not bounded opaque bytes.`);
  }
  const bytes = Buffer.from(value);
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    throw new Error(`Chatwoot ${category} value is outside its byte bound.`);
  }
  return bytes;
}

function exactKeys(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`Chatwoot ${label} has unexpected fields.`);
  }
}

function isDenseArray(value) {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

function hmac(key, fields) {
  const context = createHmac("sha256", key);
  updateField(context, hmacDomain);
  for (const field of fields) updateField(context, field);
  return context.digest("hex");
}

function updateField(context, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  updateInteger(context, bytes.byteLength);
  context.update(bytes);
}

function updateInteger(context, value) {
  const bytes = Buffer.allocUnsafe(4);
  bytes.writeUInt32BE(value, 0);
  context.update(bytes);
}

function assertPhase(phase) {
  if (!phaseNames.includes(phase)) {
    throw new Error("Chatwoot phase evidence has an invalid phase label.");
  }
}
