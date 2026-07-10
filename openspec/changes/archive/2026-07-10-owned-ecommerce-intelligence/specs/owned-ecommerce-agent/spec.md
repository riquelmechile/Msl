# Delta for Owned Ecommerce Agent

## ADDED Requirements

| # | Requirement | MUST/SHALL | Key Scenarios |
|---|---|---|---|
| R1 | **SupplierWebSignal Contract** | MUST accept 6 kinds: `new-supplier-product`, `stock-gap`, `supplier-price-change`, `supplier-stock-restored`, `supplier-stock-out`, `publish-opportunity`. Each carries `noMutationExecuted: true`, `supplierId`, `supplierItemId`, `evidenceIds`, `severity`, `recommendedAction`. | Valid signal accepted. Invalid payload rejected with controlled error. Duplicate (same supplier+item+kind in dedupe window) dropped. |
| R2 | **Supplier Manager Bridge** | `supplierManagerDaemon` SHALL enqueue signal on detection. Missing critical evidence SHALL set `recommendedAction: collect-more-evidence`. | New product → `new-supplier-product` with evidence IDs. Stock gap → `stock-gap`, `severity: critical`, `affectedSellerIds`. Price change → `supplier-price-change`, `severity: review`. Missing evidence → not aggressive proposal. |
| R3 | **Intelligence Service + Daemon** | SHALL process signals into `StorefrontCandidate` via Cortex `spreadActivation`/`queryByMetadata`. Daemon consumes `supplier-web-signal` from bus. Seller isolation: Plasticov/Maustian evidence never mixed. No mutations. Duplicate signals → no duplicate proposals. | `prepareFromSupplierWebSignal` → candidate with provenance: `supplierId`, `supplierItemId`, `cortexNodeIds`, `evidenceIds`. Cortex unavailable → `cortexUnavailable`, graceful degrade. Good candidate → CEO proposal with score, blockers, evidence. Daemon-tick backward compatible. |
| R4 | **Candidate Scoring** | Deterministic scorer blocks: no stock → `do-not-publish`, no margin → `do-not-publish`. No images → `request-creative-assets`. Reputation risk lowers score. Unsupported claims blocked. Stale evidence → `collect-more-evidence`. | Stock>0 + margin>0 + images → high score. No stock/no margin → blocked. No images → creative request. Reputation → lowered. Stale → evidence collect. |
| R5 | **Creative Studio Delegation** | Missing images SHALL create creative request with product truth constraints. Duplicates MUST be suppressed. | Candidate without images → creative request. Duplicate → suppressed. CEO proposal includes `missingMedia`. |
| R6 | **AccountBrain Channel** | SHALL compare Plasticov, Maustian, web channel. Result in projection evidence. | Plasticov healthy → recommended over web. Maustian + `grow_reputation` → recommended. Insufficient data → low confidence with reasons. |
| R7 | **Work Sessions** | Daemon SHALL register observations and lessons. MUST NOT fail when store unavailable. | Signal → observation with evidence IDs. Blocked candidate → lesson. Proposal → linked to session. Store down → silent continue. |

## MODIFIED Requirements

### Requirement: Evidence-Based Storefront Selection

MUST select from Plasticov, Maustian, Supplier Mirror, future suppliers, read-model, **SupplierWebSignals**, and Cortex. When source is `supplier-web-signal`: populate `supplierItemId`, `evidenceIds` in provenance.

#### Scenario: Signal-driven provenance
- GIVEN candidate from SupplierWebSignal → `source: "supplier-web-signal"`, `supplierItemId` and `evidenceIds` populated.

### Requirement: Cortex-Powered Supplier Reasoning

MUST reason via Cortex only. Cortex unavailable → `cortexUnavailable` marker, MUST NOT fall back to hardcoded rules. Seller isolation: Plasticov/Maustian Cortex results MUST NOT mix.

#### Scenario: Cortex unavailable
- GIVEN Cortex unreachable → `cortexUnavailable`, no hardcoded fallback.

#### Scenario: Seller isolation
- GIVEN both sellers have supplier nodes → Plasticov results exclude Maustian nodes.

### Requirement: DeepSeek Merchandising Reasoning

Deterministic validation MUST gate outputs. No advisor → deterministic fallback. Tests MUST use `FakeTransport`, zero real HTTP. Unsupported superlatives ("best", "guaranteed", "official" without evidence) blocked.

#### Scenario: No advisor
- GIVEN DeepSeek unconfigured → deterministic fallback.

#### Scenario: Superlative blocked
- GIVEN "best" without evidence → claim blocked.

#### Scenario: FakeTransport
- GIVEN test scope → `FakeTransport`, no real HTTP.

### Requirement: Static Medusa Storefront Projections

MUST produce projections with catalog, SEO (evidence-mapped), GEO (intent+FAQ IDs), media, pricing, inventory, readiness. All carry `noMutationExecuted: true`. Missing images → `missingMedia`.

#### Scenario: Full projection
- GIVEN approved inputs → catalog, SEO+evidence, GEO+FAQ, media, pricing, inventory, readiness; `noMutationExecuted: true`.

#### Scenario: Missing images
- GIVEN no images → `missingMedia` with creative request ref.

### Requirement: CEO-Gated Operations

Three new read-only tools: `inspect_owned_ecommerce_candidate`, `prepare_storefront_projection`, `read_storefront_projection_status`. All return `noMutationExecuted: true`. `read_status` handles nonexistent projection.

#### Scenario: Inspect
- GIVEN candidate exists → read-only, `noMutationExecuted: true`.

#### Scenario: Prepare projection
- GIVEN approved candidate → projection without publishing.

#### Scenario: Read nonexistent
- GIVEN projection nonexistent → controlled response.
