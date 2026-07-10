# Inter-Agent Evidence Specification

## Purpose

Domain types, store, router, responder contracts, and bus integration for multi-agent evidence requests/responses serving the owned-ecommerce pipeline and CEO inspection tools.

## Requirements

### Requirement: Evidence Payload Contracts

`EvidenceRequestPayload` and `EvidenceResponsePayload` MUST carry `noMutationExecuted: true`.

| Evidence Kind | Target Agent |
|---------------|-------------|
| `cost-margin` | `cost-supplier` |
| `supplier-stock` | `supplier-manager` |
| `market-demand` | `market-catalog` |
| `market-competition` | `market-catalog` |
| `creative-assets` | `creative-assets` |
| `account-channel-fit` | `account-brain` |
| `supplier-freshness` | `supplier-manager` |
| `listing-performance` | `owned-ecommerce` |
| `claim-support` | `operations-manager` |
| `unknown` | CEO (fallback) |

Priority: `low | medium | high | critical`. Confidence: `low | medium | high`. Status: `queued | claimed | answered | failed | expired | duplicate | unsupported`.

#### Scenario: All payloads noMutationExecuted

- GIVEN any `EvidenceRequestPayload` or `EvidenceResponsePayload`
- WHEN serialized or delivered
- THEN `noMutationExecuted` MUST be `true`

#### Scenario: Unsupported kind

- GIVEN an unrecognized evidence kind
- WHEN the router evaluates the target
- THEN status MUST be `unsupported` and the request MUST NOT be delegated

### Requirement: EvidenceRequestStore

`EvidenceRequestStore` (SQLite WAL mode; in-memory for tests) MUST support: `enqueue`, `claim`, `answer`, `fail`, `expire`, `dedupe`, `query`. Seller isolation MUST prevent Plasticov→Maustian cross-reads.

#### Scenario: Enqueue and claim lifecycle

- GIVEN no duplicate exists for candidate+kind+window
- WHEN `enqueue` is called → request persisted as `queued`
- THEN `claim` by correct responder acquires it as `claimed`
- AND `answer` stores the response with confidence

#### Scenario: Duplicate prevented

- GIVEN an existing request for same candidate, kind, dedupe window
- WHEN `enqueue` is called with matching params
- THEN status MUST be `duplicate`; original request ID returned

#### Scenario: Seller isolation and expiry

- GIVEN Plasticov and Maustian both have pending requests
- WHEN querying by seller → cross-seller requests excluded
- WHEN `expire` called on TTL-exceeded request → status `expired`, not claimable

### Requirement: EvidenceResponseRouter

`EvidenceResponseRouter` MUST delegate pending requests to correct responder per evidence kind. Failures MUST transition to `failed` with error evidence.

#### Scenario: Router delegates and handles failure

- GIVEN `cost-margin` request pending → `CostSupplier` invoked; status → `answered`
- GIVEN responder throws → status `failed` with error evidence recorded

### Requirement: Responder Agent Contracts

Five responders MUST exist (`CostSupplier`, `MarketCatalog`, `CreativeAssets`, `AccountBrain`, `SupplierManager`). Each MUST implement `handleEvidenceRequest` with fake transport injection. All MUST return `noMutationExecuted: true`. No real HTTP or mutations allowed.

#### Scenario: Responder returns evidence

- GIVEN a request matching its evidence kind
- WHEN `handleEvidenceRequest` called with fake transport
- THEN `EvidenceResponsePayload` returned with confidence, evidence IDs, and `noMutationExecuted: true`

### Requirement: EvidenceAggregator

`OwnedEcommerceEvidenceAggregator` MUST join responses, update candidate blockers/confidence, and enrich proposals. Joined confidence MUST be minimum across responses. Missing responses MUST keep candidate `waiting_for_evidence`.

#### Scenario: Aggregation and confidence

- GIVEN 3 responses: high, medium, high → overall confidence = `medium`
- WHEN a required kind has no response → candidate stays `waiting_for_evidence`
- WHEN one response expired → confidence downgraded; expired kind listed as blocker

### Requirement: Evidence Message Bus

Bus MUST support `evidence-request` and `evidence-response` message types, SQLite-backed. Every message MUST carry `correlationId` connecting request→response→proposal chain.

#### Scenario: Correlation chain preserved

- GIVEN planner emits request with `correlationId: "corr-1"`
- WHEN responder publishes response → `correlationId: "corr-1"` carried through
- AND CEO proposal enriched from that response MUST reference `correlationId: "corr-1"`
