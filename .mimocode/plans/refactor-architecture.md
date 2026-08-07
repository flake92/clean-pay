# Full Architecture Refactoring Plan: CORE → Facade → Service

## Current State
- 22 files directly import `prisma` from `@/backend/database/prisma`
- 8 Redis call sites via `redisCommand()`
- 12+ HTTP `fetch()` calls for external APIs
- 5 files bypass `security/crypto.ts` with direct `node:crypto` imports
- Business logic is tightly coupled to infrastructure

## Target Architecture
```
CORE (business logic) → Facade (interface) → Service (implementation)
```

## Phase 1: Create Facade Interfaces (Ports)

### 1.1 UserStore (`src/backend/ports/user-store.ts`)
```typescript
export interface UserStore {
  findById(id: string): Promise<User | null>
  findByEmail(email: string): Promise<User | null>
  findByTelegramId(telegramId: string): Promise<User | null>
  findByRemnashopId(remnashopUserId: string): Promise<User | null>
  findMany(where: UserWhereInput): Promise<User[]>
  create(data: CreateUserInput): Promise<User>
  update(id: string, data: UpdateUserInput): Promise<User>
  upsert(where: UpsertUserWhere, create: CreateUserInput, update: UpdateUserInput): Promise<User>
  merge(sourceId: string, targetId: string, opts: MergeOptions): Promise<void>
  // Locking operations
  lockForUpdate(tx: TransactionClient, ids: string[]): Promise<User[]>
}
```

### 1.2 SessionStore (`src/backend/ports/session-store.ts`)
```typescript
export interface SessionStore {
  findById(id: string): Promise<Session | null>
  findByRefreshToken(hash: string): Promise<SessionWithUser | null>
  create(data: CreateSessionInput): Promise<Session>
  update(id: string, data: UpdateSessionInput): Promise<void>
  updateMany(where: SessionWhereInput, data: UpdateSessionInput): Promise<number>
  revoke(id: string): Promise<void>
  revokeAllForUser(userId: string): Promise<void>
  // Token rotation
  rotateRefreshToken(sessionId: string, newHash: string): Promise<void>
  // Locking
  lockForUpdate(tx: TransactionClient, id: string): Promise<Session | null>
}
```

### 1.3 PaymentStore (`src/backend/ports/payment-store.ts`)
```typescript
export interface PaymentStore {
  // Operations
  findOperation(userId: string, idempotencyKeyHash: string): Promise<PaymentOperation | null>
  findOperationById(id: string): Promise<PaymentOperation | null>
  createOperation(data: CreateOperationInput): Promise<PaymentOperation>
  updateOperation(id: string, data: UpdateOperationInput): Promise<void>
  updateOperations(where: OperationWhereInput, data: UpdateOperationInput): Promise<number>
  claimOperation(tx: TransactionClient, input: ClaimInput): Promise<PaymentOperation | null>
  
  // Records
  findRecord(paymentId: string): Promise<PaymentRecord | null>
  findRecordByOperationId(operationId: string): Promise<PaymentRecord | null>
  findRecords(userId: string, where?: RecordWhereInput): Promise<PaymentRecord[]>
  createRecord(data: CreateRecordInput): Promise<PaymentRecord>
  updateRecord(paymentId: string, data: UpdateRecordInput): Promise<void>
  
  // History sync
  findSyncState(userId: string): Promise<SyncState | null>
  claimSync(tx: TransactionClient, input: ClaimSyncInput): Promise<SyncState | null>
  completeSync(tx: TransactionClient, input: CompleteSyncInput): Promise<void>
  failSync(tx: TransactionClient, input: FailSyncInput): Promise<void>
  
  // Advisory locks
  lockPaymentOwnerFence(tx: TransactionClient, userIds: string[]): Promise<string[]>
  
  // Time
  databaseNow(tx: TransactionClient): Promise<Date>
}
```

### 1.4 CacheStore (`src/backend/ports/cache-store.ts`)
```typescript
export interface CacheStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlSeconds?: number): Promise<void>
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<void>
  ttl(key: string): Promise<number>
  zrem(key: string, member: string): Promise<void>
  eval(script: string, keys: string[], args: string[]): Promise<unknown>
}
```

### 1.5 CryptoService (`src/backend/ports/crypto-service.ts`)
```typescript
export interface CryptoService {
  randomToken(bytes: number): string
  randomUUID(): string
  sha256(value: string): string
  hmacSha256(value: string, secret: string): string
  safeEqual(left: string, right: string): boolean
  encryptSecret(value: string, secret: string): string
  decryptSecret(encrypted: string, secret: string): string
  jsonBase64Url(value: unknown): string
  parseJsonBase64Url<T>(value: string): T
}
```

### 1.6 ExternalGateway (`src/backend/ports/external-gateway.ts`)
```typescript
export interface ExternalGateway {
  // Remnashop
  remnashopAuth(path: string, body: unknown): Promise<AuthResponse>
  remnashopRequest<T>(path: string, opts: RequestOptions): Promise<T>
  remnashopAdminRequest<T>(path: string, opts: RequestOptions): Promise<T>
  getRemnashopMe(accessToken: string): Promise<RemnashopMe>
  remnashopMergeUsers(input: MergeUsersInput): Promise<MergeResult>
  remnashopRefreshTokens(refreshToken: string): Promise<TokenPair>
  remnashopChangePassword(accessToken: string, body: ChangePasswordInput): Promise<void>
  
  // Remnawave
  remnawaveRequest<T>(path: string, opts: RequestOptions): Promise<T>
  
  // Telegram OIDC
  exchangeCodeForIdToken(code: string, codeVerifier: string): Promise<string>
  
  // Turnstile
  verifyTurnstileToken(token: string, action: string): Promise<void>
}
```

### 1.7 AuditLogger (`src/backend/ports/audit-logger.ts`)
```typescript
export interface AuditLogger {
  log(input: AuditLogInput): Promise<void>
}
```

### 1.8 HealthChecker (`src/backend/ports/health-checker.ts`)
```typescript
export interface HealthChecker {
  pingDatabase(): Promise<boolean>
  pingRedis(): Promise<boolean>
  checkRemnashop(): Promise<HealthStatus>
  checkRemnawave(): Promise<HealthStatus>
  checkTelegramOidc(): Promise<HealthStatus>
}
```

## Phase 2: Create Service Implementations

### 2.1 PrismaUserStore (`src/backend/services/prisma-user-store.ts`)
- Implements `UserStore`
- Contains ALL `prisma.webUser.*` calls
- Handles domain model transformation

### 2.2 PrismaSessionStore (`src/backend/services/prisma-session-store.ts`)
- Implements `SessionStore`
- Contains ALL `prisma.webSession.*` and `prisma.webRefreshToken.*` calls

### 2.3 PrismaPaymentStore (`src/backend/services/prisma-payment-store.ts`)
- Implements `PaymentStore`
- Contains ALL `prisma.paymentOperation.*`, `prisma.paymentRecord.*`, `prisma.paymentHistorySyncState.*` calls
- Contains all raw SQL queries for claiming/locking

### 2.4 RedisCacheStore (`src/backend/services/redis-cache-store.ts`)
- Implements `CacheStore`
- Wraps `redisCommand()` calls

### 2.5 NodeCryptoService (`src/backend/services/node-crypto-service.ts`)
- Implements `CryptoService`
- Wraps all `node:crypto` calls
- Consolidates duplicated `signTelegramAuthPayload`

### 2.6 HttpExternalGateway (`src/backend/services/http-external-gateway.ts`)
- Implements `ExternalGateway`
- Contains all `fetch()` calls to Remnashop, Remnawave, Telegram, Turnstile

### 2.7 PrismaAuditLogger (`src/backend/services/prisma-audit-logger.ts`)
- Implements `AuditLogger`
- Contains `prisma.auditLog.create` calls

### 2.8 PrismaHealthChecker (`src/backend/services/prisma-health-checker.ts`)
- Implements `HealthChecker`
- Contains health check logic

## Phase 3: Register Services as Dependency Injection

Create a service registry (`src/backend/services/registry.ts`) that provides all services to the application layer.

## Phase 4: Refactor Application Layer

### Priority order (by impact):
1. `src/backend/auth/telegram-account-merge.ts` - 5 files depend on it
2. `src/backend/sessions/web-session.ts` - used everywhere
3. `src/backend/payments/idempotency.ts` - critical payment path
4. `src/backend/payments/reconciliation.ts` - background worker
5. `src/backend/payments/history-sync.ts` - background worker
6. `src/backend/payments/records.ts` - used by payment commands
7. `src/backend/auth/email-verification.ts` - auth flow
8. `src/backend/auth/passkeys.ts` - auth flow
9. `src/backend/integrations/remnashop/session.ts` - integration layer
10. `src/backend/limits/rate-limit.ts` - rate limiting
11. `src/backend/observability/audit.ts` - logging
12. All other files

### For each file:
1. Replace `import { prisma }` with service injection
2. Replace `prisma.webUser.*` with `userStore.*`
3. Replace `prisma.webSession.*` with `sessionStore.*`
4. Replace `prisma.paymentOperation.*` with `paymentStore.*`
5. Replace `redisCommand()` with `cacheStore.*`
6. Replace direct `node:crypto` with `cryptoService.*`
7. Replace `fetch()` with `externalGateway.*`
8. Replace `prisma.auditLog.create` with `auditLogger.log`
9. Keep raw SQL queries in PaymentStore (complex locking logic)

## Phase 5: Update Tests

- Update test mocks to mock service interfaces instead of Prisma
- Ensure all 546 tests pass

## Verification

1. `npm run test:unit` - all 546 tests pass
2. `npm run typecheck` - no type errors
3. `npm run build` - builds successfully
4. Deploy to test stand and verify functionality
