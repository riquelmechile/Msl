# Proposal: Finalize Economic Run Consistency

## Intent

Finish P0 economic-ingestion consistency with truthful durable outcomes, source-specific resume, and seller-safe concurrency. P0 remains Partial until offline gates and later read-only smoke evidence pass.

## Scope

Orders are mandatory. Claims are economically material but non-blocking to the Orders cursor: Claims-local timeout/rate/transient/exhausted retry completes a partial run with explicit source gap, partial coverage, refund reconciliation unavailable/incomplete, no verified complete net profit, degraded readiness, normal warning exit 0, strict exit 1, unchanged Claims checkpoint, and durable retry backlog. Only the global AbortSignal (user/shutdown/lease lost/global deadline/explicit cancel) creates `aborted`, cancels every source, advances no pending checkpoint, and exits non-zero. Orders success plus Claims success advances independent eligible checkpoints; Claims success-empty confirms zero and advances Claims.

The work adds typed fetch outcomes, one bounded cancellable deadline, source checkpoint CAS, sole-truth source health, seller leases, deterministic durable Claims backlog, exclusive database fencing, epoch-fenced restore, alerts/SLOs, and registry-owned migrations after the verified source baseline 1006. Implemented 1010 is limited to R4b cancellation intents; R5 owns 1011 write-admission receipts, while R7 reserves 1012 delivery/SLO and 1013 restore state. R2 retains its later run-failure migration.

## In Scope

- Durable source results, health, checkpoints, retry history, reconciliation, and CLI/daemon propagation.
- Seller/source CAS and owner/token/expiry seller leases.
- Exact row-preserving Registry migrations 1007–1011 with fresh, upgrade, ambiguity, rerun, checksum, and temporary-DB proof; future R7 1012/1013 restore-fence/delivery proof and R2 run-failure migration proof remain owned by their remediation tasks.
- Offline R1–R8 RED-to-green evidence. The temporary `dataFetcher.ts` marker is removed only by R7 implementation.

## Out of Scope

- Real MercadoLibre mutation, live calls, daemon operation, Product Launch Intelligence, migration execution, or smoke during this planning work.

## Risks and Success Criteria

Provider failure must never become empty data; stale writers must never regress cursors; a run must never release another run’s lease. Success requires every R1–R8 test/gate, verified backup, clean tree, inactive daemon, two read-ready sellers, and later externally read-only one-page/five-order repeat smoke with no duplicates or checkpoint regression.
