# Delta for Business Memory Cache

## ADDED Requirements

### Requirement: Supplier Mirror Operational Store

The operational store MUST persist supplier registry, supplier item snapshots, stock observations, item mappings, target account policy, and sync ledger records with freshness, confidence, source, evidence ID, and captured timestamp metadata.

#### Scenario: Supplier snapshot stored
- GIVEN a supplier adapter normalizes an item
- WHEN the store persists the snapshot
- THEN it MUST include supplier ID, item identity, source, freshness, confidence, evidence ID, and captured time

#### Scenario: Sync ledger audited
- GIVEN Supplier Mirror proposes, pauses, skips, or defers work
- WHEN the decision is made
- THEN the sync ledger MUST record action type, reason, evidence IDs, and affected target accounts

### Requirement: Supplier Evidence Confidence

Stock observations MUST carry confidence and source authority so consumers can distinguish ML API authority, fallback scraping, XKP enrichment, stale evidence, and incomplete evidence.

#### Scenario: Low-confidence observation
- GIVEN fallback evidence is partial or stale
- WHEN stock state is queried
- THEN consumers MUST receive low-confidence metadata and MUST NOT treat it as verified stock break

#### Scenario: Enrichment evidence used
- GIVEN XKP provides specs or photos for an ML-stocked item
- WHEN catalog enrichment is assembled
- THEN XKP evidence MAY enrich catalog fields but MUST be tagged non-stock-authoritative
