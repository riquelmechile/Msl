# Delta for Owned Ecommerce Agent

## ADDED Requirements

### Requirement: Multi-Agent Evidence Pipeline Integration

The planner MUST persist evidence gaps to `EvidenceRequestStore` and emit `evidence-request` messages to the bus — not just text descriptors. The daemon MUST mark candidates `waiting_for_evidence` when requests are outstanding. Evidence responses MUST trigger candidate re-evaluation. Deduplication MUST prevent duplicate requests per candidate+kind within the configured window. All pipeline stages MUST carry `noMutationExecuted: true`.

#### Scenario: Planner persists to store and bus

- GIVEN the planner detects cost and image evidence gaps
- WHEN the planner runs
- THEN requests MUST be enqueued in `EvidenceRequestStore` with kind, priority, seller ID
- AND `evidence-request` messages MUST be published to the bus
- AND `noMutationExecuted` MUST be `true`

#### Scenario: Candidate lifecycle with evidence

- GIVEN a candidate has outstanding evidence requests
- WHEN daemon evaluates → status MUST be `waiting_for_evidence`; not proposed to CEO
- WHEN all responses arrive → daemon MUST re-evaluate; candidate flows through scoring
- WHEN duplicate request attempted → marked `duplicate`; no new bus message emitted

### Requirement: Evidence Response Aggregation

`OwnedEcommerceEvidenceAggregator` MUST join responses from all responders, enrich candidates with multi-agent evidence, and produce proposals with confidence (minimum across responses), blockers, and readiness. Proposals MUST include per-kind evidence IDs and response summaries.

#### Scenario: Aggregator enriches proposal

- GIVEN cost, stock, creative responses exist with confidence high, medium, high
- WHEN aggregator builds proposal → overall confidence `medium`; blockers surfaced
- WHEN one required kind has no response → candidate stays `waiting_for_evidence`
- WHEN one response is expired → confidence downgraded; expired kind listed as blocker

## MODIFIED Requirements

### Requirement: Evidence-Based Storefront Selection

The system MUST select products for owned ecommerce surfaces from Plasticov, Maustian, Supplier Mirror/Jinpeng, future suppliers, the operational read model, SupplierWebSignals, and Cortex context using evidence-linked inputs. When evidence gaps are detected, the system MUST request multi-agent evidence through `EvidenceRequestStore` and the message bus, mark candidates `waiting_for_evidence`, and re-evaluate upon responses. When candidate provenance source is `supplier-mirror`, the system MUST populate `CandidateProvenance.supplierId`. When source is `supplier-web-signal`, the system MUST populate `supplierItemId` and `evidenceIds`.

(Previously: Evidence gaps produced text descriptors only — no multi-agent request/response cycle.)

#### Scenario: Ranked storefront candidates

- GIVEN fresh product, stock, margin, supplier, read-model, and Cortex evidence exists
- WHEN agent prepares candidates → ranked Medusa-ready list with evidence IDs and provenance

#### Scenario: Supplier mirror provenance populated

- GIVEN a candidate derived from supplier mirror data
- WHEN built → `CandidateProvenance.source` MUST be `"supplier-mirror"` with `supplierId` and `cortexNodeIds`

#### Scenario: Signal-driven provenance

- GIVEN a candidate derived from a SupplierWebSignal
- WHEN built → `CandidateProvenance.source` MUST be `"supplier-web-signal"` with `supplierItemId` and `evidenceIds`

#### Scenario: Evidence is stale or incomplete

- GIVEN stock, margin, supplier, or freshness evidence is missing or stale
- WHEN candidate selection runs → system MUST enqueue multi-agent evidence requests
- AND candidate MUST be marked `waiting_for_evidence` with blocker reason codes

#### Scenario: Multi-agent evidence enriches selection

- GIVEN evidence responses arrive from cost-supplier, market-catalog, and creative-assets
- WHEN aggregator re-evaluates candidate → candidate includes aggregated confidence and per-kind evidence IDs
- AND enriched candidate flows through scoring for CEO proposal generation
