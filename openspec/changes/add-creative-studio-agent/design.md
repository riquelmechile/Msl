# Design: Add Creative Studio Agent

## Technical Approach

Register `creative-studio` as a lane + daemon + company agent within the existing MSL agent ecosystem. The daemon follows a `request → execute → respond` cycle (unlike existing `detect → propose` daemons): it polls the agent message bus for creative jobs addressed to `receiverAgentId: "creative-studio"`, calls MiniMax via providers in `@msl/creative-studio`, pre-diagnoses images against ML rules, persists assets locally, and responds with `CreativeExecutionResult`. All output is prepare-only.

## Architecture Decisions

| Option | Tradeoff | Decision |
|--------|----------|----------|
| **Daemon creates MiniMax client internally** vs extend `DaemonHandler` context | Internal creation avoids bloating the 12-field handler context; client init from env vars is self-contained. | Internal — daemon reads `MINIMAX_API_KEY` directly. |
| **Video polling in daemon cycle** vs separate poll worker | In-cycle keeps state simple, daemon cycles are 15min. Video max poll is 5min. No races if one message per cycle. | In-cycle — claim one job per cycle, poll to completion. |
| **`@msl/creative-studio` package** vs inline in agent/ | Separation enforces contracts boundary; MiniMax client is reusable by future Social Media Agent. | Separate package. |
| **Cost tracking in memory** vs persisted SQLite | Memory resets on restart; daily budget must survive restarts. | SQLite table `creative_cost_ledger` in `.msl/creative-studio/studio.sqlite`. |

## Data Flow

```
creativeAssetsDaemon       (detects low image count)
        │
        ▼
    bus.enqueue({ receiverAgentId: "creative-studio", messageType: "request", payload: CreativeAssetRequest })
        │
        ▼
creativeStudioDaemon  ◄─── scheduler dispatches
        │
        ├─ 1. Env gate: MSL_CREATIVE_STUDIO_ENABLED? → no → empty findings
        ├─ 2. Claim message (status → processing)
        ├─ 3. canAfford() check
        ├─ 4. Route: kind=="product-cover-i2i" → MiniMaxImageProvider
        │            kind=="ml-clip-vertical-30s" → MiniMaxVideoProvider
        ├─ 5. Generate (sync image / async video+poll)
        ├─ 6. Persist asset + cost in local store
        ├─ 7. ML pre-diagnose if channel=="mercadolibre"
        ├─ 8. Respond via bus.resolve(messageId, CreativeExecutionResult)
        └─ 9. Register outcome in Cortex
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/lanes.ts` | Modify | Add `"creative-studio"` to `LaneId`, `CREATIVE_STUDIO_LANE` contract, `LANE_CONTRACTS` |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | Add `"creative-studio": "commercial"` to `laneDepartments` |
| `packages/agent/src/workers/creativeStudioDaemon.ts` | Create | Daemon handler: claim → validate → generate → respond |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Import + register `creativeStudioDaemon` in `daemonHandlerMap` |
| `packages/agent/src/workers/creativeAssetsDaemon.ts` | Modify | Enqueue `CreativeAssetRequest` to bus on actionable findings |
| `packages/agent/src/workers/creativeCommercialDaemon.ts` | Modify | Enqueue `CreativeAssetRequest` on social opportunity detections |
| `packages/creative-studio/` | Create | New package with contracts, domain, providers, policy, cost ledger |

## Package Structure

```
packages/creative-studio/src/
  index.ts                          # Public API surface
  contracts/creative-requests.ts    # CreativeAssetRequest, CreativeExecutionResult
  domain/
    policy-engine.ts                # Pre-gen validation (budget, format, safety)
    cost-ledger.ts                  # Daily/per-job USD accounting in SQLite
    creative-asset-store.ts         # Local file persistence + metadata
  infrastructure/
    providers/minimax/
      minimax-client.ts             # HTTP client: auth header, retry, rate limiting
      minimax-image-provider.ts     # POST /v1/image_generation, sync
      minimax-video-provider.ts     # POST /v1/video_generation + task polling
    ml-diagnostic-adapter.ts        # Calls ML image diagnostic API
    cortex-bridge.ts                # Outcome feedback to Cortex
```

## Env Gate Design

| Variable | Default | Effect |
|----------|---------|--------|
| `MSL_CREATIVE_STUDIO_ENABLED` | `false` | Daemon returns empty findings when not `"true"` |
| `MINIMAX_API_KEY` | — | Daemon returns empty findings when unset |
| `MSL_CREATIVE_STUDIO_MAX_DAILY_USD` | `5.00` | Budget ceiling per UTC day |
| `MSL_CREATIVE_STUDIO_MAX_JOB_USD` | `0.50` | Per-job cost cap |
| `MSL_CREATIVE_STUDIO_WRITE_ENABLED` | `false` | Future gate for write operations |

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `policy-engine`, `cost-ledger`, validation rules | Pure functions, no external deps |
| Unit | `minimax-image-provider`, `minimax-video-provider` | Mock `MinimaxClient` HTTP layer; inject test doubles |
| Integration | `creativeStudioDaemon` full cycle | Mock bus (in-memory), fake asset store, mock ML diagnostic |
| Integration | `creativeAssetsDaemon` delegation | Capture enqueued bus messages, verify `receiverAgentId` |

## ML Clips Video Strategy

Generate in correct format (9:16 vertical, ≤60s, 1080P via Hailuo-2.3) now. Store locally. CEO uploads manually via ML dashboard until ML exposes a public Clips API. The asset metadata records the target channel and format — when the API exists, the transition is a single upload step addition.

## Integration Points

- **Lane registration**: `"creative-studio"` in `LaneId`, `LANE_CONTRACTS`, `laneDepartments`
- **Agent registration**: Auto-derived from lane contract via `toCompanyAgent()`
- **Daemon registration**: `"creative-studio": creativeStudioDaemon` in `daemonHandlerMap`
- **Bus message types**: `creative.asset.requested` (inbound), `creative.asset.prepared` (outbound)
- **Existing daemon delegation**: `creativeAssetsDaemon` and `creativeCommercialDaemon` enqueue `CreativeAssetRequest` to the bus as additive output (existing CEO proposal preserved)

## Rollback

Set `MSL_CREATIVE_STUDIO_ENABLED=false` — daemon returns empty findings. Remove handler from `daemonHandlerMap` — scheduler skips. No ML mutations ever executed; only local asset files in `.msl/creative-studio/assets/`.
