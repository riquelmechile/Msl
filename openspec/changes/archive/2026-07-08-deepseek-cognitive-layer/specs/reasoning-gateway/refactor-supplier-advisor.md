# Delta for supplier-mirror

## Purpose

Refactor `SupplierMirrorDeepSeekAdvisor.analyze()` to route through `DeepSeekReasoningGateway`. Preserve Spanish system prompt, SupplierMirrorStore evidence gathering, and return type. Consolidate pricing and model selection from `SupplierMirrorDeepSeekPolicy` into gateway. All existing tests must pass.

## MODIFIED Requirements

### Requirement: Notification and DeepSeek Cost Learning

The system MUST start with broad supplier alerts and MAY learn suppressions. DeepSeek usage MUST route through `DeepSeekReasoningGateway` with stable prompt prefixes, cacheable context blocks, V4 Flash for high volume, V4 Pro for hard reasoning, and cost/cache evidence.

(Previously: `SupplierMirrorDeepSeekAdvisor` called DeepSeek directly with inline model selection via `selectSupplierMirrorDeepSeekModel` and inline cost estimation via `estimateSupplierMirrorDeepSeekCostMicros`)

#### Scenario: High-volume extraction uses Flash through gateway

- GIVEN supplier extraction is routine and high-volume
- WHEN DeepSeek is called through the gateway
- THEN V4 Flash MUST be selected by the gateway and cost telemetry MUST be recorded

#### Scenario: Policy conflict uses Pro through gateway

- GIVEN a hard policy conflict is detected
- WHEN DeepSeek is called through the gateway with `forcePro: true`
- THEN V4 Pro MUST be selected by the gateway

## ADDED Requirements

### Requirement: Gateway Routing for Advisor

`SupplierMirrorDeepSeekAdvisor.analyze()` SHALL route through `DeepSeekReasoningGateway.reason()`.

#### Scenario: Advisor constructs ReasoningCall from store data

- GIVEN `analyze()` is called with supplierId and evidence
- WHEN the advisor prepares the call
- THEN it SHALL gather evidence from `SupplierMirrorStore`, build a `ReasoningCall` with `level: classification` and the supplier-specific prompt blocks, and pass it to the gateway

#### Scenario: Spanish system prompt preserved

- GIVEN the advisor builds the `stablePrefix`
- WHEN the `ReasoningCall` is constructed
- THEN the prefix SHALL contain the existing Spanish system prompt: "Sos un asesor interno de Supplier Mirror para el CEO de MSL."

#### Scenario: SupplierMirrorStore evidence gathering preserved

- GIVEN `analyze()` is called
- WHEN evidence is gathered
- THEN `listSupplierItemSnapshots`, `listTargetPolicies`, `listApprovedItemMappings`, `listNotificationEvents`, and `listLearnedFallbackPolicies` SHALL all be called as before

#### Scenario: Return type preserved

- GIVEN the gateway returns a `ReasoningResult`
- WHEN `analyze()` maps the result
- THEN the return SHALL still be `SupplierMirrorAnalysis` with `findings`, `summary`, `modelUsed`, `costMicros`, and token counts

### Requirement: Pricing and Model Selection Consolidation

Pricing tables (`SUPPLIER_MIRROR_DEEPSEEK_PRICING`) and model selection logic (`selectSupplierMirrorDeepSeekModel`) SHALL be consolidated into the gateway's internal pricing registry. Prompt-plan building (`buildSupplierMirrorDeepSeekPromptPlan`) SHALL remain in `SupplierMirrorDeepSeekPolicy`.

(Previously: Pricing, model selection, and prompt plans were all in one module)

#### Scenario: Cost provided by gateway telemetry

- GIVEN a DeepSeek call completes through the gateway
- WHEN `analyze()` builds the `SupplierMirrorAnalysis` result
- THEN `costMicros` and `modelUsed` SHALL come from the gateway's `costTelemetry` — the advisor SHALL NOT call pricing estimation directly

#### Scenario: Existing tests pass after refactor

- GIVEN the refactored `SupplierMirrorDeepSeekAdvisor` is tested
- WHEN `npm test` runs
- THEN all existing advisor tests SHALL pass unchanged
