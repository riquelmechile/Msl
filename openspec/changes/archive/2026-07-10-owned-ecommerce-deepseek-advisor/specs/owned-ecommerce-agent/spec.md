# Delta for owned-ecommerce-agent

## ADDED Requirements

### Requirement: DeepSeekEnrichment in Storefront Projections

Storefront projections MUST include `DeepSeekEnrichment` populated by the advisor when transport is available. When unavailable, enrichment MUST be absent but the projection MUST NOT fail.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Enrichment present | DeepSeek available, advisor returns reasoning | Projection built | `DeepSeekEnrichment` includes rationale, tradeoffs, experiments |
| No transport | Transport absent | Projection built | `DeepSeekEnrichment` absent; projection still valid |
| Validator blocks content | Advisor output partially blocked by validator | Projection built | Only valid enrichment fields included; blocked fields absent |

### Requirement: Advisor Step 7 Fulfilled

The previously deferred pipeline step 7 (DeepSeek merchandising reasoning) MUST now execute when `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` is `"true"` and transport is configured. `noMutationExecuted: true` and `requiresApproval: true` MUST be maintained throughout.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Step 7 wired and runs | Feature flag enabled, transport configured | Pipeline reaches step 7 | Advisor executes; enrichment passed to projection builder |
| Flag disabled | Feature flag is not `"true"` | Pipeline runs | Step 7 skipped; behavior identical to before this change |
| Transport absent but flag enabled | Flag is `"true"`, no transport | Pipeline reaches step 7 | Deterministic fallback used; pipeline continues |
