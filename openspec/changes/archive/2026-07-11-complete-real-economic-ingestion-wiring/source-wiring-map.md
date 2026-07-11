# Source Wiring Map: Economic Ingestion

## Current State (Post-Audit)

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
│  npm run economic:ingest ──→ economicCli.ts ──→ STUB           │
│  npm run economic:status ──→ economicCli.ts ──→ STUB           │
│  npm run economic:coverage → economicCli.ts ──→ STUB           │
│  npm run economic:reconcile → economicCli.ts ──→ STUB          │
│  npm run economic:missing ──→ economicCli.ts ──→ STUB          │
│                                                                 │
│  CEO Tools (7/8 real, 1 stub)                                   │
│  inspect_evidence_references ──→ STUB                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ NOT CONNECTED
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CORE ENGINE (REAL ✅)                         │
│                                                                 │
│  EconomicIngestionPipeline ────→ EconomicOutcomeStore           │
│  EconomicReconciliationService → EconomicOutcomeStore           │
│  Normalization (PII-free)                                       │
│  5 real adapters + 6 unavailable-input adapters                 │
│  Lock, checkpoint, retry, metrics                               │
│                                                                 │
│  EconomicOutcomeStore (985 lines, SQLite)                       │
│  └── Cost components, snapshots, evidence refs                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ NOT CONNECTED
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DAEMON (CODE EXISTS, UNWIRED)                 │
│                                                                 │
│  economicIngestionDaemon.ts ──→ NOT in start-agent-daemons.mjs │
│  ecosystem.config.cjs passes MSL_ECONOMIC_INGESTION_ENABLED    │
│  daemonScheduler.ts supports registration                       │
│  But: no import, no instantiation, no registration              │
└─────────────────────────────────────────────────────────────────┘
```

## Target State

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                           │
│                                                                 │
│  createEconomicIngestionRuntime() ←── SHARED FACTORY            │
│       │                                                         │
│       ├──→ economicCli.ts (REAL handlers)                       │
│       ├──→ economicIngestionDaemon.ts (REAL daemon)             │
│       └──→ CEO tools (8/8 real)                                 │
│                                                                 │
│  Factory resolves per seller:                                   │
│  - ML account registry                                          │
│  - OAuth manager                                                │
│  - DataFetcher (read-only)                                      │
│  - EconomicOutcomeStore                                         │
│  - EconomicIngestionRunStore                                    │
│  - EconomicIngestionPipeline                                    │
│  - EconomicReconciliationService                                │
│  - Structured logger                                            │
│  - Metrics collector                                            │
│  - Runtime health                                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CORE ENGINE (UNCHANGED ✅)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   DAEMON (WIRED)                                │
│                                                                 │
│  start-agent-daemons.mjs imports createEconomicIngestionDaemon │
│  Constructs with real factory                                   │
│  Registers with daemonScheduler                                 │
│  Gated by MSL_ECONOMIC_INGESTION_ENABLED                        │
└─────────────────────────────────────────────────────────────────┘
```

## New Components

| Component | File | Purpose |
|---|---|---|
| `createEconomicIngestionRuntime()` | `packages/agent/src/economics/factory.ts` | Shared factory for CLI, daemon, tools |
| `EconomicIngestionRunStore` | `packages/memory/src/economicIngestionRunStore.ts` | Persist runs and checkpoints |
| `DataFetcher` (production) | `packages/agent/src/economics/dataFetcher.ts` | Real ML read-only data fetching |

## Wiring Changes

| From | To | Change |
|---|---|---|
| economicCli.ts handlers | Factory → Pipeline → Store | Replace stubs with real calls |
| start-agent-daemons.mjs | economicIngestionDaemon | Add import + registration |
| inspect_evidence_references tool | EconomicOutcomeStore | Query real evidence refs |
| economicIngestionDaemon.ts | Factory | Use shared factory instead of inline construction |
