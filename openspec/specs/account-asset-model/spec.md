# account-asset-model Specification

## Purpose

Domain types that model a MercadoLibre seller account as a strategic asset with capabilities, health, risk, profit goals, and scoped memory boundaries.

## Requirements

### Requirement: AccountAsset Domain Type

The system MUST define an `AccountAsset` type with fields: `sellerId: SellerId`, `name: string`, `marketplace: MarketplaceSite`, `capabilities: AccountCapability[]`, `profitGoal: number`, `riskLevel: AccountRisk`, `createdAt: Date`.

#### Scenario: AccountAsset represents a seller account

- GIVEN a seller account `"plasticov"` on `"MLC"` marketplace
- WHEN an `AccountAsset` is constructed
- THEN `sellerId` MUST be the seller identifier, `name` the display name, `marketplace` the site
- AND `profitGoal` is a percentage (e.g. 40), `riskLevel` is one of `low | medium | high | critical`

#### Scenario: AccountAsset carries capabilities

- GIVEN a seller account with listing, pricing, and messaging capabilities
- WHEN `capabilities` is queried
- THEN each entry MUST include `kind`, `status` (`active | degraded | missing`), and `health`

### Requirement: AccountCapability Type

The system MUST define `AccountCapability` with: `kind: string`, `status: "active" | "degraded" | "missing"`, `health: AccountHealthSnapshot`.

#### Scenario: Capability status reflects real state

- GIVEN the seller has active listings but no pricing history
- WHEN capabilities are evaluated
- THEN `listing` capability MUST be `active`, and `pricing` capability MUST be `degraded` or `missing`

### Requirement: AccountHealthSnapshot Type

The system MUST define `AccountHealthSnapshot` with: `healthScore: number` (0–1), `degradedAt?: Date`, `degradationReason?: string`.

#### Scenario: Healthy account

- GIVEN all capabilities are active
- WHEN `AccountHealthSnapshot` is computed
- THEN `healthScore` MUST be 1.0 with no `degradedAt`

#### Scenario: Degraded account

- GIVEN a capability fails with repeated errors
- WHEN `AccountHealthSnapshot` is computed
- THEN `healthScore` MUST be < 1.0, `degradedAt` set, and `degradationReason` populated

### Requirement: AccountStrategy Type

The system MUST define `AccountStrategy` with: `sellerId: SellerId`, `rule: string`, `confidence: number` (0–1), `learnedFrom: string`, `updatedAt: Date`.

#### Scenario: Account-level strategy is scoped

- GIVEN seller A has a margin strategy of 50%
- WHEN seller B's strategies are queried
- THEN seller A's strategies MUST NOT appear for seller B

### Requirement: AccountRisk Type

The system MUST define `AccountRisk` as `"low" | "medium" | "high" | "critical"`.

#### Scenario: Risk classification

- GIVEN an account with no claims and healthy metrics
- WHEN risk is evaluated
- THEN `riskLevel` MUST be `"low"`
- GIVEN an account with unresolved claims and degraded capabilities
- WHEN risk is evaluated
- THEN `riskLevel` MUST be `"medium"` or higher

### Requirement: MemoryScope Type

The system MUST define `MemoryScope` as `"account" | "global"`. A `seller_id` column value of `NULL` SHALL represent `"global"` scope. A non-NULL `seller_id` SHALL represent `"account"` scope.

#### Scenario: Null seller_id means global

- GIVEN a Cortex node with `seller_id = NULL`
- WHEN memory scope is evaluated
- THEN the node MUST be treated as globally visible to all accounts

#### Scenario: Non-null seller_id means account-scoped

- GIVEN a Cortex node with `seller_id = "plasticov"`
- WHEN queried with seller scope `"maustian"`
- THEN the node MUST NOT be returned
