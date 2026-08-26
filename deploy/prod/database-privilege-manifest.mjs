// Exact, fail-closed PostgreSQL privilege contract for the current Prisma
// schema. Every migration that adds or removes an object or a writable column
// must update this versioned manifest in the same reviewed change.

export const DATABASE_PRIVILEGE_MANIFEST_VERSION = "2026-08-26.6";

// SHA-256 of the canonical effective PUBLIC ACL surface from the exact pinned
// PostgreSQL 17.11 image after the deliberate sibling-database/public-schema
// and large-object capability revocations have been applied.
export const DATABASE_PG17_SYSTEM_PUBLIC_ACL_SHA256 =
  "fd1641ca792bcabc2cca8c7ea878a1ce89150edf40021dc1b4f3c8c0e33bd200";

export const DATABASE_ENVIRONMENT_CONTRACT = Object.freeze({
  serverMajor: 17,
  serverVersionNumber: 170011,
  encoding: "UTF8",
  localeProvider: "c",
  collate: "C",
  ctype: "C.UTF-8",
  locale: null,
  icuRules: null,
  collationVersion: null,
});

export const PAYMENT_RECORD_COLUMNS = Object.freeze([
  "id",
  "userId",
  "paymentId",
  "purchaseType",
  "status",
  "finalAmount",
  "currency",
  "gatewayType",
  "planCode",
  "planName",
  "durationDays",
  "deviceLimit",
  "trafficLimit",
  "paymentUrl",
  "retentionHoldAt",
  "retentionHoldId",
  "terminalObservedAt",
  "sensitiveDataScrubbedAt",
  "isFree",
  "raw",
  "operationId",
  "upstreamCreatedAt",
  "upstreamUpdatedAt",
  "lastSyncedAt",
  "createdAt",
  "updatedAt",
]);

export const PAYMENT_OPERATION_COLUMNS = Object.freeze([
  "id",
  "userId",
  "kind",
  "idempotencyKeyHash",
  "upstreamOwnerHash",
  "requestFingerprint",
  "requestPayload",
  "upstreamKey",
  "status",
  "attemptCount",
  "claimTokenHash",
  "leaseExpiresAt",
  "dispatchedAt",
  "outcomeUnknownAt",
  "completedAt",
  "responseStatus",
  "responseSnapshot",
  "errorSnapshot",
  "reconcileAttemptCount",
  "reconcileFailureCount",
  "reconcileClaimTokenHash",
  "reconcileLeaseExpiresAt",
  "reconcileNextAttemptAt",
  "reconcileLastAttemptAt",
  "reconcileErrorSnapshot",
  "reconciledAt",
  "retentionHoldAt",
  "retentionHoldId",
  "snapshotScrubbedAt",
  "createdAt",
  "updatedAt",
]);

export const PAYMENT_RETENTION_HOLD_COLUMNS = Object.freeze([
  "id",
  "holdIdHash",
  "status",
  "selectorKind",
  "selectorId",
  "selectorEvidenceHash",
  "activeCaseKey",
  "caseUserId",
  "caseOperationId",
  "casePaymentRecordId",
  "owner",
  "reason",
  "reviewAt",
  "heldAt",
  "releasedBy",
  "releaseReason",
  "releasedAt",
  "disposedBy",
  "disposition",
  "disposedAt",
  "createdAt",
  "updatedAt",
]);

export const DATABASE_TABLES = Object.freeze([
  "AccountMergeConfirmation",
  "AppSetting",
  "AuditLog",
  "EmailVerificationCode",
  "IntegrationStatus",
  "PaymentHistorySyncState",
  "PaymentOperation",
  "PaymentRecord",
  "PaymentRetentionHold",
  "RateLimitEvent",
  "TelegramAuthState",
  "WebAuthnChallenge",
  "WebAuthnCredential",
  "WebRefreshToken",
  "WebSession",
  "WebUser",
]);

// Physical scalar columns, including Prisma-managed timestamps. Relations are
// deliberately absent because they are not database columns. Grant sync checks
// this map before changing ACLs, so adding a column cannot inherit broad table
// DML unnoticed while runtimes are stopped.
export const DATABASE_TABLE_COLUMNS = Object.freeze({
  _clean_pay_retention_policy: Object.freeze([
    "singleton",
    "auth_state_days",
    "session_days",
    "audit_info_days",
    "audit_security_days",
    "rate_limit_days",
    "payment_sensitive_days",
    "payment_operation_snapshot_days",
    "payment_hold_disposed_days",
    "updated_at",
  ]),
  _prisma_migrations: Object.freeze([
    "id", "checksum", "finished_at", "migration_name", "logs",
    "rolled_back_at", "started_at", "applied_steps_count",
  ]),
  AccountMergeConfirmation: Object.freeze([
    "id", "userId", "tokenHash", "telegramId", "telegramUsername",
    "sourceEmail", "targetEmail", "targetTelegramId", "sourceRemnashopUserId",
    "targetRemnashopUserId", "status", "attemptCount", "leaseExpiresAt",
    "lastErrorCode", "expiresAt", "completedAt", "createdAt", "updatedAt",
  ]),
  AppSetting: Object.freeze(["key", "value", "updatedAt"]),
  AuditLog: Object.freeze([
    "id", "userId", "action", "severity", "ipHash", "metadata", "createdAt",
  ]),
  EmailVerificationCode: Object.freeze([
    "id", "userId", "codeHash", "attempts", "maxAttempts", "sentAt",
    "expiresAt", "consumedAt", "createdAt", "updatedAt",
  ]),
  IntegrationStatus: Object.freeze([
    "id", "service", "status", "message", "checkedAt", "updatedAt",
  ]),
  PaymentHistorySyncState: Object.freeze([
    "userId", "upstreamOwnerHash", "cursor", "generation", "attemptCount",
    "failureCount", "claimTokenHash", "leaseExpiresAt", "nextAttemptAt",
    "lastAttemptAt", "lastSyncedAt", "backfillCompletedAt", "errorSnapshot",
    "createdAt", "updatedAt",
  ]),
  PaymentOperation: PAYMENT_OPERATION_COLUMNS,
  PaymentRecord: PAYMENT_RECORD_COLUMNS,
  PaymentRetentionHold: PAYMENT_RETENTION_HOLD_COLUMNS,
  RateLimitEvent: Object.freeze([
    "id", "key", "action", "occurredAt", "metadata",
  ]),
  TelegramAuthState: Object.freeze([
    "id", "stateHash", "nonceHash", "codeVerifierHash", "redirectTo", "userId",
    "expiresAt", "consumedAt", "callbackStatus", "callbackCodeHash",
    "callbackClaimTokenHash", "callbackLeaseExpiresAt", "callbackAttemptCount",
    "callbackResultEncrypted", "callbackResultExpiresAt", "callbackWebSessionId",
    "callbackCompletedAt", "callbackFailureCode", "createdAt", "updatedAt",
  ]),
  WebAuthnChallenge: Object.freeze([
    "id", "challenge", "type", "userId", "expiresAt", "consumedAt", "createdAt",
  ]),
  WebAuthnCredential: Object.freeze([
    "id", "userId", "credentialId", "publicKey", "counter", "transports",
    "aaguid", "deviceType", "backedUp", "name", "lastUsedAt", "createdAt",
    "updatedAt",
  ]),
  WebRefreshToken: Object.freeze([
    "id", "sessionId", "tokenHash", "successorTokenEncrypted", "graceExpiresAt",
    "consumedAt", "createdAt",
  ]),
  WebSession: Object.freeze([
    "id", "userId", "refreshTokenHash", "refreshRotatedAt",
    "remnashopAccessTokenEncrypted", "remnashopRefreshTokenEncrypted",
    "remnashopAccessExpiresAt", "remnashopRefreshExpiresAt",
    "remnashopRefreshClaimTokenHash", "remnashopRefreshLeaseExpiresAt",
    "remnashopRefreshDispatchedAt", "remnashopRefreshRecoveryEncrypted",
    "remnashopRefreshAttemptCount", "authMethod", "assuranceLevel", "userAgent",
    "ipHash", "accessTokenExpiresAt", "refreshExpiresAt", "revokedAt", "createdAt",
    "updatedAt",
  ]),
  WebUser: Object.freeze([
    "id", "remnashopUserId", "email", "telegramId", "telegramUsername",
    "fullName", "photoUrl", "lastLoginAt", "emailVerified", "authPending",
    "pendingRemnashopUserId", "pendingRemnashopEmail",
    "paymentOwnerChangeTokenHash", "paymentOwnerChangeLeaseExpiresAt",
    "paymentOwnerChangeStartedAt", "paymentOwnerChangeMutationStartedAt",
    "paymentOwnerChangeLocalFinalizedAt", "paymentOwnerChangeOperationHash",
    "paymentOwnerChangeExpectedOwnerHash", "paymentOwnerChangeAttemptCount",
    "displayName", "createdAt", "updatedAt",
  ]),
});

export const DATABASE_INTERNAL_TABLES = Object.freeze([
  "_clean_pay_retention_policy",
  "_prisma_migrations",
]);

export const DATABASE_ENUM_TYPES = Object.freeze([
  "AccountMergeConfirmationStatus",
  "AuditSeverity",
  "IntegrationStatusKind",
  "PaymentOperationKind",
  "PaymentOperationStatus",
  "PaymentRecordStatus",
  "PaymentRetentionDisposition",
  "PaymentRetentionHoldSelectorKind",
  "PaymentRetentionHoldStatus",
  "TelegramCallbackStatus",
  "WebAuthnChallengeType",
  "WebSessionAssuranceLevel",
  "WebSessionAuthMethod",
]);

export const DATABASE_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "clean_pay_retention_delete_batch",
    identityArguments: "phase text",
    executeRoles: Object.freeze(["retention"]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "TABLE(selected integer, affected integer, backlog boolean)",
    securityDefiner: true,
    sourceSha256: "48f152dc56dbc2de8e8b76f6fc6759060396e0f9b27ab2084547e81a36a97c89",
    strict: false,
    configuration: Object.freeze([
      "search_path=pg_catalog, <target>",
      "TimeZone=UTC",
    ]),
    volatility: "v",
  }),
  Object.freeze({
    name: "clean_pay_retention_scrub_payment_operation_snapshots",
    identityArguments: "",
    executeRoles: Object.freeze(["retention"]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "TABLE(selected integer, affected integer, backlog boolean)",
    securityDefiner: true,
    sourceSha256: "a004418b5fe283ed4b3876d71f5775672b4f2021cb9e41d7cfb1c461f5b678c0",
    strict: false,
    configuration: Object.freeze([
      "search_path=pg_catalog, <target>",
      "TimeZone=UTC",
    ]),
    volatility: "v",
  }),
  Object.freeze({
    name: "clean_pay_retention_scrub_payment_records",
    identityArguments: "",
    executeRoles: Object.freeze(["retention"]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "TABLE(selected integer, affected integer, backlog boolean)",
    securityDefiner: true,
    sourceSha256: "9c20e269acdc0fae68417bfc5a5d105463a9a13eb000b269e113ad808413d8f1",
    strict: false,
    configuration: Object.freeze([
      "search_path=pg_catalog, <target>",
      "TimeZone=UTC",
    ]),
    volatility: "v",
  }),
  Object.freeze({
    name: "clean_pay_retention_scrub_telegram_callbacks",
    identityArguments: "",
    executeRoles: Object.freeze(["retention"]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "TABLE(selected integer, affected integer, backlog boolean)",
    securityDefiner: true,
    sourceSha256: "f9f8cd3a1fc255728c4d7a2e69d7904666ebc31cfa3a8efd662a169b787e4b04",
    strict: false,
    configuration: Object.freeze([
      "search_path=pg_catalog, <target>",
      "TimeZone=UTC",
    ]),
    volatility: "v",
  }),
  Object.freeze({
    name: "enforce_payment_retention_hold_integrity",
    identityArguments: "",
    executeRoles: Object.freeze([]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "trigger",
    securityDefiner: true,
    sourceSha256: "7de5ff847c02b7eb5e053ec4a0a9c178fcbcb0cb96cee9ded03f1710efe9755a",
    strict: false,
    configuration: Object.freeze(["search_path=pg_catalog"]),
    volatility: "v",
  }),
  Object.freeze({
    name: "prevent_held_payment_case_link",
    identityArguments: "",
    executeRoles: Object.freeze([]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "trigger",
    securityDefiner: false,
    sourceSha256: "56bad0044db63b13d684ab83a28eea53943b9b1bd46cda0a1ef0a34668a177ec",
    strict: false,
    configuration: Object.freeze(["search_path=pg_catalog"]),
    volatility: "v",
  }),
  Object.freeze({
    name: "prevent_payment_retention_hold_reassignment",
    identityArguments: "",
    executeRoles: Object.freeze([]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "trigger",
    securityDefiner: false,
    sourceSha256: "53915dc6bf2d53ff2f2bab4ad65ed515bf1ed16141a8815eb1da757529972d6a",
    strict: false,
    configuration: Object.freeze(["search_path=pg_catalog"]),
    volatility: "v",
  }),
  Object.freeze({
    name: "prevent_retained_payment_hold_delete",
    identityArguments: "",
    executeRoles: Object.freeze([]),
    kind: "f",
    language: "plpgsql",
    leakproof: false,
    parallel: "u",
    returnType: "trigger",
    securityDefiner: false,
    sourceSha256: "8913e1f082a2457618bd6a65b5e41c21444932238deb62145e94d8fa6346d2aa",
    strict: false,
    configuration: Object.freeze(["search_path=pg_catalog"]),
    volatility: "v",
  }),
]);

export const DATABASE_TRIGGERS = Object.freeze([
  Object.freeze({
    name: "PaymentOperation_payment_retention_hold_integrity",
    table: "PaymentOperation",
    functionName: "enforce_payment_retention_hold_integrity",
    functionIdentityArguments: "",
    type: 29,
    enabled: "O",
    constraintName: "PaymentOperation_payment_retention_hold_integrity",
    deferrable: true,
    initiallyDeferred: true,
    definitionSha256: "fd2a3964011724bf9256c9ec11be449090f0fe27b2ea5aeb2842bfec44178a58",
    updateColumns: Object.freeze([
      "id", "userId", "retentionHoldId", "retentionHoldAt",
    ]),
  }),
  Object.freeze({
    name: "PaymentRecord_payment_retention_hold_integrity",
    table: "PaymentRecord",
    functionName: "enforce_payment_retention_hold_integrity",
    functionIdentityArguments: "",
    type: 29,
    enabled: "O",
    constraintName: "PaymentRecord_payment_retention_hold_integrity",
    deferrable: true,
    initiallyDeferred: true,
    definitionSha256: "81f7641a60033fdee1efb808fff8248c61c78a95301b7c077ca47658bf9ed8dd",
    updateColumns: Object.freeze([
      "id", "userId", "operationId", "retentionHoldId", "retentionHoldAt",
    ]),
  }),
  Object.freeze({
    name: "PaymentRecord_prevent_held_case_link",
    table: "PaymentRecord",
    functionName: "prevent_held_payment_case_link",
    functionIdentityArguments: "",
    type: 23,
    enabled: "O",
    definitionSha256: "3b9c6484a008897e5f4160731a4902e7e907a5082862277879b324b76cf054ca",
    updateColumns: Object.freeze(["operationId"]),
  }),
  Object.freeze({
    name: "PaymentRetentionHold_payment_retention_hold_integrity",
    table: "PaymentRetentionHold",
    functionName: "enforce_payment_retention_hold_integrity",
    functionIdentityArguments: "",
    type: 29,
    enabled: "O",
    constraintName: "PaymentRetentionHold_payment_retention_hold_integrity",
    deferrable: true,
    initiallyDeferred: true,
    definitionSha256: "7005418b70a4885f84049e8c8f264374c5d55196c215fe78cdcd63eeb5b1d713",
    updateColumns: Object.freeze([]),
  }),
  Object.freeze({
    name: "PaymentRetentionHold_prevent_reassignment",
    table: "PaymentRetentionHold",
    functionName: "prevent_payment_retention_hold_reassignment",
    functionIdentityArguments: "",
    type: 19,
    enabled: "O",
    definitionSha256: "6c28592654179f9bedfcb523af7e19b3098cbfbb8c6612ed0b415ef3e8a96951",
    updateColumns: Object.freeze([]),
  }),
  Object.freeze({
    name: "PaymentRetentionHold_prevent_retained_delete",
    table: "PaymentRetentionHold",
    functionName: "prevent_retained_payment_hold_delete",
    functionIdentityArguments: "",
    type: 11,
    enabled: "O",
    definitionSha256: "aeecbdc886c5958b3b4329c38958133deadd7c3297b8e6730afb5d700e8730ba",
    updateColumns: Object.freeze([]),
  }),
]);

export const DATABASE_SECURITY_CONSTRAINTS = Object.freeze([
  Object.freeze({ table: "_clean_pay_retention_policy", name: "_clean_pay_retention_policy_pkey", type: "p", definitionSha256: "d004b3efcdc4a0108ecbe83c93408f63eebecc563529a3941a4c59667835f25b" }),
  Object.freeze({ table: "_clean_pay_retention_policy", name: "_clean_pay_retention_policy_ranges_check", type: "c", definitionSha256: "21db4b72d88225583770df458b4f91e0e0b874e6b738a8f701c4a6e112af4f1e" }),
  Object.freeze({ table: "_clean_pay_retention_policy", name: "_clean_pay_retention_policy_singleton_check", type: "c", definitionSha256: "0a780c77dfabbc15def3d17957997d352de196c1233a0d25fccc97a40d2d6f41" }),
  Object.freeze({ table: "PaymentOperation", name: "PaymentOperation_payment_retention_hold_integrity", type: "t", definitionSha256: "698fc09045e7267eeb19c5b09473ec8c40f237145be8c1cbd97b9dde2451ddc1" }),
  Object.freeze({ table: "PaymentOperation", name: "PaymentOperation_retentionHoldId_fkey", type: "f", definitionSha256: "71889754feecbf76036d4902bafa0df74d2e78bdf195e9397bf8e5c825b9113d" }),
  Object.freeze({ table: "PaymentOperation", name: "PaymentOperation_retention_hold_pointer_pair_check", type: "c", definitionSha256: "252aaf2a4cd26d4bb12e184f2556fdd1beac66e0f94744a355d5eed41939fb11" }),
  Object.freeze({ table: "PaymentRecord", name: "PaymentRecord_payment_retention_hold_integrity", type: "t", definitionSha256: "698fc09045e7267eeb19c5b09473ec8c40f237145be8c1cbd97b9dde2451ddc1" }),
  Object.freeze({ table: "PaymentRecord", name: "PaymentRecord_retentionHoldId_fkey", type: "f", definitionSha256: "71889754feecbf76036d4902bafa0df74d2e78bdf195e9397bf8e5c825b9113d" }),
  Object.freeze({ table: "PaymentRecord", name: "PaymentRecord_retention_hold_pointer_pair_check", type: "c", definitionSha256: "252aaf2a4cd26d4bb12e184f2556fdd1beac66e0f94744a355d5eed41939fb11" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_caseOperationId_fkey", type: "f", definitionSha256: "3c145816b983e3f88294dfa25d5ea2662d1524ba1e3e982d51c74bc223a8a074" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_casePaymentRecordId_fkey", type: "f", definitionSha256: "10a47d7ac5b9d1796c3aeee8a989132e1c57824e036e0ecd41417514dbec2ce9" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_evidence_hash_check", type: "c", definitionSha256: "eff0e5a4bcd7f61263d85f39ad8b955ec36942a48f61cde088436f40e364abd7" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_lifecycle_check", type: "c", definitionSha256: "a801d2ed7c0523bbe9339554d2854024f07c0ae43211a4b1c938426fd6be382e" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_payment_retention_hold_integrity", type: "t", definitionSha256: "698fc09045e7267eeb19c5b09473ec8c40f237145be8c1cbd97b9dde2451ddc1" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_pkey", type: "p", definitionSha256: "8c8464f42472e42ee190fc91ca8db79b5351d3a4609040516578d229c56f6fa5" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_selector_case_check", type: "c", definitionSha256: "6d2834b73fe7c5de38350eef2ff76550c5fe7eb66597d4360d24af503d89f52f" }),
]);

export const DATABASE_SECURITY_INDEXES = Object.freeze([
  Object.freeze({ table: "_clean_pay_retention_policy", name: "_clean_pay_retention_policy_pkey", unique: true, primary: true, definitionSha256: "b434b47faa0a0e41df0b2569dc5c6a4700b17ea653f99e33ede23657a01925ae" }),
  Object.freeze({ table: "PaymentOperation", name: "PaymentOperation_retentionHoldId_key", unique: true, primary: false, definitionSha256: "5b964707c6c571ca0363f835f0622cae29b2ce50a3e3a6baab0113b6a4be4084" }),
  Object.freeze({ table: "PaymentRecord", name: "PaymentRecord_retentionHoldId_key", unique: true, primary: false, definitionSha256: "e700509ea7f50b033bfbe1b0973040f9877184cc620c4a0f4a9f6f77936c2226" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_activeCaseKey_key", unique: true, primary: false, definitionSha256: "4b78952bc928d8695083e6d27179afb4d2bb65c4ff5934f54fc873be58698ff6" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_active_caseOperationId_key", unique: true, primary: false, definitionSha256: "a0a59b9dedd381d064dbc8c9a4df49f825be62832081e6a1ea14c15926275632" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_active_casePaymentRecordId_key", unique: true, primary: false, definitionSha256: "c0d70bb7d46c54b7ae9cf8468bfa5d21f9670ee78fce439e548fad364882be3f" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_caseOperationId_idx", unique: false, primary: false, definitionSha256: "e66e61362c7f0498cb6a2e87509b70caab834211361f1231250028299ad3d934" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_casePaymentRecordId_idx", unique: false, primary: false, definitionSha256: "bf9f905a72cbff9f8eba3eb9ddc304f97c073f7e3fec15fbcb3ac12a790cdb2e" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_holdIdHash_key", unique: true, primary: false, definitionSha256: "606a8bcbe4afb6a465adadd3d1efd9a2374fb9c9878d49a9b7b4ea8a68637cf3" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_pkey", unique: true, primary: true, definitionSha256: "da2956e0cf1a3c4039bfc3ab55d0974214b3ed4d2b3924696c9a59f1f5388c11" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_status_disposedAt_idx", unique: false, primary: false, definitionSha256: "7edaf48b61b71edfde1c8d6f210292cdf547279aedd97c790eb6e8d6d7821a55" }),
  Object.freeze({ table: "PaymentRetentionHold", name: "PaymentRetentionHold_status_reviewAt_idx", unique: false, primary: false, definitionSha256: "75bc03401cef88b71714508eafae668ad2012b6971436ab4e0815c4143826407" }),
]);

// Canonical PostgreSQL 17 catalog fingerprints for the only supported
// stopped-maintenance rollout states. The provisioner also requires the exact
// contiguous Prisma ledger prefix matching the state name. Intermediate or
// older schemas fail closed instead of being treated as an arbitrary subset.
export const DATABASE_REVIEWED_CATALOG_STATES = Object.freeze({
  EMPTY: "9f7f35a431e5a131e5491af9f151199ecd07c31d9c9842c5f6cd478609ac5a37",
  LEDGER_ONLY: "1955b728adc39e2e5552647fbceddfd4b334306436b95c7717c0a293c9c7368d",
  "20260718000000_add_payment_reconciliation": "ada0de1e528e0f473942c5d6d655238dbd30338ad5404757f13ba12fc5d84a49",
  "20260813091000_add_remnashop_refresh_recovery": "22cd5e6885b74cb1e17498fccf38e47ef11b2d912fcb6d182dcd301fb8871eae",
  "20260825010000_add_durable_telegram_callback": "62919eda26c3c27d1b9b2c1cad71b6891796167573a43eda07e018acf49e4132",
  "20260825210000_add_payment_sensitive_retention": "2e143c73bf74b96b750be2a83480b4abaf14f58e069ad1925cbce9b61d7ee140",
  "20260825220000_add_payment_retention_hold_lifecycle": "ec5e19d357e70cd943f1cc79d9f39e426dd77990787e2cd80e19c44e9aee872b",
  "20260825230000_guard_retention_mutations": "bc7d32a97ebdaf57f36bcf61e6535a21313132b58de911caf0d930738fccd509",
});

export const DATABASE_RECOVERY_PREDECESSOR_STATES = Object.freeze({
  "20260718141000_drop_redundant_indexes": Object.freeze({
    predecessor: "20260718000000_add_payment_reconciliation",
    fingerprint: DATABASE_REVIEWED_CATALOG_STATES["20260718000000_add_payment_reconciliation"],
  }),
  "20260825010000_add_durable_telegram_callback": Object.freeze({
    predecessor: "20260813091000_add_remnashop_refresh_recovery",
    fingerprint: DATABASE_REVIEWED_CATALOG_STATES["20260813091000_add_remnashop_refresh_recovery"],
  }),
  "20260825210000_add_payment_sensitive_retention": Object.freeze({
    predecessor: "20260825010000_add_durable_telegram_callback",
    fingerprint: DATABASE_REVIEWED_CATALOG_STATES["20260825010000_add_durable_telegram_callback"],
  }),
  "20260825220000_add_payment_retention_hold_lifecycle": Object.freeze({
    predecessor: "20260825210000_add_payment_sensitive_retention",
    fingerprint: DATABASE_REVIEWED_CATALOG_STATES["20260825210000_add_payment_sensitive_retention"],
  }),
  "20260825230000_guard_retention_mutations": Object.freeze({
    predecessor: "20260825220000_add_payment_retention_hold_lifecycle",
    fingerprint: DATABASE_REVIEWED_CATALOG_STATES["20260825220000_add_payment_retention_hold_lifecycle"],
  }),
});

export const APPLICATION_TABLE_PRIVILEGES = Object.freeze({
  AccountMergeConfirmation: Object.freeze(["SELECT"]),
  EmailVerificationCode: Object.freeze(["DELETE"]),
  PaymentHistorySyncState: Object.freeze(["SELECT", "DELETE"]),
  PaymentOperation: Object.freeze(["SELECT"]),
  PaymentRecord: Object.freeze(["SELECT"]),
  TelegramAuthState: Object.freeze(["SELECT", "DELETE"]),
  WebAuthnChallenge: Object.freeze(["SELECT", "DELETE"]),
  WebAuthnCredential: Object.freeze(["SELECT", "DELETE"]),
  WebRefreshToken: Object.freeze(["SELECT"]),
  WebSession: Object.freeze(["SELECT", "DELETE"]),
  WebUser: Object.freeze(["SELECT", "DELETE"]),
});

export const APPLICATION_COLUMN_SELECTS = Object.freeze({
  AuditLog: Object.freeze(["userId"]),
  EmailVerificationCode: Object.freeze(["userId"]),
  PaymentRetentionHold: Object.freeze([
    "status",
    "caseUserId",
    "caseOperationId",
    "casePaymentRecordId",
  ]),
});

export const APPLICATION_COLUMN_INSERTS = Object.freeze({
  AccountMergeConfirmation: Object.freeze([
    "id", "userId", "tokenHash", "telegramId", "telegramUsername",
    "sourceEmail", "targetEmail", "targetTelegramId", "sourceRemnashopUserId",
    "targetRemnashopUserId", "status", "attemptCount", "expiresAt",
    "createdAt", "updatedAt",
  ]),
  AuditLog: Object.freeze([
    "id", "userId", "action", "severity", "ipHash", "metadata", "createdAt",
  ]),
  PaymentHistorySyncState: Object.freeze([
    "userId", "upstreamOwnerHash", "generation", "attemptCount",
    "failureCount", "createdAt", "updatedAt",
  ]),
  PaymentOperation: Object.freeze([
    "id", "userId", "kind", "idempotencyKeyHash", "requestFingerprint",
    "requestPayload", "upstreamKey", "status", "attemptCount",
    "reconcileAttemptCount", "reconcileFailureCount", "createdAt", "updatedAt",
  ]),
  PaymentRecord: Object.freeze([
    "id", "userId", "paymentId", "purchaseType", "status", "finalAmount",
    "currency", "gatewayType", "planCode", "planName", "durationDays",
    "deviceLimit", "trafficLimit", "paymentUrl", "terminalObservedAt", "isFree",
    "raw", "operationId", "upstreamCreatedAt", "upstreamUpdatedAt", "lastSyncedAt",
    "createdAt", "updatedAt",
  ]),
  TelegramAuthState: Object.freeze([
    "id", "stateHash", "nonceHash", "codeVerifierHash", "redirectTo", "userId",
    "expiresAt", "callbackStatus", "callbackAttemptCount", "createdAt", "updatedAt",
  ]),
  WebAuthnChallenge: Object.freeze([
    "id", "challenge", "type", "userId", "expiresAt", "createdAt",
  ]),
  WebAuthnCredential: Object.freeze([
    "id", "userId", "credentialId", "publicKey", "counter", "transports",
    "aaguid", "deviceType", "backedUp", "name", "lastUsedAt", "createdAt",
    "updatedAt",
  ]),
  WebRefreshToken: Object.freeze([
    "id", "sessionId", "tokenHash", "successorTokenEncrypted", "graceExpiresAt",
    "consumedAt", "createdAt",
  ]),
  WebSession: Object.freeze([
    "id", "userId", "refreshTokenHash", "remnashopAccessTokenEncrypted",
    "remnashopRefreshTokenEncrypted", "remnashopAccessExpiresAt",
    "remnashopRefreshExpiresAt", "remnashopRefreshAttemptCount", "authMethod",
    "assuranceLevel", "userAgent", "ipHash", "accessTokenExpiresAt",
    "refreshExpiresAt", "createdAt", "updatedAt",
  ]),
  WebUser: Object.freeze([
    "id", "remnashopUserId", "email", "telegramId", "telegramUsername",
    "fullName", "photoUrl", "lastLoginAt", "emailVerified", "authPending",
    "paymentOwnerChangeAttemptCount", "displayName", "createdAt", "updatedAt",
  ]),
});

export const APPLICATION_COLUMN_UPDATES = Object.freeze({
  AccountMergeConfirmation: Object.freeze([
    "tokenHash", "telegramUsername", "status", "attemptCount", "leaseExpiresAt",
    "lastErrorCode", "expiresAt", "completedAt", "updatedAt",
  ]),
  AuditLog: Object.freeze(["userId"]),
  PaymentHistorySyncState: Object.freeze([
    "upstreamOwnerHash", "cursor", "generation", "attemptCount", "failureCount",
    "claimTokenHash", "leaseExpiresAt", "nextAttemptAt", "lastAttemptAt",
    "lastSyncedAt", "backfillCompletedAt", "errorSnapshot", "updatedAt",
  ]),
  PaymentOperation: Object.freeze([
    "userId", "idempotencyKeyHash", "upstreamOwnerHash", "status", "attemptCount",
    "claimTokenHash", "leaseExpiresAt", "dispatchedAt", "outcomeUnknownAt",
    "completedAt", "responseStatus", "responseSnapshot", "errorSnapshot",
    "reconcileAttemptCount", "reconcileFailureCount", "reconcileClaimTokenHash",
    "reconcileLeaseExpiresAt", "reconcileNextAttemptAt", "reconcileLastAttemptAt",
    "reconcileErrorSnapshot", "reconciledAt", "updatedAt",
  ]),
  PaymentRecord: Object.freeze([
    "userId", "purchaseType", "status", "finalAmount", "currency", "gatewayType",
    "planCode", "planName", "durationDays", "deviceLimit", "trafficLimit",
    "paymentUrl", "terminalObservedAt", "isFree", "raw", "operationId",
    "upstreamCreatedAt", "upstreamUpdatedAt", "lastSyncedAt", "updatedAt",
  ]),
  PaymentRetentionHold: Object.freeze(["caseUserId", "updatedAt"]),
  TelegramAuthState: Object.freeze([
    "userId", "consumedAt", "callbackStatus", "callbackCodeHash",
    "callbackClaimTokenHash", "callbackLeaseExpiresAt", "callbackAttemptCount",
    "callbackResultEncrypted", "callbackResultExpiresAt", "callbackWebSessionId",
    "callbackCompletedAt", "callbackFailureCode", "updatedAt",
  ]),
  WebAuthnChallenge: Object.freeze(["consumedAt"]),
  WebAuthnCredential: Object.freeze([
    "userId", "counter", "transports", "aaguid", "deviceType", "backedUp", "name",
    "lastUsedAt", "updatedAt",
  ]),
  WebRefreshToken: Object.freeze(["successorTokenEncrypted"]),
  WebSession: Object.freeze([
    "refreshTokenHash", "refreshRotatedAt", "remnashopAccessTokenEncrypted",
    "remnashopRefreshTokenEncrypted", "remnashopAccessExpiresAt",
    "remnashopRefreshExpiresAt", "remnashopRefreshClaimTokenHash",
    "remnashopRefreshLeaseExpiresAt", "remnashopRefreshDispatchedAt",
    "remnashopRefreshRecoveryEncrypted", "remnashopRefreshAttemptCount", "authMethod",
    "assuranceLevel", "accessTokenExpiresAt", "refreshExpiresAt", "revokedAt",
    "updatedAt",
  ]),
  WebUser: Object.freeze([
    "remnashopUserId", "email", "telegramId", "telegramUsername", "fullName",
    "photoUrl", "lastLoginAt", "emailVerified", "authPending",
    "pendingRemnashopUserId", "pendingRemnashopEmail", "paymentOwnerChangeTokenHash",
    "paymentOwnerChangeLeaseExpiresAt", "paymentOwnerChangeStartedAt",
    "paymentOwnerChangeMutationStartedAt", "paymentOwnerChangeLocalFinalizedAt",
    "paymentOwnerChangeOperationHash", "paymentOwnerChangeExpectedOwnerHash",
    "paymentOwnerChangeAttemptCount", "displayName", "updatedAt",
  ]),
});

export const RETENTION_TABLE_PRIVILEGES = Object.freeze({});

// Retention receives no direct business-table access. Owner-executed guarded
// functions own every predicate, projection, cutoff, and mutation.
export const RETENTION_COLUMN_SELECTS = Object.freeze({});

export const RETENTION_COLUMN_UPDATES = Object.freeze({});

export const HOLD_OPERATOR_TABLE_PRIVILEGES = Object.freeze({
  PaymentRetentionHold: Object.freeze(["SELECT"]),
});

export const HOLD_OPERATOR_COLUMN_SELECTS = Object.freeze({
  PaymentOperation: Object.freeze([
    "id",
    "userId",
    "retentionHoldAt",
    "retentionHoldId",
  ]),
  PaymentRecord: Object.freeze([
    "id",
    "userId",
    "operationId",
    "retentionHoldAt",
    "retentionHoldId",
  ]),
});

export const HOLD_OPERATOR_COLUMN_INSERTS = Object.freeze({
  PaymentRetentionHold: Object.freeze([
    "id",
    "holdIdHash",
    "status",
    "selectorKind",
    "selectorId",
    "selectorEvidenceHash",
    "activeCaseKey",
    "caseUserId",
    "caseOperationId",
    "casePaymentRecordId",
    "owner",
    "reason",
    "reviewAt",
    "heldAt",
    "createdAt",
    "updatedAt",
  ]),
});

export const HOLD_OPERATOR_COLUMN_UPDATES = Object.freeze({
  PaymentOperation: Object.freeze([
    "retentionHoldAt",
    "retentionHoldId",
    "updatedAt",
  ]),
  PaymentRecord: Object.freeze([
    "retentionHoldAt",
    "retentionHoldId",
    "updatedAt",
  ]),
  PaymentRetentionHold: Object.freeze([
    "status",
    "selectorKind",
    "selectorId",
    "activeCaseKey",
    "caseUserId",
    "caseOperationId",
    "casePaymentRecordId",
    "owner",
    "reason",
    "reviewAt",
    "releasedBy",
    "releaseReason",
    "releasedAt",
    "disposedBy",
    "disposition",
    "disposedAt",
    "updatedAt",
  ]),
});

export const ROLE_ENUM_TYPES = Object.freeze({
  application: DATABASE_ENUM_TYPES,
  retention: Object.freeze([]),
  holdOperator: Object.freeze([
    "PaymentRetentionDisposition",
    "PaymentRetentionHoldSelectorKind",
    "PaymentRetentionHoldStatus",
  ]),
});

export function isReservedPostgresSchema(schema) {
  const normalized = schema.toLowerCase();
  return normalized === "information_schema"
    || normalized === "pg_catalog"
    || normalized === "pg_toast"
    || normalized.startsWith("pg_temp_")
    || normalized.startsWith("pg_toast_temp_")
    || normalized.startsWith("pg_");
}
