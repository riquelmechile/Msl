# Delta for owned-ecommerce-agent

## ADDED Requirements

### Requirement: Cortex-Powered Supplier Reasoning

The agent MUST reason on supplier data exclusively via Cortex queries (`queryByMetadata` and `spreadActivation`) rather than hardcoded rules or direct Supplier Mirror reads. Supplier-driven candidates SHALL be discovered by spreading activation from supplier concept nodes through the graph, not by deterministic pipeline logic.

#### Scenario: Agent discovers niche via Cortex traversal
- GIVEN supplier_item and supplier_mapping nodes exist in Cortex
- WHEN the agent queries Cortex with `spreadActivation` from a supplier seed node
- THEN activated concept paths SHALL inform candidate proposals
- AND no hardcoded price-point or category rules SHALL determine merchandise selection

#### Scenario: Agent queries supplier metadata
- GIVEN the agent needs all items from a specific supplier
- WHEN the agent calls `queryByMetadata("supplierId", "jinpeng")`
- THEN supplier_item and supplier_mapping nodes for that supplier MUST be returned
- AND the agent MUST use these results for reasoning, proposals, and provenance population

#### Scenario: No supplier data in Cortex
- GIVEN Cortex has no supplier-typed nodes for a requested supplier
- WHEN the agent queries for supplier data
- THEN the agent MUST return an empty result gracefully
- AND MUST NOT fall back to hardcoded rules or direct operational-store queries

## MODIFIED Requirements

### Requirement: Evidence-Based Storefront Selection

The system MUST select products for owned ecommerce surfaces from Plasticov, Maustian, Supplier Mirror/Jinpeng, future suppliers, the operational read model, and Cortex context using evidence-linked inputs. When candidate provenance source is `supplier-mirror`, the system MUST populate `CandidateProvenance.supplierId` with the supplier identifier and `CandidateProvenance.cortexNodeIds` with the Cortex node IDs backing the candidate.

(Previously: Provenance populated source account or supplier provenance generically — no `supplierId` or `cortexNodeIds` fields required.)

#### Scenario: Ranked storefront candidates
- GIVEN fresh product, stock, margin, supplier, read-model, and Cortex evidence exists
- WHEN the agent prepares owned storefront candidates
- THEN it MUST return ranked Medusa-ready candidates with evidence IDs
- AND it MUST identify source account or supplier provenance.

#### Scenario: Supplier mirror provenance populated
- GIVEN a storefront candidate is derived from supplier mirror data
- WHEN the candidate is built
- THEN `CandidateProvenance.source` MUST be `"supplier-mirror"`
- AND `CandidateProvenance.supplierId` MUST contain the originating supplier identifier
- AND `CandidateProvenance.cortexNodeIds` MUST contain the Cortex node IDs for all supplier_item, supplier_stock, supplier_mapping, and supplier_policy nodes used

#### Scenario: Evidence is stale or incomplete
- GIVEN stock, margin, supplier, or freshness evidence is missing or stale
- WHEN candidate selection runs
- THEN the system MUST exclude or mark the candidate blocked with reason codes.

## REMOVED Requirements

(None)

## RENAMED Requirements

(None)
