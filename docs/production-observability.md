# Production observability contract

Application metric labels are an enumerated interface. Unknown event, scope,
service, or operation values collapse to `other`; operational-event maps are
hard-capped at 64 series and upstream maps at 128 series, with a reserved
overflow series. Adding a new label requires an allowlist change and a bounded
cardinality test.

Counters are process-local and reset whenever a replica restarts. Scrape every
replica separately and aggregate counters with restart-aware `rate()` or
`increase()` queries; never interpret one instance as a durable global total.
Backlog values are live database gauges and may be aggregated with `max` rather
than summed across replicas.

Normal reconciliation logs contain only the manual-review count and 16-hex
HMAC support handles. Exact operation IDs stay in the authenticated operator
workflow. The deployment logger also redacts identifier-shaped metadata and
legacy `*_ids=` message fragments as defense in depth.

The deployment monitoring contour must retain evidence that it scrapes every
replica and delivers alerts for:

- degraded readiness and PostgreSQL connection/lock pressure;
- authentication rate-limit/concurrency abuse and refresh-token reuse;
- manual reconciliation backlog and oldest unresolved age;
- reconciliation and retention worker heartbeat failure;
- upstream unavailability/error-rate and latency growth.

Repository tests prove label bounds and output semantics. Scrape discovery,
dashboard ownership, alert routing, delivery tests, and runbook links are
external infrastructure controls and must be attached to release evidence.
