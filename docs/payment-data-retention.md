# Payment data retention

Clean Pay keeps the minimum ledger fields required to explain a payment
(`paymentId`, status, amount, currency, plan and timestamps) but does not keep
provider redirect material and diagnostic snapshots indefinitely.

## Automated policy

- After `PAYMENT_SENSITIVE_RETENTION_DAYS` (default 30), a terminal
  `PaymentRecord` (`COMPLETED`, `FAILED`, `CANCELED`, or `REFUNDED`) has
  `paymentUrl` removed and `raw` replaced by a fixed scrub marker. Age is
  measured from `terminalObservedAt`, the first local terminal observation;
  provider timestamps and routine history syncs cannot extend the window.
- After `PAYMENT_OPERATION_SNAPSHOT_RETENTION_DAYS` (default 90), a terminal
  `PaymentOperation` (`SUCCEEDED` or `FAILED_FINAL`) has request and diagnostic
  snapshots replaced by a fixed marker. A minimal tombstone retains only the
  non-sensitive success fields (with `payment_url: null`) or failure code/status
  needed for deterministic idempotency replay; free-form error text is removed.
- `PENDING`, `UNKNOWN`, `READY`, `DISPATCHING`, and `OUTCOME_UNKNOWN` data is
  unresolved and is not scrubbed. A terminal payment linked to an unresolved
  operation is also preserved.
- A non-null `retentionHoldAt` together with `retentionHoldId` is an explicit
  legal/investigation hold and excludes the whole linked payment case from
  automatic scrubbing. The pointer/timestamp pair is protected by check,
  foreign-key, partial-unique, and deferred bidirectional constraints;
  placement updates both currently linked rows in one serializable
  transaction. A hold cannot be reassigned, skip release, or be resurrected
  after disposal. Reverse `RESTRICT` references also prevent direct
  deletion or user-cascade deletion of held evidence until disposition. A new
  operation/record link is rejected at both service and database boundaries if
  either previously independent row has an ACTIVE hold or RELEASED evidence
  awaiting disposition. An existing linked case also cannot be unlinked or
  pointed at a different operation while either row has ACTIVE/RELEASED
  evidence; after explicit disposition the relation may change normally.
  Account merge transfers the hold case owner in the same transaction. A
  pointer or timestamp without its
  matching half fails closed instead of being repaired heuristically.
- The database binds the stored selector kind/value to the matching operation
  or record case identifier. Trigger lookups resolve every related table from
  the trigger table's own schema rather than trusting a runtime `search_path`,
  so the invariant also holds for a non-`public` Prisma schema. `ACTIVE` and
  `RELEASED` lifecycle rows cannot be deleted; only a successfully scrubbed
  `DISPOSED` tombstone is eligible for the bounded cleanup policy.
- `sensitiveDataScrubbedAt` and `snapshotScrubbedAt` make cleanup idempotent
  and provide metadata-only evidence without retaining the removed value.
- `sensitiveDataScrubbedAt` is also a privacy tombstone. Later provider syncs
  may advance terminal status and ledger metadata, but must not restore
  `paymentUrl` or `raw`. Sync compare-and-set predicates include the tombstone,
  so a cleanup racing an older sync wins without a rehydration window.

The retention worker reports only aggregate scrub counts. It must never log
payment URLs, snapshots, exact payment IDs, or exact operation IDs.
Each payment table and disposed-hold tombstone set is processed in at most
500-row statements. A full batch sets a backlog flag and the worker continues
after one second instead of its normal interval, so large backlogs drain
without an unbounded transaction.

The retention database role has no direct table, column, or application-enum
privileges. It can execute only four reviewed `SECURITY DEFINER` functions
owned by the non-login migration role. Those functions use a fixed
`pg_catalog` plus application-schema search path, a server UTC clock, a private
single-row policy table, fixed 500-row batches, and hard-coded predicates; the
worker cannot supply a cutoff, timestamp, row identifier, or arbitrary SQL.
The provision service validates the eight bounded retention settings and
atomically synchronizes that private policy row while runtimes are fenced.
Deployment must complete database-role `sync` and `verify` before the worker is
started; missing policy, unexpected function source/ACL, or any direct runtime
grant fails closed.

The hold command accepts a bounded JSON request on standard input so exact case
identifiers do not appear in process arguments or deployment logs. First
confirm that the guarded deployment completed database-role `sync` and `verify`
for the running privilege manifest. Then run the dedicated one-shot operator
service; it receives only the hold-operator URL remapped to `DATABASE_URL` and
never receives the migration-owner credential:

```sh
docker compose --profile operations run --rm -T --no-deps retention-hold \
  < ./hold-request.json
```

A placement request has `action: "hold"`, exactly one of `operationId` or
`paymentRecordId`, `owner`, `reason`, a future ISO `reviewAt`, and a
caller-generated opaque UUIDv4 `holdId`. UUIDv4 is required so the identifier
cannot embed a ticket, customer, or payment identifier. Only its namespaced
SHA-256 digest is stored. Repeating the exact placement is idempotent; reuse of
the UUID with different selector or metadata fails closed.

```json
{
  "action": "hold",
  "holdId": "018f47a2-4b11-4f87-8f8c-22e309a20f1a",
  "operationId": "case-selector-from-secure-source",
  "owner": "legal-operations",
  "reason": "documented external case",
  "reviewAt": "2026-10-01T00:00:00.000Z"
}
```

A release must repeat the same selector kind and exact selector value together
with the same `holdId`, plus `releasedBy` and `reason`. A linked selector is not
interchangeable: a hold placed with `operationId` cannot be released using its
`paymentRecordId`. A wrong identifier, divergent retry, inconsistent pointer,
or another active hold aborts the first serializable release transition without
clearing protection. Once released, an exact retry returns the stored release
timestamp even if a newer hold was placed; that replay is read-only and never
changes the newer hold.

```json
{
  "action": "release",
  "holdId": "018f47a2-4b11-4f87-8f8c-22e309a20f1a",
  "operationId": "case-selector-from-secure-source",
  "releasedBy": "legal-operations",
  "reason": "release approved and verified"
}
```

Release deliberately retains case evidence in the `RELEASED` lifecycle state.
After the case disposition has been approved, a separate `dispose` action with
the same selector and `holdId` is required. It is rejected while this or any
other hold on the case is active. Disposition immediately nulls the plaintext
selector, user/operation/record identifiers, owner, reason, review date, and
release actor/reason. It preserves the opaque hold-ID digest, lifecycle
timestamps, the disposition actor, one fixed disposition code, and selector
evidence protected by an HMAC whose key is the non-stored opaque `holdId`:
`CASE_CLOSED`, `LEGAL_RETENTION_SATISFIED`, or `EVIDENCE_TRANSFERRED`.

```json
{
  "action": "dispose",
  "holdId": "018f47a2-4b11-4f87-8f8c-22e309a20f1a",
  "operationId": "case-selector-from-secure-source",
  "disposedBy": "records-management",
  "disposition": "CASE_CLOSED"
}
```

After that scrub, an exact disposition retry verifies the selector HMAC using
the opaque `holdId`, plus the same actor and disposition code. A database reader
cannot enumerate remaining ledger IDs against that HMAC without the non-stored
UUID, and the retry continues to work after the underlying payment row is
lawfully removed.

Generic audit cleanup does not own active or released case evidence. Only a
scrubbed `DISPOSED` tombstone is eligible for deletion after
`PAYMENT_HOLD_DISPOSED_RETENTION_DAYS` (default 365, bounded to 90-2555 days).
The lifecycle migration also refuses to proceed if it finds an old
timestamp-only hold: an operator must resolve that ambiguous state before the
new contract can be enabled.

The input file is an operator secret: mode `0600`, no shell-history copy, and
secure deletion after the lifecycle state has been verified with a
least-privilege database query.

## Export, erasure, holds, and backups

Exports should use the ledger fields and public cabinet serializer; provider
snapshots are diagnostic data, not part of the customer export contract.
Erasure requests do not override a documented financial/legal hold, but they
do apply to redundant provider material on the schedule above. Active holds
need an owner, reason, review date, and regular review; released evidence must
receive an explicit disposition instead of being retained indefinitely.

Backups age out on their own encrypted backup-retention schedule. Scrubbing the
live database does not rewrite an existing immutable backup; restored backups
must run migrations and retention cleanup before application traffic is
enabled. Backup access and destruction evidence remain an operator control.

## Provider contract gate

Before onboarding or changing a payment provider, staging contract evidence
must classify every path/query/fragment component of its redirect URL. If any
component is a reusable bearer credential, do not persist it as a normal URL:
exchange it for a short-lived opaque reference or encrypt it under a dedicated
rotatable key, and shorten the 30-day default accordingly.

Regression coverage lives in
`tests/integration/services/payment-retention-postgres.test.ts`; it inserts a
synthetic marker into terminal, unresolved, and held records, runs the real
cleanup twice, attempts a provider re-sync after scrubbing, and verifies
status/hold isolation, non-rehydration, plus idempotence.
