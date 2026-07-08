# Proposal: Add Creative Studio Agent

## Intent

MSL's creative daemons detect visual/commercial problems but cannot generate solutions. The CEO has no way to get AI-generated images or video clips for MercadoLibre listings, ecommerce storefront, or future social media. This change adds a Creative Studio Agent — a lane + daemon that centralizes multimodal asset generation via MiniMax, with prepare-only output requiring CEO approval before any external publication.

## Scope

### In Scope
- New `creative-studio` lane and company agent registration
- New `creativeStudioDaemon` processing creative requests from the agent message bus
- MiniMax API integration: text-to-image (`image-01`), image-to-video (Hailuo models)
- Pre-diagnosis against MercadoLibre image rules (white_background, minimum_size, text_logo, watermark)
- Cost ledger tracking daily/per-job USD limits
- Cortex feedback loop for outcome learning
- CEO-facing tools: `request_creative_asset`, `query_creative_task`, `approve_creative_asset`
- Message bus contracts: `creative.asset.requested` → `creative.asset.prepared`
- Integration hooks in `creativeAssetsDaemon` and `creativeCommercialDaemon` to delegate remediation to the studio

### Out of Scope
- Social Media Agent (separate future change)
- Audio/music generation (TTS, voice cloning — future)
- Automated ML Clips video upload (blocked on ML API availability; manual upload only)
- FLUX provider (MiniMax only for MVP)
- `@msl/creative-studio` package extraction (follows after contracts stabilize)

## Capabilities

### New Capabilities
- `creative-studio-agent`: Lane contract, daemon handler, and message bus contracts for centralized creative asset generation. Handles "request → validate → generate → pre-diagnose → respond" lifecycle.
- `creative-studio-minimax`: MiniMax API client with image provider (`image-01`), video provider (Hailuo-2.3 with async polling), rate limiting, and per-job cost estimation.

### Modified Capabilities
- `daemon-scheduler`: Add `creative-studio` to the static handler map. The handler signature accommodates a MiniMax client and cost-ledger context distinct from existing ORM-reader daemons.
- `specialist-daemons`: Add `creativeStudioDaemon` — architecturally distinct from existing "detect → propose" daemons. This daemon follows "request → execute → respond": claims creative jobs from the bus, calls MiniMax, persists outputs, returns proposals.
- `creative-assets-daemon`: Extend detection findings to enqueue `CreativeAssetRequest` messages to the studio via the bus when visual remediation is actionable (low image count, moderation block, poor PICTURES score).

## Approach

Register a new `creative-studio` lane and company agent (LaneId, LANE_CONTRACTS, laneDepartments). Add `creativeStudioDaemon` as a daemon handler in the scheduler — this daemon polls the message bus for pending creative jobs, validates against budget policy, routes to MiniMax image/video providers, runs ML pre-diagnosis on generated assets, and responds with `creative.asset.prepared` proposals. Image generation is synchronous (POST → response); video generation is async with task-id polling. All output is prepare-only — never published directly.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/lanes.ts` | Modified | Add `creative-studio` LaneId + LANE_CONTRACTS entry |
| `packages/agent/src/conversation/companyAgents.ts` | Modified | Add creative-studio to `laneDepartments` |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Import + register `creativeStudioDaemon` in handler map |
| `packages/agent/src/workers/daemonTypes.ts` | Modified | May extend handler signature for MiniMax/cost context |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | New | Daemon handler: claim → validate → generate → respond |
| `packages/agent/src/workers/creativeAssetsDaemon.ts` | Modified | Add bus enqueue to creative-studio on actionable findings |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Modified | Add bus enqueue to creative-studio on social opportunities |
| `packages/creative-studio/` | New | Package: contracts, domain, MiniMax providers, policy engine, cost ledger |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Daemon handler blocks scheduler on sync image gen (~1-2s) | Medium | Acceptable for image; video uses async polling outside handler cycle |
| Video polling exceeds scheduler cycle window | Low | Separate poll timer; `maxPollAttempts=60` with 5s interval, timeout at 5 min |
| MiniMax API key missing → daemon crashes | Low | Env gate: daemon returns empty findings if `MINIMAX_API_KEY` unset |
| Daily budget exceeded mid-cycle | Medium | Pre-check via `canAfford()` before every generation call |
| No existing payload-processing daemon tests | Low | New `claimFixture()` patterns for `CreativeAssetRequest` payloads |

## Rollback Plan

1. Set `MSL_CREATIVE_STUDIO_ENABLED=false` → daemon returns empty findings on next cycle
2. Remove `creative-studio` from `daemonHandlerMap` → scheduler skips the lane
3. No data mutations to ML — only local asset storage in `.msl/creative-studio/assets/`

## Dependencies

- Agent Message Bus (exists)
- Daemon Scheduler (exists)
- Cortex memory (exists)
- ML Image Diagnosis API (exists)
- MiniMax API key (needs provisioning)

## Success Criteria

- [ ] `creativeAssetsDaemon` can request and receive generated product images via the bus
- [ ] Generated images pass ML pre-diagnosis (no white_background, text_logo, watermark issues)
- [ ] Costs tracked and `MSL_CREATIVE_STUDIO_MAX_DAILY_USD` enforced per cycle
- [ ] Zero mutations to ML without CEO approval (`prepare-only` at all times)
- [ ] All existing Vitest suites continue passing
