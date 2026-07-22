# Матрица данных

| ID | Физическая модель | Логическая спецификация | Владельцы | Статус |
|---|---|---|---|---|
| DATA-001 | WebUser | domain entities/ownership | identity + payment fence | описан |
| DATA-002 | AccountMergeConfirmation | states/lifecycles | identity | описан |
| DATA-003 | PaymentRecord | payment domain/data fields | payments | описан |
| DATA-004 | TelegramAuthState | identity lifecycle | identity | описан |
| DATA-005 | WebSession | session lifecycle | identity | описан |
| DATA-006 | WebRefreshToken | session lifecycle | identity | описан |
| DATA-007 | PaymentOperation | payment states | payments | описан |
| DATA-008 | PaymentHistorySyncState | payment history | payments | описан |
| DATA-009 | WebAuthnCredential | identity domain | identity | описан |
| DATA-010 | WebAuthnChallenge | identity lifecycle | identity | описан |
| DATA-011 | EmailVerificationCode | identity lifecycle | identity retention; dormant local issuance | описан |
| DATA-012 | AuditLog | operations/observability | platform/all modules | описан |
| DATA-013 | RateLimitEvent | anti-abuse/retention | platform/identity/payments | описан |
| DATA-014 | AppSetting | dormant physical table | platform physical compatibility | описан |
| DATA-015 | IntegrationStatus | dormant physical table | platform physical compatibility | описан |

Все 9 перечислений, поля, значения по умолчанию, допустимость `null`, уникальности, внешние ключи, индексы и 15 миграций описаны в `06-data/field-catalog.md`, `indexes.md`, `migrations.md`; доказательства исходной схемы и SQL находятся в этом разделе трассируемости.
