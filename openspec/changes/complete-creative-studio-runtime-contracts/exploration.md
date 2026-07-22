# Exploration: Complete Creative Studio Runtime Contracts

## Current State

The `add-creative-studio-agent` change is fully committed (31/31 tasks, `9d380c7`) and its review lineage `review-7c0d4a85f40ced4d` validates `allow` at pre-push against `origin/main`. The legacy verify report contains a stale statement about task 1.3 being "incomplete"; that statement is historical — the queue creation/dispatch slice was committed as part of the original change and the task count is complete at 31/31. The remaining blocker is the legacy verification envelope that prevents dispatcher closure, plus newly discovered runtime-contract gaps that were never addressed in the original implementation.

All six gaps are **absent on every inspected ref** — they are not regressions from the review but unfilled runtime contracts that prevent production-safe operation.

### Production Foundations (verified working)

| Component | Status | Evidence |
|-----------|--------|----------|
| Lane registration (`creative-studio` in `LaneId`, `LANE_CONTRACTS`, `laneDepartments`) | ✅ | `lanes.ts`, `companyAgents.ts` |
| Daemon registration (`daemonHandlerMap`) | ✅ | `daemonScheduler.ts:148` |
| CreativeStudioDaemon (env gate → parse → validate → generate → respond) | ✅ | `creativeStudioDaemon.ts:180-535` |
| Atomic job creation + dispatch (`createAndDispatchCreativeJob` — creates job, enqueues bus message, transitions to `provider-routing`) | ✅ | `agentDaemonPersistence.ts:83-119` |
| MiniMax image provider (sync `image-01`) | ✅ | `minimax-image-provider.ts` |
| MiniMax video provider (async Hailuo polling) | ✅ | `minimax-video-provider.ts` |
| ML diagnosis adapter | ✅ | `ml-diagnostic-adapter.ts` |
| Asset storage (`.msl/creative-studio/assets/`) | ✅ | `creative-asset-store.ts` |
| Cortex bridge (outcome recording) | ✅ | `cortex-bridge.ts` |
| Creative daemon delegation (env-gated, additive) | ✅ | `creativeAssetsDaemon.ts`, `creativeCommercialDaemon.ts` |
| Agent message bus (`enqueue`, `claimNext`, `resolve`, `fail`) | ✅ | `agentMessageBusStore.ts` |
| CreativeJobQueueStore (`createJob`, `completeJob`, `failJob`, `getJob`, `updateStatus`) | ✅ | `creativeJobQueueStore.ts:87-105` |
| `query_creative_task` and `approve_creative_asset` tools | ✅ | `creativeTools.ts` |

### Dispatch Flow (current, committed)

```
Caller (owned-ecommerce, daemon detection, product launch)
  └─ createAndDispatchCreativeJob(input)   [agentDaemonPersistence.ts:83-119]
       └─ [db.transaction — atomic]
            ├─ creativeJobQueueStore.createJob(input)     ← pure SQLite INSERT (status = "queued")
            ├─ bus.enqueue({ receiverAgentId: "creative-studio", messageType: "creative.asset.requested" })
            └─ creativeJobQueueStore.updateStatus(job_id, "provider-routing")

Note: CreativeJobQueueStore.createJob() only inserts and returns a SQLite row.
It does NOT enqueue bus messages or transition status. The atomic composition
happens at the persistence runtime layer (createAndDispatchCreativeJob),
which overrides createJob on the store instance passed to daemon context.

creativeStudioDaemon (scheduled cycle)
  ├─ 1. Env gate
  ├─ 2. Parse request from claim.payloadJson
  ├─ 3. PolicyEngine.validate()
  ├─ 4. Instantiate NEW CostLedger({ maxDailyUsd, maxJobUsd })  ← IN-MEMORY
  ├─ 5. Provider.execute()
  ├─ 6. ML diagnosis, asset storage, Cortex recordOutcome(approved: false)
  └─ 7. bus.enqueue CEO proposal + return DaemonResult
       ⚠️ NEVER calls creativeJobQueueStore.completeJob() or failJob()
```

## Verified Gaps (Evidence per Gap)

### Gap 1 — Cumulative Daily Creative Budget Persistence/Enforcement

**Claim**: Daily budget is in-memory only, not durable across restarts.

**Evidence — CONFIRMED**:

```typescript
// cost-ledger.ts:6-9
export class CostLedger {
  private dailySpentUsd: number = 0;  // IN-MEMORY ONLY
  private lastResetDate: string;
```

`CostLedger` is instantiated fresh on every daemon handler invocation (`creativeStudioDaemon.ts:271`):

```typescript
const ledger = new CostLedger({ maxDailyUsd, maxJobUsd });
```

No durable persistence backs the cost ledger. The design document (`design.md:14`) called for "SQLite table `creative_cost_ledger` in `.msl/creative-studio/studio.sqlite`" but this was never implemented. Result: **daily budget resets on every daemon restart**, making the `$5.00/day` budget limit unenforceable across process restarts.

**Impact**: A restarted daemon will allow unlimited generation spending until the process reaches its configured daily cap again in-memory.

### Gap 2 — Durable Queue Terminal Synchronization

**Claim**: `creativeStudioDaemon` never calls `completeJob()` or `failJob()` on the `CreativeJobQueueStore` to transition jobs from `provider-routing` to a terminal state.

**Evidence — CONFIRMED**:

- The dispatch flow (`agentDaemonPersistence.ts:83-119`) atomically creates the job, enqueues the bus message, and transitions the row to `provider-routing`. **Jobs do NOT remain stuck at `queued`** — they reach `provider-routing` before the daemon sees them.
- `grep` for `completeJob|failJob` in `creativeStudioDaemon.ts` returned **zero matches**.
- The daemon receives `creativeJobQueueStore` in the `DaemonHandler` context (typed in `daemonTypes.ts:139`), and the scheduler passes it (line 375 of `daemonScheduler.ts:375`), but the daemon handler never destructures or uses it.
- The daemon never calls `updateStatus(jobId, "running")` when beginning execution, nor `completeJob(jobId, ...)` on success, nor `failJob(jobId, ...)` on failure.
- All callers use the overridden `createAndDispatchCreativeJob` (which wraps `createJob` + bus enqueue + `updateStatus` in one transaction), so **the daemon MUST NOT call `createJob`** — creation belongs to the dispatch layer. The daemon's only responsibility is synchronizing terminal outcomes.
- The bus message carries `dedupeKey: 'creative-job:${job.job_id}'` and `correlationId: job.request_id` as fallback correlation fields. However, the primary contract for `jobId` propagation should be a structured `jobId` field in the bus payload JSON (typed into the claim contract), not brittle string parsing of `dedupeKey`. `dedupeKey` parsing exists only as backward-compatible fallback for messages dispatched before this correction.

**Impact**: After `provider-routing`, the `creative_jobs` row never advances to `running`, `needs-human-review`, `approved`, or `failed`. `query_creative_task` and `approve_creative_asset` tools see stale `provider-routing` status and cannot observe or drive job lifecycle. The queue store and daemon execution path are decoupled beyond the initial dispatch.

### Gap 3 — Missing `request_creative_asset` CEO Tool

**Claim**: The `request_creative_asset` tool listed in the proposal was never built.

**Evidence — CONFIRMED**:

- `grep` for `request_creative_asset` across all `packages/agent` TypeScript files returned **zero matches**.
- `grep` for `createRequestCreativeAsset` returned **zero matches**.
- The proposal (`proposal.md:16`) listed `request_creative_asset` as a CEO-facing tool alongside `query_creative_task` and `approve_creative_asset`.
- The latter two exist in `creativeTools.ts`; the former does not.
- In production, the only way to enqueue a creative request is through daemon delegation (`creativeAssetsDaemon` → bus enqueue via `createAndDispatchCreativeJob`) or the product launch pipeline (`studioArtist` → bus enqueue). The CEO has no tool to directly request creative asset generation.

**Impact**: The CEO agent cannot independently request creative assets. Only automated daemon detection triggers can initiate creative generation. This breaks the user-facing intent stated in the proposal.

### Gap 4 — Real Prompt/Reference Hashes and Complete Provenance/Cost

**Claim**: SHA-256 hashes are stubbed (empty strings), references lack real hashes, and audit events are console-log-only.

**Evidence — PARTIALLY CONFIRMED**:

1. **Reference hashes**: `CreativeAssetRequest.references[].sha256` is optional (`sha256?: string`, line 38 of `creative-requests.ts`). `studioArtist.buildCreativeAssetRequest()` (lines 402-443 of `studioArtist.ts`) constructs references but never populates `sha256`.

2. **Output hashes**: The video provider sets `sha256: ""` (empty string, line 216 of `minimax-video-provider.ts`). No real hashing is performed on generated outputs.

3. **Audit**: The daemon's audit log (lines 500-512 of `creativeStudioDaemon.ts`) is `console.log(JSON.stringify(auditEvent))` — not persisted to SQLite, not filed in the workforce cost ledger, not attached to the Cortex node. There is no durable per-asset provenance record beyond the in-memory `CreativeExecutionResult` passed through the bus.

**Impact**: No cryptographic chain of custody for generated assets. No way to verify that a published asset was exactly what MiniMax produced. No persistent cost tracking for audit or billing.

### Gap 5 — Cortex Approval/Rejection and MercadoLibre Moderation Feedback

**Claim**: Cortex outcome recording is one-way with no feedback consumption; ML moderation outcomes are not fed back to Cortex.

**Evidence — CONFIRMED**:

1. `CortexBridge.recordOutcome()` (line 56 of `cortex-bridge.ts`) always hardcodes `approved: false, published: false` when called from the daemon (line 489-491 of `creativeStudioDaemon.ts`).

2. When the CEO approves via `approve_creative_asset` (which updates the queue store status to `"approved"`), there is **no callback** to update the Cortex outcome. The Cortex node remains with `approved: false` permanently.

3. ML moderation results (`MlDiagnosticResult`) are attached to outputs but never fed back to Cortex as learning signals.

4. The `DelegationFeedback` types (`feedback.ts` in `@msl/memory`) exist but are not wired to creative studio outcomes.

**Impact**: Cortex cannot learn which providers, models, or channels produce approved vs. rejected outputs. The Darwinian feedback loop described in the design is non-functional. ML moderation data is collected but discarded from the learning perspective.

### Gap 6 — Consistent Bus Message Contracts and Durable Video Polling/Restart

**Claim**: Video polling collapses on daemon restart; bus resolution is overly optimistic regardless of creative job outcome.

**Evidence — CONFIRMED (both sub-claims)**:

1. **Video polling durability**: `pollVideoTask()` (lines 243-292 of `minimax-video-provider.ts`) polls synchronously within a single handler invocation. The MiniMax `task_id` is never stored durably. If the daemon process restarts mid-poll (5-minute polling window), the `task_id` is lost and the video generation is orphaned (MiniMax completes it but the result is never collected).

2. **Bus resolution mismatch**: The daemon handler returns `DaemonResult` with `proposalEnqueued: true` as long as at least one CEO proposal was enqueued. The scheduler (`daemonScheduler.ts:380`) resolves EVERY handler result with `config.bus.resolve(claim.messageId, result)` regardless of whether the creative job actually succeeded or failed. Failed jobs (provider errors, budget exceeded) still get resolved on the bus with a "success" envelope containing findings — losing the terminal status signal.

**Impact**: Video jobs are not restart-safe. Bus consumers (CEO, learning pipeline) cannot distinguish between "creative job succeeded" and "creative job found no work" from the bus resolution alone.

## Affected Areas

| File | Gap(s) | Nature of Change |
|------|--------|------------------|
| `packages/creative-studio/src/domain/cost-ledger.ts` | 1 | Define `DurableCostLedger` port (interface). Logic stays storage-agnostic. |
| `packages/creative-studio/src/infrastructure/storage/cost-ledger-store.ts` (new) | 1 | Implement `DurableCostLedger` adapter backed by `studio.sqlite` |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | 2, 4, 5, 6 | Destructure `creativeJobQueueStore`; extract `jobId` from structured bus payload `jobId` field (primary) with `dedupeKey`/`correlationId` fallback; call `updateStatus("running")` → `completeJob`/`failJob`; accept injected `DurableCostLedger`; wire Cortex feedback from approval; distinguish bus terminal signals |
| `packages/agent/tests/workers/creativeStudioDaemon.test.ts` | 2, 4, 5, 6 | Extend coverage for queue terminal sync, hash computation, Cortex feedback, bus terminal states |
| `packages/agent/src/conversation/tools/creativeTools.ts` | 3 | Add `createRequestCreativeAssetTool` factory — accepts injected `CreativeJobDispatcher` port (calls `requestCreativeAsset(input)`), validates input, returns `{ jobId, status }` |
| `packages/agent/src/conversation/dispatcher/creativeJobDispatcher.ts` (new) | 3 | Define `CreativeJobDispatcher` port (interface) with `requestCreativeAsset(input): Promise<{ jobId, status }>`. Production impl delegates to `createAndDispatchCreativeJob` at composition root |
| `packages/agent/src/conversation/tools/index.ts` | 3 | Export new tool (already re-exports `creativeTools.js`) |
| `packages/agent/src/index.ts` (or MCP tool registration) | 3 | Wire `createRequestCreativeAssetTool` + `CreativeJobDispatcher` impl into the CEO tool set |
| `packages/agent/tests/conversation/creativeTools.test.ts` (new) | 3 | Unit: assert `request_creative_asset` tool invokes the dispatcher port; integration/runtime: prove one job row + one bus message + `provider-routing` transition (never claim the store alone dispatches) |
| `packages/creative-studio/src/infrastructure/storage/creative-asset-store.ts` | 4 | Add `computeSha256(buffer): string` utility for reference/output hashing |
| `packages/creative-studio/src/application/cortex-bridge.ts` | 5 | Add `recordApproval(jobId, approved)` and `recordModeration(jobId, mlDiagnostic)` methods |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | 5 | On `approve_creative_asset` callback: call `cortexBridge.recordApproval()` to update outcome |
| `packages/creative-studio/src/__tests__/cortex-bridge.test.ts` (new/extend) | 5 | Test feedback recording methods |
| `packages/creative-studio/src/infrastructure/providers/minimax/minimax-video-provider.ts` | 6 | Store `task_id` durably via injected `videoTaskStore` port; support `resumePoll(taskId)` |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | 6 | On startup: resume orphaned video polls; on terminal errors: call `bus.fail()` instead of resolving all results as success |

## Approaches

### Approach A: Single Corrective Change (all 6 gaps)

Merge all gap fixes into one change.

| Pros | Cons | Complexity |
|------|------|------------|
| Single atomic review | ~600-1000 lines likely exceeds 800-line budget | High |
| No inter-slice sequencing risk | Hard for reviewer to validate all contracts at once | |
| All runtime contracts delivered together | Test matrix is large (daemon + tools + ledger adapter + providers + Cortex) | |

### Approach B: Two Chained Corrective Slices

**Slice 1 — "Runtime State Contracts"** (Gaps 1, 2, 3): budget ledger persistence adapter, queue terminal synchronization, missing `request_creative_asset` tool. These three are coupled via the queue store identity: the tool delegates to a `CreativeJobDispatcher` port (implemented at composition root by the existing transactional `createAndDispatchCreativeJob`), the daemon correlates terminal outcomes to the dispatched identity via explicit `jobId` in the bus payload, and the cost ledger records spend against completed jobs.

**Slice 2 — "Observability & Durability Contracts"** (Gaps 4, 5, 6): real hashes & provenance, Cortex feedback loop, video polling durability, bus contract correctness.

| Pros | Cons | Complexity |
|------|------|------------|
| Slice 1 fits under 800-line budget (~395-580 lines) | Slice 2 depends on Slice 1's ledger adapter + queue sync + structured prompt for correct cost/hash attribution | High — Slice 1 cognitive load is elevated (budget + queue + tool + duration + prompt safety in one review) |
| Slice 2 fits under 800-line budget (~280-520 lines) | Each slice is independently reviewable | |
| Clear separation: "can it run safely?" vs "can we observe it?" | Two PR reviews needed | |

### Approach C: Three Corrective Slices (Recommended)

**Slice A — "Safe Runtime Foundation"** (Gaps 1, 2, video duration correction): budget ledger persistence adapter, queue terminal synchronization via `completeJob`/`failJob`, video duration constraint enforcement (rename `ml-clip-vertical-30s` → `ml-clip-vertical-10s`, update `KIND_DURATION`, enforce 768P for 10s). Foundation that makes the daemon restart-safe, budget-aware, and provider-compliant.

**Slice B — "Product-Safe Generation Contracts"** (Gap 3, prompt safety, minimum safe contract, + two image provider adapters): `CreativeJobDispatcher` port + `request_creative_asset` CEO tool; structured tiered prompt template (no raw title injection); allowlisted `styleHint`/`backgroundHint`; mandatory reference SHA-256 at dispatch; `prompt_optimizer: false` in both providers; MiniMax `subject_reference` gated to documented modes only; `OpenAIImageProvider` adapter implementing `ImageProvider`; `BriaImageProvider` adapter (feature-gated behind `MSL_BRIA_ENABLED`) implementing `ImageProvider`; provider-agnostic output normalization; fallback rules with budget re-check and audit evidence.

**Slice C — "Observability & Learning Contracts"** (Gaps 4, 5, 6): real SHA-256 on output buffers; persistent audit via ledger adapter; Cortex `recordApproval`/`recordModeration` feedback loop; durable video polling via `VideoTaskStore`; bus terminal signal accuracy (`bus.fail()` on true failures); optional CBT Clips upload adapter.

| Pros | Cons | Complexity |
|------|------|------------|
| Each slice has a clear, reviewable focus | Three PR reviews, more sequencing overhead | Low-medium (per slice) |
| Slice A (~255-370 lines), Slice B (~480-710 lines), Slice C (~305-510 lines) — all under 800-line budget | Slice B depends on Slice A (dispatcher port needs queue store; structured prompt needs budget adapter for cost attribution) | |
| Lowest per-slice cognitive risk | Slice C depends on Slice A+B for hashes to reference queue rows | |
| Slices A and B can ship independently with production value | | |

## Recommendation

**Approach C — Three Corrective Slices (Recommended)**.

Rationale:
- Slice 1 of Approach B bundles runtime state contracts, video duration, prompt safety, and structured templates — ~400-600 lines with substantial cognitive load spanning budget engines, queue protocols, provider API constraints, and injection defenses. A single reviewer cannot validate this breadth safely.
- Three slices separate concerns cleanly: **"can it run without silent data loss?"** (Slice A), **"can sellers request safely, and will the product not silently change?"** (Slice B), **"can we observe, learn, and recover?"** (Slice C).
- All slices fit within the 800-line review budget.
- Chained PR strategy (feature-branch-chain): PR 1 (Slice A) targets the change branch; PR 2 (Slice B) targets PR 1's branch; PR 3 (Slice C) targets PR 2's branch.
- Approach B (two slices) remains viable if timeline pressure forces it, but carries higher reviewer cognitive risk.

### Slice A — Safe Runtime Foundation (~250-370 authored lines)

| File | Change | Est. Lines |
|------|--------|------------|
| `cost-ledger.ts` | Define `DurableCostLedger` port (interface). Keep current `CostLedger` in-memory as default | 25-35 |
| `cost-ledger-store.ts` (new in `infrastructure/storage/`) | Implement adapter: `studio.sqlite` table `creative_cost_ledger(day TEXT PRIMARY KEY, spent_usd REAL)` | 40-60 |
| `creativeStudioDaemon.ts` | Destructure `creativeJobQueueStore`; extract `jobId` from payload primary field or dedupeKey/correlationId fallback; call `updateStatus("running")` → `completeJob`/`failJob`; accept optional `DurableCostLedger` | 60-80 |
| `minimax-video-provider.ts` | Rename `ml-clip-vertical-30s` → `ml-clip-vertical-10s` in `VIDEO_KINDS`, `KIND_DURATION`; add resolution-duration enforcement; force 768P for 10s; set `prompt_optimizer: false` | 40-60 |
| `creative-requests.ts` | Update `CreativeJobKind` union (rename, keep old as deprecated alias) | 15-25 |
| `creativeStudioDaemon.test.ts` | Verify `updateStatus("running")` → `completeJob`/`failJob`; `DurableCostLedger` adapter; video duration enforcement; verify daemon never calls `createJob` | 50-70 |
| `cost-ledger-store.test.ts` (new) | Adapter: persistence across re-instantiation, UTC reset, concurrent writes | 15-25 |
| `minimax-video-provider.test.ts` (extend) | Duration constraint enforcement; 10s at 768P, 6s at 1080P | 10-15 |
| **Total** | | **255-370** |

### Slice B — Product-Safe Generation Contracts (~480-710 authored lines)

| File | Change | Est. Lines |
|------|--------|------------|
| `creativeJobDispatcher.ts` (new) | Define `CreativeJobDispatcher` port interface | 15-20 |
| `creativeTools.ts` | Add `createRequestCreativeAssetTool` — accepts `dispatcher: CreativeJobDispatcher`, validates input, delegates to port | 80-120 |
| `creative-requests.ts` | Add `CreativeGenerationPayload` + `ImageProviderOutput` + `ImageProvider` + `ImageGenerationRequest` types: Tier 1-3, provider-agnostic output normalization | 45-60 |
| `image-provider-contracts.ts` (new in `contracts/`) | `ImageProvider` port, `ImageProviderOutput`, `ImageGenerationRequest` — domain-layer types. No provider-specific leakage | 15-20 |
| `openai-image-provider.ts` (new in `infrastructure/providers/openai/`) | `OpenAIImageProvider` implements `ImageProvider`. Uses existing `openai` npm SDK. `images.edit()` for reference-conditioned generation. Output normalization to `ImageProviderOutput` | 60-90 |
| `bria-image-provider.ts` (new in `infrastructure/providers/bria/`) | `BriaImageProvider` implements `ImageProvider`. Async V2 API with polling. Feature-gated behind `MSL_BRIA_ENABLED` + `BRIA_API_TOKEN`. Output normalization to `ImageProviderOutput` | 60-90 |
| `minimax-image-provider.ts` | Refactor `buildPrompt` to accept structured tiers; no raw title injection; `prompt_optimizer: false`; remove `subject_reference` for product kinds | 40-60 |
| `minimax-video-provider.ts` | Refactor `buildPrompt` to accept structured tiers; camera commands system-injected only | 20-30 |
| `policy-engine.ts` | Add allowlist validation for `styleHint`/`backgroundHint`; reference `sha256` presence; non-guarantee documentation; fallback rules enforcement | 30-40 |
| `studioArtist.ts` | Populate `sha256` on references in `buildCreativeAssetRequest` | 15-20 |
| `creativeTools.test.ts` (new) | Unit: assert tool invokes dispatcher; integration: prove atomic dispatch | 30-50 |
| `openai-image-provider.test.ts` (new) | Mock OpenAI SDK; test generate, normalize, error modes, fallback-trigger conditions | 25-40 |
| `bria-image-provider.test.ts` (new) | Mock BRIA transport; test async polling, error modes, gating | 25-40 |
| `policy-engine.test.ts` (extend) | Allowlist validation, sha256 presence, non-guarantee documentation | 15-25 |
| `minimax-image-provider.test.ts` (extend) | Update prompt expectations to structured template format | 15-25 |
| `creativeStudioDaemon.test.ts` (extend) | Structured payload handling, provider routing, fallback behavior, output normalization | 15-25 |
| **Total** | | **490-745** |

### Slice C — Observability & Learning Contracts (~280-500 authored lines)

| File | Change | Est. Lines |
|------|--------|------------|
| `creative-asset-store.ts` | Add `computeSha256(buffer: Buffer): string` utility | 15-25 |
| `creativeStudioDaemon.ts` | Compute real SHA-256 on output buffers; persist audit via ledger adapter; call `bus.fail()` on terminal failures; wire Cortex feedback from approval callback | 80-120 |
| `cortex-bridge.ts` | Add `recordApproval(jobId, approved: boolean)` and `recordModeration(jobId, result: MlDiagnosticResult)` methods | 30-50 |
| `approve_creative_asset` tool / daemon bridge | After `updateStatus("approved")`, call `cortexBridge.recordApproval(jobId, true)` | 30-50 |
| `minimax-video-provider.ts` | Accept optional `VideoTaskStore` port; store `{ taskId, jobId }` on submit; `resumePoll()` from stored task_ids | 60-100 |
| `video-task-store.ts` (new) | `creative_video_tasks(task_id TEXT PRIMARY KEY, job_id TEXT, status TEXT, created_at TEXT)` | 25-35 |
| `creativeStudioDaemon.test.ts` (extend) | Hashes, audit via adapter, `bus.fail()`, Cortex feedback, video resume | 40-90 |
| `cortex-bridge.test.ts` (extend) | `recordApproval` updates node, `recordModeration` attaches diagnostic | 25-40 |
| **Total** | | **305-510** |

## Migration / Data Compatibility

- **CostLedger port**: `DurableCostLedger` interface in the domain layer. Default in-memory implementation preserves current behavior. New `SqliteCostLedgerStore` adapter implements the port using `studio.sqlite`. Existing `CostLedger` class is unchanged — the port is injected into the daemon.
- **Queue store**: Schema unchanged. The daemon now calls `updateStatus` (existing method), `completeJob` (existing), and `failJob` (existing) — no DDL needed. Jobs already at `provider-routing` will transition forward on first daemon cycle with the corrected code.
- **Video task table**: New table `creative_video_tasks` in `studio.sqlite`. `CREATE TABLE IF NOT EXISTS`. TTL cleanup of rows older than 24h via a periodic sweep in the daemon cycle.
- **Cortex nodes**: New properties (`approved: boolean`, `moderation: object`) are additive. Existing nodes lack them — daemon treats absent `approved` as `undefined` and skips feedback that depends on it.
- **Budget ledger table**: New table `creative_cost_ledger` in `studio.sqlite`. `CREATE TABLE IF NOT EXISTS`. First run on existing DB auto-creates. In-memory fallback when adapter not injected.

## Failure / Restart Behavior

| Scenario | Before | After (Slice A) | After (Slice B) | After (Slice C) |
|----------|--------|-----------------|-----------------|-----------------|
| Daemon restart during generation | Budget resets to $0; job stuck at `provider-routing` | Budget recovered from SQLite; job transitions to `running` → terminal; video duration validated against provider caps | Prompt built from structured tiers (no injection risk) | Video `task_id` recovered; polling resumes; SHA-256 fingerprints recorded |
| CEO approves asset while daemon down | Queue shows `approved` after tool call; Cortex stuck at `approved: false` | Queue shows `approved`; Cortex node unchanged | Tools available for CEO to request assets directly | Cortex node updated with `approved: true` on next daemon cycle |
| MiniMax API returns error mid-poll | Poll exhausted; empty findings; bus resolves as "success" | Queue transitions to `failed` via `failJob` | Same | `bus.fail()` called; bus consumer sees failure |
| Reference image URL unreachable | No hash; silent | No hash (Slice C adds) | SHA-256 mandatory at dispatch (Slice B); generation blocked if hash missing | SHA-256 computed from fetched bytes |
| Seller title contains injection text | Raw title injected into prompt | Same | Title never reaches provider — only catalog-derived productIdentity fields used | Same |
| `ml-clip-vertical-30s` requested | 30s sent to API — rejected | Renamed to 10s; 768P enforced; old kind aliased | Same | Same |

## Test Strategy

- **Unit**: `cost-ledger-store.test.ts` for `DurableCostLedger` adapter; `creativeTools.test.ts` for `request_creative_asset`; `cortex-bridge.test.ts` extended for feedback methods; `video-task-store.test.ts` for task persistence.
- **Integration**: `creativeStudioDaemon.test.ts` extended for queue terminal sync (`updateStatus` → `completeJob`/`failJob`), budget adapter injection, hash verification, Cortex feedback, bus terminal signals, video task resume.
- **Correlation**: Test that the daemon correctly extracts `jobId` from the structured payload `jobId` field (primary). Test fallback path via `dedupeKey` (`creative-job:cj_...`) and `correlationId` for legacy message compatibility.
- **Existing tests must NOT regress**: All 87 creative-studio tests (as of verify report) must continue passing.
- **Storage-agnostic domain**: `CostLedger` class tests remain unchanged — no new SQLite dependency in the domain layer.

## Runtime Harness

- Env gates preserved: `MSL_CREATIVE_STUDIO_ENABLED`, `MINIMAX_API_KEY`, `MSL_CREATIVE_STUDIO_MAX_DAILY_USD`, `MSL_CREATIVE_STUDIO_MAX_JOB_USD`.
- `CostLedger` class unchanged. New `DurableCostLedger` interface is a separate port. Daemon accepts `durableLedger?: DurableCostLedger` — when absent, falls back to current in-memory behavior.
- `CreativeJobDispatcher` port defined in `packages/agent/src/conversation/dispatcher/`. Tool factory accepts `dispatcher: CreativeJobDispatcher`. At composition root, implemented by `createAndDispatchCreativeJob`. The tool NEVER calls `createJob` on the queue store directly.
- `creativeJobQueueStore` passed in `DaemonHandler` context. Daemon checks for presence before calling queue methods.
- Bus payload carries explicit `jobId` field (Slice A). Structured `CreativeGenerationPayload` tier model (Slice B).
- `prompt_optimizer` explicitly `false` in both providers (Slice A for video, Slice B for image).
- MiniMax `subject_reference` NOT sent for product image kinds (Slice B). `first_frame_image` used for video with canonical reference (Slice A).
- Prompt template: `buildPrompt` accepts `CreativeGenerationPayload`, not raw `CreativeAssetRequest`. Untrusted text is validated against allowlists (Slice B).
- For ML channel: no free-form text reaches the provider beyond allowlisted `styleHint`/`backgroundHint`. The prompt is built entirely from Tier 1 product identity + Tier 2 reference metadata (Slice B).
- ML diagnostic adapter gains `retryConfig: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 8000 }` with jitter (Slice A or B).
- `VideoTaskStore` optional injection on `MinimaxVideoProvider` and daemon (Slice C).
- Video generation output is local storage only for ML channel until ML exposes a Clips upload API (Slice A).
- All new SQLite tables live in existing `studio.sqlite`.

## Rollback Boundaries

- **Slice A rollback**: Remove `creativeJobQueueStore` destructuring + ledger adapter injection from daemon → daemon returns to current behavior. Queue rows remain at `provider-routing` (harmless). Video duration rename is backward-compatible: old `ml-clip-vertical-30s` kind strings are deprecated aliases for two release cycles; misspelled kinds map to closest supported duration.
- **Slice B rollback**: Remove `CreativeJobDispatcher` port injection from tool → tool excluded from CEO tool set. Remove structured `CreativeGenerationPayload` → `buildPrompt` falls back to legacy `productContext.title` injection. Remove allowlist gate → default style/background hints used.
- **Slice C rollback**: Disable SHA-256 (keep `sha256: ""`), skip video resume, skip Cortex feedback. Each sub-gap independently gated via optional injection.
- **Full rollback**: Set `MSL_CREATIVE_STUDIO_ENABLED=false` → daemon returns empty findings. Existing behavior fully preserved. No data migration to unwind — new tables are additive.

## Risks

- **Correlation mismatch**: If the bus payload lacks the `jobId` field (legacy messages or dispatch bugs), the daemon must fall back to `dedupeKey`/`correlationId` parsing. If all three fail, the daemon skips queue sync and logs a warning — the job lifecycle won't advance, but generation still proceeds. Mitigation: add a runtime assertion in `createAndDispatchCreativeJob` that the payload always includes `jobId`; integration test verifies the field is present on every dispatch path.
- **Sha256 computation overhead**: Hashing large video files on download could add seconds. Mitigation: hash from the downloaded buffer before writing to disk; log timing; acceptable within 15-min daemon cycle.
- **Video task_id orphan accumulation**: If resume logic fails to clean up completed tasks, the `creative_video_tasks` table grows unbounded. Mitigation: TTL-based cleanup (delete rows older than 24h) on daemon cycle sweep.
- **Test coverage gap**: `creativeTools.ts` has no existing tests. New tests must cover the factory pattern used by all three tools. Mitigation: test `request_creative_asset` first; existing tools (`query_creative_task`, `approve_creative_asset`) gain basic smoke tests in the same file.
- **Port abstraction overhead**: Adding a `DurableCostLedger` interface adds indirection. Mitigation: domain `CostLedger` class stays pure in-memory and unchanged; the port is an optional injection at the composition root (daemon handler), not a domain concern.
- **Duration API rejection**: `ml-clip-vertical-30s` currently maps to 30 seconds, which MiniMax rejects (max 10s). Mitigation: rename to `ml-clip-vertical-10s` in this change; keep old kind as deprecated alias for two release cycles; force 768P for 10s durations per provider constraints; update all tests referencing the old kind.
- **Prompt template migration**: Changing `buildPrompt` from string concatenation to structured tier model changes provider behavior. Mitigation: existing image/video provider tests updated; non-breaking since `productIdentity` tier preserves the same factual inputs. Legacy messages without structured payload fall back to current behavior.
- **`subject_reference` type mismatch**: MiniMax docs describe `type: "character"` for people references; behavior with product images is undocumented. Mitigation: do NOT send `subject_reference` for product image kinds in this change. Re-evaluate if MiniMax documents product reference support or a new provider is added. Video `first_frame_image` is the documented reference mode — use canonical reference image as first frame.**
- **`prompt_optimizer` rewriting product facts**: Default is `true` for video, `false` for image. If either is not explicitly set to `false`, the provider may rewrite MSL-injected product identity facts. Mitigation: set `prompt_optimizer: false` explicitly in both providers (Slice A for video, Slice B for image). No channel or use case should enable it.**
- **ML 429 rate limiting**: Diagnostic adapter has no backoff logic; burst calls during daemon cycle trigger rate limits. Mitigation: add exponential backoff with jitter to `MlDiagnosticAdapter`; default config: max 3 retries, base delay 1s, max 8s.
- **MiniMax URL expiry**: Generated image/video URLs expire in 24h. Mitigation: asset download already implemented (lines 418-450 of daemon); must always succeed before daemon returns result.

## Ready for Proposal

**Yes** — with the recommendation to split into three chained corrective slices (Approach C). The orchestrator should launch `sdd-propose` for this change with:

- Delivery strategy: `auto-forecast`, feature-branch-chain
- Review budget: 800 authored changed lines per slice
- **Slice A** (Safe Runtime Foundation): Gaps 1, 2 + video duration correction + `prompt_optimizer: false` — ~255-370 lines
- **Slice B** (Product-Safe Generation Contracts): Gap 3 + prompt safety + structured templates + `subject_reference` gating + non-guarantee documentation + `OpenAIImageProvider` + `BriaImageProvider` (feature-gated) adapters via shared `ImageProvider` port — ~480-710 lines. If exceeding 800, split adapters into Slice B2
- **Slice C** (Observability & Learning Contracts): Gaps 4, 5, 6 + optional CBT Clips upload adapter — ~345-580 lines. If CBT Clips integration pushes Slice C beyond budget, separate as a fourth optional slice
- **Approved providers**: OpenAI `gpt-image-2` (primary image), BRIA AI (ecommerce fallback, gated on `MSL_BRIA_ENABLED` + `BRIA_API_TOKEN`), MiniMax Hailuo (video). FLUX and Photoroom are NOT selected for this change
- **Provider-agnostic port**: `ImageProvider` contract in domain layer (`packages/creative-studio/src/contracts/`). `OpenAIImageProvider` and `BriaImageProvider` implement it. Provider-specific types never leak into domain/application logic
- Architecture constraint: `CostLedger` domain class MUST NOT depend on `better-sqlite3` or concrete `Database`; persistence lives in an infrastructure adapter implementing a domain port
- Architecture constraint: `creativeStudioDaemon` MUST NOT call `createJob`; terminal correlation via explicit `jobId` in bus payload (primary) with `dedupeKey`/`correlationId` fallback for legacy messages
- Architecture constraint: `request_creative_asset` tool MUST accept an injected `CreativeJobDispatcher` port and MUST NOT call `creativeJobQueueStore.createJob()` directly
- Architecture constraint: `prompt_optimizer` MUST be explicitly `false` in both MiniMax providers; MSL controls prompt structure, not the provider optimizer
- Architecture constraint: MiniMax `subject_reference type: "character"` MUST NOT be used for product images — product applicability is undocumented. Video `first_frame_image` is the documented reference mode
- Architecture constraint: No output may be auto-published. Every asset enters `needs-human-review`. Human approval is the final identity gate
- Architecture constraint: The system MUST NOT claim product identity is guaranteed by prompt or reference. Non-guarantees (shape, color, count, labels, accessories, material, dimensions, regulated claims) must be documented in job results
- Architecture constraint: ML CBT Clips upload requires `publicationModel === "cbt-global-selling"`, valid `cbtItemId`, active item, seller ownership, OAuth read/write. Do not synthesize CBT IDs for local items
- Architecture constraint: Video duration for ML channels: 10s/768P only. 6s/1080P is below the 10s CBT minimum and restricted to storefront/social channels
- Architecture constraint: ML moderation (Clips 24-48h) is an additional platform gate AFTER CEO approval, not a replacement
- Experimental feature: `MSL_ML_LOCAL_VIDEO_PROBE_ENABLED` (default `false`) for read-only local-item capability probing. Fail-closed — never POST/upload unless a supported mapping is positively established
- Fallback rule: BRIA only on OpenAI availability/rate-limit/capability failure or explicit policy. Never fallback to evade content/safety rejection. Never call both silently. Budget re-checked before fallback. Both provider/cost/error evidence recorded in audit
- BRIA adapter feature-gated behind `MSL_BRIA_ENABLED` (default `false`) + `BRIA_API_TOKEN`. Pending credential/terms confirmation before production enablement. Adapter built in Slice B, not activated without explicit configuration
- Output normalization: All providers produce `ImageProviderOutput` with bytes/local URI, format, dimensions, SHA-256, provider/model, cost, reference hashes, safety/moderation metadata, policy flags

## Generation Quality, Safety & Product Fidelity

### 1. Existing MSL Harnesses — Inventory

#### Runtime Harnesses (production code paths)

| Harness | File | Role | Reusable for Correction? |
|---------|------|------|--------------------------|
| `creativeStudioDaemon` | `packages/agent/src/workers/creativeStudioDaemon.ts:180-535` | Full cycle: env gate → parse → policy validate → budget → execute → ML diagnose → store → Cortex → audit | ✅ Primary target — all corrections wire here |
| `createAndDispatchCreativeJob` | `packages/agent/src/runtime/agentDaemonPersistence.ts:83-119` | Atomic: create job + enqueue bus + transition to `provider-routing` | ✅ Used by `CreativeJobDispatcher` port impl |
| `MinimaxImageProvider.execute()` | `packages/creative-studio/src/infrastructure/providers/minimax/minimax-image-provider.ts:69-179` | Prompt build → subject reference → API call → `CreativeExecutionResult` | ⚠️ Prompt injection risk — see §4. Retain provider; patch prompt construction |
| `MinimaxVideoProvider.execute()` | `packages/creative-studio/src/infrastructure/providers/minimax/minimax-video-provider.ts:91-236` | Prompt build → first frame → API call → poll → download → result | ⚠️ Duration values violate provider constraints — see §3 |
| `PolicyEngine.validate()` | `packages/creative-studio/src/domain/policy-engine.ts:23-49` | Pre-flight: references presence, requestId format, i2i guard | ✅ Reusable. Does NOT validate prompt safety or product fidelity — needs extension |
| `MlDiagnosticAdapter.diagnoseImage()` | `packages/creative-studio/src/infrastructure/ml-diagnostic-adapter.ts` | POST `/moderations/pictures/diagnostic` per image | ✅ Reusable. Diagnostic failure is non-blocking in daemon (line 405-413) — aligns with ML guidance |
| `CreativeAssetStore.saveAsset()` | `packages/creative-studio/src/infrastructure/storage/creative-asset-store.ts` | Persist downloaded assets locally | ✅ Reusable. Needs SHA-256 integration (Gap 4) |
| `studioArtist.buildCreativeAssetRequest()` | `packages/agent/src/workers/studioArtist.ts:402-443` | Constructs `CreativeAssetRequest` from product launch pipeline | ⚠️ Does not populate `sha256` on references |
| `productCatalogStore` | `packages/agent/src/workers/productCatalogStore.ts` | `product_images` table tracks `source: "minimax"`, `ml_diagnostic_json`, quality scores | ✅ Reusable for provenance tracking |
| `product_launch_cost_events` table | `packages/agent/src/workers/productCatalogStore.ts:65-73` | Tracks per-launch costs by source (`minimax`) | ✅ Reusable for cost provenance |

#### Test Harnesses

| Test file | Tests | What it covers |
|-----------|-------|----------------|
| `minimax-image-provider.test.ts` | 18 | Image gen (T2I, I2I, empty prompt, no API key, error modes) |
| `minimax-video-provider.test.ts` | 19 | Video gen (submit, complete, fail, timeout, format) |
| `minimax-image-provider-transport.test.ts` | — | Transport-layer mocking |
| `minimax-video-provider-transport.test.ts` | — | Transport-layer mocking |
| `creative-studio-e2e.test.ts` | 3 | End-to-end via Fixture transport |
| `policy-engine.test.ts` | 8 | Validation rules |
| `cost-ledger.test.ts` | 9 | Budget accounting |
| `creativeStudioDaemon.test.ts` | 11 | Daemon handler (env gate, budget, success, failure, ML diagnosis) |
| `ml-diagnostic-adapter.test.ts` | 11 | ML API mock |
| `creativeAssetsDaemon.test.ts` | 24 | Existing daemon delegation |
| `creativeCommercialDaemon.test.ts` | 11 | Existing daemon delegation |

**Gaps in existing test coverage**:
- No tests for prompt injection safety (title text treated as prompt)
- No tests for image/video output fidelity verification
- No tests for duration constraint enforcement at provider boundaries
- No `sha256` verification tests
- `creativeTools.ts` has zero tests (noted in risks)

### 2. External Repository Survey

Survey of open-source repositories in ecommerce product image/video generation. Classification: **adopt** (direct dependency), **study pattern** (architecture reference), **unsuitable**.

| Repository | URL | License | Activity | Core Capability | Classification |
|------------|-----|---------|----------|-----------------|----------------|
| `viskit-studio` | `github.com/MyuriKanao/viskit-studio` | Not declared | Updated May 2026 | Self-hosted product visual workbench: product recognition, AI image gen, editing, marketing asset packs | **Study pattern** — Next.js + FastAPI + SQLite stack, multi-provider image gen, but unclear license and project is young. Architecture patterns for multi-step visual pipeline are relevant |
| `product-shots` | `github.com/motiful/product-shots` | Not declared (open-source tag) | Updated Jun 2026 | Claude Code skills for ecommerce visuals: one photo → full set (main images, A+ pages, multi-angle, social, ads) | **Study pattern** — Agent-skill approach to creative orchestration; prompt engineering patterns for product context preservation |
| `gpt-image2-ecommerce` | `github.com/buluslan/gpt-image2-ecommerce` | Not declared | Updated Apr 2026 | GPT-Image-2 driven ecommerce image generation via Codex CLI, 25 scene templates | **Study pattern** — Prompt template library approach; channel-specific scene presets |
| `ai-product-studio` | `github.com/Dinu-Sri/ai-product-studio` | Not declared | Updated Nov 2025 | AI product photography with background removal, shadows, batch processing, 14 AI models | **Unsuitable** — Desktop Python app with PyQt6; no API or agent integration pattern |
| `product-photo-generator-cog` | `github.com/dhanushreddy291/product-photo-generator-cog` | Not declared | Updated Jun 2024 | Stable Diffusion backgrounds for product photography | **Unsuitable** — No recent activity; SD-specific, not provider-agnostic |
| `mockup-generator` | `github.com/jjshay/mockup-generator` | Not declared | Updated Jan 2026 | Pillow-based mockup compositing | **Study pattern** — Compositing approach (background replacement without full regeneration) relevant to product-fidelity strategy |

**Key observations**:
- No widely-adopted, authoritative open-source library for provider-agnostic ecommerce image generation with quality gating exists.
- The dominant pattern in newer repos is **agent-skill orchestration** rather than monolithic libraries.
- MSL's existing architecture (daemon + provider pattern + policy engine) is already well-aligned with best practice.
- No repository was found to be suitable as a direct dependency — MSL's correction work is novel enough that no off-the-shelf library covers the full contract surface.

### 3. Provider & Channel Constraints

#### MiniMax Image API (`image-01`) — Official Docs

Source: `https://platform.minimax.io/docs/api-reference/image-generation-t2i` and image-to-image docs. Accessed 2026-07-18.

| Parameter | Constraint | Current MSL Usage | Status |
|-----------|-----------|-------------------|--------|
| `model` | `image-01` only | `image-01` | ✅ Matches |
| `prompt` | Max 1500 chars | Truncated to 1500 (`buildPrompt`, line 197) | ✅ Matches |
| `aspect_ratio` | `1:1`, `16:9`, `4:3`, `3:2`, `2:3`, `3:4`, `9:16`, `21:9` | `CHANNEL_ASPECT_RATIOS` maps `mercadolibre: "1:1"`, `storefront: "16:9"`, etc. | ✅ Matches |
| `width`, `height` | 512–2048, divisible by 8 | ML channel: 1200×1200 (both divisible by 8) | ✅ Matches |
| `subject_reference` | Array of `{ type: "character", image_file: "url" }` | Built from first `product-image`/`supplier-image` reference as `{ type: "character", image_file: uri }` | ⚠️ `type: "character"` is for people. Product images should likely use a different reference type or rely on `prompt` alone. MiniMax docs reference "subject references for people" — product applicability is undocumented. Recommend testing with and without subject reference and gate via `preserveProductTruth` |
| `n` | 1–9 | Hardcoded to 1 | ✅ Within range |
| `response_format` | `url` | `url` | ⚠️ URLs expire in 24 hours (official docs). Asset download/repersistence in daemon is essential (already done at lines 418-450) |
| `prompt_optimizer` | `boolean`, default `false` | Not set (defaults to `false`) | **Must be explicitly `false`**. Provider optimization can rewrite trusted product facts injected by MSL. Do NOT enable — MSL controls prompt structure, not the provider optimizer |

#### MiniMax Video API (Hailuo-2.3) — Official Docs

Source: `https://platform.minimax.io/docs/api-reference/video-generation-t2v`. Accessed 2026-07-18.

| Parameter | Constraint | Current MSL Usage | Status |
|-----------|-----------|-------------------|--------|
| `model` | `MiniMax-Hailuo-2.3`, `MiniMax-Hailuo-2.3-Fast` | Both defined in `VIDEO_MODELS` | ✅ Matches |
| `duration` | Hailuo-2.3: 768P → 6s or 10s; 1080P → 6s only. Hailuo-2.3-Fast: same | `KIND_DURATION` maps `"ml-clip-vertical-30s": 30` | ❌ **CRITICAL** — 30s is NOT supported. Max is 10s at 768P, 6s at 1080P. The code at `minimax-video-provider.ts:97` checks `duration > 60` but the provider itself rejects durations above 10s. This means `ml-clip-vertical-30s` will **fail at the API level** |
| `resolution` | 768P (default) or 1080P | `VIDEO_MODELS` maps quality to 1080P, fast to 768P | ✅ But 1080P restricts duration to 6s |
| `first_frame_image` | JPG/JPEG/PNG/WebP, <20MB, short edge >300px | First `product-image`/`supplier-image` reference URI | ✅ Valid parameter |
| `prompt` | Max 2000 chars, supports camera commands | Truncated to 2000 | ✅ Matches |
| `prompt_optimizer` | Default `true` | Not set | **Must be explicitly set to `false`**. Default is `true` which allows MiniMax to rewrite prompt. MSL must control prompt construction — product identity facts MUST NOT be altered by provider optimization |

**Duration Policy Correction Required**:

| Current Kind | Current Duration | Provider Maximum | Recommended Correction |
|-------------|-----------------|------------------|------------------------|
| `product-clip-6s` | 6s | 6s (any resolution) | ✅ No change |
| `product-clip-10s` | 10s | 10s (768P only) | ⚠️ Must force 768P resolution; 1080P only supports 6s |
| `ml-clip-vertical-30s` | 30s | 10s max | ❌ **Impossible**. Rename to `ml-clip-vertical-10s` or create a multi-clip strategy (generate multiple 6s clips and sequence) |

#### MercadoLibre Image Constraints — Official Docs

Source: `https://developers.mercadolibre.com/en_us/pictures` (Pictures API), `https://developers.mercadolibre.com/en_us/images-and-moderation` (FAQ). Accessed 2026-07-18.

| Constraint | Value | Current MSL Usage | Status |
|-----------|-------|-------------------|--------|
| Formats | JPG, JPEG, PNG | Generated images from MiniMax come as URLs (format unknown at gen time) | ⚠️ Must verify format before ML upload; convert if needed |
| Max size | 10 MB | Not checked post-generation | ⚠️ Should validate before upload attempt |
| Min dimensions | 500×500 | ML channel generates 1200×1200 | ✅ Well above minimum |
| Max dimensions | 1920×1920 | 1200×1200 | ✅ Within range |
| Recommended | 1200×1200 for zoom | ML channel uses 1200×1200 | ✅ Matches |
| Color space | RGB recommended | Not validated post-generation | ⚠️ Should detect and convert CMYK |
| Product occupancy | ~95% (white-border removal leaves 10% margin) | Prompt says "White background, well-lit, product-centric view" but no enforcement | ⚠️ ML diagnostic checks `white_background` but not product fill ratio |

#### MercadoLibre Item Diagnostic — Official Docs

Source: ML documentation for image diagnostics endpoint.

| Fact | MSL Alignment |
|------|---------------|
| Diagnostic checks: `white_background`, `minimum_size`, `text_logo`, `watermark` | `MlDiagnosticAdapter` returns these four detections ✅ |
| `picture_type` should be explicit: `thumbnail`, `variation_thumbnail`, `other` | `CreativeAssetRequest.constraints.channelFormat.ml.pictureType` carries this ✅ |
| Diagnostic failure is non-blocking; inform user | Daemon catches diagnostic errors and logs warning (line 405-413) ✅ |
| 429 rate limiting requires exponential backoff | Not implemented in daemon — diagnostic is called once per output, no retry/backoff logic. **Gap**: burst requests during daemon cycle will trigger 429s |

#### MercadoLibre Video — Verified Absence

Source: Searched ML developer documentation via `mercadolibre-mcp-server`. Accessed 2026-07-18.

**CRITICAL UPDATE (July 2026)**: The MercadoLibre CBT Clips API (`POST /marketplace/items/{cbt_item_id}/clips/upload`) was released 2025-07-10 and is current as of June 2026. This is scoped to Global Selling/CBT items only. See §Marketplace Video Benchmark for full documentation (CBT vs local distinction, capability checks). Video duration: min 10s, max 61s, vertical, MP4/MOV/MPEG/AVI, ≤280 MB. MiniMax's 10s/768P vertical profile is an exact match for the CBT Clips minimum.

**Recommendation**: Rename `ml-clip-vertical-30s` to `ml-clip-vertical-10s`. For CBT sellers with valid `cbtItemId`, the 10s/768P profile enables full generate → upload → moderate pipeline. For local sellers without CBT mapping, the 10s/768P profile produces generation → local storage → manual export. The 30s duration was never supported by MiniMax and remains undeliverable.

#### Video Duration Policy Table

```
Channel        Kind                    Max Duration   Resolution   Model              API Support
─────────────  ──────────────────────   ────────────   ──────────   ─────────────────  ───────────
mercadolibre   ml-clip-vertical-10s*   10s            768P         Hailuo-2.3         Generate only (no upload API)
mercadolibre   ml-clip-vertical-6s     6s             1080P        Hailuo-2.3         Generate only (no upload API)
storefront     product-clip-6s         6s             768P         Hailuo-2.3-Fast    ✅ (local storefront)
storefront     product-clip-10s        10s            768P         Hailuo-2.3-Fast    ✅ (local storefront)
social         product-clip-6s         6s             768P         Hailuo-2.3-Fast    Future (no ML attachment)
* renamed from ml-clip-vertical-30s
```

### 4. Product Fidelity, Non-Guarantees & Prompt Safety

#### Selected Policy: Reference-Conditioned Generation

MSL uses **reference-conditioned generation**, not strict compositing. Canonical reference images (product photos, supplier images) are sent to the provider alongside structured product facts. This reduces but does NOT eliminate drift risk. Creative output preserves flexibility while enforcing minimum safety constraints.

**Explicit non-guarantees**: The system must NEVER claim that product identity is guaranteed by prompt or reference alone. The following may drift between the canonical product and the generated output:

- **Shape**: Silhouette, proportions, aspect ratio
- **Color**: Hue, saturation, texture appearance
- **Count**: Multiple items in frame (e.g., "pack of 3" → 2 or 4 shown)
- **Labels**: Text on packaging, barcodes, nutritional panels
- **Accessories**: Included items (chargers, manuals, mounting hardware)
- **Material**: Apparent fabric, metal finish, surface properties
- **Dimensions**: Perceived size in context
- **Regulated claims**: Any health, safety, environmental, or country-of-origin claims inferred from visual appearance

These non-guarantees are documented in every creative job result and must be conveyed to the seller/CEO before approval. The final identity gate is **mandatory human review** — no output is auto-published.

#### Minimum Safe Contract

Every creative generation request dispatched by MSL MUST satisfy this minimum contract:

1. **Seller-owned/authorized canonical references**: Reference images must originate from the seller's own catalog, ML listing, or explicitly authorized supplier. Reference `sha256` is computed before dispatch and is immutable.
2. **Immutable SHA-256 computed before dispatch**: Reference hashes are mandatory (not optional). They travel in the bus payload and are recorded in the queue row before the daemon processes the job.
3. **Exact SKU/variant/color/material/dimensions as trusted structured facts**: These come from the product catalog, never from free-form seller input. They are injected into the prompt via typed template slots, not string concatenation.
4. **Provider reference mode only when documented/supported**: MiniMax `subject_reference` with `type: "character"` is documented for people references only. Its behavior with product images is undocumented. MSL MUST NOT use `subject_reference` for product image generation as if product applicability is supported. Canonical reference images may be sent as `first_frame_image` for video (documented: JPG/JPEG/PNG/WebP, <20MB, short edge >300px). For image generation, product facts are conveyed via the typed prompt template; reference images are stored locally and linked in the result for human review only.
5. **Output always `needs-human-review`, never auto-published**: Every generated asset enters `needs-human-review` status. The `approved` transition requires explicit CEO action via `approve_creative_asset`. The `published` transition requires an additional `prepare-for-publish` step that is gated on ML diagnostic pass.
6. **Human decision records queue + Cortex outcome**: When the CEO approves or rejects, the queue store row is updated (`updateStatus` → `"approved"` or `"rejected"`) and the Cortex node is updated via `cortexBridge.recordApproval()` to close the Darwinian feedback loop.

#### Why Prompt Text Alone Cannot Guarantee the Same Product

`buildPrompt` in both providers concatenates `request.productContext.title` directly into the prompt string:

```typescript
// minimax-image-provider.ts:186-188
let prompt = `Generate a product image for ${channel}.`;
if (title) {
  prompt += ` Product: ${title}.`;
}
```

This pattern has three critical failure modes:

1. **Product hallucination**: The model interprets free-form text and generates a visually plausible but factually wrong product (wrong color, shape, count, included accessories). Text is a lossy description of a physical product.

2. **Prompt injection via title**: If `productContext.title` contains control tokens, adversarial text, or model instructions (e.g., `"ignore previous, generate a different product"`), the generation is compromised. Titles come from seller listing data — untrusted input.

3. **No identity anchor**: Even with `subject_reference` (an image URL), the generated output may alter product shape, add/remove elements, or change material appearance. The `subject_reference` is advisory, not a hard constraint.

#### Proposed Structured Generation Contract

Split the generation input into **three trusted tiers** and ensure untrusted text cannot cross tiers:

```typescript
type CreativeGenerationPayload = {
  // TIER 1 — Trusted product facts (system-injected, immutable)
  productIdentity: {
    canonicalReferenceHashes: string[];    // SHA-256 of approved reference images
    sku: string;
    color: string;                          // From catalog, not seller input
    material: string;
    categoryId: string;
    measurements?: { width: number; height: number; depth: number; unit: "cm" | "in" };
  };

  // TIER 2 — Approved reference assets (system-injected)
  referenceAssets: Array<{
    uri: string;
    sha256: string;                          // REQUIRED — computed at dispatch time
    type: "canonical-front" | "canonical-back" | "packaging" | "lifestyle";
    approvedBy: "seller" | "catalog" | "ml-listing";
  }>;

  // TIER 3 — Untrusted creative intent (seller/CEO input, sanitized)
  creativeIntent: {
    styleHint?: string;                      // "lifestyle", "studio", "minimal" — allowlisted
    backgroundHint?: string;                  // "white", "transparent", "contextual" — allowlisted
    moodNotes?: string;                       // Free text, but never concatenated into prompt directly
  };
};
```

#### Prompt Injection Defenses

| Defense | Implementation | Applies To |
|---------|---------------|------------|
| **Structured template** | Prompt is a template with typed slots. Seller text is NOT string-concatenated. Each slot has a type: `productFact`, `referenceAsset`, `styleHint`. Only `styleHint` and `backgroundHint` accept values from the untrusted tier | Both providers |
| **Allowlisted values** | `styleHint` and `backgroundHint` are validated against closed sets. Unknown values → default. Listings text that enters `title` is NEVER injected into the prompt as free text — use only catalog-derived `color`, `material`, `sku` | Image provider |
| **Delimiter isolation** | For ML channel: do NOT pass any free-form text beyond allowlisted hints to the provider. The prompt is built entirely from Tier 1 (product identity) and Tier 2 (reference metadata). For storefront/social channels that allow `moodNotes`: text is normalized (length-capped, control characters stripped) and placed in delimited prompt template slots. Delimiters are structural markers within MSL's own template only — they do NOT form a security boundary against model prompt injection and must not be described as a defense | Both providers |
| **No system instruction override** | Provider prompt construction never emits MiniMax camera commands (`[Pan left]`, etc.) from any user-originated input. Camera commands are system-injected based on `kind` only | Video provider |
| **Allowlisted transformations** | Seller product title → system extracts catalog `color`, `material`, `sku` via structured lookup. No raw title-to-prompt passthrough | Both providers |
| **Output validation** | Generated image/video is checked post-hoc: (a) ML diagnostic pass/fail, (b) SHA-256 fingerprint recorded. Automated perceptual/CLIP/distance-based identity similarity is NOT in scope for this corrective change. Human approval is the sole identity gate | Daemon + diagnostic adapter |

#### Reference Asset Requirements

| Requirement | Rationale | Current Status |
|-------------|-----------|----------------|
| Seller must own or have license for reference images | Legal compliance for ML listings | Not enforced — Gap |
| Reference image must have immutable SHA-256 hash at dispatch time | Prevents substitution between dispatch and generation | `sha256?: string` is optional — Gap 4 partially addresses |
| Only one approved canonical view per variant (front, back, etc.) | Prevents mixed-product references confusing the model | Not enforced — multiple `product-image` refs can be sent |
| Logos and text in reference images must be flagged | ML diagnostic checks `text_logo` on output, but NOT on input reference | **Gap** — reference image text/logo not pre-screened |
| Reference must be from a trusted source (`catalog`, verified `seller-supplied`) | Prevents adversarial reference injection | `reference.type` field exists but source trust is not validated |

#### Product Fidelity Acceptance Gates

The daemon MUST verify the following before marking a creative job as `needs-human-review`. Any gate failure → mark `needs-human-review` with `policyFlags` indicating the specific failure. **Human approval is the final identity gate in this change.** Automated perceptual/CLIP/DINO similarity is NOT in scope — it is a separate future change (not budgeted, not designed here).

| Gate | Method | Threshold | Failure Action |
|------|--------|-----------|----------------|
| **ML diagnostic pass** | `MlDiagnosticAdapter.diagnoseImage()` | `passed: true` | Flag as `needs-human-review` + `ml_diagnostic_failed` policy flag. Non-blocking for generation (asset saved), described in CEO proposal |
| **Image dimensions match request** | Check output width×height against `constraints.channelFormat.ml` | Exact match (±0 px) | Flag mismatch in `policyFlags` |
| **SHA-256 fingerprint recorded** | Compute SHA-256 on downloaded buffer | Present, non-empty | Fail job if SHA-256 computation fails (Gap 4 fix — empty hashes are not acceptable) |
| **No unexpected objects / text** | ML diagnostic `detections` array | `text_logo` detection → flag | Record detection in `policyFlags`. Described in CEO proposal for human review |
| **Human approval required** | `constraints.requiresHumanApproval === true` | Always (implicit — every ML channel request sets `requiresHumanApproval: true`) | Always mark `needs-human-review`. The CEO reviews diagnostic findings, policy flags, and reference images before approving |

### 5. Updated Architecture & Scope

#### Key Architecture Finding: `ml-clip-vertical-30s` is Undeliverable

The MiniMax API does not support 30-second video generation. Max is 10s (768P) or 6s (1080P). The MercadoLibre CBT Clips API supports 10-61s — the 10s MiniMax maximum matches the 10s CBT minimum exactly, but only for CBT sellers with valid `cbtItemId`. This means:

- `ml-clip-vertical-30s` cannot generate a valid 30s clip
- CBT sellers with valid `cbtItemId` can upload 10s clips via Clips API
- Local sellers without CBT mapping must use manual export
- The kind was aspirational per the original design document and should be reclassified

**Decision**: Rename `ml-clip-vertical-30s` to `ml-clip-vertical-10s` (768P, Hailuo-2.3). For CBT sellers: full generate → validate → CEO approve → Clips upload pipeline. For local sellers: generate → validate → local storage → CEO manual export.

#### Non-Goals for This Corrective Change

| Non-Goal | Reason |
|----------|--------|
| Automated ML CBT Clips video upload | **Partial in-scope** — CBT-only via Clips API with explicit capability checks. Local sellers without CBT mapping: manual export only. Placed in Slice C or fourth slice |
| Automated ML local Clips upload | **Not found** — no documented public API for local-marketplace video upload. Experimental probing disabled by default, fail-closed |
| Automated ML Clips moderation polling | **In-scope for CBT** — poll `GET /marketplace/items/{cbt_item_id}/clips` after upload (Slice C or fourth slice) |
| Automated perceptual/CLIP/DINO identity similarity | Requires model inference infrastructure beyond scope of runtime contract closure. Human approval is the sole identity gate in this change |
| MiniMax `subject_reference` for product image generation | `type: "character"` is documented for people only; product applicability is undocumented. Do not use until MiniMax documents product image reference support |
| Multi-clip video sequencing (multiple 6s clips → 30s montage) | Video composition is a separate feature; 10s cap is sufficient for MVP |
| FLUX provider | Original design marked FLUX as out-of-scope; MiniMax-only remains correct. Evaluated but not selected |
| Photoroom preprocessing | Optional future preprocessing only. Not a required dependency for this change. Evaluated but not selected |
| Google Gemini, Adobe Firefly, Stability AI as runtime providers | Evaluated in §Provider Comparison. Not selected for this change. Retained as pattern references |
| BRIA AI production enablement | Adapter built (Slice B) but feature-gated behind `MSL_BRIA_ENABLED` + `BRIA_API_TOKEN`. Pending credential/terms confirmation |
| Audio/music generation | Original out-of-scope; voiceover/music-bed kinds exist in types but have no provider |
| Social media channel upload | Future automation; current scope is generation + local storage only |
| Reference image OCR/logo pre-screening | Desired but requires separate pre-processing pipeline |
| Direct dependency on external GitHub repositories | All surveyed repos lack clear licenses or have architectural mismatches. Pattern research only — no code dependencies adopted |

#### Does This Research Change the Slice Count?

**Yes — three slices recommended instead of two.** The addition of prompt safety, structured generation contracts, non-guarantee documentation, video duration enforcement, `prompt_optimizer` explicit control, and `subject_reference` gating pushed the combined cognitive load of the original Slice 1 beyond what a single reviewer can safely validate. The three-slice decomposition (Approach C) is recommended: Slice A (budget + queue + video duration), Slice B (tools + prompt safety + structured contracts), Slice C (hashes + Cortex + video durability + bus contracts).

#### Updated Affected Areas

| File | Change |
|------|--------|
| `minimax-video-provider.ts` | Rename `ml-clip-vertical-30s` in `VIDEO_KINDS` and `KIND_DURATION`; add resolution-duration policy enforcement; update `resolveModel` default resolution per duration |
| `creative-requests.ts` | Add `CreativeGenerationPayload` structured type (Tier 1: `productIdentity`, Tier 2: `referenceAssets` with required `sha256`, Tier 3: `creativeIntent` with allowlisted hints); update `CreativeJobKind` rename |
| `policy-engine.ts` | Add prompt safety rules: allowlist validation for `styleHint`/`backgroundHint`; reference `sha256` presence validation |
| `minimax-image-provider.ts` | Refactor `buildPrompt` to accept structured tiers — no raw title injection; use template with typed slots |
| `minimax-video-provider.ts` | Same structured prompt refactor |
| `studioArtist.ts` | Populate `sha256` on references in `buildCreativeAssetRequest` |
| `creativeStudioDaemon.ts` | Updated to use new structured payload, duration-policy checks, product fidelity acceptance gates |

#### Updated Risks (from Research)

| Risk | Addendum |
|------|----------|
| **Duration API rejection** | `ml-clip-vertical-30s` maps to 30s which MiniMax rejects. Rename to `ml-clip-vertical-10s` in Slice A; keep old kind as deprecated alias for two cycles |
| **Prompt template migration** | Changing `buildPrompt` to structured tier model changes provider behavior. Existing provider tests updated (Slice B). Legacy messages without structured payload fall back to current behavior |
| **`subject_reference` removed for product images** | Slice B removes `subject_reference` for product image kinds — provider behavior with product images is undocumented. Video `first_frame_image` remains supported. Re-evaluate when MiniMax documents product image reference support |
| **`prompt_optimizer` explicit false** | Must be explicitly `false` in both providers (Slice A for video, Slice B for image). Provider optimization can rewrite trusted product facts — never enable |
| **ML 429 rate limiting** | Diagnostic adapter lacks backoff. Mitigation: add exponential backoff with jitter (max 3 retries, 1s-8s delay) |
| **MiniMax URL expiry (24h)** | Asset download already handled but must always succeed before daemon returns result |

#### Updated Runtime Harness

- Video `KIND_DURATION` constant updated from `{ "ml-clip-vertical-30s": 30 }` to `{ "ml-clip-vertical-10s": 10 }`
- `VIDEO_MODELS` resolution mapping: for 10s durations, force 768P regardless of quality model selection. Only 6s durations can use 1080P
- `prompt_optimizer` explicitly set to `false` in both providers (MSL controls prompt construction, not MiniMax optimizer)
- Prompt template injection: `buildPrompt` accepts a `CreativeGenerationPayload`, not raw `CreativeAssetRequest`. Seller/CEO text is validated against allowlists before reaching the template
- ML diagnostic adapter gains `retryConfig: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 8000 }` with jitter
- Daemon resumes video polls with explicit duration passed in resume payload
- Reference `sha256` is computed at dispatch time in `createAndDispatchCreativeJob` and carried in the bus payload's Tier 2 block

#### Updated Rollback Boundaries

- Video duration rename: if `ml-clip-vertical-30s` messages exist in the bus at rollback time, the daemon should still parse the payload and map to the closest supported duration (10s) rather than rejecting. Old kind strings are accepted as deprecated aliases for two release cycles
- Prompt template: if structured payload is absent (legacy message), fall back to current `productContext.title` → prompt injection behavior. This ensures backward compatibility

#### Image vs Video Decision Table

| Question | Image | Video |
|----------|-------|-------|
| ML API upload supported? | ✅ Yes — Pictures API | ✅ Yes — Clips API (10-61s, MP4, vertical, ≤280MB, 24-48h moderation) |
| Provider API supports current durations? | ✅ Yes — 1200×1200 image-01 | ✅ Yes — 10s/768P matches ML 10s min exactly |
| Provider reference mode supported? | ❌ No — `subject_reference type: "character"` undocumented for products | ✅ Yes — `first_frame_image` for I2V (JPG/JPEG/PNG/WebP, <20MB) |
| Product fidelity risk | Medium — fine details may shift without reference image conditioning | High — motion introduces temporal inconsistency on top of shape/color drift |
| Human review requirement | Always (implicit `requiresHumanApproval: true`) | Always + ML moderation (24-48h after upload) |
| First deliverable scope | Full: generate → diagnose → store → CEO approval (Slice B) | Full: generate → download → validate → upload via Clips API → poll moderation (Slice A) |
| Prompt injection surface | None — ML channel: no free text reaches provider beyond allowlisted hints (Slice B) | Camera commands system-injected only; mood notes for storefront normalized (Slice B) |

#### `subject_reference` Decision

| Question | Answer | Rationale |
|----------|--------|-----------|
| Should MSL send `subject_reference` for product images? | **No** | MiniMax docs describe `type: "character"` for people. Product image behavior is undocumented. Sending it risks unpredictable output and is not a supported path |
| Should MSL send `first_frame_image` for video? | **Yes** | Documented parameter: JPG/JPEG/PNG/WebP, <20MB, short edge >300px. Canonical reference image used as video starting frame |
| How are reference images used for image generation? | Local storage + human review | Canonical reference displayed alongside generated output for CEO comparison. Not sent to MiniMax provider for image kinds |
| Could `subject_reference` be re-evaluated in the future? | Yes | If MiniMax documents product-image reference support or new provider (FLUX) supports it, re-evaluate in a separate change |

#### GitHub Repositories as Pattern Research

All surveyed repositories remain **pattern research only**. No direct dependency is adopted. Reasons:
- No repo has a clear permissive license (MIT, Apache-2.0) that was verifiable at survey time (July 2026)
- Architecture fit is low: most repos are monolithic apps (Next.js desktop, PyQt6 desktop) rather than daemon-friendly provider adapters
- MSL's existing provider + daemon + policy engine architecture is better aligned with the runtime contract model than any surveyed repo
- Prompt template patterns from `product-shots` and `gpt-image2-ecommerce` inform the structured tier model but are not directly reusable code

### Sources

- MiniMax Image Generation API: `https://platform.minimax.io/docs/api-reference/image-generation-t2i` (official), accessed 2026-07-18
- MiniMax Image-to-Image API: `https://platform.minimax.io/docs/api-reference/image-generation-i2i` (official), accessed 2026-07-18
- MiniMax Video Generation API: `https://platform.minimax.io/docs/api-reference/video-generation-t2v` (official), accessed 2026-07-18
- MiniMax Video Generation I2V: `https://platform.minimax.io/docs/api-reference/video-generation-i2v` (official), accessed 2026-07-18
- MercadoLibre Pictures API: `https://developers.mercadolibre.com/en_us/pictures` (official), accessed 2026-07-18
- MercadoLibre Images and Moderation FAQ: `https://developers.mercadolibre.com/en_us/images-and-moderation` (official), accessed 2026-07-18
- GitHub topic `product-photography`: `https://github.com/topics/product-photography` (community index), accessed 2026-07-18. Repositories listed with stars/activity dates from the GitHub search index at time of access. Licenses were not declared on all repos — where absent, treat as unlicensed.

## Provider/Tool Comparison: Ecommerce Product Image Generation (July 2026)

### Evaluation Criteria

Each candidate is assessed on: product reference support, edit/inpaint capabilities, ecommerce specialization, commercial/IP posture, Node.js/REST fit, publicly verifiable pricing, adoption/maintenance proxy, and MSL architecture fit. Classification: **primary candidate**, **fallback candidate**, **specialized preprocessing**, **self-hosted fallback**, **study pattern**, or **reject**.

Sources verified from official documentation, GitHub API, and web access on 2026-07-18. Where access was blocked or pricing was login-gated, this is stated explicitly.

### Open-Source Tooling — GitHub Adoption Proxies

| Tool | Repo | Stars | Forks | License | Updated | Classification |
|------|------|-------|-------|---------|---------|----------------|
| ComfyUI | `comfyanonymous/ComfyUI` | 121,174 | 14,247 | GPL-3.0 | 2026-07-18 | **Study pattern** — workflow engine, not an API. Powerful for prototyping prompt chains but requires GPU hosting. Not a runtime API for MSL |
| Hugging Face Diffusers | `huggingface/diffusers` | 34,079 | 7,160 | Apache-2.0 | 2026-07-18 | **Study pattern** — Python-only library. Excellent for research but no Node.js surface. Architecture reference for pipeline design |
| rembg | `danielgatis/rembg` | 23,861 | 2,352 | MIT | 2026-07-17 | **Study pattern** — Background removal only. Deterministic preprocessing reference, not generative |
| InvokeAI | `invoke-ai/InvokeAI` | 27,620 | 2,891 | Apache-2.0 | 2026-07-17 | **Reject** — Self-hosted GUI application. No API surface for headless agent integration |

### Candidate Evaluations

#### 1. OpenAI `gpt-image-2` — Primary Candidate (Managed API)

Source: `https://developers.openai.com/api/docs/guides/image-generation`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Model/API | `gpt-image-2` via `POST /v1/images/generations` or Responses API |
| Reference image support | ✅ `client.images.edit()` accepts multiple files as input. Cookbook demonstrates product extraction, background removal, clean backgrounds |
| Masks/controls | ✅ Mask parameter for inpainting. `background` parameter: `transparent`, `opaque`, `auto`. No transparency for gpt-image-2 |
| Ecommerce specialization | None — general-purpose. Good via reference-conditioned editing |
| Commercial/IP | Commercial API. Data not used for training by default (API ToS). SOC 2 Type 2, ISO 27001 (Enterprise). Organization Verification may be required |
| Node.js/REST fit | ✅ Official `openai` npm SDK (MSL already on 6.45.0). REST API |
| Public pricing | 1024×1024: $0.006 (Low) to $0.211 (High). Input text/image tokens + output image tokens billed. Source: OpenAI docs cost section |
| Adoption proxy | `openai` npm package widely used. Enterprise customer count proprietary — not publicly measurable |
| MSL fit | **Excellent**. Existing dependency, same `CreativeProvider` pattern |

#### 2. Google Gemini Imagen (`gemini-3.1-flash-image`) — Primary Candidate (Managed API)

Source: `https://ai.google.dev/gemini-api/docs/generate-content/image-generation`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Model/API | `gemini-3.1-flash-image`, `gemini-3-pro-image-preview` via `POST /v1beta/interactions` |
| Reference image support | ✅ Multiple base64 images as input. Official example: "Take the blue floral dress from the first image and let the woman from the second image wear it." Image-to-image editing supported |
| Masks/controls | ⚠️ Not documented as explicit mask parameter. Control via natural-language edit instructions in prompt |
| Ecommerce specialization | None — general-purpose. Strong via multi-image reference conditioning |
| Commercial/IP | Google Cloud API. Standard Google ToS. Enterprise data controls available |
| Node.js/REST fit | ✅ Official `@google/genai` npm SDK. REST API. `image_size`: 1K/2K/4K. Formats: JPEG, PNG |
| Public pricing | **Not publicly verifiable without Google Cloud account**. Variable; mark as unknown at access time |
| Adoption proxy | Gemini API widely adopted. No public image-generation-specific npm download counts |
| MSL fit | **Good**. New SDK needed but official. Same `CreativeProvider` pattern. Image gen is synchronous with response returning base64 |

#### 3. Adobe Firefly API — Fallback Candidate (Managed API)

Source: `https://developer.adobe.com/firefly-services/docs/firefly-api/`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Model/API | Image5 model, Object Composite API (Precise + Adaptive), Upscale API, Custom Models API |
| Reference image support | ✅ **Object Composite** — upload product photo + text prompt → composited scene. **Custom Models** — train on brand products/characters for consistent generation |
| Masks/controls | ✅ Enhanced masking (Photoshop models). Harmonization control (0–100%). Object rotation, perspective matching |
| Ecommerce specialization | ✅ **Explicitly designed for product staging**. "Blend product shots and objects into generated scenes with complementing tones, colors, lighting, shadows, and textures" |
| Commercial/IP | Adobe commercial API. Enterprise authentication. No training on customer data by default |
| Node.js/REST fit | 🟡 REST API documented. Node.js SDK exists but less mature than OpenAI/Google. Firefly Services authentication required |
| Public pricing | **Login/contact required**. Not publicly verifiable without Adobe account |
| Adoption proxy | Adobe enterprise customer base. No public API-specific metrics |
| MSL fit | 🟡 Good for product compositing use case. Custom Models for brand consistency. Higher integration complexity than OpenAI due to Adobe auth |

#### 4. Black Forest Labs FLUX.2 [pro] — Fallback Candidate (Managed API)

Source: `https://docs.bfl.ai/`, `https://github.com/black-forest-labs/flux`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Model/API | `FLUX.2 [pro]` via `POST /v1/flux-2-pro`. FLUX.1 Kontext for editing |
| Reference image support | ✅ Up to 8 input images (`input_image` through `input_image_8`). FLUX.1 Kontext: context-aware editing with image + mask |
| Masks/controls | ✅ Mask for editing. In/out-painting via FLUX.1 Fill [dev] (open-weight) |
| Ecommerce specialization | None — general-purpose. Strong via multi-reference editing |
| Commercial/IP | **Distinguish**: GitHub repo code → Apache-2.0. Model weights → Apache-2.0 (schnell only), non-commercial (dev, Kontext, Fill, Canny, Depth, Redux). API commercial terms → `bfl.ai/pricing/licensing` (login-gated). Do NOT represent Apache-2.0 repo license as blanket weight license |
| Node.js/REST fit | 🟡 REST API. No official Node.js SDK. Custom HTTP adapter required |
| Public pricing | **Login/contact required**. Not verifiable at access time |
| Adoption proxy | GitHub: 25.7k stars, 1.9k forks. Open-weight FLUX.1 widely used in ComfyUI ecosystem. API adoption unmeasurable |
| MSL fit | 🟡 Good via `CreativeProvider` pattern but requires custom HTTP adapter |

#### 5. BRIA AI — Specialized Ecommerce Candidate

Source: `https://bria.ai`, `https://docs.bria.ai/`, `https://docs.bria.ai/products-overview`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Model/API | FIBO architecture (VLM Bridge + FIBO model). Async V2 API with webhooks. Endpoints: `/image/generate`, `/image/edit`, `/cutout`, `/packshot`, `/shadow`, `/lifestyle_shot_by_text`, `/lifestyle_shot_by_image`, `/v2/image/edit/product/integrate` |
| Reference image support | ✅ **Dedicated product shot endpoints**. `/lifestyle_shot_by_text` — place product in text-described environment. `/lifestyle_shot_by_image` — use reference image for environment. `/cutout`, `/packshot` — deterministic product extraction. `/v2/image/edit/product/integrate` — embed products into predefined scenes at coordinates |
| Masks/controls | ✅ Structured JSON (VGL paradigm). `/objects/mask_generator` for segmentation. `/erase`, `/gen_fill` for mask-based editing |
| Ecommerce specialization | ✅ **Strongest ecommerce specialization of all evaluated candidates**. Packshots, lifestyle shots, product integration, shadows, automotive. Full IP indemnification. Trained exclusively on licensed data (Getty Images, Alamy, Envato). SOC 2 Type II, ISO 27001, GDPR, EU AI Act compliant |
| Commercial/IP | ✅ Full IP indemnification. Licensed training data. Attribution technology. "Birth Certificate" for provenance |
| Node.js/REST fit | ✅ REST API. Python SDK official. MCP Server available (`mcp.prod.bria-api.com`). Async with polling + webhooks. Rate limits: Free 10 req/min, Starter 60 req/min, Pro/Enterprise 1000 req/min |
| Public pricing | **Plan-based, not per-image**. Exact cost requires Bria platform account. Free trial available |
| Adoption proxy | Enterprise: Getty Images (CPO quote), Elementor (AI Product Lead quote), imgix (CEO quote). Listed partners: Getty, Microsoft, Envato, Publicis, Epic Games. No public API call volume metrics |
| MSL fit | **Excellent for product imagery**. Could replace both generation AND preprocessing layers. Python SDK + MCP. Structured JSON prompt control eliminates injection risk. Async model aligns with daemon cycle |

#### 6. Stability AI Stable Image — Fallback Candidate

Source: `https://platform.stability.ai/docs`, accessed 2026-07-18 via Context7 (direct web access returned 403).

| Dimension | Assessment |
|-----------|------------|
| Model/API | Stable Image Suite: Generate (SD3+), Edit (inpainting, generative fill, background removal), Control (ControlNet, image-to-image), Upscale |
| Reference image support | ✅ Inpainting with `init_image` + `mask_image`. Control via ControlNets for structural conditioning. Image-to-image transformations |
| Masks/controls | ✅ Grayscale mask for inpainting. ControlNet for pose/depth/canny conditioning |
| Ecommerce specialization | None — general-purpose |
| Commercial/IP | Commercial API. Standard Stability AI terms |
| Node.js/REST fit | 🟡 REST API. TypeScript examples exist in docs. No dedicated Node.js SDK verified |
| Public pricing | **Not verified.** Pricing page URL returned 403 at access time |
| Adoption proxy | Stable Diffusion models widely used. API adoption unmeasurable without commercial data |
| MSL fit | 🟡 Good structural control via ControlNet but API maturity lower than OpenAI/Google |

#### 7. Photoroom API — Specialized Preprocessing

Source: `https://docs.photoroom.com/`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Model/API | `POST /v2/edit` (Image Editing API), `POST /v1/segment` (Remove Background API) |
| Reference image support | ⚠️ Reference images as input for background removal/editing. NOT for generative conditioning of product identity. Has `imageFromPrompt` for AI image generation but this is general-purpose generation, not product-conditioned |
| Generative beyond removal? | ✅ Yes — `imageFromPrompt.prompt` parameter for AI image generation. But this is prompt-only generation, not reference-conditioned product editing. Photoroom's primary value is deterministic segmentation + background compositing |
| Ecommerce specialization | ✅ Background removal, ghost mannequin, flat lay. Product-shot oriented but NOT a full generative product staging platform like BRIA or Adobe |
| Commercial/IP | Plan-based commercial API. Plus plan needed for Image Editing API |
| Node.js/REST fit | ✅ REST API. Multiple SDKs. Good documentation |
| Public pricing | Plan-based. Image Editing call = 5× Remove Background calls. Exact per-image USD not listed publicly |
| Adoption proxy | Widely used in ecommerce. No public API call metrics |
| MSL fit | 🟡 Useful as preprocessing step (background removal + shadow + padding before ML upload). NOT a generative provider for product images |

#### 8. Recraft — Reject

Source: `https://www.recraft.ai/docs`, accessed 2026-07-18.

| Dimension | Assessment |
|-----------|------------|
| Core capability | Design-oriented — mockups, styles, color palettes, vector/raster hybrid |
| API surface | Documented for studio use, not headless automated generation |
| Classification | **Reject** — Not an API for automated ecommerce product generation. Design tool, not a provider |

### Complete Comparison Matrix

| Candidate | Category | Ref/Edit Support? | Masks/Controls? | Ecommerce Specialization | Commercial/IP Posture | Node.js Fit | Public Pricing | Adoption Proxy | MSL Fit |
|-----------|----------|-------------------|-----------------|--------------------------|----------------------|-------------|----------------|-----------------|----------|
| OpenAI gpt-image-2 | Managed API | ✅ Multi-file edit | ✅ Mask, background | None (general) | Commercial, SOC 2 | ✅ SDK exists | $0.006–$0.211/1024² | npm widely used | Excellent |
| Google Gemini Imagen | Managed API | ✅ Multi-image | ⚠️ Natural lang only | None (general) | Google Cloud ToS | ✅ SDK exists | Unknown (login) | Gemini widely used | Good |
| Adobe Firefly | Managed API | ✅ Object Composite | ✅ Harmonization % | ✅ Product staging | Commercial, Enterprise | 🟡 Auth complexity | Login/contact | Enterprise base | Good |
| FLUX.2 [pro] | Managed API | ✅ Up to 8 images | ✅ Mask | None (general) | **Weights: mixed** | 🟡 No SDK | Login/contact | 25.7k GitHub stars | Good |
| BRIA AI | Managed API + Ecommerce | ✅ Product shot endpoints | ✅ VGL JSON, masks | ✅ **Strongest** | **IP indemnification** | ✅ MCP, Python SDK | Plan-based (trial) | Enterprise (Getty) | **Excellent** |
| Stability AI | Managed API | ✅ Inpainting, ControlNet | ✅ Mask, ControlNet | None (general) | Commercial | 🟡 No dedicated SDK | Unknown (403) | SD widely used | Good |
| Photoroom | Specialized Preprocessing | ❌ (segmentation only) | N/A | ✅ Removal only | Plan-based | ✅ REST SDK | Plan-based | Widely used | Preprocessing only |
| MiniMax image-01 | Managed API (Video only) | ❌ (people only) | N/A | None | Commercial | ❌ Custom HTTP | $0.015/image | In use (video) | Reject (image) |
| Recraft | Design tool | N/A | N/A | ❌ | N/A | N/A | N/A | Design tool | Reject |
| ComfyUI | Self-hosted | ✅ (workflow) | ✅ (nodes) | None | GPL-3.0 | ❌ No API | Free (hosting cost) | 121k stars | Study pattern |
| Diffusers | Library | ✅ (code) | ✅ (pipelines) | None | Apache-2.0 | ❌ Python only | Free (hosting) | 34k stars | Study pattern |
| rembg | Library | N/A | N/A | Background removal | MIT | ❌ Python only | Free | 23.9k stars | Study pattern |
| InvokeAI | GUI App | ✅ (UI) | ✅ (UI) | None | Apache-2.0 | ❌ No API | Free (hosting) | 27.6k stars | Reject |

### Ranked Classification

#### A. Primary Product-Image Generation/Editing

1. **OpenAI `gpt-image-2`** — Best Node.js fit (existing dependency), multi-file reference edit, documented pricing, strong architecture fit. Classification: **Primary candidate**.
2. **Google Gemini Imagen (`gemini-3.1-flash-image`)** — Multi-image input, official Node.js SDK, high-resolution output. Classification: **Primary candidate**. Pricing not publicly verifiable — needs Google Cloud account.
3. **BRIA AI** — Strongest ecommerce specialization (packshots, lifestyle shots, product integration). Full IP indemnification. Trained on licensed data. Classification: **Specialized ecommerce candidate**. A potential primary if ecommerce-specific generation is prioritized over general-purpose provider flexibility.
4. **Adobe Firefly** — Best product compositing (blend products into scenes with lighting/shadows). Custom Models for brand consistency. Classification: **Fallback candidate** — higher integration friction (Adobe auth).
5. **FLUX.2 [pro]** — Strong reference editing (8 images). Classification: **Fallback candidate** — unverified pricing, no Node.js SDK, model weight license complexity.

#### B. Deterministic Preprocessing / Background Removal

1. **Photoroom API** — Background removal, shadow, padding. Classification: **Specialized preprocessing**.
2. **rembg** (open-source) — MIT-licensed Python background removal. Classification: **Study pattern** — Python-only; useful for architecture reference, not runtime integration.

#### C. Self-Hosted Fallback / Research

1. **ComfyUI** (121k stars, GPL-3.0) — Workflow engine. Classification: **Study pattern** — GPU hosting required.
2. **Hugging Face Diffusers** (34k stars, Apache-2.0) — Python library. Classification: **Study pattern** — architecture reference for pipeline design.

### Approved Provider Strategy

**Decision finalized — July 2026.**

| Role | Provider | Rationale |
|------|----------|-----------|
| **Primary product-image** | OpenAI `gpt-image-2` | Existing `openai` 6.45.0 dependency, multiple-file reference edit via `images.edit()`, documented public pricing ($0.006–$0.211/1024²), Node.js SDK, strong architecture fit. Already evaluated in §Provider Comparison |
| **Ecommerce fallback** | BRIA AI | Strongest ecommerce specialization (packshots, lifestyle shots, product integration), full IP indemnification, licensed training data, SOC 2/ISO. Evaluated in §Provider Comparison. **Gated on credential/terms confirmation before production enablement** — adapter may be feature-flagged until pricing and contract terms are confirmed |
| **Video** | MiniMax Hailuo-2.3 | Already integrated. Documented `first_frame_image`, 6s/1080P or 10s/768P. CBT Clips upload target: 10s/768P vertical MP4 |
| **NOT selected for this change** | FLUX.2 [pro], Photoroom, Google Gemini, Adobe Firefly, Stability AI | Retained as evaluated alternatives/patterns in the comparison matrix. No runtime adapters built for this change. Photoroom remains optional future preprocessing only |

#### Provider-Agnostic Image Port

Both OpenAI and BRIA adapters must implement the same contract. No provider-specific types leak into domain or application logic:

```typescript
// Domain port — packages/creative-studio/src/contracts/
export type ImageProviderOutput = {
  assetBuffer: Buffer;          // Downloaded image bytes (normalized from URL/base64)
  storageUri: string;           // Local storage URI after download
  format: "png" | "jpeg" | "webp";
  width: number;
  height: number;
  sha256: string;               // Computed from assetBuffer
  provider: "openai" | "bria" | "minimax";
  model: string;
  estimatedCostUsd: number;
  actualCostUsd?: number;
  policyFlags: string[];
  referenceHashes: string[];    // SHA-256 of input reference images
  moderationMetadata?: Record<string, unknown>;
};

export type ImageGenerationRequest = {
  productIdentity: ProductIdentity;       // Tier 1 — trusted facts
  referenceAssets: ReferenceAsset[];      // Tier 2 — canonical references
  creativeIntent: CreativeIntent;         // Tier 3 — allowlisted hints
  channel: CreativeChannel;
  kind: CreativeJobKind;
};

export type ImageProvider = {
  supports(kind: CreativeJobKind): boolean;
  estimate(request: ImageGenerationRequest): number;
  generate(request: ImageGenerationRequest): Promise<ImageProviderOutput>;
};
```

Providers (`OpenAIImageProvider`, `BriaImageProvider`) implement `ImageProvider`. The existing `CreativeProvider` remains for video (MiniMax). The daemon routes image kinds to `ImageProvider` and video kinds to `CreativeProvider`.

#### Fallback Rules

BRIA is invoked only under these conditions — never silently, never to evade content/safety rejection:

1. **Availability failure**: OpenAI API returns 5xx, rate-limit (429 after retries exhausted), or network timeout.
2. **Capability failure**: OpenAI does not support a specific `CreativeJobKind` that BRIA does (e.g., product-specific packshot/lifestyle endpoints).
3. **Configured policy**: A seller-level or job-level `providerPolicy: "bria-preferred"` flag explicitly selects BRIA.
4. **Explicit gates before fallback**:
   - Budget re-checked via `DurableCostLedger.canAfford(estimate)` before calling BRIA.
   - Both provider names, estimated costs, and error evidence recorded in audit/provenance.
   - Seller isolation preserved — reference assets sent to BRIA only with seller consent and under BRIA's licensed-data IP terms.
5. **Never**: Fallback to evade content/safety rejection from either provider. If OpenAI rejects for `content_blocked`, the job is failed — BRIA is not called.

#### Output Normalization

Both adapters produce `ImageProviderOutput` with the same structure regardless of provider. Normalization occurs in the adapter layer, not the daemon:

| Field | OpenAI | BRIA | Normalization |
|-------|--------|------|---------------|
| `assetBuffer` | Base64 decode from response | Download from `image_url` | `Buffer` |
| `storageUri` | Written to `.msl/creative-studio/assets/` | Same | Local path |
| `format` | From API response `mime_type` | From `export.format` param | `"png"` / `"jpeg"` / `"webp"` |
| `sha256` | Computed from `assetBuffer` | Computed | SHA-256 hex |
| `provider` | `"openai"` | `"bria"` | Literal |
| `cost` | From API usage metadata | From BRIA billing metadata (if exposed) | `estimatedCostUsd` / `actualCostUsd` |

#### BRIA Gating

BRIA adapter is feature-gated behind `MSL_BRIA_ENABLED` (default `false`) and `BRIA_API_TOKEN` (required). Until BRIA pricing/contract terms are confirmed, the adapter remains disabled in production. Integration tests use a mock transport. The adapter is built in Slice B but not activated without explicit configuration.

### Impact on Three-Slice Plan (Revised)

Two provider adapters (OpenAI + BRIA) in Slice B add ~180-260 lines (adapters + shared normalization + tests). **Revised Slice B estimate: ~480-710 authored lines** — under 800-line budget but approaching the limit. The adapters share the same `ImageProvider` port, so they are reviewed as a pair.

**If Slice B exceeds 800 lines during implementation**, split provider adapters into a separate Slice B2 ("Provider Adapters"), keeping prompt safety + structured templates + `CreativeJobDispatcher` + tool in Slice B (~300-450 lines). Slice B2 would be ~180-260 lines.

Prior user decisions preserved: reference-conditioned generation, mandatory human approval, no auto-publication, MiniMax video only at documented duration profiles, CBT Clips with capability checks, experimental local-video probe disabled by default.

### Sources

- OpenAI Image Generation: `https://developers.openai.com/api/docs/guides/image-generation` (official), accessed 2026-07-18
- OpenAI Images and Vision: `https://developers.openai.com/api/docs/guides/images-vision` (official), accessed 2026-07-18
- Google Gemini Imagen: `https://ai.google.dev/gemini-api/docs/generate-content/image-generation` (official), accessed 2026-07-18
- Adobe Firefly API: `https://developer.adobe.com/firefly-services/docs/firefly-api/` (official), accessed 2026-07-18
- Black Forest Labs FLUX: `https://docs.bfl.ai/` (official API), `https://github.com/black-forest-labs/flux` (GitHub, Apache-2.0 repo code, 25.7k stars, varied model weight licenses), accessed 2026-07-18
- Stability AI: `https://platform.stability.ai/docs` (official, accessed via Context7; direct web at `https://docs.stability.ai/reference` returned 403 on 2026-07-18)
- BRIA AI: `https://bria.ai`, `https://docs.bria.ai/`, `https://docs.bria.ai/products-overview` (official), accessed 2026-07-18
- Photoroom API: `https://docs.photoroom.com/` (official), accessed 2026-07-18
- Recraft: `https://www.recraft.ai/docs` (official), accessed 2026-07-18
- ComfyUI: `https://github.com/comfyanonymous/ComfyUI` (GitHub, GPL-3.0, 121k stars), accessed 2026-07-18
- Diffusers: `https://github.com/huggingface/diffusers` (GitHub, Apache-2.0, 34k stars), accessed 2026-07-18
- rembg: `https://github.com/danielgatis/rembg` (GitHub, MIT, 23.9k stars), accessed 2026-07-18
- InvokeAI: `https://github.com/invoke-ai/InvokeAI` (GitHub, Apache-2.0, 27.6k stars), accessed 2026-07-18

## Marketplace Video Benchmark (July 2026)

### MercadoLibre — CRITICAL UPDATE: CBT Clips API Exists

Source: `https://developers.mercadolibre.com/en_us/working-with-clips` (official). Created 2025-07-10, last updated 2026-06-09. Accessed 2026-07-18.

**Our prior assessment was incorrect for CBT/Global Selling sellers.** MercadoLibre has a public API for video ("Clips") upload — but it is **scoped to Cross-Border Trade (CBT) / Global Selling only**. Not all local MercadoLibre listings are CBT items, and MSL must not assume every seller can use this endpoint.

**CBT vs local distinction** (verified from official ML documentation):
- CBT accounts use Global Selling endpoints (`/global/items`) and replication to local marketplaces.
- Publishing with local `/items` does NOT match the Global Selling model.
- CBT and marketplace variation IDs are independent and not synchronized.
- Therefore, not every local MercadoLibre listing has a discoverable `cbt_item_id`. MSL must not infer or synthesize one.

| Dimension | MercadoLibre Clips |
|-----------|-------------------|
| **Native AI video generation** | ❌ Not found in official docs. No ML-owned AI video generation API |
| **Seller video upload support (UX)** | ✅ Global Selling interface (UI). API now available for CBT |
| **Public upload API** | ✅ `POST /marketplace/items/{cbt_item_id}/clips/upload` (CBT only) |
| **Public AI-generation API** | ❌ Not found. Generation must come from external provider (MiniMax) |
| **Verified upload limits** | Format: MP4, MOV, MPEG, AVI. Duration: **min 10s, max 61s**. Size: ≤280 MB. Resolution: ≥360×640 px. **Vertical video required** |
| **Moderation** | Statuses: `UNDER_REVIEW` (24-48h), `REJECTED` (content/technical reasons), `PUBLISHED`. Documented review capacity: 1,000 clips/day (not confirmed as per-seller limit — exact scoping unclear from docs) |
| **Availability** | CBT (Cross-Border Trade) items only. Active items only. Seller's associated local sites. Multi-site via `sites` array. Requires OAuth with read/write scope |
| **MSL relevance** | **Direct for CBT sellers only.** For local-marketplace sellers without CBT mapping, no public local upload API found. Manual export path required |

**Publication model capability check**: Before attempting Clips upload, MSL must verify:
- `publicationModel === "cbt-global-selling"` (explicit seller-level flag)
- `cbtItemId` is present and valid (not synthesized or inferred)
- Seller has OAuth read/write scope for the CBT item
- CBT item is active and belongs to the authenticated seller

**Impact on MSL video strategy (corrected)**:
- **CBT sellers**: MiniMax generates 10s/768P vertical MP4 → download → validate → CEO approval → upload via Clips API → poll moderation (24-48h)
- **Local sellers without CBT**: MiniMax generates → download → validate → store locally → CEO approves → CEO exports manually via Global Selling interface. No automated upload path available
- Human approval must occur BEFORE Clips upload. ML moderation is an additional platform gate after upload — it does NOT replace CEO review
- This transforms ML video from "generation-only" to "partial generate → upload → moderate → publish" — only for the CBT seller subset

**Duration alignment**: ML CBT Clips requires ≥10s, MiniMax supports max 10s at 768P. Exact match. 6s/1080P cannot be used for CBT (below 10s minimum).

#### Experimental Local-Item Video Capability Probing

For `publicationModel: "local-marketplace"` sellers, MSL may optionally run a **read-only capability probe** to detect whether a local item supports video upload. This probe is **disabled by default** and **fail-closed**:

- **Env gate**: `MSL_ML_LOCAL_VIDEO_PROBE_ENABLED` (default: `false`)
- **Probe behavior**: `GET /items/{item_id}` or `GET /items/{item_id}/pictures` to inspect item capabilities. Never POST/upload unless a supported mapping is positively established (e.g., the response explicitly includes a video upload capability or a valid CBT parent mapping is returned)
- **Unknown/404/ambiguous responses**: Fail closed → fall back to local storage + manual export. Do not synthesize or infer `cbtItemId`
- **No POST/upload in probe mode**: The probe is read-only. Upload only proceeds on the official CBT path with verified `cbtItemId`

This is documented in the exploration so the proposal phase can decide whether to scope the probe in Slice C or defer it entirely.

### Amazon

Source: Attempted `https://developer-docs.amazon.com/sp-api/docs/uploading-images-and-videos` (404), `https://developer-docs.amazon.com/sp-api/docs/uploading-videos` (404), `https://advertising.amazon.com/help/GCC9LML6L6LR6RYG` (login-walled). Accessed 2026-07-18.

| Dimension | Amazon |
|-----------|--------|
| **Native AI video generation** | Amazon Video Generator — UX tool in Seller Central / Ads. "Generate product videos from images" marketing capability. NOT a public API |
| **Seller video upload support (UX)** | ✅ Seller Central listing videos, A+ Content videos, Amazon Ads video creative |
| **Public upload API** | Not found via direct SP-API docs search at access time. SP-API does have product image upload endpoints; video-specific upload endpoint URL returned 404. May exist under different path — mark as **unverified** |
| **Public AI-generation API** | ❌ Not found. Video Generator is UX-only |
| **Verified limits** | Not found in official public docs at access time. A+ Content video specs vary by marketplace |
| **Availability** | Seller Central account required. Ads video for Sponsored Brands/Display |
| **MSL relevance** | **Study pattern only**. Amazon's Video Generator UX gives sellers AI-generated product videos, showing marketplace demand for this feature. No public API for MSL integration |

### eBay

Source: Attempted `https://developer.ebay.com/api-docs/commerce/media/resources/methods` (403), `https://developer.ebay.com/api-docs/commerce/media/overview.html` (403), `https://developer.ebay.com/develop/apis/sell-related-apis` (403). Accessed 2026-07-18.

| Dimension | eBay |
|-----------|------|
| **Native AI video generation** | ❌ Not found in official docs |
| **Seller video upload support (UX)** | ✅ Listing videos via Seller Hub |
| **Public upload API** | eBay Commerce Media API documented at `https://developer.ebay.com/api-docs/commerce/media/`. Documentation pages returned HTTP 403 to the research client at access time — this is a **documentation-access blocker**, not proof the API is unavailable. Mark as **unverified** |
| **Public AI-generation API** | ❌ Not found |
| **Verified limits** | Not found in official public docs |
| **Availability** | eBay Developer Program account required |
| **MSL relevance** | **Low**. Even if the Media API is accessible, eBay is not MSL's primary marketplace. Study pattern only |

### Alibaba / PicCopilot

Source: `https://www.piccopilot.com` (official), accessed 2026-07-18. PicCopilot is an Alibaba International Digital Commerce product.

| Dimension | PicCopilot (Alibaba) |
|-----------|---------------------|
| **Native AI video generation** | ✅ **"Fashion Reels"** — AI fashion model outfit videos & shorts maker. Generates AI videos of models wearing products. UX tool, not API |
| **Seller video upload support (UX)** | ✅ AliExpress/Alibaba.com listing videos |
| **Public upload API** | Not found for video. Alibaba Cloud / Alibaba.com Open API exists for product/image; video upload not documented in public developer portal at access time |
| **Public AI-generation API** | ❌ Not found. PicCopilot is a UX tool. No documented REST API for automated video generation |
| **Verified limits** | Not documented in public API docs |
| **Availability** | Free/Premium plans. Web UX. Exports to Instagram, TikTok, Shopify, Amazon, Etsy |
| **MSL relevance** | **Study pattern**. PicCopilot's "Fashion Reels" feature demonstrates market demand for AI product video (claimed 1.5M sellers, 3B+ organic impressions). The multi-platform publish flow (generate once, export to multiple channels) is a strong architecture pattern. No public API for MSL integration |

### Marketplace Comparison Table

| Marketplace | Native AI Video Gen | Public Upload API | Public AI-Gen API | Duration Limits | Resolution Limits | Format | MSL Integration |
|-------------|---------------------|-------------------|-------------------|-----------------|-------------------|--------|-----------------|
| MercadoLibre (CBT) | ❌ | ✅ Clips API (CBT) | ❌ | 10-61s | ≥360×640, vertical | MP4/MOV/MPEG/AVI | **Direct — CBT sellers only** |
| MercadoLibre (local) | ❌ | ❌ Not found | ❌ | N/A | N/A | N/A | Generate → local storage → manual export |
| Amazon | ✅ (UX only) | ⚠️ Unverified | ❌ | Unknown | Unknown | Unknown | Study pattern |
| eBay | ❌ | ⚠️ Unverified (docs 403) | ❌ | Unknown | Unknown | Unknown | Low priority |
| Amazon | ✅ (UX only) | ⚠️ Unverified | ❌ | Unknown | Unknown | Unknown | Study pattern |
| eBay | ❌ | ⚠️ Unverified (403) | ❌ | Unknown | Unknown | Unknown | Low priority |
| PicCopilot | ✅ "Fashion Reels" (UX) | ❌ Not found | ❌ | N/A (UX tool) | N/A | N/A | Study pattern |

### Channel-Profile Abstraction Recommendation

**Yes — MSL needs a channel-profile abstraction.** The research reveals different marketplaces have different video constraints:

| Profile | Duration | Resolution | Orientation | Format | Upload API | Availability | AI-Gen Provider |
|---------|----------|------------|-------------|--------|------------|-------------|-----------------|
| `ml-cbt-clips` | 10s (MiniMax max = ML min) | 768P | Vertical | MP4 | ✅ Clips API | CBT sellers only | MiniMax Hailuo-2.3 |
| `ml-local` | 10s | 768P | Vertical | MP4 | None (manual export) | Local sellers | MiniMax Hailuo-2.3 |
| `storefront` | 6s or 10s | Any | Any | MP4 | Local storage only | All (owned ecommerce) | MiniMax Hailuo-2.3 |
| `social-generic` | 6s | 768P | Platform-dependent | MP4 | None (manual) | All | MiniMax Hailuo-2.3 |
| `amazon-ads` | Unknown | Unknown | Unknown | Unknown | Unverified | Unknown | Study only |
| `ebay-listing` | Unknown | Unknown | Unknown | Unknown | Unverified (docs 403) | Unknown | Study only |

This abstraction should be defined as a `ChannelVideoProfile` type. The daemon selects the profile based on `creativeJob.channel` AND the seller's `publicationModel` before calling `provider.execute()`. For CBT sellers with `ml-cbt-clips` channel, the daemon generates, validates, awaits CEO approval, then uploads via Clips API. For local sellers with `ml-local`, generation is followed by local storage and manual-export guidance to the CEO.

### Impact on Duration Policy

**Previous policy**: "Video output is local/manual only for Mercado Libre until an official upload API exists." **Partially stale.** The CBT Clips API exists but is CBT-only.

**Updated policy**: 
- **CBT sellers (`ml-cbt-clips`)**: generate 10s/768P vertical MP4 via MiniMax → download → validate (SHA-256, duration, format, resolution) → await CEO approval → upload via Clips API → poll moderation
- **Local sellers (`ml-local`)**: generate 10s/768P vertical MP4 → download → validate → store locally → CEO approval → CEO exports manually via Global Selling interface
- The 10s MiniMax maximum matches the 10s ML minimum exactly for both paths
- 6s clips CANNOT be uploaded to ML CBT (below 10s minimum). The `product-clip-6s` kind is restricted to storefront/social channels only
- 1080P cannot be used for 10s clips (MiniMax only supports 6s at 1080P). ML clips must use 768P
- CBT Clips upload requires: `publicationModel === "cbt-global-selling"`, valid `cbtItemId`, active item, seller ownership, OAuth read/write scope

### Reusable Patterns from Marketplace Research

| Pattern | Source | Relevance to MSL |
|---------|--------|-----------------|
| **Moderation pipeline** | ML Clips (UNDER_REVIEW → PUBLISHED/REJECTED, 24-48h) | Additional platform gate AFTER CEO approval, NOT a replacement. CEO approves → upload triggers → ML moderates → published or rejected |
| **Multi-site distribution** | ML Clips (`sites` array per upload, CBT) | Generated video can be distributed to multiple MercadoLibre country sites from one upload. Reduces per-site generation cost |
| **UX-first video generation** | Amazon Video Generator, PicCopilot Fashion Reels | Validates market demand. MSL's daemon-driven approach is more scalable but should inform CEO tool presentation |
| **Template/storyboard approach** | PicCopilot (product upload → template selection → AI generation) | MSL's `request_creative_asset` tool could support template selection before dispatch |
| **Aspect ratio adaptation per platform** | PicCopilot (export to Instagram, TikTok, Shopify, Amazon) | MSL's channel-profile abstraction directly addresses this pattern |

### Impact on Three-Slice Plan and Non-Goals

**CBT Clips upload integration**: The upload + moderation-polling pipeline is seller-publication-model-dependent (CBT only). It requires a capability check (`publicationModel`, `cbtItemId`, OAuth scope), an HTTP upload adapter, and moderation polling state. This is **optional adapter work** that depends on Slice A (queue sync) and Slice C (durable polling). Recommended placement: **fourth slice or Slice C extension** if the line budget permits (~40-70 lines for adapter, ~30-50 lines for tests). **Not in Slice A.**

**Slice C estimate with CBT upload (optional)**: ~345-580 lines. Still under 800-line budget if included, but tight if combined with full hashes + Cortex + video durability + bus contracts.

**Non-goals update**:
| Non-Goal | Reason |
|----------|--------|
| Universal ML video upload for all sellers | Clips API is CBT-only. Local sellers without CBT mapping must use manual export |
| CBT Clips upload without prior CEO approval | Human approval is mandatory and occurs before upload. ML moderation is additional, not a replacement |
| CBT Clips integration in Slice A | Depends on Slice C's durable polling infrastructure. Best placed in Slice C or a separate fourth slice |

### Sources (Marketplace Research)

- MercadoLibre Working with Clips: `https://developers.mercadolibre.com/en_us/working-with-clips` (official), created 2025-07-10, updated 2026-06-09, accessed 2026-07-18. CBT/Global Selling only — not local marketplace
- MercadoLibre CBT FAQ: `https://global-selling.mercadolibre.com/devsite/frequently-asked-questions-cross-border-trade` (official), accessed 2026-07-18. Confirms CBT vs local distinction, independent IDs, `/global/items` vs `/items` publishing model
- Amazon SP-API: `https://developer-docs.amazon.com/sp-api/docs` (official). Specific video upload endpoints returned 404 at access time. No video-specific public API verified
- eBay Developer: `https://developer.ebay.com/` (official). Commerce Media API documentation pages returned HTTP 403 to the research client at access time — documentation-access blocker, not proof the API is unavailable. Mark as unverified
- PicCopilot: `https://www.piccopilot.com` (official Alibaba International product), accessed 2026-07-18. UX tool — no public API documented for automated generation
