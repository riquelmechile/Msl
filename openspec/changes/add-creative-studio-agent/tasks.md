# Tasks: Add Creative Studio Agent

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 900–1400 |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Phases 0–1) → PR 2 (Phases 2–3) → PR 3 (Phases 4–6) |
| Delivery strategy | auto-forecast |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
800-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Contracts + Domain (Phases 0–1) | PR 1 | base=tracker branch; types, policy, cost ledger, test |
| 2 | Providers + Agent (Phases 2–3) | PR 2 | base=PR 1 branch; MiniMax client/providers, lane, daemon |
| 3 | Integration + Audit (Phases 4–6) | PR 3 | base=PR 2 branch; ML diag, daemon delegation, cortex, e2e |

## Phase 0: Contracts

- [x] 0.1 Scaffold `packages/creative-studio/` with package.json, tsconfig.json, src/index.ts
- [x] 0.2 Define contracts in `creative-requests.ts`: request/result types, job kind, channel, status, budget policy, ML diag
- [x] 0.3 Add `@msl/creative-studio` to workspace tsconfig paths
- [x] 0.4 Unit tests: validate domain behavior built on contracts (policy-engine, cost-ledger)

## Phase 1: Policy + Domain

- [x] 1.1 `PolicyEngine`: validate request, check constraints, pre-flight rules
- [x] 1.2 `CostLedger`: daily/job spend tracking, `canAfford()`, UTC midnight reset (pure TS, no SQLite yet)
- [ ] 1.3 `CreativeJobQueue`: local SQLite job state (PR2)
- [ ] 1.4 `MlDiagnosticAdapter`: call POST /moderations/pictures/diagnostic (PR2)
- [x] 1.5 Unit tests: policy rules, cost accounting (17 tests passing)

## Phase 2: MiniMax Provider

- [ ] 2.1 `MiniMaxClient`: HTTP client, auth, retry (3x), rate limit (3 concurrent, 2s cooldown)
- [ ] 2.2 `MiniMaxImageProvider`: POST /v1/image_generation, model image-01, sync
- [ ] 2.3 `MiniMaxVideoProvider`: POST /v1/video_generation, async polling, file download
- [ ] 2.4 `CreativeAssetStore`: local persistence under `.msl/creative-studio/assets/`
- [ ] 2.5 Mock tests: image/video providers with mocked HTTP layer

## Phase 3: Agent Registration

- [ ] 3.1 Register `"creative-studio"` in lanes.ts: LaneId, CREATIVE_STUDIO_LANE, LANE_CONTRACTS
- [ ] 3.2 Register in companyAgents.ts: laneDepartments entry
- [ ] 3.3 Create `creativeStudioDaemon.ts`: investigate(), env gate, claim→validate→generate→respond
- [ ] 3.4 Register in daemonScheduler.ts daemonHandlerMap
- [ ] 3.5 Integration: daemon processes mock request from in-memory bus

## Phase 4: ML Integration

- [ ] 4.1 Wire MlDiagnosticAdapter: pre-diagnosis after image gen for mercadolibre channel
- [ ] 4.2 Add mlDiagnostic to CreativeExecutionResult.outputs[]
- [ ] 4.3 Handle diag failures: flag asset, non-blocking
- [ ] 4.4 Tests: mocked ML API (pass + fail)

## Phase 5: Daemon Integration

- [ ] 5.1 Modify creativeAssetsDaemon: enqueue CreativeAssetRequest on low images/moderation (env-gated)
- [ ] 5.2 Modify creativeCommercialDaemon: enqueue social-pack on opportunity (env-gated)
- [ ] 5.3 Preserve CEO proposal flow; delegation additive
- [ ] 5.4 Integration tests: capture bus messages, verify receiverAgentId

## Phase 6: Cortex + Audit

- [ ] 6.1 CortexBridge: record job outcomes for learning
- [ ] 6.2 Audit logging per asset (provider, model, cost, hashes)
- [ ] 6.3 query_creative_task and approve_creative_asset tools
- [ ] 6.4 End-to-end: detect→request→generate→diagnose→propose (all mocked)
