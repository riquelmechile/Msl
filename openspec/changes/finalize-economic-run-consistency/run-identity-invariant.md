# Run Identity Invariant

`finalizeEconomicIngestionRun(existingRun, result)` MUST be pure: it validates/transitions fields and returns a new immutable aggregate with `runId === existingRun.runId`. It MUST NOT call `RunIdFactory`, write storage, fetch data, or change failure identity.

Creation generates an ID once, attempts `createRun` before external reads, and retries only primary-key collisions up to three generated candidates. Exhaustion fails closed before reads. Any later error returns/persists the same created ID when durable storage is reachable; it never substitutes `failed-run` or a newly generated ID.

The transaction persists exactly the finalizer result. `runFromRow` maps the same durable field names, including checkpoint, counts, reconciliation, sanitized errors, and completion time.
