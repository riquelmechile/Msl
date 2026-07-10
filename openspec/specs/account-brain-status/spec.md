# account-brain-status Specification

## Purpose

Per-account strategic dashboard aggregating existing stores (AccountAssetStore, AgentWorkSessionStore, WorkforceCostCacheLedgerStore, CeoInboxStore, Cortex) into a structured `AccountBrainStatus` per seller. Read-only; no ML mutations.

## Requirements

### Requirement: Account Brain Status Query

The system SHALL accept `AccountBrainStatusInput` and return `AccountBrainStatus` with health, capabilities, risks, opportunities, strategy, agent activity, pending approvals, cost/cache, cortex presence, recommended focus, confidence, and evidence. All outputs SHALL include `noMutationExecuted: true`.

#### Scenario: Full account data returned

- GIVEN sellerId "plasticov" with data across all stores
- WHEN `get_account_brain_status` is called
- THEN health, capabilities, risks, opportunities, strategy, agentActivity, pendingApprovals, costAndCache, cortex, recommendedFocus, confidence, and evidence are populated
- AND `noMutationExecuted` is `true`

#### Scenario: Missing account

- GIVEN sellerId "unknown_account" does not exist in AccountAssetStore
- WHEN `get_account_brain_status` is called
- THEN returns status `missing_account_asset` — never throws

#### Scenario: Store unavailable

- GIVEN WorkforceCostCacheLedgerStore is not configured
- WHEN `get_account_brain_status` is called
- THEN costAndCache reports `"unavailable"` per field — never crashes

#### Scenario: Empty data

- GIVEN seller has zero agents, zero approvals, zero risks
- WHEN `get_account_brain_status` is called
- THEN returns valid structure with empty arrays and zero counts — never throws

### Requirement: Seller Isolation

The system SHALL filter every store query by the input `sellerId`. Plasticov queries MUST NOT return Maustian data. Global memory source SHALL be marked as `"global"`.

#### Scenario: Plasticov-only data

- GIVEN both Plasticov and Maustian have agent sessions today
- WHEN `get_account_brain_status({ sellerId: "plasticov" })` is called
- THEN only Plasticov agent data appears in agentActivity, pendingApprovals, costAndCache

### Requirement: Optional Input Flags

The system SHALL respect input flags `includeLessons`, `includeCosts`, `includeCortex`, `includePendingApprovals`. When `false`, the corresponding output section SHALL be omitted. When omitted, defaults apply: costs and cortex default `true`; lessons and pending approvals default `true`.

#### Scenario: Lessons excluded

- GIVEN `includeLessons: false`
- WHEN `get_account_brain_status` is called
- THEN agentActivity omits lessons count

#### Scenario: Cortex excluded

- GIVEN `includeCortex: false`
- WHEN `get_account_brain_status` is called
- THEN cortex section is omitted entirely

### Requirement: Read-Only Guarantee

The system SHALL NOT execute any ML mutations. No HTTP calls, no DeepSeek calls, no MercadoLibre writes. Output MUST include `noMutationExecuted: true`.

#### Scenario: Multiple invocations

- GIVEN tool invoked 3 times
- WHEN responses inspected
- THEN `noMutationExecuted: true` on every response, zero side effects
