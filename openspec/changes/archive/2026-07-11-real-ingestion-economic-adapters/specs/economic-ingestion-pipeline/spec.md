# Economic Ingestion Pipeline Specification

## Purpose

The MercadoLibreEconomicIngestionPipeline daemon orchestrates the end-to-end flow from ML data to persisted UnitEconomicsSnapshot. Read-only, seller-scoped, PII-free, with explicit missing-input reporting.

## Requirements

### Requirement: Pipeline Stages

The pipeline MUST execute 16 stages in order: 1) resolve seller, 2) verify read readiness, 3) acquire seller-scoped lock, 4) recover checkpoint, 5) fetch orders/payments/items/shipments/claims/ads as needed, 6) normalize, 7) strip PII, 8) build evidence references, 9) build revenue and cost components, 10) evaluate missing inputs, 11) create UnitEconomicsSnapshot, 12) persist in transaction, 13) reconcile, 14) update checkpoint, 15) emit metrics/logs, 16) release lock.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Full pipeline run | Seller "plasticov" with 50 recent orders | Pipeline runs | All 16 stages executed, snapshots persisted, checkpoint advanced |
| Stage 5 API failure | ML API returns 429 rate limit | Pipeline at stage 5 | Graceful degradation: bounded retry, backoff, partial run saved |

### Requirement: Operational Controls

The pipeline MUST support: abort signal, limits (max pages, max time), rate limiting, bounded retry with backoff, seller isolation, dry-run, no-persist, resume from checkpoint, deterministic clock/IDs in tests.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Abort mid-run | Pipeline processing page 3 of 10 | `AbortSignal` triggered | Pipeline stops cleanly, lock released, checkpoint unchanged |
| Dry run | `mode: "dry-run"` | Pipeline executes all stages | No persistence to store, metrics emitted, snapshot computed in memory |
| Resume from checkpoint | Checkpoint at page 5, order #250 | Pipeline runs again | Starts from page 6, no duplicate processing |
| Max time exceeded | `maxTimeMs: 30000` | Pipeline exceeds 30s | Graceful stop, partial results saved, checkpoint updated to last completed page |
| Rate limit backoff | 429 response from ML API | Pipeline retries | Exponential backoff: 1s, 2s, 4s, 8s, then fail page |

### Requirement: DeepSeek Exclusion

The pipeline MUST NEVER call DeepSeek or any LLM during execution. It is a deterministic data pipeline.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Pipeline execution | Any valid seller | Entire pipeline run | Zero LLM calls made |

### Requirement: Seller Isolation

All stages MUST scope queries and writes to a single seller. Cross-seller data access SHALL be rejected.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Seller A pipeline | sellerId: "plasticov" | Fetch orders | Only Plasticov orders returned |
| Accidental cross-seller | Code references seller B's data in A's pipeline | Stage execution | Rejected with seller-scope error |
