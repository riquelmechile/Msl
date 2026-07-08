# creative-studio-agent Specification

## Purpose

Centralized Creative Studio lane + daemon for multimodal asset generation. Any MSL agent needing generated images or video SHALL request them through this agent via the message bus. Output is prepare-only — never externally published without CEO approval.

## Requirements

### Requirement: Centralized Creative Asset Requests

Any MSL agent requiring generated images or video SHALL request them through the Creative Studio Agent (`receiverAgentId = "creative-studio"`) via the agent message bus. Agents SHALL NOT call external generation providers (MiniMax, FLUX) directly.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Agent requests generation | creativeAssetsDaemon detects low image count | Daemon enqueues `CreativeAssetRequest` to creative-studio | Studio claims and processes the job |
| Direct provider access | Any agent calls MiniMax API directly | — | SHALL NOT be permitted; provider access is exclusive to creative-studio lane |
| Unsupported request kind | Request with unknown `CreativeJobKind` | Studio validates request | Job rejected with validation error |

### Requirement: Agent Message Bus Integration

`creativeStudioDaemon` SHALL poll messages where `receiverAgentId = "creative-studio"` and `status = "pending"`, claim them (status → `processing`), execute the creative job, and respond with `CreativeExecutionResult`. Poll interval SHALL be configurable, defaulting to 30s.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Pending creative job | Bus has pending creative-studio message | Daemon polls | Message claimed, generation begins |
| No pending messages | Bus has no creative-studio messages | Daemon polls | Empty cycle, daemon sleeps |
| Processing succeeds | Image generated and pre-diagnosed | Daemon completes | Message resolved with `CreativeExecutionResult` |
| Processing fails | Provider error or budget exceeded | Daemon catches error | Message failed with error reason, no partial output |

### Requirement: No External Mutation

The agent SHALL NOT publish, upload, or mutate external channels directly. Every result SHALL include `noMutationExecuted: true`. Assets SHALL be stored locally only. Publication to MercadoLibre or social media SHALL require explicit CEO approval via the existing prepare-only flow.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Image for MercadoLibre | Channel `mercadolibre` | Result returned | `noMutationExecuted: true`, asset local only |
| Video for social | Channel `instagram` | Result returned | `noMutationExecuted: true`, no post to Instagram |
| CEO approves asset | CEO calls `approve_creative_asset` | Approval recorded | Mutation delegated to existing ML orchestration flow |

### Requirement: Product Truth Preservation

For jobs with product `kind` (`product-cover-i2i`, `product-gallery-i2i`, `product-clip-*`, `ml-clip-*`), the agent SHALL preserve real product identity. Generated output SHALL NOT alter product color, material, size, or function. Reference images from supplier/product sources MUST be provided and used as `subject_reference`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Product cover from supplier photo | `preserveProductTruth: true`, reference provided | Image generated | Product color, material, shape match reference |
| Missing reference for product | `preserveProductTruth: true`, no references | Job validated | Job rejected — reference required |
| Non-product job | `kind: "social-pack"`, no product context | Job validated | Creative freedom permitted |

### Requirement: Cost and Provenance Ledger

Every generated asset SHALL record: provider, model, estimated and actual cost (USD), prompt hash (SHA-256), reference hash (SHA-256), requester agent ID, channel, and job ID.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Image generation completes | MiniMax returns image URLs | Asset persisted | Ledger: provider, model, cost, hashes, requester, channel |
| Video generation completes | MiniMax returns file_id after polling | Asset persisted | Ledger with async cost and duration |
| Job rejected (budget) | `canAfford()` returns false | Before generation | No cost recorded; rejection logged |

### Requirement: Cortex Feedback

The agent SHALL record CEO approval/rejection and MercadoLibre moderation results as Cortex learning evidence. Each record SHALL include: request ID, channel, kind, provider, model, cost, approval status, and moderation result.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| CEO approves asset | Asset approved | Feedback recorded | Cortex evidence: approved, provider/model context |
| CEO rejects asset | Asset rejected with reason | Feedback recorded | Cortex evidence: rejected, rejection reason |
| ML moderation completes | Asset uploaded and moderated | Feedback recorded | Cortex evidence: moderation result, detections |

### Requirement: Budget Enforcement

The agent SHALL reject jobs whose estimated cost exceeds `MSL_CREATIVE_STUDIO_MAX_JOB_USD`, or that would cause daily spending to exceed `MSL_CREATIVE_STUDIO_MAX_DAILY_USD`. Budget checks SHALL run via `canAfford()` before every generation call.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Job within budget | Cost $0.015, daily $1.00 / max $5.00 | Budget check | Allowed |
| Job exceeds max | Cost $0.75, max job $0.50 | Budget check | Rejected: "Job cost exceeds max job USD" |
| Daily budget exhausted | Cost $0.02, daily $4.99 / max $5.00 | Budget check | Rejected: "Daily budget exceeded" |

### Requirement: Environment Gate

The agent SHALL be disabled when `MSL_CREATIVE_STUDIO_ENABLED` is not `"true"`. When disabled, `creativeStudioDaemon` SHALL return `{ findings: [], proposalEnqueued: false }` without polling the bus or contacting any provider.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Enabled | `MSL_CREATIVE_STUDIO_ENABLED=true` | Daemon cycle starts | Normal polling and processing |
| Disabled | `MSL_CREATIVE_STUDIO_ENABLED=false` | Daemon cycle starts | Empty findings immediately |
| Unset | Env var not present | Daemon cycle starts | Treated as disabled — empty findings |
