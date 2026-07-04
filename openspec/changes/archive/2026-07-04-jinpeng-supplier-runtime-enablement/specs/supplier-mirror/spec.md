# Delta for Supplier Mirror

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Source Authority Separation

ML supplier stock MUST be the operational stock authority. Jinpeng ML refs MUST validate nickname, profile, and seller id when available; unresolved identity MUST block runtime enablement. ML API/docs access MUST be attempted first; scraping MAY be isolated fallback evidence. XKP SHALL enrich catalog/spec/photo/description data and MUST NOT override ML stock.
(Previously: ML stock authority and XKP enrichment boundaries existed, but no Jinpeng identity validation or runtime gate was specified.)

#### Scenario: ML stock available
- GIVEN ML returns stock for a supplier item
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

### Requirement: Target Account Policy

The system MUST allow Plasticov, Maustian, or both as targets per supplier, item, or category. Jinpeng defaults MUST target both as CEO-confirmed proposals: Maustian owned/improved titles/descriptions at x2.5; Plasticov at x2. Supplier Mirror MUST NOT reuse the old Plasticov→Maustian direction guard.
(Previously: targets could include one or both accounts, but Jinpeng-specific pricing/content defaults and CEO confirmation were not defined.)

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
