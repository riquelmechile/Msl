# Delta for specialist-daemons

## ADDED Requirements

### Requirement: creativeStudioDaemon

`creativeStudioDaemon` MUST export `investigate(claim: AgentMessage): Promise<DaemonResult>`. It SHALL poll messages where `receiverAgentId = "creative-studio"` and `status = "pending"`, claim them, route to MiniMax providers by `CreativeJobKind`, persist outputs locally, run ML pre-diagnosis for `mercadolibre` channel jobs, and respond with `CreativeExecutionResult`. It SHALL enforce budget via `canAfford()` before every generation call. It SHALL be disabled when `MSL_CREATIVE_STUDIO_ENABLED` is not `"true"`, returning empty findings.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Image job received | Bus message with `kind: "product-cover-i2i"` | Daemon processes | MiniMax image-01 called, asset persisted, result returned |
| Video job received | Bus message with `kind: "ml-clip-vertical-30s"` | Daemon processes | MiniMax Hailuo-2.3 called, async polling, asset persisted |
| Budget exceeded | Job cost > remaining daily budget | Daemon validates | Job rejected, message failed |
| Env gate disabled | `MSL_CREATIVE_STUDIO_ENABLED=false` | Daemon cycle starts | Empty findings, no bus polling |

### Requirement: creativeAssetsDaemon → Creative Studio Delegation

When `creativeAssetsDaemon` detects actionable visual remediation signals (low image count, moderation block, poor PICTURES score), it SHALL create a `CreativeAssetRequest` with `kind: "product-cover-i2i"` or `"product-gallery-i2i"` and enqueue it to `receiverAgentId = "creative-studio"` via the agent message bus, IN ADDITION to its existing CEO proposal. The delegation SHALL only trigger when `MSL_CREATIVE_STUDIO_ENABLED` is `"true"`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Low image count | creativeAssetsDaemon detects pictureCount < 2, env gate enabled | Daemon completes investigation | `CreativeAssetRequest` enqueued to creative-studio alongside CEO proposal |
| Moderation blocked | creativeAssetsDaemon detects moderation block | Daemon completes investigation | `CreativeAssetRequest` enqueued with product context |
| Env gate disabled | Detection triggers, `MSL_CREATIVE_STUDIO_ENABLED=false` | Daemon evaluates | Only CEO proposal enqueued; no creative-studio message |
| No actionable signals | All checks pass | Daemon completes | No creative-studio message enqueued |

### Requirement: creativeCommercialDaemon → Creative Studio Delegation

When `creativeCommercialDaemon` detects creative candidates (high-visit listings with creative opportunity), it MAY enqueue a `CreativeAssetRequest` with `kind: "social-pack"` to `receiverAgentId = "creative-studio"` via the agent message bus. This delegation SHALL be additive and SHALL NOT replace the existing CEO proposal flow.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| High-visit listing | Visits > threshold, social opportunity identified | Daemon completes investigation | `social-pack` request optionally enqueued to creative-studio |
| No creative candidate | Visits normal, no social opportunity | Daemon completes | No creative-studio message enqueued |
| CEO proposal preserved | Delegation triggered | Daemon returns | Existing CEO proposal still enqueued alongside creative-studio request |

## MODIFIED Requirements

### Requirement: No Mutation Boundary

ALL daemons MUST set `noMutationExecuted: true`. Daemon functions SHALL NOT call MercadoLibre write APIs, modify seller listings, execute external mutations, or publish to social media channels. They SHALL only read evidence via `OperationalReadModelReader` and `GraphEngine`, enqueue proposals, and — for creativeAssetsDaemon and creativeCommercialDaemon — enqueue creative asset requests to the creative-studio agent via the message bus.
(Previously: creative daemons only enqueued CEO proposals; they were not connected to a generation agent.)

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Listing API not called | Daemon processes evidence | Any daemon runs | No ML write API invoked |
| Only enqueue | Daemon has findings | investigate() returns | Proposal enqueued on bus, no mutation executed |
| Creative delegation is prepare-only | creativeAssetsDaemon enqueues to creative-studio | investigate() returns | `noMutationExecuted: true`; creative-studio handles generation separately |
