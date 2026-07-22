# Proposal: Complete Creative Studio Runtime Contracts

## Intent

Close six verified runtime gaps from `add-creative-studio-agent` (committed, `9d380c7`): in-memory budget resets, missing queue terminal sync, absent CEO request tool, stub hashes, one-way Cortex feedback, non-durable video polling. All are unbuilt contracts, not regressions. Eight transversal invariants added for durable state safety.

## Scope

### In Scope

- Durable daily budget ledger (SQLite, restart-safe). Two phases with distinct message cardinality:
  - **Pre-dispatch**: exactly one job row; ZERO messages. Approval atomically creates exactly one message → `provider-routing`. Timeout → `failed` (zero messages).
  - **Runtime**: exactly one existing bus message retained in durable nonterminal `deferred` state (never failed, resolved, or duplicated while waiting); ZERO new messages. Approval transitions same message `deferred → pending/processing` without new row. Timeout → `failed`; fail/resolve the existing message exactly once.
  - Only pre-dispatch approval enqueues. Runtime approval never enqueues. Phase persisted for audit.
- Queue terminal sync: daemon calls `completeJob`/`failJob` on `CreativeJobQueueStore`
- Bus message deferral invariant: runtime waits (`awaiting-budget-approval` runtime phase, `awaiting-provider-consent`) retain the same message in `deferred` state. Approval re-activates same message. Partial valid outcome resolves same message once; zero-valid terminal failure calls `bus.fail` once. Pre-dispatch wait has no message.
- Durable provider generation attempts (`creative-generation-attempts`):
  - Stable `generationAttemptId` linked to sellerId, jobId, bus message identity, provider/model, `estimatedCostUsd`, request hash, reference hashes.
  - States: `prepared | submitted | completed | ambiguous | failed`.
  - Persist `prepared` before external POST. Use provider idempotency key where officially supported.
  - Crash after POST without durable response → `ambiguous`; never blindly retry when provider cannot prove idempotency/reconciliation.
  - Video submit and image generation share this safety model. Polling an existing paid task is NOT a new generation attempt or budget charge.
- Provider ownership migration: product images route to OpenAI primary/BRIA consent-gated fallback; MiniMax routes video only. MercadoLibre image format/compliance remains provider-agnostic. MiniMax capability purpose becomes video-only after archive. Delta on `specialist-daemons`.
- BRIA consent lifecycle (entered from `running`, same job/message in `deferred` state):
  - OpenAI allowed failure → `awaiting-provider-consent`.
  - CEO consent granted, budget recheck fails → consent retained; job → `awaiting-budget-approval` (runtime); same message `deferred`. On budget approval → `running`, call BRIA once. Never return to `awaiting-provider-consent` after consent exists.
  - No consent within 24h → `failed`; terminal bus once; zero BRIA calls.
  - Safety/content rejection never enters fallback consent.
- Unified timeout outcome table (any timeout/refusal/provider failure):
  - ≥1 valid asset: provider task may complete with `partial=true` metadata; job → `needs-human-review`; bus resolve partial once; CEO alert.
  - 0 valid assets: job/provider attempt → `failed`; bus fail once.
  - Video provider-task state separate from job state; provider task may be `completed` with `partial=true`, never `needs-human-review`.
- Cortex/provenance schema migration: replace generic `cost` with separate `estimatedCostUsd` and `actualCostUsd`; preserve all other base fields.
- Alias expiry: durable semantic-version metadata `deprecatedSinceVersion` and `removeAfterVersion`, compared against injected current application version. After expiry: validation error, zero provider attempt.
- Local-item video probing: env-flagged (`MSL_ML_LOCAL_VIDEO_PROBE_ENABLED`, default `false`); GET/read-only; typed result `supported | unsupported | unknown`; errors/404/ambiguity → `unknown`; no upload, mutation, or inferred CBT ID.
- Terminal provider/policy failure with zero valid assets → `failed` + terminal bus failure exactly once. Runtime budget exhaustion → `awaiting-budget-approval`; message retained `deferred`; no `failJob`/`bus.fail` while waiting.
- Lifecycle paths (not a single linear chain):
  - **Normal**: `provider-routing → running → needs-human-review | failed` → CEO `approved | rejected`
  - **Pre-dispatch budget**: created → `awaiting-budget-approval` (0 msgs) → CEO → atomic 1 msg → `provider-routing → ...`
  - **Runtime budget**: `running → awaiting-budget-approval` (1 msg `deferred`, 0 new) → CEO → same msg `deferred → pending` → `running → ...`
  - **Provider consent**: `running → awaiting-provider-consent` (msg `deferred`) → CEO → `running` (BRIA) → ...; if budget recheck fails → `awaiting-budget-approval` (runtime, consent retained) → CEO budget → `running` (BRIA)
- `request_creative_asset` CEO tool via `CreativeJobDispatcher` port (atomic dispatch)
- Real SHA-256 on reference/output assets; persistent audit; Cortex feedback loop
- Durable video polling (`VideoTaskStore`); polling existing paid task is not a new generation attempt; `bus.fail()` on terminal errors
- Interrupted video: resume polling after restart; timeout → unified timeout outcome table → failed + CEO alert
- Video duration: deprecated `ml-clip-vertical-30s` accepted with `deprecatedSinceVersion`/`removeAfterVersion` metadata; normalized to 10s/768P; provider never sends 30s. After expiry: validation error. 1080P restricted to ≤6s.
- Structured tiered prompt; no raw seller title reaches provider
- `ImageProvider` port: `OpenAIImageProvider` primary; `BriaImageProvider` feature-gated fallback (disabled, per-job CEO consent); MiniMax product-image generation replaced; ML format/compliance provider-agnostic
- MiniMax `subject_reference type: character` MUST NOT be sent for product images; MiniMax is video provider using `first_frame_image`
- `prompt_optimizer: false` in MiniMax video provider
- MercadoLibre moderation rejection: escalated to CEO; no automatic regeneration
- Non-guarantee docs per result; human approval sole identity gate; no auto-publication
- Seller isolation preserved; reference assets to BRIA only upon CEO consent
- BRIA fallback: never silent; never evade safety rejection; budget re-check; audit recorded
- Preserved invariants: configurable daemon polling and video polling intervals; queue durability guarantees; ML diagnostics non-blocking for generation but blocking auto-publication (prohibited)
- `estimatedCostUsd`/`actualCostUsd` always distinguished; never collapsed

### Out of Scope

- CBT Clips upload/moderation (separate follow-up; reusable channel/video profile contracts defined here)
- BRIA production activation (blocked pending credentials, pricing, data terms, commercial terms)
- Automated perceptual/CLIP/DINO identity similarity, FLUX, Photoroom, Gemini, Firefly, Stability, audio, multi-clip sequencing, Amazon/eBay video upload

## Capabilities

### New
- `creative-cost-ledger`: Durable daily budget; pre-dispatch/runtime phases with distinct message cardinality; CEO exception (24h, single-job, idempotent, phase-persisted); domain port + SQLite adapter
- `creative-job-dispatcher`: `CreativeJobDispatcher` port + `request_creative_asset` CEO tool; idempotent dispatch
- `creative-image-provider-contracts`: `ImageProvider` port; OpenAI + BRIA (gated) adapters; `awaiting-provider-consent` (entered from `running`, msg `deferred`); consent retained through budget-wait; `estimatedCostUsd`/`actualCostUsd` distinction; unified timeout table
- `creative-video-task-store`: Durable `task_id` persistence; restart-safe polling; provider task state separate from job state
- `creative-generation-attempts`: Stable `generationAttemptId`; states `prepared | submitted | completed | ambiguous | failed`; persist `prepared` before POST; provider idempotency key; crash → `ambiguous`; shared by video and image; polling ≠ new attempt

### Modified
- `creative-studio-agent`: Queue terminal sync; lifecycle transitions; bus message deferral (`deferred` state); Cortex wiring; structured `jobId`; partial/unified-timeout handling; ML rejection escalation; provenance field distinction
- `creative-studio-minimax`: Duration rename + enforcement; `prompt_optimizer: false`; structured prompt; `subject_reference` gating; video-only after archive; alias expiry metadata
- `specialist-daemons`: Product images → OpenAI/BRIA consent-gated; MiniMax → video only; ML format/compliance remains provider-agnostic

## Approach

Three chained corrective slices, each under 800 authored lines:

**Slice A** (~350-520 lines): durable ledger adapter (pre-dispatch/runtime phases, message cardinality); bus message deferral (`deferred` state); `creative-generation-attempts` (stable id, `prepared-before-POST`, `ambiguous` on crash, shared video+image model, polling ≠ new attempt); queue terminal sync; terminal provider vs budget-wait distinction; video duration + `prompt_optimizer: false` for MiniMax video.

**Slice B** (~540-800 lines): `CreativeJobDispatcher` + CEO tool; structured tiered prompt; `ImageProvider` port + OpenAI/BRIA adapters; `awaiting-provider-consent` (msg `deferred`, consent retained through budget-wait); provider ownership migration (`specialist-daemons` delta); alias expiry metadata; injection defenses; non-guarantee docs. Split BRIA to Slice B2 if forecast exceeds budget.

**Slice C** (~380-580 lines): real SHA-256; persistent audit; Cortex `estimatedCostUsd`/`actualCostUsd` migration; unified timeout outcome table (≥1 asset → partial + `needs-human-review`; 0 → `failed`); durable video polling + resume + timeout; `bus.fail()`; partial-output invariant on all paths; ML rejection escalation; local-item probing (`supported | unsupported | unknown`).

Slice A → B → C (chained). Domain ports never import `better-sqlite3`. Review lineage untouched.

## Affected Areas

| File | Change |
|------|--------|
| `packages/creative-studio/src/domain/cost-ledger.ts` | `DurableCostLedger` port; pre-dispatch/runtime phases; message cardinality |
| `packages/creative-studio/src/domain/generation-attempt.ts` | New: `GenerationAttempt` entity; states; idempotency contract |
| `packages/creative-studio/src/contracts/` | New: `image-provider-contracts.ts`; consent/budget-phase/deferral contracts |
| `packages/creative-studio/src/infrastructure/storage/` | New: ledger store, generation-attempt store, video task store |
| `packages/agent/src/runtime/agentDaemonPersistence.ts` | Pre-dispatch budget gate; bus message `deferred` state; CEO approval paths |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | Queue sync, ledger, generation attempts, hashes, Cortex, bus deferral, unified timeout, provider vs budget distinction, provider-consent workflow |
| `packages/agent/src/conversation/tools/creativeTools.ts` | `request_creative_asset` tool |
| `packages/creative-studio/src/infrastructure/providers/openai/` | New adapter; generation attempt integration |
| `packages/creative-studio/src/infrastructure/providers/bria/` | New adapter (gated); generation attempt integration |
| `packages/creative-studio/src/infrastructure/providers/minimax/` | Duration, prompt, subject_reference; video-only routing; alias expiry; generation attempt integration |
| `packages/creative-studio/src/application/cortex-bridge.ts` | Feedback methods; `estimatedCostUsd`/`actualCostUsd` migration |
| `packages/agent/src/workers/studioArtist.ts` | Provider routing: images → OpenAI/BRIA; MiniMax → video only |

## Risks

| Risk | L | Mitigation |
|------|---|------------|
| Generation attempt `ambiguous` after crash; provider cannot reconcile | Low | Persist `prepared` before POST; provider idempotency key; `ambiguous` triggers CEO review; never blindly retry |
| Runtime message double-resolved | Low | Phase persisted; single `deferred → resolved/failed` transition; atomic guard |
| Consent granted, budget recheck fails → orphaned consent | Low | Consent retained in runtime `awaiting-budget-approval`; never returns to consent state |
| BRIA exposes references without consent | Med | `awaiting-provider-consent` gate; zero asset transfer until consent |
| Partial-output invariant skipped on timeout | Low | Unified timeout table enforced in daemon for every path |
| `estimatedCostUsd` collapsed to generic cost | Low | Separate fields in output/audit/Cortex; normalized by adapters |
| Alias expiry breaks legacy callers with deprecated `30s` | Low | `deprecatedSinceVersion`/`removeAfterVersion` metadata; two-cycle grace; validation error after expiry |
| Local probe misinterprets 404 as capability | Low | Strict tri-state typing (`unsupported`/`unknown`); 404/error → `unknown`; fail-closed |
| Slice B exceeds 800-line budget with ownership migration | Med | Split BRIA adapter to Slice B2; `specialist-daemons` delta is routing-only (~30-50 lines) |
| Polling existing paid task charged as new attempt | Low | `generationAttemptId` deduplication; polling is read-only status check, never creates attempt |

## Rollback Plan

Per-slice: remove adapter/port injection → current behavior. Full: `MSL_CREATIVE_STUDIO_ENABLED=false`. New tables additive only (`CREATE TABLE IF NOT EXISTS`). Jobs in wait states at rollback become `failed` with reason; existing bus messages resolved exactly once; partial-output invariant applied. `generationAttemptId` rows preserved for audit. Kind rename backward-compatible with alias expiry metadata. MiniMax image capability restored on full rollback via env gate.

## Dependencies

- `add-creative-studio-agent` (committed, `9d380c7`); `openai` SDK (6.45.0)
- `MINIMAX_API_KEY`, `OPENAI_API_KEY`; `BRIA_API_TOKEN` + `MSL_BRIA_ENABLED` (disabled)
- `specialist-daemons` spec exists in `openspec/specs/`; delta modifies provider routing only

## Success Criteria

- [ ] Pre-dispatch budget: `awaiting-budget-approval` (0 msgs); CEO → atomic 1 msg; timeout → `failed` (0 msgs)
- [ ] Runtime budget: msg retained `deferred`; zero new msgs; approval → same msg `deferred → pending`; never enqueues
- [ ] Terminal provider failure (0 assets) → `failed` + bus fail once; never enters budget-wait
- [ ] Runtime budget exhaustion → `awaiting-budget-approval`; msg `deferred`; no `failJob`/`bus.fail` while waiting
- [ ] Generation attempt persisted `prepared` before POST; `ambiguous` on crash without provider reconciliation; no blind retry
- [ ] Polling existing video task does not create new generation attempt or budget charge
- [ ] Product images route to OpenAI/BRIA consent-gated; MiniMax routes video only; ML format/provider-agnostic
- [ ] MiniMax capability purpose is video-only post-archive
- [ ] OpenAI allowed failure → `awaiting-provider-consent` (msg `deferred`); consent retained through budget-wait; never returns to consent
- [ ] Unified timeout: ≥1 asset → `needs-human-review` + bus resolve partial once + CEO alert; 0 assets → `failed` + bus fail once
- [ ] Video provider-task state separate from job state; provider task `completed` with `partial=true`, never `needs-human-review`
- [ ] Cortex: `estimatedCostUsd`/`actualCostUsd` separate; generic `cost` replaced; all other base fields preserved
- [ ] Alias expiry: `ml-clip-vertical-30s` has `deprecatedSinceVersion`/`removeAfterVersion`; after expiry → validation error, zero provider attempt
- [ ] Local probe: GET/read-only; result typed `supported | unsupported | unknown`; 404/error → `unknown`; no mutation/synthesis
- [ ] Normal jobs: `provider-routing → running → needs-human-review | failed`; CEO → `approved | rejected`
- [ ] `request_creative_asset` produces one job row + one bus message
- [ ] SHA-256 on assets; audit persisted; Cortex updated on approval and moderation
- [ ] Interrupted video resumes polling; timeout → unified table → failed + CEO alert
- [ ] Deprecated `ml-clip-vertical-30s` normalized to 10s/768P; provider never receives 30s
- [ ] ML moderation rejection escalated to CEO; no automatic regeneration
- [ ] MiniMax `subject_reference type: character` absent from all product image requests
- [ ] No raw seller title in prompt; `prompt_optimizer: false` in MiniMax video provider
- [ ] No auto-publication; every asset enters `needs-human-review`
- [ ] All relevant existing and new focused/runtime tests pass; exact evidence captured during apply/verify
