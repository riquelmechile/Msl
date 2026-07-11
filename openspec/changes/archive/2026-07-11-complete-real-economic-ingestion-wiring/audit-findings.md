# Audit Findings: Real Ingestion Economic Adapters

## Date
2026-07-11

## Auditor
Independent SDD audit (orchestrator-delegated exploration)

## Methodology
- Full-text search for stub markers across `packages`, `apps`, `scripts`, `docs`, `openspec`
- Full read of all 11 critical files
- Classification of every match
- Cross-reference with archive claims

---

## Summary

| Classification | Count |
|---|---|
| PRODUCTIVE_STUB_CRITICAL | 3 |
| UNAVAILABLE_INPUT_ADAPTER (legitimate) | 6 |
| LEGITIMATE_FALLBACK | 1 |
| FALSE POSITIVE (test fixtures, security patterns) | 85+ |
| TOTAL REAL ISSUES | 3 |

---

## CRITICAL Finding #1: economicCli.ts — ALL FIVE HANDLERS ARE STUBS

**File:** `packages/agent/src/cli/economicCli.ts`
**Severity:** CRITICAL

Every command handler returns hardcoded fake data:

| Handler | Lines | Behavior |
|---|---|---|
| `handleIngest()` | 123-135 | Returns `runId: "run-stub-{timestamp}"`, message: *"Real implementation requires EconomicOutcomeStore and DataFetcher"* |
| `handleStatus()` | 137-145 | Returns `lastRun: null, totalRuns: 0` (hardcoded) |
| `handleCoverage()` | 147-170 | Returns ALL 8 dimensions as `"unverifiable"` with `confidence: 0.5` (hardcoded) |
| `handleReconcile()` | 172-179 | Returns `status: "incomplete"` (hardcoded) |
| `handleMissing()` | 181-197 | Returns hardcoded list of 5 missing types, never queries store |

**Impact:** All 5 `npm run economic:*` scripts produce fake output. The public operational interface is non-functional despite the underlying pipeline being production-ready.

**Root cause:** CLI was implemented as a placeholder during PR4 development and never wired to the real pipeline. The archive report accepted the stub message as "valid JSON output."

**Fix:** Rewrite all handlers to instantiate `EconomicOutcomeStore`, `DataFetcher`, and call `runEconomicIngestion()` / query the store.

---

## CRITICAL Finding #2: Economic Ingestion Daemon NOT WIRED

**File:** `scripts/start-agent-daemons.mjs`
**Severity:** CRITICAL

The daemon scheduler (`daemonScheduler.ts` line 155-160) supports economic ingestion daemon registration. `ecosystem.config.cjs` passes `MSL_ECONOMIC_INGESTION_ENABLED` to the agent process. But `start-agent-daemons.mjs` never imports or instantiates `createEconomicIngestionDaemon`.

**Impact:** Setting `MSL_ECONOMIC_INGESTION_ENABLED=true` has no effect. Automated scheduled ingestion never runs.

**Root cause:** Daemon code was implemented but the wiring in the start script was never completed.

**Fix:** Import `createEconomicIngestionDaemon`, construct instance with real store + dataFetcher, pass to `startDaemonScheduler()`.

---

## CRITICAL Finding #3: inspect_evidence_references CEO Tool is STUB

**File:** `packages/agent/src/conversation/tools/economicTools.ts`
**Lines:** 471-509
**Severity:** MEDIUM

Returns: `"Evidence reference store not yet available. Use inspect_cost_components for per-component provenance information..."`

Evidence references ARE created by the pipeline (EconomicIngestionPipeline.ts lines 222-242). The data exists but the tool doesn't surface it.

**Fix:** Wire tool to query real evidence references from the store.

---

## LEGITIMATE: Unavailable Input Adapters (6)

These adapters correctly return `[]` because input data does not exist. Each documents what real implementation would need:

| Adapter | Missing Input |
|---|---|
| `adaptProductCost` | Supplier cost data, COGS tracking |
| `adaptLandedCost` | Customs/duty, freight, insurance |
| `adaptPackaging` | Packaging material/labor cost |
| `adaptFinancing` | ML installment cost, merchant discount rate |
| `adaptTax` | VAT/IVA treatment, withholding |
| `adaptOther` | Seller-specific manual costs |

**Verdict:** These are CORRECT. The pipeline properly surfaces them as `missingInputs`. They must NOT be changed to return zeros or fake data.

---

## LEGITIMATE FALLBACK

**`SellerAccountReadinessChecker.ts:243`**: `"MercadoLibre write operations are not yet available."` — Truthful readiness report. Correct.

---

## FALSE POSITIVES (85+ matches)

- **`vi.stubEnv()` in test files** — Vitest infrastructure, not application stubs
- **`"placeholder"` in readiness checkers** — Security pattern to detect test credentials (`test|example|changeme|your-|xxx|placeholder|dummy`)
- **`"stub" in bot/src/index.ts:51`** — JSDoc comment about grammY test mode
- **Archive artifacts** — Historical SDD documents describing past stubs

---

## Production-Ready Files (Verified)

These files contain ZERO stubs and use real domain logic:

- ✅ `packages/memory/src/economicOutcomeStore.ts` — 985 lines, complete SQLite CRUD
- ✅ `packages/agent/src/economics/EconomicIngestionPipeline.ts` — 551 lines, full pipeline
- ✅ `packages/agent/src/economics/EconomicReconciliationService.ts` — 135 lines, real math
- ✅ All 5 real adapters (revenue, marketplaceFee, shippingCost, sellerDiscount, refundReturn, advertisingCost)
- ✅ `packages/agent/src/economics/normalization.ts` — PII-free normalization
- ✅ `packages/agent/src/workers/economicIngestionDaemon.ts` — Real daemon code (unwired)
- ✅ 7/8 CEO tools in economicTools.ts

---

## Honest Assessment

The archive report's claim of "fully implemented" is **70% truthful**. The core engine is genuinely production-grade. The 30% gap is the CLI (100% stubs), daemon wiring, and one CEO tool. This change closes that gap.
