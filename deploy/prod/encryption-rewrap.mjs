import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

const PROVIDER_TOKEN_PURPOSE = "remnashop-provider-token";
const REFRESH_SUCCESSOR_PURPOSE = "web-refresh-successor";
const TELEGRAM_CALLBACK_PURPOSE = "telegram-oidc-callback-result";
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

function assertSecret(name, value) {
  if (typeof value !== "string" || value.length < 32) {
    throw new Error(`${name} must be a secret of at least 32 characters`);
  }
  return value;
}

export function encryptionKeyringFromEnvironment(environment = process.env) {
  const primary = {
    id: environment.WEB_REFRESH_KEY_ID?.trim() || "primary",
    secret: assertSecret(
      "WEB_REFRESH_SECRET",
      environment.WEB_REFRESH_SECRET?.trim(),
    ),
  };
  if (!KEY_ID_PATTERN.test(primary.id)) {
    throw new Error("WEB_REFRESH_KEY_ID must contain 1 to 32 safe key-id characters");
  }

  const encodedPrevious = environment.WEB_REFRESH_PREVIOUS_KEYS?.trim();
  let previous = [];
  if (encodedPrevious) {
    let parsed;
    try {
      parsed = JSON.parse(encodedPrevious);
    } catch {
      throw new Error("WEB_REFRESH_PREVIOUS_KEYS must be a JSON object");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("WEB_REFRESH_PREVIOUS_KEYS must be a JSON object");
    }
    const entries = Object.entries(parsed);
    if (entries.length === 0 || entries.length > 4) {
      throw new Error("WEB_REFRESH_PREVIOUS_KEYS must contain 1 to 4 previous keys");
    }
    previous = entries.map(([id, secret]) => {
      if (!KEY_ID_PATTERN.test(id)) {
        throw new Error("WEB_REFRESH_PREVIOUS_KEYS contains an invalid key id");
      }
      return {
        id,
        secret: assertSecret(`WEB_REFRESH_PREVIOUS_KEYS.${id}`, secret),
      };
    });
  }

  const secrets = [primary.secret, ...previous.map(({ secret }) => secret)];
  if (new Set(secrets).size !== secrets.length) {
    throw new Error("Encryption keyring secrets must be distinct");
  }
  return { primary, previous };
}

function legacyEncryptionKey(secret) {
  return createHash("sha256").update(secret).digest();
}

function purposeEncryptionKey(secret, purpose) {
  return createHmac("sha256", secret)
    .update(`clean-pay:secret-encryption:v1:${purpose}`)
    .digest();
}

export function encryptionKeyCommitment(secret) {
  return createHmac("sha256", secret)
    .update("clean-pay:secret-encryption:key-binding:v2")
    .digest("base64url")
    .slice(0, 22);
}

function decryptVersionedEnvelope(
  encrypted,
  iv,
  authTag,
  secret,
  purpose,
  associatedData,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    purposeEncryptionKey(secret, purpose),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(associatedData, "utf8"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function decryptLegacyEnvelope(value, secret) {
  const [iv, authTag, encrypted] = value.split(".");
  if (!iv || !authTag || !encrypted) throw new Error("Invalid legacy envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    legacyEncryptionKey(secret),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptRewrapEnvelope(value, keyring, purpose) {
  const iv = randomBytes(12);
  const prefix = [
    "v2",
    keyring.primary.id,
    encryptionKeyCommitment(keyring.primary.secret),
  ].join(".");
  const cipher = createCipheriv(
    "aes-256-gcm",
    purposeEncryptionKey(keyring.primary.secret, purpose),
    iv,
  );
  cipher.setAAD(Buffer.from(`${prefix}.${purpose}`, "utf8"));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    prefix,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptRewrapEnvelope(value, keyring, purpose) {
  const parts = value.split(".");
  if (parts.length === 6 && parts[0] === "v2") {
    const [, keyId, commitment, iv, authTag, encrypted] = parts;
    const entries = [keyring.primary, ...keyring.previous];
    const entryIndex = keyId && commitment
      ? entries.findIndex((entry) =>
          entry.id === keyId
          && encryptionKeyCommitment(entry.secret) === commitment
        )
      : -1;
    const entry = entryIndex >= 0 ? entries[entryIndex] : undefined;
    if (!entry || !keyId || !commitment || !iv || !authTag || !encrypted) {
      throw new Error("Unknown or invalid encrypted secret key");
    }
    return {
      value: decryptVersionedEnvelope(
        encrypted,
        iv,
        authTag,
        entry.secret,
        purpose,
        `v2.${keyId}.${commitment}.${purpose}`,
      ),
      keyId,
      needsRewrap: entryIndex !== 0,
    };
  }

  if (parts.length === 5 && parts[0] === "v1") {
    const [, keyId, iv, authTag, encrypted] = parts;
    if (!keyId || !iv || !authTag || !encrypted) {
      throw new Error("Unknown or invalid encrypted secret key");
    }
    for (const entry of [keyring.primary, ...keyring.previous]) {
      if (entry.id !== keyId) continue;
      try {
        return {
          value: decryptVersionedEnvelope(
            encrypted,
            iv,
            authTag,
            entry.secret,
            purpose,
            `v1.${keyId}.${purpose}`,
          ),
          keyId,
          needsRewrap: true,
        };
      } catch {
        // v1 carried only an id. Try another explicitly authorised entry with
        // that exact id so a same-id rotation can be recovered and rewrapped.
      }
    }
    throw new Error("Unknown or invalid encrypted secret key");
  }

  if (parts.length === 3) {
    for (const entry of [keyring.primary, ...keyring.previous]) {
      try {
        return {
          value: decryptLegacyEnvelope(value, entry.secret),
          keyId: entry.id,
          needsRewrap: true,
        };
      } catch {
        // Try only the next explicitly authorised key.
      }
    }
  }
  throw new Error("Invalid encrypted secret payload");
}

function boundedInteger(name, value, fallback, minimum, maximum) {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return resolved;
}

function candidateFilter(primary) {
  return {
    not: {
      startsWith: `v2.${primary.id}.${encryptionKeyCommitment(primary.secret)}.`,
    },
  };
}

function nullableEnvelopeFilter(primary, validateCurrentEnvelopes) {
  return validateCurrentEnvelopes
    ? { not: null }
    : candidateFilter(primary);
}

function createReport(mode, batchSize, maxBatches) {
  return {
    mode,
    batchSize,
    maxBatches,
    complete: true,
    scannedRows: 0,
    scannedCiphertexts: 0,
    needsRewrap: 0,
    rewrapped: 0,
    conflicts: 0,
    unreadable: 0,
    oldKeyUsage: {},
    stores: {
      webSessions: { batches: 0, rows: 0, complete: false },
      refreshSuccessors: { batches: 0, rows: 0, complete: false },
      telegramCallbacks: { batches: 0, rows: 0, complete: false },
    },
  };
}

function inspectEnvelope(encrypted, purpose, keyring, report) {
  report.scannedCiphertexts += 1;
  try {
    const revealed = decryptRewrapEnvelope(encrypted, keyring, purpose);
    if (!revealed.needsRewrap) return null;
    report.needsRewrap += 1;
    const previousCount = Object.hasOwn(report.oldKeyUsage, revealed.keyId)
      ? report.oldKeyUsage[revealed.keyId]
      : 0;
    Object.defineProperty(report.oldKeyUsage, revealed.keyId, {
      value: previousCount + 1,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    return revealed;
  } catch {
    report.unreadable += 1;
    return null;
  }
}

async function processStorePages({
  report,
  storeReport,
  batchSize,
  maxBatches,
  fetchPage,
  processRow,
}) {
  let cursor;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const rows = await fetchPage(cursor);
    storeReport.batches += 1;
    if (rows.length === 0) {
      storeReport.complete = true;
      break;
    }
    storeReport.rows += rows.length;
    report.scannedRows += rows.length;
    for (const row of rows) await processRow(row);
    cursor = rows.at(-1).id;
    if (rows.length < batchSize) {
      storeReport.complete = true;
      break;
    }
  }
  if (!storeReport.complete) report.complete = false;
}

async function rewrapWebSessionField({
  prisma,
  row,
  field,
  purpose,
  keyring,
  apply,
  report,
}) {
  const encrypted = row[field];
  if (!encrypted) return;
  const revealed = inspectEnvelope(encrypted, purpose, keyring, report);
  if (!revealed || !apply) return;
  const updated = await prisma.webSession.updateMany({
    where: { id: row.id, [field]: encrypted },
    data: { [field]: encryptRewrapEnvelope(revealed.value, keyring, purpose) },
  });
  if (updated.count === 1) report.rewrapped += 1;
  else report.conflicts += 1;
}

/**
 * Scans a bounded number of rows and CAS-rewraps only old/legacy ciphertext.
 * The returned report is aggregate-only: callers must never add row ids,
 * ciphertext or key material to operator logs.
 */
export async function runEncryptionRewrap(
  prisma,
  keyring,
  options = {},
) {
  if (options.apply && options.retirementCheck) {
    throw new Error("Encryption rewrap apply and retirement check modes are mutually exclusive");
  }
  const mode = options.apply ? "apply" : "report";
  const batchSize = boundedInteger("batchSize", options.batchSize, 100, 1, 500);
  const maxBatches = boundedInteger("maxBatches", options.maxBatches, 10, 1, 1_000);
  const report = createReport(mode, batchSize, maxBatches);
  const validateCurrentEnvelopes = options.retirementCheck === true;
  const selectedNullableEnvelope = nullableEnvelopeFilter(
    keyring.primary,
    validateCurrentEnvelopes,
  );

  await processStorePages({
    report,
    storeReport: report.stores.webSessions,
    batchSize,
    maxBatches,
    fetchPage: (cursor) => prisma.webSession.findMany({
      where: {
        OR: [
          { remnashopAccessTokenEncrypted: selectedNullableEnvelope },
          { remnashopRefreshTokenEncrypted: selectedNullableEnvelope },
          { remnashopRefreshRecoveryEncrypted: selectedNullableEnvelope },
        ],
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: {
        id: true,
        remnashopAccessTokenEncrypted: true,
        remnashopRefreshTokenEncrypted: true,
        remnashopRefreshRecoveryEncrypted: true,
      },
      orderBy: { id: "asc" },
      take: batchSize,
    }),
    processRow: async (row) => {
      await rewrapWebSessionField({
        prisma,
        row,
        field: "remnashopAccessTokenEncrypted",
        purpose: PROVIDER_TOKEN_PURPOSE,
        keyring,
        apply: options.apply,
        report,
      });
      await rewrapWebSessionField({
        prisma,
        row,
        field: "remnashopRefreshTokenEncrypted",
        purpose: PROVIDER_TOKEN_PURPOSE,
        keyring,
        apply: options.apply,
        report,
      });
      await rewrapWebSessionField({
        prisma,
        row,
        field: "remnashopRefreshRecoveryEncrypted",
        purpose: PROVIDER_TOKEN_PURPOSE,
        keyring,
        apply: options.apply,
        report,
      });
    },
  });

  await processStorePages({
    report,
    storeReport: report.stores.refreshSuccessors,
    batchSize,
    maxBatches,
    fetchPage: (cursor) => prisma.webRefreshToken.findMany({
      where: {
        ...(validateCurrentEnvelopes
          ? {}
          : { successorTokenEncrypted: candidateFilter(keyring.primary) }),
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, successorTokenEncrypted: true },
      orderBy: { id: "asc" },
      take: batchSize,
    }),
    processRow: async (row) => {
      const revealed = inspectEnvelope(
        row.successorTokenEncrypted,
        REFRESH_SUCCESSOR_PURPOSE,
        keyring,
        report,
      );
      if (!revealed || !options.apply) return;
      const updated = await prisma.webRefreshToken.updateMany({
        where: {
          id: row.id,
          successorTokenEncrypted: row.successorTokenEncrypted,
        },
        data: {
          successorTokenEncrypted: encryptRewrapEnvelope(
            revealed.value,
            keyring,
            REFRESH_SUCCESSOR_PURPOSE,
          ),
        },
      });
      if (updated.count === 1) report.rewrapped += 1;
      else report.conflicts += 1;
    },
  });

  await processStorePages({
    report,
    storeReport: report.stores.telegramCallbacks,
    batchSize,
    maxBatches,
    fetchPage: (cursor) => prisma.telegramAuthState.findMany({
      where: {
        callbackResultEncrypted: selectedNullableEnvelope,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      select: { id: true, callbackResultEncrypted: true },
      orderBy: { id: "asc" },
      take: batchSize,
    }),
    processRow: async (row) => {
      const revealed = inspectEnvelope(
        row.callbackResultEncrypted,
        TELEGRAM_CALLBACK_PURPOSE,
        keyring,
        report,
      );
      if (!revealed || !options.apply) return;
      const updated = await prisma.telegramAuthState.updateMany({
        where: {
          id: row.id,
          callbackResultEncrypted: row.callbackResultEncrypted,
        },
        data: {
          callbackResultEncrypted: encryptRewrapEnvelope(
            revealed.value,
            keyring,
            TELEGRAM_CALLBACK_PURPOSE,
          ),
        },
      });
      if (updated.count === 1) report.rewrapped += 1;
      else report.conflicts += 1;
    },
  });

  report.retirementReady = validateCurrentEnvelopes
    && mode === "report"
    && report.complete
    && report.needsRewrap === 0
    && report.unreadable === 0
    && report.conflicts === 0;
  return report;
}

export const encryptionRewrapPurposes = Object.freeze({
  providerToken: PROVIDER_TOKEN_PURPOSE,
  refreshSuccessor: REFRESH_SUCCESSOR_PURPOSE,
  telegramCallback: TELEGRAM_CALLBACK_PURPOSE,
});
