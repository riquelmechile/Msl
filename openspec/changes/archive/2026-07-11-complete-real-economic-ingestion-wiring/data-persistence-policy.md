# Data Persistence Policy: Economic Ingestion

## What IS Persisted

| Data | Store | Retention | Sanitization |
|------|-------|-----------|--------------|
| EconomicIngestionRun (id, seller, status, timestamps) | SQLite | Indefinite | Errors sanitized (no stack traces with secrets) |
| Checkpoint (last order date/id) | SQLite | Indefinite | No PII |
| EconomicCostComponent (type, amount, currency, confidence) | SQLite | Indefinite | Monetary only |
| UnitEconomicsSnapshot (revenue, costs, profit, missing inputs) | SQLite | Indefinite | Aggregated economic data |
| EconomicEvidenceReference (source record type/id, verification) | SQLite | Indefinite | Reference IDs only, no payloads |
| Structured logs | Log files | Rotating (30 days) | Sanitized by existing pipeline |
| Metrics | In-memory | Session only | N/A |

## What is NOT Persisted

| Data | Reason |
|------|--------|
| Raw ML API responses | PII risk, payload bloat |
| Buyer names, emails, phones, addresses | PII |
| Buyer document numbers | PII |
| Access tokens, refresh tokens | Security (encrypted in separate OAuth DB) |
| Client secrets | Security |
| Full order details (items, quantities, buyer notes) | PII + unnecessary |
| Payment instrument details | PCI scope |
| Shipping addresses | PII |
| ML API URLs with signed parameters | Security |

## Database Location

- Economic DB: configured via `MSL_ECONOMIC_DB_PATH` env var
- OAuth DB: configured via `MSL_OAUTH_DB_PATH` env var
- Both OUTSIDE the repository
- Both in `.gitignore`

## Migration Policy

- All schema changes use the existing migration framework (PR 2/4)
- New tables: `economic_ingestion_runs`, `economic_ingestion_checkpoints`
- Existing tables: `economic_cost_components`, `unit_economics_snapshots`, `economic_evidence_references` (unchanged)
- Forward-only migrations, no rollback in production
