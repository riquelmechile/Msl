# Cumulative Metrics Policy

`runMetrics` describe this invocation only: fetched/normalized, created and ignored evidence/components/snapshots, partial/disputed snapshots, elapsed time, and reconciliation. They are finalized before write and persisted in the durable run result.

`cumulativeMetrics` are seller-scoped SQLite aggregates read after a successful commit from the same database handle. They never fall back to current-run counts. If any aggregate query fails, return `{ status: "unavailable", reason: "aggregate-query-failed" }`; preserve successful run metrics and do not fabricate totals. CLI/log output distinguishes the two objects.
