# Delta for creative-studio-agent

## ADDED Requirements

### Requirement: Runtime Lifecycle Paths and Unified Timeout

Lifecycle SHALL follow exact paths with distinct message cardinality:

| Path | States | Messages |
|------|--------|----------|
| Normal | `provider-routing → running → needs-human-review \| failed` → CEO `approved \| rejected` | 1 |
| Pre-dispatch budget | → `awaiting-budget-approval` (phase=pre-dispatch) → CEO | 0 until CEO, then 1 |
| Runtime budget | `running → awaiting-budget-approval` (phase=runtime) → CEO | 1 retained; 0 new |
| Provider consent | `running → awaiting-provider-consent` → CEO → `running` (BRIA) | 1 retained |

Unified timeout outcome (any timeout/refusal/provider failure): ≥1 valid asset → `needs-human-review`; retain assets; bus resolve partial once; CEO alert. Zero valid assets → `failed`; bus fail once.

#### Scenario: Normal path to review

- GIVEN job at `provider-routing` with one bus message
- WHEN provider succeeds and returns valid assets
- THEN job transitions to `needs-human-review` with hashes and non-guarantee docs

#### Scenario: Partial output retained on provider timeout

- GIVEN provider call times out with ≥1 valid asset already produced
- WHEN timeout triggers
- THEN job → `needs-human-review`; valid assets retained; CEO alerted; bus resolve partial once

#### Scenario: Zero assets on terminal failure

- GIVEN provider/policy/consent/budget/video timeout with zero valid assets
- WHEN terminal outcome evaluated
- THEN job → `failed`; bus fail exactly once; no assets retained

#### Scenario: Consent timeout with prior partial

- GIVEN `awaiting-provider-consent` 24h timeout; ≥1 valid asset from prior provider step
- WHEN timeout triggers
- THEN job → `needs-human-review`; assets retained; CEO alerted; bus resolve once

#### Scenario: Consent timeout zero assets

- GIVEN `awaiting-provider-consent` 24h timeout; zero valid assets
- WHEN timeout triggers
- THEN job → `failed`; terminal bus fail once

### Requirement: Local Video Probe

Local-item video probing SHALL be env-flagged via `MSL_ML_LOCAL_VIDEO_PROBE_ENABLED` (default `false`). Probe SHALL be GET/read-only. Result typed: `supported | unsupported | unknown`. Errors, 404, or ambiguity SHALL produce `unknown`. SHALL NOT upload, mutate, or synthesize CBT IDs.

#### Scenario: Probe disabled

- GIVEN `MSL_ML_LOCAL_VIDEO_PROBE_ENABLED=false`
- WHEN daemon evaluates video capability
- THEN probe skipped; capability treated as unavailable

#### Scenario: Probe error → unknown

- GIVEN probe enabled; local endpoint returns 404 or error
- WHEN probe executes
- THEN result is `unknown`; zero POST/upload/CBT ID

## MODIFIED Requirements

### Requirement: Agent Message Bus Integration

`creativeStudioDaemon` SHALL poll pending messages, claim, execute, respond. Poll: configurable (default 30s). On success: `completeJob(jobId, result)` on queue store; job → `needs-human-review`. Terminal provider/policy failure with zero valid assets: `failJob(jobId, error)`; `bus.fail()` exactly once. Runtime budget exhaustion: transition to `awaiting-budget-approval` (phase=runtime); retain existing message in durable nonterminal `deferred`; ZERO new messages; MUST NOT `failJob` or `bus.fail` while waiting. Consent and runtime-budget transitions SHALL retain same message in `deferred`. Approval SHALL transition same message `deferred → pending/processing` without new row.
(Previously: success → resolved directly; no queue sync; no bus.fail(); provider error and budget exhaustion lumped together.)

#### Scenario: Pending creative job

- GIVEN bus has pending creative-studio message
- WHEN daemon polls
- THEN message claimed; generation begins

#### Scenario: No pending messages

- GIVEN bus has no creative-studio messages
- WHEN daemon polls
- THEN empty cycle; daemon sleeps

#### Scenario: Processing succeeds

- GIVEN image generated and pre-diagnosed
- WHEN daemon completes
- THEN `completeJob(jobId, result)` called; queue → `needs-human-review`

#### Scenario: Terminal provider failure (zero assets)

- GIVEN provider error; zero valid assets
- WHEN daemon catches
- THEN `failJob(jobId, error)` called; `bus.fail()` exactly once

#### Scenario: Runtime budget exhausted

- GIVEN job `running` with one message; daily budget cap hit
- WHEN daemon evaluates
- THEN job → `awaiting-budget-approval` (phase=runtime); msg retained `deferred`; no `failJob`/`bus.fail`

#### Scenario: Budget timeout partial

- GIVEN `awaiting-budget-approval` 24h timeout (runtime); ≥1 valid asset
- WHEN timeout triggers
- THEN job → `needs-human-review`; assets retained; CEO alerted; bus resolve once

#### Scenario: Budget timeout zero assets

- GIVEN `awaiting-budget-approval` 24h timeout (runtime); zero valid assets
- WHEN timeout triggers
- THEN job → `failed`; bus fail once

### Requirement: Budget Enforcement

SHALL reject jobs exceeding `MSL_CREATIVE_STUDIO_MAX_JOB_USD` (zero rows; zero messages; no bus interaction). Exhausting daily cap SHALL enter `awaiting-budget-approval` with distinct phase behavior:
- **Pre-dispatch**: one durable row; ZERO existing/new messages or provider calls. CEO approval atomically enqueues exactly one message → `provider-routing`. Timeout (24h) → `failed`; zero messages.
- **Runtime**: job `running` with one existing message; retains message in durable nonterminal `deferred`; ZERO NEW calls/messages. CEO approval resumes same message → `running`; MUST NOT enqueue another. Timeout (24h): ≥1 valid asset → `needs-human-review`; 0 valid → `failed` plus bus fail once.
CEO never raises cap; `budgetWaitPhase` persisted for audit. Polling existing paid task is NOT a charge. Checks via `DurableCostLedger` before every paid call.
(Previously: in-memory budget; "daily budget exceeded" rejected immediately; no phases or CEO exception.)

#### Scenario: Within budget

- GIVEN cost $0.015; daily $1.00 / max $5.00
- WHEN budget check runs
- THEN allowed; one row + one message → `provider-routing`

#### Scenario: Max job exceeded

- GIVEN cost exceeds `MSL_CREATIVE_STUDIO_MAX_JOB_USD`
- WHEN budget check runs
- THEN rejected; zero rows; zero messages; no bus interaction

#### Scenario: Pre-dispatch daily exhausted

- GIVEN no existing message; budget cap hit
- WHEN budget check runs
- THEN one row in `awaiting-budget-approval` (phase=pre-dispatch); zero messages

#### Scenario: Pre-dispatch CEO approved

- GIVEN phase=pre-dispatch; valid re-checks
- WHEN CEO approves
- THEN atomic one message → `provider-routing`; cap unchanged; audited

#### Scenario: Runtime daily exhausted

- GIVEN job `running` with one message; budget cap hit
- WHEN budget check runs
- THEN `awaiting-budget-approval` (phase=runtime); message retained `deferred`; zero NEW calls

#### Scenario: Runtime CEO approved

- GIVEN phase=runtime; one message `deferred`; valid re-checks
- WHEN CEO approves
- THEN same message `deferred → pending`; → `running`; zero new messages; cap unchanged

#### Scenario: Pre-dispatch timeout

- GIVEN phase=pre-dispatch; 24h elapsed; zero assets
- WHEN timeout triggers
- THEN job → `failed`; zero messages

### Requirement: Cost and Provenance Ledger

Every asset SHALL record: provider, model, `estimatedCostUsd`, `actualCostUsd`, real prompt SHA-256, every reference SHA-256, every output SHA-256, requester agent ID, channel, and `jobId`. Image providers: OpenAI or BRIA. MiniMax: video only. Every queue result, audit entry, and Cortex evidence SHALL carry separate `estimatedCostUsd` and `actualCostUsd` fields; no generic `cost` replacement. Audit SHALL be durable and restart-safe.
(Previously: SHA-256 stubs; MiniMax image URLs; generic cost field.)

#### Scenario: Image generated

- GIVEN provider returns image bytes
- WHEN asset persisted
- THEN ledger records provider, model, estimatedCostUsd, actualCostUsd, hashes, jobId

#### Scenario: Video generated

- GIVEN MiniMax returns file_id after polling
- WHEN asset persisted
- THEN ledger records provider, model, estimatedCostUsd, actualCostUsd, async cost, duration

#### Scenario: Job rejected at budget gate

- GIVEN `canAfford()` returns false
- WHEN before generation
- THEN no cost recorded; rejection logged; zero provider calls

### Requirement: Cortex Feedback

The agent SHALL record CEO approval/rejection and MercadoLibre moderation results as Cortex learning evidence. Each record SHALL include: request ID, channel, kind, provider, model, `estimatedCostUsd`, `actualCostUsd`, approval status, and moderation result.
(Previously: generic `cost` field used; no separate estimated/actual distinction.)

#### Scenario: CEO approves asset

- GIVEN asset approved
- WHEN feedback recorded
- THEN Cortex evidence: approved, provider/model context, separate estimatedCostUsd and actualCostUsd

#### Scenario: CEO rejects asset

- GIVEN asset rejected with reason
- WHEN feedback recorded
- THEN Cortex evidence: rejected, rejection reason, separate cost fields

#### Scenario: ML moderation completes

- GIVEN asset uploaded and moderated
- WHEN feedback recorded
- THEN Cortex evidence: moderation result, detections

### Requirement: No External Mutation

The agent SHALL NOT publish, upload, or mutate external channels directly. Every result SHALL include `noMutationExecuted: true`. Assets SHALL be stored locally only. Publication to MercadoLibre or social media SHALL require explicit CEO approval via the existing prepare-only flow. ML diagnostics SHALL be non-blocking for generation but SHALL prevent auto-publication; no auto-publication exists.
(Previously: no ML diagnostics gate on auto-publication.)

#### Scenario: Image for MercadoLibre

- GIVEN channel `mercadolibre`
- WHEN result returned
- THEN `noMutationExecuted: true`; asset local only

#### Scenario: Video for social

- GIVEN channel `instagram`
- WHEN result returned
- THEN `noMutationExecuted: true`; no post to Instagram

#### Scenario: CEO approves asset

- GIVEN CEO calls `approve_creative_asset`
- WHEN approval recorded
- THEN mutation delegated to existing ML orchestration flow

#### Scenario: ML diagnostic blocks auto-publication

- GIVEN ML diagnostic finds blocking issue
- WHEN asset reaches review
- THEN auto-publication prevented; CEO may still approve manually

### Requirement: Product Truth Preservation

For product kinds, SHALL preserve identity. References MUST be provided. OpenAI/BRIA SHALL use provider-specific reference/edit under `ImageProvider` contract. MiniMax SHALL use `first_frame_image`; SHALL NOT send `subject_reference type: "character"` for product images. Ownership, hash, and policy constraints preserved.
(Previously: uniform `subject_reference` regardless of provider; MiniMax handled product images.)

#### Scenario: Product cover via OpenAI/BRIA

- GIVEN `preserveProductTruth: true`; reference provided; provider is OpenAI or BRIA
- WHEN image generated
- THEN product color, material, shape match reference via provider-specific reference/edit

#### Scenario: Product video via MiniMax

- GIVEN reference frame; provider is MiniMax
- WHEN video generated
- THEN `first_frame_image` used; no `subject_reference type: "character"`

#### Scenario: Missing reference for product

- GIVEN `preserveProductTruth: true`; no references
- WHEN job validated
- THEN rejected — reference required

#### Scenario: Non-product job

- GIVEN `kind: "social-pack"`; no product context
- WHEN job validated
- THEN creative freedom permitted

## REMOVED Requirements

None.
