# Delta for supplier-mirror

## ADDED Requirements

(No standalone ADDED requirements — all changes are modifications to existing requirements.)

## MODIFIED Requirements

### Requirement: Pricing and Supplier Price Learning

The system MUST accept CEO-natural pricing policies: x2, x3, x4, fixed uplift, or future learned policy. Supplier price changes MUST notify the CEO; the CEO proposes the next action; the user's answer MUST be recorded as Cortex fallback learning. The system MUST ingest each recorded fallback lesson as a `supplier_lesson` Cortex node via the supplier-cortex-integration bridge, including `supplierId`, lesson text, and decision context in node metadata.

(Previously: Fallback learning was recorded locally only — no Cortex node ingestion.)

#### Scenario: Natural pricing policy stored
- GIVEN the user tells the CEO "use x3 for this supplier"
- WHEN policy is parsed and confirmed
- THEN future proposals MUST use x3 as the supplier policy

#### Scenario: Supplier price changes
- GIVEN a supplier item price changes
- WHEN monitoring detects the change
- THEN the CEO MUST be notified with proposed options and record the user's answer as fallback learning

#### Scenario: Fallback lesson ingested to Cortex
- GIVEN the user's answer is recorded as fallback learning
- WHEN the bridge syncs fallback lessons
- THEN a `supplier_lesson` Cortex node MUST be created or updated with `supplierId`, lesson text, and decision context in metadata

### Requirement: Mirror Evidence Model

The system MUST persist supplier item snapshots, stock observations with confidence, target mappings, target account policy, and sync ledger records for every proposal, pause, skip, or mutation candidate. When item mappings are approved for mirroring, the system MUST create `supplier_mapping` Cortex nodes via the supplier-cortex-integration bridge, linking supplier items to target listings.

(Previously: Mappings were recorded only in the operational read model — no Cortex nodes were created.)

#### Scenario: Item mapped to targets
- GIVEN a supplier item is approved for mirroring
- WHEN mappings are recorded
- THEN mappings MUST identify supplier item, target listing/account, policy, and evidence IDs

#### Scenario: Approved mapping creates Cortex node
- GIVEN an item mapping is approved
- WHEN the bridge syncs approved mappings
- THEN a `supplier_mapping` Cortex node MUST be created with metadata including `supplierItemId`, `targetListingId`, `targetAccount`, and `policyId`

#### Scenario: Sync skipped
- GIVEN evidence is stale, low-confidence, or unmapped
- WHEN sync evaluation runs
- THEN the ledger MUST record a skip reason without mutation

### Requirement: Stock Monitoring and Emergency Pause

Approved mapped items MUST be monitored about every 10 minutes. Possible stock breaks MUST receive short verification before confirmed breaks pause affected target listings when allowed and notify the CEO. Stock observations MUST be written to Cortex as `supplier_stock` nodes via the supplier-cortex-integration bridge. Confirmed stock breaks MUST emit a notification to the Agent Message Bus for consumption by the owned ecommerce agent.

(Previously: Stock monitoring did not write to Cortex nodes, and stock-break notifications did not reach the Agent Message Bus.)

#### Scenario: Confirmed stock break
- GIVEN an approved mapped item shows a possible supplier stock break
- WHEN verification confirms the break with sufficient evidence
- THEN allowed target listings MUST be paused and the CEO MUST receive evidence
- AND a stock-break notification MUST be published to the Agent Message Bus

#### Scenario: Stock observation written to Cortex
- GIVEN a stock observation is recorded for a mapped item
- WHEN the bridge syncs stock data
- THEN a `supplier_stock` Cortex node MUST be created or updated with latest `quantity`, `confidence`, and `supplierItemId` in metadata

#### Scenario: Verification inconclusive
- GIVEN stock evidence is conflicting or low-confidence
- WHEN verification completes
- THEN the system MUST not pause and MUST notify or ledger the uncertainty

## REMOVED Requirements

(None)

## RENAMED Requirements

(None)
