## Exploration: add-creative-studio-agent

### Executive Summary

The Creative Studio Agent requires adding a new `creative-studio` lane, company agent, and daemon to the MSL agent ecosystem, plus creating a new `@msl/creative-studio` package for MiniMax integration. The existing patterns are well-established and documented. However, the creative-studio daemon is architecturally **different** from all existing daemons: existing daemons follow a "detect → propose" pattern (poll ORM/Cortex for signals, enqueue to CEO), while creative-studio follows a "request → execute → respond" pattern (receive creative jobs from other agents via bus, generate assets via MiniMax, return proposals).

The lane + company agent registration is straightforward (add to `LaneId`, `LANE_CONTRACTS`, `laneDepartments`). The daemon needs a handler and a `daemonHandlerMap` entry. The new `@msl/creative-studio` package follows existing workspace conventions.

### Current State

The MSL ecosystem has:
- **13 lane contracts** in `LANE_CONTRACTS` (`lanes.ts`) with `LaneContract` type
- **14 LaneId values** (including `morning-report`, `eod-summary`, `unanswered-questions` which lack contracts)
- **8 active daemon handlers** in `daemonHandlerMap` (`daemonScheduler.ts`)
- **2 creative daemons**: `creativeAssetsDaemon` (asset quality) and `creativeCommercialDaemon` (commercial opportunities) — both detect problems but cannot generate assets
- **Agent message bus** with `enqueue`, `claimNext`, `resolve`, `fail` lifecycle
- **ML image orchestration** tools: `diagnose_image`, `upload_image`, `check_image_moderation`, `prepare_image_flow` (4-step prepare-only flow)
- **Creative draft patterns** in `packages/workers/src/creative/index.ts` (concept/draft level only)
- **9 packages** under `packages/*` auto-workspaced by root `package.json`

### Affected Areas

- `packages/agent/src/conversation/lanes.ts` — Add `"creative-studio"` to `LaneId`, add `CREATIVE_STUDIO_LANE` to `LANE_CONTRACTS`
- `packages/agent/src/conversation/companyAgents.ts` — Add `"creative-studio": "commercial"` to `laneDepartments` (auto-generates agent)
- `packages/agent/src/workers/daemonTypes.ts` — May need new type additions for creative-studio context (MiniMax client, etc.)
- `packages/agent/src/workers/daemonScheduler.ts` — Import `creativeStudioDaemon`, add to `daemonHandlerMap`
- `packages/agent/src/conversation/agentMessageBusStore.ts` — No changes needed (bus is generic)
- `packages/agents/src/conversation/agentLoop.ts` — Potentially register new tools for creative studio (if any are CEO-facing)
- `packages/creative-studio/` — New package: contracts, domain, application, infrastructure, tests
- `packages/agent/src/workers/creativeAssetsDaemon.ts` — Future: add bus enqueue to creative-studio
- `packages/agent/src/workers/creativeCommercialDaemon.ts` — Future: add bus enqueue to creative-studio
- `docs/env-example.md` or `.env.example` — Add `MSL_CREATIVE_STUDIO_*` and `MINIMAX_*` vars

### Approaches

1. **Standard daemon in `packages/agent/src/workers/` (design doc approach)**
   - Create `creativeStudioDaemon.ts` in existing `packages/agent/src/workers/`
   - Register in `daemonHandlerMap`
   - Reuses existing scheduler, bus, and team infrastructure
   - **Pros**: Minimum new infra; follows established patterns; reuse of scheduler, bus, testing patterns
   - **Cons**: Daemon pattern mismatch — existing daemons are "detect from data" while creative-studio is "process request from bus"; handler signature exposes many unused params (reader, cortex, sellerIds, advisors). The daemon fundamentally needs MiniMax client, not ORM readers
   - **Effort**: Medium

2. **New package `@msl/creative-studio` with standalone daemon (also per design doc)**
   - Create full `packages/creative-studio/` with contracts, domain, infrastructure, tools
   - The daemon lives inside the new package; the agent package imports and registers it
   - **Pros**: Clean separation of concerns; the studio package owns its types, MiniMax client, storage; no bloat to agent package; follows monorepo conventions
   - **Cons**: New package needs its own `tsconfig.json`, `package.json`, build config; daemon still needs to be registered in scheduler
   - **Effort**: Medium-High (but more sustainable)

3. **Hybrid: minimal stub in agent, logic in package**
   - Thin daemon handler in `packages/agent/src/workers/creativeStudioDaemon.ts` that delegates to `@msl/creative-studio`
   - The new package owns all logic: MiniMax client, policy engine, asset storage, cost ledger
   - **Pros**: Registration stays with agent (where scheduler lives); logic stays clean in its own package; daemon handler is ~50 lines
   - **Cons**: Two-file split can be confusing; the daemon handler still needs the context from scheduler which doesn't naturally pass MiniMax client
   - **Effort**: Medium

### Recommendation

**Approach 1 first, extract to Approach 2 later.** 

For the initial implementation (Phases 1-3 per the design doc), create the daemon handler inside `packages/agent/src/workers/` following the standard pattern, but extend `DaemonHandler`'s context to accept an optional `creativeStudio` client. This keeps the registration simple and avoids introducing a new package dependency until the contracts are stable. Once the contracts stabilize (Phase 4+), extract `@msl/creative-studio` as a proper package.

The creative-studio daemon differs architecturally from existing daemons:
- Existing: `claim → read ORM/Cortex → detect signals → enqueue to CEO`
- Creative-studio: `claim (with CreativeAssetRequest) → validate → call MiniMax → persist → enqueue result to CEO/requester`

This means the daemon handler needs:
- The `CreativeAssetRequest` from `claim.payloadJson` (existing daemons mostly ignore the payload)
- A MiniMax API client (not part of current `DaemonHandler` signature)
- Asset storage (not part of current `DaemonHandler` signature)
- Cost ledger (not part of current `DaemonHandler` signature)

The `DaemonHandler` type may need extension to pass these, or the daemon creates them internally behind env gates.

### Risks

- **Daemon pattern mismatch**: Existing daemons don't process message payloads meaningfully. The creative-studio daemon MUST parse `claim.payloadJson` as a `CreativeAssetRequest`. The scheduler's `claimNext` returns minimal data by default but the full `AgentMessage` with `payloadJson` is available — this works but is untested.
- **Synchronous generation blocking**: `image-01` is synchronous (POST → response). If the daemon handler calls MiniMax directly in the handler, it blocks the scheduler cycle. For image generation (~1-2s) this may be acceptable; for video polling (minutes), it must be async with state persisted in storage.
- **Env gate dependencies**: The daemon must gate on `MSL_CREATIVE_STUDIO_ENABLED` and `MINIMAX_API_KEY`. If the key is missing, it should return empty findings gracefully.
- **Cost tracking**: The daemon must track `MSL_CREATIVE_STUDIO_MAX_DAILY_USD` across cycles. This requires persistent state (SQLite or Cortex) — existing daemons don't do this.
- **No existing daemon tests for payload processing**: Tests will need to set up creative request payloads in `claimFixture()`, which is a new pattern.
- **`morning-report` and `eod-summary` are declared in `LaneId` and `laneDepartments` but NOT in `LANE_CONTRACTS`** — they are not produced by `listCompanyAgents()` from the static module. The daemon scheduler's `listCompanyAgents()` imports from the static `companyAgents.ts`, so these daemon handlers may never be dispatched. This is a pre-existing ambiguity that should be verified for `creative-studio`.

### Ready for Proposal

**Yes.** The patterns are well-understood. Key architectural decisions to confirm in proposal:
1. Where does the daemon handler live? (agent package vs. new package)
2. How does MiniMax client get injected into the daemon? (extend `DaemonHandler` type or create in handler)
3. Is the async video polling handled within the daemon or via a separate worker?
4. Can the daemon safely call external APIs within the scheduler's polling cycle?
