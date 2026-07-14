# Fetch, Backlog, and Fence Policy

`aborted` is only a global signal (user/shutdown, lease loss, deadline, explicit cancel). It cancels all work, advances no pending checkpoint, releases owned leases, and returns nonzero. It MUST release any owned backlog row to `pending`; it MUST NOT write `cancelled`. A Claims-local failure completes partial: Orders may advance, Claims does not, and an idempotent backlog row is written.

## Backlog

`economic_source_retry_backlog` has `backlog_identity_key TEXT NOT NULL UNIQUE`, seller/source (`claims`), normalized range/cursor, purpose, failure reason, state, attempt count, due/lease fields, run references, and timestamps. The key is SHA-256 of a length-prefixed canonical tuple `(sellerId, "claims", normalizedRange, normalizedCursor, "claims-recovery")`; normalized cursor has explicit null markers and fixed field order. It contains no buyer/order payload, raw JSON, credentials, or order-variant representation.

Allowed states are exactly `pending`, `leased`, `retrying`, `resolved`, `dead-letter`, and `administratively-cancelled`. Scheduler transitions: `pending→leased→retrying→pending|resolved|dead-letter`; expired `leased|retrying` is recovered to `pending` without incrementing attempts. Increment `attempt_count` exactly when the provider request starts, never on lease, renewal, expiry, abort before start, or release. Dead letters retain history and require an audited replay to `pending`. Administrative cancellation requires approver, reason, actor/time audit record, and mandatory alert; it is never produced by global abort.

Every scheduler read/write is seller/source/fence scoped. Seller lease default is TTL 60s, renew every 20s, and recover expired rows every 15s; backlog claim default is TTL 120s, renew every 40s, and recover at most 100 expired rows every 30s. Acquire/renew/release MUST CAS owner, token digest, and generation; zero affected rows are classified `stale-or-replaced` and MUST NOT delete another lease. Recovery is bounded to three unsuccessful reclaim attempts per sweep before deferral.

## Fetch and health

`SourceResult` contains only bounded status/reason, timestamps, attempts/pages/records, retryability/retry-after, and validated cursor. Health remains the sole readiness truth. Every final writer validates the fence before admission, lease acquire/renew, backlog mutation, and precommit; this coordination does not increment `write_epoch`.
