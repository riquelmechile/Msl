# Owned Ecommerce Agent Specification

## Purpose

Define the Medusa.js-first ecommerce builder/operator agent that creates and maintains fast owned storefront surfaces under CEO governance.

## Requirements

### Requirement: Evidence-Based Storefront Selection

The system MUST select products for owned ecommerce surfaces from Plasticov, Maustian, Supplier Mirror/Jinpeng, future suppliers, the operational read model, SupplierWebSignals, and Cortex context using evidence-linked inputs. When candidate provenance source is `supplier-mirror`, the system MUST populate `CandidateProvenance.supplierId` with the supplier identifier and `CandidateProvenance.cortexNodeIds` with the Cortex node IDs backing the candidate. When source is `supplier-web-signal`, the system MUST populate `supplierItemId` and `evidenceIds` in provenance.

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

#### Scenario: Signal-driven provenance

- GIVEN a storefront candidate is derived from a SupplierWebSignal
- WHEN the candidate is built
- THEN `CandidateProvenance.source` MUST be `"supplier-web-signal"`
- AND `CandidateProvenance.supplierItemId` and `evidenceIds` MUST be populated

#### Scenario: Evidence is stale or incomplete

- GIVEN stock, margin, supplier, or freshness evidence is missing or stale
- WHEN candidate selection runs
- THEN the system MUST exclude or mark the candidate blocked with reason codes.

### Requirement: Cortex-Powered Supplier Reasoning

The agent MUST reason on supplier data exclusively via Cortex queries (`queryByMetadata` and `spreadActivation`) rather than hardcoded rules or direct Supplier Mirror reads. Supplier-driven candidates SHALL be discovered by spreading activation from supplier concept nodes through the graph, not by deterministic pipeline logic. When Cortex is unavailable, the agent MUST return a `cortexUnavailable` marker and MUST NOT fall back to hardcoded rules. Cortex results for Plasticov and Maustian SHALL be isolated — seller-specific queries MUST NOT mix data across sellers.

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

#### Scenario: Cortex unavailable

- GIVEN Cortex is unreachable
- WHEN the agent attempts supplier reasoning
- THEN the result MUST include a `cortexUnavailable` marker
- AND the agent MUST NOT fall back to hardcoded rules or direct operational-store queries

#### Scenario: Seller isolation

- GIVEN both Plasticov and Maustian have supplier nodes in Cortex
- WHEN the agent queries Cortex for Plasticov's supplier data
- THEN results MUST exclude Maustian's supplier nodes
- AND Maustian queries MUST exclude Plasticov's nodes

### Requirement: DeepSeek Merchandising Reasoning

The system MAY use DeepSeek non-deterministically for ranking, merchandising, SEO/GEO copy, product/category positioning, and tradeoff reasoning, but deterministic validation MUST decide whether outputs are usable. When no DeepSeek advisor is configured, the system MUST use deterministic fallback. Unsupported superlatives such as "best", "guaranteed", or "official" without evidence MUST be blocked by deterministic validation. Tests MUST use FakeTransport and MUST NOT issue real HTTP requests.

#### Scenario: DeepSeek proposes positioning

- GIVEN eligible candidates and evidence-backed product context
- WHEN DeepSeek generates ranking or copy recommendations
- THEN the system MUST preserve rationale and source evidence references
- AND deterministic checks MUST validate claims before preview use.

#### Scenario: Risky or unsupported claim

- GIVEN generated copy includes a claim not supported by evidence
- WHEN validation runs
- THEN the system MUST block that claim from the storefront projection.

#### Scenario: No advisor

- GIVEN DeepSeek is not configured or available
- WHEN the agent needs merchandising reasoning
- THEN the system MUST use deterministic fallback
- AND MUST NOT fail or skip the projection

#### Scenario: Superlative blocked

- GIVEN DeepSeek generates content containing "best" without supporting evidence
- WHEN deterministic validation runs
- THEN the claim MUST be blocked from the storefront projection

#### Scenario: FakeTransport in tests

- GIVEN test scope with DeepSeek integration
- WHEN tests execute
- THEN FakeTransport MUST be used
- AND no real HTTP requests MUST be issued

### Requirement: Static Medusa Storefront Projections

The system MUST produce Medusa-oriented storefront projections with catalog structure, evidence-mapped SEO content, GEO content with intent and FAQ IDs, optimized media, pricing, inventory, schema/metadata, and readiness checks without request-time LLM reasoning. All projections MUST carry `noMutationExecuted: true`. When images are missing, the projection MUST include a `missingMedia` marker with creative request references.

#### Scenario: Projection is generated

- GIVEN approved candidate inputs exist
- WHEN a preview projection is built
- THEN it MUST include Medusa-ready catalog/content data, media references, schema, metadata, and readiness checks.

#### Scenario: Public request path

- GIVEN a generated storefront preview is served
- WHEN a public page request occurs
- THEN it MUST use static or precomputed data
- AND MUST NOT invoke LLM reasoning at request time.

#### Scenario: Full projection

- GIVEN approved candidate inputs with catalog, media, pricing, inventory, and readiness evidence
- WHEN a projection is built
- THEN it MUST include catalog, evidence-mapped SEO, GEO with intent and FAQ IDs, media, pricing, inventory, and readiness
- AND it MUST carry `noMutationExecuted: true`

#### Scenario: Missing images

- GIVEN candidate inputs have no images available
- WHEN a projection is built
- THEN the projection MUST include a `missingMedia` marker with creative request references
- AND the projection MUST NOT fail

### Requirement: CEO-Gated Owned Ecommerce Operations

The system MUST route business questions and approvals through the CEO Agent over Telegram while ecommerce workers remain internal and proposal-only. Three read-only tools SHALL be available: `inspect_owned_ecommerce_candidate`, `prepare_storefront_projection`, and `read_storefront_projection_status`. All three MUST return `noMutationExecuted: true` and MUST NOT execute mutations. `read_storefront_projection_status` MUST handle nonexistent projections gracefully with a controlled response.

#### Scenario: CEO approval needed

- GIVEN publishing, checkout/payment activation, price/stock mutation, or risky claims are proposed
- WHEN the operation is prepared
- THEN the CEO Agent MUST ask the human CEO in Telegram before execution.

#### Scenario: Worker completes analysis

- GIVEN an internal ecommerce worker finishes ranking, copy, or readiness analysis
- WHEN output is ready
- THEN it MUST return evidence-backed results to the CEO Agent
- AND MUST NOT message the human directly.

#### Scenario: Inspect candidate

- GIVEN a storefront candidate exists
- WHEN the CEO uses `inspect_owned_ecommerce_candidate`
- THEN the tool MUST return read-only evidence with `noMutationExecuted: true`
- AND MUST NOT execute any mutations

#### Scenario: Prepare projection

- GIVEN an approved candidate exists
- WHEN the CEO uses `prepare_storefront_projection`
- THEN the tool MUST build a storefront projection without publishing
- AND MUST return `noMutationExecuted: true`

#### Scenario: Read nonexistent projection

- GIVEN a projection does not exist for the requested ID
- WHEN the CEO uses `read_storefront_projection_status`
- THEN the tool MUST return a controlled response indicating nonexistence
- AND MUST NOT fail or throw

---

### Requirement: Backend-Only Medusa Runtime Execution

The system MUST execute owned ecommerce publish or checkout operations only from a backend runtime after approval and readiness are revalidated. LLM-facing CEO tools and public request paths MUST remain preparation-only and MUST NOT receive runtime credentials or execute Medusa mutations.

#### Scenario: Approved backend execution

- GIVEN a stored storefront projection and action have exact valid approval and fresh eligible readiness
- WHEN backend runtime execution is requested for the approved target
- THEN the system MUST execute through the controlled Medusa write boundary
- AND it MUST return execution status with redacted audit and rollback references.

#### Scenario: LLM tool cannot execute

- GIVEN the CEO-facing owned ecommerce tool prepares a publish or checkout action
- WHEN the user confirms from conversation
- THEN the tool MUST keep `noMutationExecuted: true`
- AND it MUST NOT accept approval claims as execution proof.

#### Scenario: Unsafe runtime request blocked

- GIVEN approval is missing, expired, mismatched, readiness is stale, or projection guardrails fail
- WHEN runtime execution is requested
- THEN the system MUST return a controlled blocked result with redacted reason codes
- AND it MUST NOT call the Medusa write boundary.

### Requirement: Public Publish and Checkout Activation Gates

The system MUST gate public publishing separately from checkout/payment activation. Each gate MUST require exact approval, configured non-LLM credentials, fresh readiness, safe public claims, and a rollback trail before activation.

#### Scenario: Public publish without checkout

- GIVEN publish approval exists but checkout/payment activation approval is absent
- WHEN backend runtime execution runs
- THEN the system MAY publish the approved public surface
- AND it MUST keep checkout and payments inactive.

#### Scenario: Checkout activation approved

- GIVEN publish and checkout/payment approvals both bind to the same safe fresh projection target
- WHEN backend runtime execution runs
- THEN the system MAY activate checkout/payment for the approved target
- AND it MUST expose only redacted execution evidence.

#### Scenario: Credentials unavailable

- GIVEN runtime credentials are missing or unavailable from environment/config
- WHEN publish or checkout activation is requested
- THEN the system MUST fail closed with a controlled blocked result
- AND it MUST NOT ask LLM or user-facing tools for credentials.

---

### Requirement: SupplierWebSignal Contract

The system MUST accept 6 signal kinds: `new-supplier-product`, `stock-gap`, `supplier-price-change`, `supplier-stock-restored`, `supplier-stock-out`, and `publish-opportunity`. Each signal MUST carry `noMutationExecuted: true`, `supplierId`, `supplierItemId`, `evidenceIds`, `severity`, and `recommendedAction`.

#### Scenario: Valid signal accepted

- GIVEN a well-formed SupplierWebSignal with a known kind, supplierId, and evidenceIds
- WHEN the signal is enqueued
- THEN the system MUST accept and process it

#### Scenario: Invalid payload rejected

- GIVEN a SupplierWebSignal with missing required fields or an unknown kind
- WHEN the signal is validated
- THEN the system MUST reject it with a controlled error

#### Scenario: Duplicate signal dropped

- GIVEN a signal with the same supplierId, itemId, signalKind, and hour key was already processed
- WHEN a duplicate arrives within the dedupe window
- THEN the system MUST drop the duplicate signal

### Requirement: Supplier Manager Bridge

`supplierManagerDaemon` SHALL enqueue a `supplier-web-signal` on detecting each of the 6 signal kinds. Missing critical evidence SHALL set `recommendedAction: collect-more-evidence`.

#### Scenario: New product triggers signal

- GIVEN a new supplier product is detected in the Supplier Mirror
- WHEN the daemon processes the detection
- THEN it MUST enqueue a `new-supplier-product` signal with evidence IDs

#### Scenario: Stock gap triggers signal

- GIVEN a stock gap is detected between Plasticov/Maustian listings and supplier availability
- WHEN the daemon processes the detection
- THEN it MUST enqueue a `stock-gap` signal with `severity: critical` and `affectedSellerIds`

#### Scenario: Price change triggers signal

- GIVEN a supplier price change is detected exceeding the configured threshold
- WHEN the daemon processes the detection
- THEN it MUST enqueue a `supplier-price-change` signal with `severity: review`

#### Scenario: Missing evidence not aggressive

- GIVEN critical evidence such as stock or margin is missing for a detection
- WHEN the daemon prepares the signal
- THEN it MUST set `recommendedAction: collect-more-evidence`
- AND MUST NOT enqueue an aggressive proposal

### Requirement: Intelligence Service + Daemon

The intelligence service SHALL process SupplierWebSignals into `StorefrontCandidate` via Cortex `spreadActivation` and `queryByMetadata`. The daemon SHALL consume `supplier-web-signal` messages from the bus and process them per seller. Seller isolation MUST be enforced — Plasticov and Maustian evidence MUST never be mixed. No mutations SHALL be executed. Duplicate signals MUST NOT produce duplicate proposals. The daemon tick MUST remain backward compatible.

#### Scenario: Signal processed into candidate

- GIVEN a valid SupplierWebSignal
- WHEN `prepareFromSupplierWebSignal` is called
- THEN it MUST return a `StorefrontCandidate` with provenance including `supplierId`, `supplierItemId`, `cortexNodeIds`, and `evidenceIds`

#### Scenario: Cortex unavailable degrades gracefully

- GIVEN Cortex is unreachable
- WHEN the intelligence service processes a signal
- THEN it MUST return a `cortexUnavailable` marker
- AND MUST degrade gracefully without hardcoded rules

#### Scenario: Good candidate becomes CEO proposal

- GIVEN a candidate scores above the publishable threshold and has no blockers
- WHEN the daemon processes the result
- THEN it MUST present a CEO proposal with score, blockers, and evidence

### Requirement: Candidate Scoring

The deterministic scorer MUST block candidates with no stock (`do-not-publish`) or no margin (`do-not-publish`). Candidates without images MUST receive `request-creative-assets`. Reputation risk SHALL lower the score. Unsupported claims MUST be blocked. Stale evidence MUST result in `collect-more-evidence`.

#### Scenario: High score with full evidence

- GIVEN a candidate has stock>0, margin>0, and images available
- WHEN the scorer evaluates it
- THEN the candidate MUST receive a high score

#### Scenario: No stock or margin blocks candidate

- GIVEN a candidate has stock=0 or no margin
- WHEN the scorer evaluates it
- THEN the candidate MUST be blocked with `do-not-publish`

#### Scenario: Missing images triggers creative request

- GIVEN a candidate has no images
- WHEN the scorer evaluates it
- THEN the scorer MUST return `request-creative-assets`

#### Scenario: Reputation risk lowers score

- GIVEN a candidate has reputation risk factors
- WHEN the scorer evaluates it
- THEN the score MUST be lowered proportionally

#### Scenario: Stale evidence requests collection

- GIVEN a candidate's evidence has exceeded its freshness window
- WHEN the scorer evaluates it
- THEN the scorer MUST return `collect-more-evidence`

### Requirement: Creative Studio Delegation

When images are missing for a storefront candidate, the system SHALL create a creative request with product truth constraints. Duplicate creative requests MUST be suppressed.

#### Scenario: Candidate without images creates creative request

- GIVEN a candidate has no images
- WHEN the intelligence pipeline processes it
- THEN a creative request SHALL be enqueued with product truth constraints

#### Scenario: Duplicate creative request suppressed

- GIVEN a creative request for the same candidate within the dedupe window
- WHEN the pipeline encounters the same missing-image candidate again
- THEN the duplicate creative request MUST be suppressed

#### Scenario: CEO proposal includes missingMedia

- GIVEN a projection has missing images
- WHEN the CEO proposal is built
- THEN it MUST include `missingMedia` references with creative request IDs

### Requirement: AccountBrain Channel

The system SHALL compare Plasticov, Maustian, and web channel performance via AccountBrain. Channel recommendations SHALL be included in projection evidence.

#### Scenario: Plasticov healthy recommended over web

- GIVEN Plasticov account health is strong and web channel is untested
- WHEN AccountBrain compares channel performance
- THEN Plasticov SHALL be recommended over web

#### Scenario: Maustian with grow_reputation recommended

- GIVEN Maustian has an active `grow_reputation` strategy
- WHEN AccountBrain compares channel performance
- THEN Maustian SHALL be recommended

#### Scenario: Insufficient data returns low confidence

- GIVEN AccountBrain has insufficient data for a meaningful comparison
- WHEN channel comparison runs
- THEN the result MUST include low confidence with reasons

### Requirement: Work Sessions

The daemon SHALL register observations and lessons in work sessions. It MUST NOT fail when the session store is unavailable.

#### Scenario: Signal creates observation

- GIVEN a SupplierWebSignal is processed
- WHEN the daemon registers the result
- THEN an observation with evidence IDs SHALL be created in the work session

#### Scenario: Blocked candidate becomes lesson

- GIVEN a candidate is blocked by the scorer
- WHEN the daemon processes the result
- THEN a lesson SHALL be registered in the work session

#### Scenario: Proposal linked to session

- GIVEN a CEO proposal is generated
- WHEN the daemon registers the result
- THEN the proposal SHALL be linked to the current work session

#### Scenario: Store down continues silently

- GIVEN the work session store is unavailable
- WHEN the daemon attempts to register an observation or lesson
- THEN the daemon MUST continue silently
- AND MUST NOT fail or throw

---

### Requirement: DeepSeekEnrichment in Storefront Projections

Storefront projections MUST include `DeepSeekEnrichment` populated by the advisor when transport is available. When unavailable, enrichment MUST be absent but the projection MUST NOT fail.

#### Scenario: Enrichment present

- GIVEN DeepSeek available, advisor returns reasoning
- WHEN projection is built
- THEN `DeepSeekEnrichment` includes rationale, tradeoffs, experiments

#### Scenario: No transport

- GIVEN transport absent
- WHEN projection is built
- THEN `DeepSeekEnrichment` absent; projection still valid

#### Scenario: Validator blocks content

- GIVEN advisor output partially blocked by validator
- WHEN projection is built
- THEN only valid enrichment fields included; blocked fields absent

### Requirement: Advisor Step 7 Fulfilled

The previously deferred pipeline step 7 (DeepSeek merchandising reasoning) MUST now execute when `MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED` is `"true"` and transport is configured. `noMutationExecuted: true` and `requiresApproval: true` MUST be maintained throughout.

#### Scenario: Step 7 wired and runs

- GIVEN feature flag enabled, transport configured
- WHEN pipeline reaches step 7
- THEN advisor executes; enrichment passed to projection builder

#### Scenario: Flag disabled

- GIVEN feature flag is not `"true"`
- WHEN pipeline runs
- THEN step 7 skipped; behavior identical to before this change

#### Scenario: Transport absent but flag enabled

- GIVEN flag is `"true"`, no transport
- WHEN pipeline reaches step 7
- THEN deterministic fallback used; pipeline continues
