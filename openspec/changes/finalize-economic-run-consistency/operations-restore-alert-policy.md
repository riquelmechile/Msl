# Operations, Restore, and Alert Policy

## Alert lifecycle

R4b owns only `economic_operational_alert_intents`: administrative Claims cancellation writes one seller-scoped, deterministic, allowlisted-metadata intent with exact type `claims-backlog-administratively-cancelled`, severity `warning`, reason `administratively-cancelled`, source `claims`, related backlog key, cancellation version `1`, and `pending|consumed` status. It does not claim delivery.

R5 owns 1011 database write-admission receipts. R7 reserves 1012 for `economic_operational_alerts`, delivery attempts, dispatcher claims, transport, inbox, acknowledgement/resolution, HTTP/Telegram integrations, backoff, dead-letter, paging, and degraded-delivery SLO state; and 1013 for `restore_operation_journal`. R2 owns a separate later future migration for `run_failure_intent`; neither that table nor R7 state belongs to 1010 or R5's 1011 receipt schema.

## Restore

1. Fence `open→quiescing` with a new generation/token; create `restore_operation_journal=quiescing` by CAS before irreversible work; reject all writer admission and wait for workers, leases, and open DB handles to close.
2. Abort if any handle/new writer remains. Checkpoint and close the live SQLite connection; close WAL/SHM sidecars. Record live epoch and manifest epoch.
3. If live epoch is newer, set `manual-reconcile`; no swap. Otherwise restore to a fresh staging pathname, never reuse live/candidate WAL/SHM sidecars, open staging, and validate integrity, registry, immutable database/tenant/deployment identity, generation, and manifest hash. Plasticov/Maustian or installation mismatch blocks automatic swap.
4. Recheck generation/token, zero handles, and no new writes; CAS-journal `live-renamed` before live→candidate rename and `staging-promoted` before staging→live rename. Reopen a new handle, validate schema/fence/epoch/health, then CAS `completed` and open the fence.
5. Any post-swap validation failure keeps writers blocked, closes new handles, checkpoints/removes generation sidecars, CAS-journals rollback renames, restores the retained candidate, reopens and validates it, then emits a durable alert. Handle, WAL/SHM, rename, reopen, or health failure enters `manual-reconcile` if restoration cannot validate. Startup recovery handles every nonterminal journal state idempotently.

The manifest records identity, registry versions/checksums, epoch, timestamp, digest, integrity result, and safe path identifier. Restore coordination never increments `write_epoch`; restored data keeps its manifest epoch. Subsequent successful final economic writes increment it once.

## Recovery matrix

| Event | Required recovery |
|---|---|
| global abort before request | release backlog to pending; no attempt/CP |
| global abort after request starts | release pending; attempt retained; no CP |
| expired backlog lease | recover pending; no extra attempt |
| dead letter | durable history, alert, approved replay only |
| admin cancellation | audited approval, alert, terminal administrative state |
| CAS missing/exhausted | rollback then independent same-run operational transaction |
| fence/lease mismatch | rollback, global abort, blocked alert |
| alert transport failure | retry/backoff then dead-letter; degraded readiness |
| restore epoch newer/handle/write | manual reconcile or abort; no swap |
| post-swap validation failure | rollback candidate while fenced; blocked alert |
