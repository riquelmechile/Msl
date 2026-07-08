# Reasoning Gateway Specification

## Purpose

Unified DeepSeek call pattern for internal MSL agents. Single entry point wrapping the shared `deepseekClient.ts` singleton. Standardizes model selection, prompt caching, cost recording, timeout enforcement, structured output validation, and fallback behavior.

## Requirements

### Requirement: Unified Reasoning Interface

The system MUST expose `DeepSeekReasoningGateway.reason(call: ReasoningCall): Promise<ReasoningResult>` as the sole entry point for all internal-agent DeepSeek calls.

#### Scenario: Successful reasoning call

- GIVEN a valid `ReasoningCall` with laneId, level, and 3-block prompt
- WHEN `reason()` is called
- THEN the gateway SHALL select a model, construct the prompt, call DeepSeek, record cost, and return a `ReasoningResult` with `status: "success"`

#### Scenario: Refactored callers route through gateway

- GIVEN `CeoDeepSeekClientImpl` and `SupplierMirrorDeepSeekAdvisor` are refactored
- WHEN either calls DeepSeek for reasoning
- THEN the call SHALL pass through `DeepSeekReasoningGateway.reason()` exclusively

### Requirement: ReasoningCall Contract

`ReasoningCall` MUST include: `laneId` (string, non-empty), `level` (ReasoningLevel), `stablePrefix` (string), `cacheableContext` (string), `volatileInput` (string), and optionally `expectedSchema` (JSON Schema) and `forcePro` (boolean).

### Requirement: ReasoningResult Contract

`ReasoningResult` MUST return: `status` ("success" | "fallback"), `summary` (string), `confidence` (0–1), `recommendations` (array of structured objects), `modelUsed` (string), `costTelemetry` (CostTelemetry), `requiresApproval` (boolean), and `rawResponse` (string | undefined).

#### Scenario: Success result with recommendations

- GIVEN DeepSeek returns valid structured JSON matching `expectedSchema`
- WHEN the gateway processes the response
- THEN `status` SHALL be "success", `confidence` SHALL be > 0, and `recommendations` SHALL be non-empty

#### Scenario: Fallback result on error

- GIVEN the DeepSeek call fails, times out, or returns unparseable output
- WHEN the gateway handles the error
- THEN `status` SHALL be "fallback", `recommendations` SHALL be empty, and the gateway SHALL NOT throw

### Requirement: Model Selection

The gateway SHALL select `deepseek-v4-flash` by default. SHALL escalate to `deepseek-v4-pro` when `level` is `recommendation` or `decision`, or when `forcePro` is `true` regardless of level.

| Level | Default Model | forcePro |
|-------|--------------|----------|
| classification, summarization, prioritization | Flash | Pro |
| recommendation, decision | Pro | Pro |

### Requirement: Prompt Cache Strategy

The gateway SHALL construct prompts as 3 concatenated blocks: `stablePrefix` (immutable, cached), `cacheableContext` (slow-changing, cached), `volatileInput` (uncached). Uses the existing `cacheBlocks` pattern for prefix reuse.

### Requirement: Cost Recording

Every `reason()` call SHALL record one workforce cost ledger entry via `WorkforceCostCacheLedgerStore.insertEntry()` with: model, token counts, cache hit/miss status, laneId, departmentId, and cost estimate.

### Requirement: Timeout Strategy

The gateway SHALL enforce per-level timeouts via AbortController:

| Levels | Timeout |
|--------|---------|
| classification, summarization, prioritization | 5 seconds |
| recommendation | 15 seconds |
| decision | 30 seconds |

#### Scenario: Classification times out at 5s

- GIVEN a classification call is made
- WHEN the API does not respond within 5 seconds
- THEN the gateway SHALL abort and return `status: "fallback"`

### Requirement: Fallback Behavior

On any error — network, timeout, invalid JSON, schema mismatch — the gateway SHALL return `status: "fallback"` with empty recommendations and SHALL NOT throw.

### Requirement: Structured Output Validation

When `expectedSchema` is provided, the gateway SHALL validate the DeepSeek JSON response against the schema. Invalid output SHALL trigger fallback.

### Requirement: Autonomy Gate Integration

For auto-execute levels (`classification`, `summarization`, `prioritization`), the gateway SHALL call `autonomyGate` to verify the current autonomy tier allows skip-dale. If blocked, `requiresApproval` SHALL be `true` and the result SHALL include a Spanish reason.

#### Scenario: Autonomy allows auto-execute

- GIVEN autonomy level is 3 (BAJO_RIESGO) and level is `classification`
- WHEN `autonomyGate` is called
- THEN `requiresApproval` SHALL be `false`

#### Scenario: Autonomy blocks despite low-risk level

- GIVEN autonomy level is 1 (SUGIERE) and level is `prioritization`
- WHEN `autonomyGate` returns blocked
- THEN `requiresApproval` SHALL be `true` with a Spanish "dale" reason
