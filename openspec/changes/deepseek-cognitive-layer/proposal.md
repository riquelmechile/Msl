# Proposal: DeepSeek Reason Gateway

United gateway for DeepSeek calls across internal MSL agents. Eliminates duplicated prompt strategy, cost recording, model selection, and error handling spread across `CeoDeepSeekClient`, `SupplierMirrorDeepSeekAdvisor`, and future lanes.

## Quick Path

1. Create `packages/agent/src/reasoning/` with `DeepSeekReasoningGateway`
2. Refactor `CeoDeepSeekClient` and `SupplierMirrorDeepSeekAdvisor` to call gateway
3. Consolidate `SupplierMirrorDeepSeekPolicy` pricing/model logic into gateway
4. Export from `packages/agent/src/index.ts`

## Scope

### In Scope

| Area | Action |
|------|--------|
| `reasoning/DeepSeekReasoningGateway` | Unified class wrapping shared singleton. Standardizes: model selection (Flash default, Pro escalation), prompt cache strategy (stable+ cacheable+ volatile blocks), cost ledger entries, timeout/retry per caller type, structured output validation |
| `reasoning/reasoningLevels.ts` | `ReasoningLevel` enum: `classification`, `summarization`, `prioritization` (low-risk auto-execute), `recommendation`, `decision` (require approval) |
| `ceoDeepSeekClient.ts` | Refactor `CeoDeepSeekClientImpl.reason()` to route through gateway |
| `supplierMirrorDeepSeekAdvisor.ts` | Refactor `analyze()` to route through gateway |
| `supplierMirrorDeepSeekPolicy.ts` | Consolidate pricing tables and model selection into gateway; keep prompt-plan builder as is |
| `index.ts` | Add gateway exports |

### Out of Scope

- AgentLoop (CEO conversation) refactoring
- Daemon intelligence (per-daemon changes follow separately)
- Vision/multimodal AI
- Generic brain-plugin system
- Photo/Listing pipeline automation

## Capabilities

### New Capabilities

- `reasoning-gateway`: Unified DeepSeek call pattern with model selection, prompt caching, cost ledger, timeout/retry, and `ReasoningLevel`-based auto-execution boundary

### Modified Capabilities

- `deepseek-ceo-profitability-reasoning`: `CeoDeepSeekClient` routes through gateway; same behavior, new path
- `supplier-mirror`: `SupplierMirrorDeepSeekAdvisor` routes through gateway; pricing/model logic consolidated upstream
- `workforce-cost-rollups`: No spec change; gateway inserts unified ledger entries

## Approach

Gateway wraps the existing OpenAI singleton from `deepseekClient.ts`. Callers pass a `ReasoningCall` with `level`, `context blocks`, and `output schema`. Gateway resolves model, builds prompt with cache blocks, calls DeepSeek, records cost, validates output, returns structured result. Low-risk levels (`classification`/`summarization`/`prioritization`) integrate with `autonomyGate` for skip-dale.

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regression in profitability reasoning | Low | Existing `ceoDeepSeekClient` tests pass unchanged; behavior is preserved, path changes |
| Cost ledger double-counting | Low | Gateway is single entry point; all ledger calls go through one `insertEntry` path |
| Supplier Mirror prompt quality change | Low | Prompt structure and Spanish system prompt preserved; only transport layer changes |

## Rollback

Revert the two refactored callers to their pre-gateway implementation. Gateway is additive — no data migration, no schema changes. No existing clients depend on the `reasoning/` directory yet.

## Success Criteria

- [ ] `DeepSeekReasoningGateway` class exists with documented interface in `reasoning/`
- [ ] `CeoDeepSeekClient` refactored to use gateway — existing tests pass
- [ ] `SupplierMirrorDeepSeekAdvisor` refactored to use gateway — existing tests pass
- [ ] `ReasoningLevel` enum enforces low-risk auto-execution boundary
- [ ] All internal-agent DeepSeek calls route through gateway
- [ ] Cost recording is unified — single `insertEntry` pattern across callers
- [ ] `SupplierMirrorDeepSeekPolicy` pricing tables consolidated into gateway
