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

MercadoLibre supplier stock MUST be the operational stock authority. MercadoLibre API/docs access MUST be attempted first; scraping MAY be used only as isolated fallback evidence for API gaps. XKP/website sources SHALL enrich catalog/spec/photo data and MUST NOT override ML stock authority.

#### Scenario: ML stock available
- GIVEN MercadoLibre returns stock for a supplier item
- WHEN stock is normalized
- THEN the observation MUST be authoritative with API evidence

#### Scenario: XKP stock differs
- GIVEN XKP enrichment contains stock-like data that differs from ML
- WHEN target sync is evaluated
- THEN ML stock MUST win and XKP stock MUST be ignored for authority

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

The system MUST allow Plasticov, Maustian, or both as targets per supplier, item, or category. Supplier Mirror MUST NOT reuse the old Plasticov→Maustian direction guard as its targeting model.

#### Scenario: Category targets both accounts
- GIVEN target policy maps a category to both accounts
- WHEN an approved item in that category is synchronized
- THEN separate mappings MUST be evaluated for Plasticov and Maustian

#### Scenario: No explicit target policy
- GIVEN a supplier item lacks target policy
- WHEN publication or sync is considered
- THEN the system MUST block action and ask the CEO for policy

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

The system MUST start with broad supplier alerts and MAY learn suppressions such as "do not notify me about this anymore." DeepSeek usage MUST use stable prompt prefixes, cacheable context blocks, V4 Flash for high volume, V4 Pro only for hard reasoning, and cost/cache evidence.

#### Scenario: User suppresses alert type
- GIVEN the CEO sends a supplier alert
- WHEN the user says not to notify about that condition anymore
- THEN future matching alerts MUST be suppressed or summarized per learned policy

#### Scenario: High-volume extraction
- GIVEN supplier extraction is routine and high-volume
- WHEN DeepSeek is used
- THEN V4 Flash MUST be selected and cache hit/miss, usage, and cost evidence MUST be recorded
