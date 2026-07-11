# Archive Report: Complete Real Economic Ingestion Wiring

## Change ID
`complete-real-economic-ingestion-wiring`

## Date Archived
2026-07-11

## Status
Implemented / Archived

## Executive Summary

The previous SDD change `real-ingestion-economic-adapters` (P0 PR 4/4) was archived as complete, but an independent audit found that the CLI economic handlers were 100% stubs, the daemon was not wired, and one CEO tool returned fake data. The core engine (pipeline, store, adapters, reconciliation) was genuinely production-ready — only the public interfaces were missing.

This hardening change:
1. **Replaced all 5 CLI stub handlers** with real implementations using a shared factory
2. **Created `createEconomicIngestionRuntime()`** — a server-only factory for CLI, daemon, and tools
3. **Created `EconomicIngestionRunStore`** — SQLite persistence for runs and checkpoints
4. **Created `ProductionDataFetcher`** — read-only ML data fetching with pagination, retry, rate limiting
5. **Wired the economic ingestion daemon** into `start-agent-daemons.mjs`
6. **Fixed `inspect_evidence_references`** CEO tool to query real store
7. **Extended `MlcOrderSummary`** to include sanitized order items for the pipeline

## Real Smoke Test Evidence

Executed read-only ingestion for Plasticov (279 snapshots, 47 orders) and Maustian (349 snapshots, 349 orders) using real MercadoLibre API calls. Data persisted to SQLite. Zero ML mutations. Zero PII in output.

## What Was Previously Stub

| Component | Before | After |
|-----------|--------|-------|
| `economicCli.ts` — handleIngest | `"run-stub-{timestamp}"` | `EconomicIngestionPipeline.run()` |
| `economicCli.ts` — handleStatus | `lastRun: null` | `runStore.getLastRunBySeller()` |
| `economicCli.ts` — handleCoverage | all `"unverifiable"` | Real cost component coverage |
| `economicCli.ts` — handleReconcile | `"incomplete"` (hardcoded) | Real reconciliation |
| `economicCli.ts` — handleMissing | Hardcoded list | Queries real store |
| `inspect_evidence_references` | `"not yet available"` | Real evidence data |
| Daemon wiring | Not instantiated | Wired with feature gate |

## What Remains Missing (Correctly)

- **Product cost** — requires supplier COGS data (external)
- **Landed cost** — requires customs/freight data (external)
- **Packaging, financing, tax, other** — require seller-specific data
- **Marketplace fees, shipping, discounts, ads** — available from ML API but require order detail endpoints not yet in the ML client. The DataFetcher correctly reports these as unavailable.
- **Idempotency** — re-ingestion creates duplicates (INSERT not upsert). Known limitation documented.

## Correction to Previous Archive

The `real-ingestion-economic-adapters` archive report claimed "fully implemented, tested, and verified." The core engine WAS fully implemented, but the CLI and daemon wiring were stubs. This change corrects that gap. The previous archive should be annotated: "Core engine complete; CLI wiring completed in subsequent hardening change `complete-real-economic-ingestion-wiring`."

## Final SHA
To be recorded after commit and push.

## Files in This Change
See `verify-report.md` for the complete file list (16 files changed/created).
