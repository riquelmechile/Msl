# Supplier Mirror Specification

## Purpose

Mirror supplier catalogs into MSL with auditable evidence, CEO-led policies, and safe target-account synchronization.

## Requirements

### Requirement: Supplier Registry and Source Adapters

The system MUST support many suppliers through a registry of source adapters. Each adapter MUST identify supplier identity, source type, freshness, confidence, and evidence for every normalized item.

#### Scenario: Registered supplier ingested
- GIVEN a registered supplier has an enabled source adapter
- WHEN Supplier Mirror runs ingestion
- THEN it MUST create or update supplier item snapshots with source, freshness, confidence, and evidence IDs

#### Scenario: Unsupported supplier source
- GIVEN a supplier lacks an enabled adapter
- WHEN ingestion is requested
- THEN the system MUST skip ingestion and report unsupported source evidence

### Requirement: Source Authority Separation

ML supplier stock MUST be the operational stock authority. Jinpeng ML refs MUST validate nickname, profile, and seller id when available; unresolved identity MUST block runtime enablement. ML API/docs access MUST be attempted first; scraping MAY be isolated fallback evidence. XKP SHALL enrich catalog/spec/photo/description data and MUST NOT override ML stock.

#### Scenario: ML stock available
- GIVEN MercadoLibre returns stock for a supplier item
- WHEN stock is normalized
- THEN the observation MUST be authoritative with API evidence

#### Scenario: XKP stock differs
- GIVEN XKP enrichment contains stock-like data that differs from ML
- WHEN target sync is evaluated
- THEN ML stock MUST win and XKP stock MUST be ignored for authority

#### Scenario: Jinpeng seller id unresolved
- GIVEN nickname/profile lookup cannot resolve a trusted ML seller id
- WHEN validation completes
- THEN runtime enablement MUST be blocked

### Requirement: Mirror Evidence Model

The system MUST persist supplier item snapshots, stock observations with confidence, target mappings, target account policy, and sync ledger records for every proposal, pause, skip, or mutation candidate.

#### Scenario: Item mapped to targets
- GIVEN a supplier item is approved for mirroring
- WHEN mappings are recorded
- THEN mappings MUST identify supplier item, target listing/account, policy, and evidence IDs

#### Scenario: Sync skipped
- GIVEN evidence is stale, low-confidence, or unmapped
- WHEN sync evaluation runs
- THEN the ledger MUST record a skip reason without mutation

### Requirement: Target Account Policy

The system MUST allow Plasticov, Maustian, or both as targets per supplier, item, or category. Jinpeng defaults MUST target both as CEO-confirmed proposals: Maustian owned/improved titles/descriptions at x2.5; Plasticov at x2. Supplier Mirror MUST NOT reuse the old Plasticov→Maustian direction guard.

#### Scenario: Category targets both accounts
- GIVEN target policy maps a category to both accounts
- WHEN an approved item in that category is synchronized
- THEN separate mappings MUST be evaluated for Plasticov and Maustian

#### Scenario: No explicit target policy
- GIVEN a supplier item lacks target policy
- WHEN publication or sync is considered
- THEN the system MUST block action and ask the CEO for policy

#### Scenario: Jinpeng policies proposed
- GIVEN Jinpeng bootstrap validation succeeds
- WHEN target defaults are prepared
- THEN Maustian x2.5 owned/improved content and Plasticov x2 MUST be stored as proposals requiring CEO confirmation

### Requirement: Jinpeng Bootstrap Safety

The system MUST provide admin/CLI bootstrap for supplier `jinpeng` that registers metadata, refs, enrichment, and target proposals without repository secrets.

#### Scenario: Safe bootstrap
- GIVEN ML credentials are supplied at runtime
- WHEN Jinpeng bootstrap runs
- THEN metadata and proposals MUST be validated or upserted without storing secrets
- AND no publish, pause, or price update MUST execute

#### Scenario: Missing credentials
- GIVEN required ML credentials are absent
- WHEN bootstrap validation runs
- THEN it MUST fail safely with no enablement

### Requirement: Jinpeng Runtime Gates

Jinpeng execution MUST remain read-only and worker-disabled unless explicitly enabled after validation and CEO confirmation.

#### Scenario: Dry-run first
- GIVEN Jinpeng is registered but not enabled
- WHEN validation runs
- THEN it MUST produce a read-only report and ledger entries
- AND the worker MUST remain disabled

#### Scenario: Dependency unavailable
- GIVEN ML API or XKP enrichment is unavailable
- WHEN validation runs
- THEN the report MUST name the dependency and block enablement

### Requirement: CEO Readiness Review

The CEO MUST ask for missing decisions and receive validation before enablement.

#### Scenario: Missing decisions requested
- GIVEN seller id, credentials, low-stock threshold, or enablement approval is unresolved
- WHEN CEO reviews readiness
- THEN the CEO MUST ask the user before enabling runtime behavior

#### Scenario: Report received
- GIVEN validation completed
- WHEN CEO presents readiness
- THEN the report MUST include identity, authority, policy, failures, and ledger evidence

### Requirement: Jinpeng Audit Ledger

The system MUST ledger Jinpeng bootstrap decisions, failures, proposals, skips, and blocked enablement.

#### Scenario: Enablement blocked
- GIVEN validation fails for credentials, seller id, ML API, or XKP
- WHEN bootstrap completes
- THEN the ledger MUST record the reason and runtime MUST remain disabled

### Requirement: Stock Monitoring and Emergency Pause

Approved mapped items MUST be monitored about every 10 minutes. Possible stock breaks MUST receive short verification before confirmed breaks pause affected target listings when allowed and notify the CEO.

#### Scenario: Confirmed stock break
- GIVEN an approved mapped item shows a possible supplier stock break
- WHEN verification confirms the break with sufficient evidence
- THEN allowed target listings MUST be paused and the CEO MUST receive evidence

#### Scenario: Verification inconclusive
- GIVEN stock evidence is conflicting or low-confidence
- WHEN verification completes
- THEN the system MUST not pause and MUST notify or ledger the uncertainty

### Requirement: Pricing and Supplier Price Learning

The system MUST accept CEO-natural pricing policies: x2, x3, x4, fixed uplift, or future learned policy. Supplier price changes MUST notify the CEO; the CEO proposes the next action; the user's answer MUST be recorded as Cortex fallback learning.

#### Scenario: Natural pricing policy stored
- GIVEN the user tells the CEO "use x3 for this supplier"
- WHEN policy is parsed and confirmed
- THEN future proposals MUST use x3 as the supplier policy

#### Scenario: Supplier price changes
- GIVEN a supplier item price changes
- WHEN monitoring detects the change
- THEN the CEO MUST be notified with proposed options and record the user's answer as fallback learning

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
