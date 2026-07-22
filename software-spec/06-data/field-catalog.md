# Каталог значимых полей

Ниже перечислены все обязательные физические поля; `?` означает допустимый `NULL`, `[]` — массив, `U` — уникальность, `I` — индекс. Реализация может изменить имена таблиц, но не вправе потерять поле, значение по умолчанию, точность, уникальность или назначение.

| Модель | Поля |
|---|---|
| WebUser | `id`; `remnashopUserId? U`; `email? U`; `telegramId? U`; `telegramUsername?`; `fullName?`; `photoUrl?`; `lastLoginAt?`; `emailVerified=false`; `authPending=false`; `pendingRemnashopUserId? I`; `pendingRemnashopEmail?`; `displayName?`; timestamps |
| AccountMergeConfirmation | `id`; `userId I`; `tokenHash U`; `telegramId`; `telegramUsername?`; `sourceEmail?`; `targetEmail`; source/target Remnashop ids; `status=PENDING`; `attemptCount=0`; `leaseExpiresAt?`; `lastErrorCode?`; `expiresAt I`; `completedAt?`; timestamps |
| PaymentRecord | `id`; `userId`; `paymentId U`; `purchaseType`; enum `status=PENDING`; `finalAmount Decimal(12,2)`; `currency`; `gatewayType`; plan/duration/device/traffic nullable snapshot; `paymentUrl?`; `isFree=false`; `raw? Json`; `operationId? U`; upstream/local timestamps |
| TelegramAuthState | `id`; unique hashes of state/nonce/verifier; `redirectTo?`; `userId? I`; `expiresAt I`; `consumedAt? I`; timestamps |
| WebSession | `id`; `userId I`; `refreshTokenHash U`; `refreshRotatedAt?`; four nullable encrypted-token/expiry fields; `authMethod=EMAIL`; `assuranceLevel=FULL I`; `userAgent?`; `ipHash?`; access/refresh expiries I; `revokedAt? I`; timestamps |
| WebRefreshToken | `id`; `sessionId`; `tokenHash U`; `successorTokenEncrypted`; `graceExpiresAt I`; `consumedAt`; `createdAt` |
| PaymentOperation | `id`; `userId`; `kind`; `idempotencyKeyHash`; `upstreamOwnerHash?`; `requestFingerprint`; `requestPayload Json`; `upstreamKey U`; status/claim/lease/dispatch/outcome/completion; response/error snapshots; reconciliation counters/claim/lease/schedule/error/reconciled; timestamps; unique `(userId,idempotencyKeyHash)` |
| PaymentHistorySyncState | `userId PK`; `upstreamOwnerHash`; `cursor?`; `generation=0`; attempt/failure counters; claim/lease/next/last/synced/backfill timestamps; `errorSnapshot?`; timestamps |
| WebAuthnCredential | `id`; `userId I`; `credentialId U`; `publicKey Bytes`; `counter BigInt=0`; `transports String[]`; authenticator metadata; `name?`; usage/timestamps |
| WebAuthnChallenge | `id`; `challenge U`; `type I`; `userId? I`; `expiresAt I`; `consumedAt? I`; `createdAt` |
| EmailVerificationCode | `id`; `userId I`; `codeHash`; `attempts=0`; `maxAttempts=5`; `sentAt I`; `expiresAt I`; `consumedAt? I`; timestamps |
| AuditLog | `id`; `userId? I`; `action I`; `severity=INFO`; `ipHash?`; `metadata? Json`; `createdAt I` |
| RateLimitEvent | `id`; `key`; `action`; `occurredAt`; `metadata?`; compound index `(key,action,occurredAt)` |
| AppSetting | `key PK`; `value Json`; `updatedAt` |
| IntegrationStatus | `id`; `service U`; `status=UNKNOWN`; `message?`; `checkedAt`; `updatedAt` |
