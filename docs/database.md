# Web cabinet database

The web cabinet uses its own PostgreSQL database through Prisma.

This database stores supporting web-cabinet data only. Remnashop remains the source of truth for tariffs, subscriptions, payments, devices, and VPN access.

## Tables

### WebUser

Local link between the web cabinet and a Remnashop user.

- `remnashopUserId` - external Remnashop user id.
- `email` - user e-mail.
- `telegramId` - optional Telegram id; login may use e-mail or Telegram id.
- `emailVerified` - local display/control flag synced through the web flow.
- `displayName` - optional display name.

### WebSession

Web session controlled by Clean Pay.

- Access session lifetime: 15 minutes.
- Refresh session lifetime: 30 days.
- Refresh tokens are stored only as hashes.
- Sessions can be revoked.

### EmailVerificationCode

Verification code state for e-mail confirmation sent by the web cabinet.

- Code TTL: 15 minutes.
- Max attempts: 5.
- Stores `sentAt`, `expiresAt`, attempt count, and optional `consumedAt`.
- Stores `codeHash`, not the plain code.

### AuditLog

Audit events for auth and sensitive flows.

Initial events should include registration, login, logout, code request, code confirmation, payment creation, extension attempt, and device deletion.

### RateLimitEvent

Raw event records for rate limiting sensitive actions.

### AppSetting

Small service settings that are safe to keep in the web-cabinet database.

### IntegrationStatus

Health/status records for dependencies such as Remnashop, SMTP, and the local database.
