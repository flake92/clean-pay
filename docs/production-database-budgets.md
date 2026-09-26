# Production PostgreSQL budgets

Clean Pay pins `pg` directly, owns one exported `pg.Pool` per runtime role, and
passes that pool to `PrismaPg`. Prisma URL parameters from other engine paths
are rejected instead of being silently accepted. The supported `schema` URL
option is passed explicitly to `PrismaPg`, because an external `pg.Pool` cannot
carry that Prisma query-schema setting. Prisma disposes each external pool on
`$disconnect()`, so graceful client shutdown also releases connections.
Role defaults are:

| Role | Pool max | Acquire/connect | Query / statement | Lock | Idle transaction | Application name |
|---|---:|---:|---:|---:|---:|---|
| application | 8 | 5 s | 15 s / 15 s | 5 s | 10 s | `clean-pay-app` |
| readiness | 1 | 4 s | 4 s / 4 s | 4 s | 4 s | `clean-pay-readiness` |
| retention | 2 | 5 s | 120 s / 120 s | 30 s | 15 s | `clean-pay-retention` |

The application values use `DATABASE_*`; retention uses
`RETENTION_DATABASE_*`. Numeric values are bounded by the production validator.
Payment workflows that legitimately need a longer transaction already pass an
explicit Prisma transaction timeout; this does not disable PostgreSQL's lock
or statement boundary for unrelated queries.

For `R` application replicas, the maximum steady Clean Pay budget is
`R × (8 app + 1 readiness) + 2 retention`. Migration runs before application
startup and must be budgeted separately during operator actions. Keep a
database administration/emergency reserve outside this total.

The authenticated `/api/internal/metrics` endpoint reads only documented pool
counters and exports active/idle connections, queued callers, configured max,
and an exhausted gauge for the application and isolated readiness pools. Role
labels are fixed, not caller-controlled. The separate retention process emits
the same bounded aggregate counters in every completion/failure log record.
No query text, connection string, or identifier is included.

Alert when `clean_pay_database_pool_waiting` stays above zero or
`clean_pay_database_pool_exhausted` stays at one; scrape every application
replica. Database monitoring must additionally group `pg_stat_activity` by
`application_name`: it is the aggregate authority across replicas and the
separate retention container, and should alert before the reviewed database
ceiling is reached.

`tests/integration/services/database-pool-faults-postgres.test.ts`, included in
`test:services`, verifies effective server settings, slow-query and lock-wait
deadlines, saturation/acquisition timeout, telemetry transitions, and automatic
recovery against `REAL_DATABASE_URL`. Constructor and validator regressions are
covered by `tests/unit/config/production-database-pool.test.ts`.

A silent packet blackhole requires network-namespace/firewall control outside
the repository test process. The deployment fault job must still blackhole an
otherwise valid database target and verify the 5-second connect/acquire budget,
readiness isolation, recovery, aggregate `pg_stat_activity` ceiling, and alert
delivery. This is deployment evidence, not an application configuration gap.
