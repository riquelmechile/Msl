# Proposal: Complete Real Economic Ingestion Wiring

## Change ID
`complete-real-economic-ingestion-wiring`

## Status
Proposed → In Progress

## Type
Hardening / Bugfix

---

## Problem Statement

The previous SDD change `real-ingestion-economic-adapters` (P0 PR 4/4) was archived as complete, but an independent audit revealed that while the **core engine** (EconomicIngestionPipeline, EconomicOutcomeStore, EconomicReconciliationService, adapters) is genuinely production-ready, the **public interfaces** remain stubs:

1. **economicCli.ts** — All 5 command handlers (`ingest`, `status`, `coverage`, `reconcile`, `missing`) return hardcoded fake data. The message `"Real implementation requires EconomicOutcomeStore and DataFetcher"` appears in the ingest handler.
2. **economicIngestionDaemon** — The daemon code exists and is real, but `start-agent-daemons.mjs` never imports or instantiates it. Setting `MSL_ECONOMIC_INGESTION_ENABLED=true` has no effect.
3. **inspect_evidence_references** CEO tool — Returns stub message despite real evidence references being created by the pipeline.

## What This Change Does

- Replace all CLI stub handlers with real implementations that use the existing `EconomicOutcomeStore`, `EconomicIngestionPipeline`, and ML `DataFetcher`.
- Wire the economic ingestion daemon into the production daemon scheduler.
- Connect the `inspect_evidence_references` CEO tool to real evidence data.
- Implement `EconomicIngestionRun` persistence (runs, checkpoints) using the existing migration framework.
- Run a limited real smoke test (read-only) for Plasticov and Maustian.
- Verify idempotency, checkpoint correctness, and PII safety.

## What This Change Does NOT Do

- Does NOT invent product cost or landed cost data. Those adapters remain correctly declared as `missingInput`.
- Does NOT perform any MercadoLibre write operations.
- Does NOT change the core pipeline, adapters, or store logic (they are already correct).
- Does NOT process all 2,800+ historical orders — only a limited smoke test.

## P0 Status After Completion

| Before | After |
|--------|-------|
| P0 PR 4/4: Partial / Stubs in CLI | P0 PR 4/4: Complete (with honest partials) |
| P0 global: Partial | P0 Foundation: Complete |

`productCost` and `landedCost` remain `missingInput`. Snapshots will be `partial` until those external data sources are available. The honest default is correct.

## Scope

- **packages/agent/src/cli/economicCli.ts** — Complete rewrite of handlers
- **packages/agent/src/economics/** — Add factory, run store, checkpoint persistence
- **packages/memory/src/** — EconomicIngestionRunStore
- **packages/agent/src/conversation/tools/economicTools.ts** — Fix inspect_evidence_references
- **scripts/start-agent-daemons.mjs** — Wire economic ingestion daemon
- **packages/agent/src/workers/economicIngestionDaemon.ts** — Ensure uses real factory
- **Documentation** — ROADMAP, README, ARCHITECTURE, operations docs
- **Tests** — Rewrite CLI tests to use real injected fakes

## Risks

| Risk | Mitigation |
|------|-----------|
| CLI wiring breaks existing pipeline | Existing pipeline tests pass; CLI becomes thin wrapper |
| Real ML calls fail in smoke test | Dry-run first, limited scope, read-only |
| Checkpoint/lock bugs | Use existing migration framework, test idempotency |
| PII leak in new persistence | Sanitization in normalization layer already exists |

## Dependencies

- Requires: EconomicOutcomeStore (exists ✅), EconomicIngestionPipeline (exists ✅), ML DataFetcher (exists ✅), OAuth dual-account (exists ✅)
- Blocks: Product Launch Intelligence (requires complete P0)
