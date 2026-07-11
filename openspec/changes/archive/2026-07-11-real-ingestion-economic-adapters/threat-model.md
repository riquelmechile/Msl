# Threat Model — Security Threats & Mitigations

## Architecture Context

The economic ingestion pipeline is a **read-only pipeline**. It reads from MercadoLibre API and writes structured economic data to a local SQLite database. It has zero write capability to MercadoLibre — `assertMercadoLibreWriteDisabled()` blocks all mutations.

```
ML API (external, read-only) ──→ Pipeline ──→ SQLite (local)
                              OAuth tokens    Seller-isolated
                              (encrypted)     (column-scoped)
```

## Threat: Unauthorized Data Access

**Vector**: An attacker gains access to the SQLite database containing economic data.

**Impact**: Exposure of seller revenue, costs, margins, and unit economics.

**Mitigations**:
- Database is local (SQLite file on VPS filesystem) — not network-exposed
- VPS-level access controls (SSH keys, firewall)
- No buyer PII stored (stripped during normalization)
- Seller data is column-scoped — all queries filter by `sellerId`
- Database encryption available via filesystem-level encryption (VPS config)

## Threat: PII Leakage from ML API

**Vector**: The pipeline accidentally stores buyer PII from ML order data.

**Impact**: Privacy violation, potential GDPR/Chilean data protection law exposure.

**Mitigations**:
- Normalization (`normalization.ts`) explicitly strips all PII fields
- Buyer name, email, phone, address, payment details: never enter the pipeline
- `NormalizedCommerceTransaction` type has no PII fields — enforced by TypeScript
- Evidence references use SHA-256 hashes, not raw data
- Log sanitization via `sanitizeContext()` in observability pipeline

## Threat: Data Tampering

**Vector**: An attacker modifies cost components or snapshots in the database.

**Impact**: Corrupted financial data leading to wrong business decisions.

**Mitigations**:
- VPS access control (SSH only)
- SQLite WAL mode with `busy_timeout = 5000` — concurrent writes are serialized
- Cost components are never hard-deleted (soft-delete via `reversedAt`)
- Superseded rows are preserved (version history)
- Snapshots are immutable (insert-only, never updated)
- Reconciliation detects discrepancies between store and snapshots
- Database integrity checks via `PRAGMA integrity_check`

## Threat: OAuth Token Exposure

**Vector**: ML OAuth tokens leak through logs, error messages, or database dumps.

**Impact**: Attacker can read seller ML data or (if write-enabled) mutate listings.

**Mitigations**:
- Tokens never enter the economic pipeline — resolved at the ML client layer
- Tokens encrypted with AES-256-GCM key derived from `MSL_ENCRYPTION_KEY`
- Log sanitization strips tokens from all output via `sanitizeContext()`
- The pipeline receives a pre-configured `MlcApiClient`, not raw tokens
- Write operations are blocked by `assertMercadoLibreWriteDisabled()`

## Threat: Rate Limit Abuse

**Vector**: Excessive or aggressive ingestion triggers ML API rate limits.

**Impact**: Temporary loss of ML API access for all services (bot, MCP, daemons).

**Mitigations**:
- `--max-pages` CLI flag limits fetch scope
- Checkpoint-based pagination prevents re-fetching already-processed data
- Daemon uses small page limits for incremental runs
- No parallel seller ingestion — sequential processing
- Backfill plan recommends spreading across hours/days

## Threat: Cross-Seller Data Leakage

**Vector**: A query or tool returns another seller's economic data.

**Impact**: Confidential financial data exposed to wrong seller context.

**Mitigations**:
- All store methods require `sellerId` parameter
- SQL queries use parameterized `WHERE seller_id = ?` clauses
- Agent tools validate `sellerId` before any store call
- Finance Director tools enforce seller isolation on every query
- Tool tests include explicit seller isolation tests (e.g., "Plasticov cannot see Maustian")

## Read-Only Enforcement

The pipeline's read-only nature is enforced at multiple levels:

| Layer | Enforcement |
|-------|-------------|
| ML API client | `assertMercadoLibreWriteDisabled()` blocks all write operations |
| Pipeline | No code path calls any ML write method |
| Adapters | Pure functions — take data, return `EconomicCostComponent[]` |
| Daemon | Feature-gated, proposes to CEO, never auto-executes |
| Agent tools | All tagged `noExternalMutationExecuted: true` |

## Residual Risks

| Risk | Status | Notes |
|------|--------|-------|
| SQLite file accessible to VPS compromise | Accepted | Standard VPS hardening applies |
| Stub adapters return empty (missing real data) | Known | Documented. CEO aware that `product_cost` and `landed_cost` are partial |
| No independent verification of ML data | Accepted | We trust ML API as source of truth for fees, shipping, etc. |
| No audit trail for manual corrections | Future | `reverseCostComponent` captures reason but full change audit is future work |
