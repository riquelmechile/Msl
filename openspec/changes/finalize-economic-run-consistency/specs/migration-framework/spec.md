# Delta for migration-framework

## ADDED Requirements

### Requirement: Economic Restore Journal Migration

The canonical economic migration plan MUST register migration 1013 after 1007–1011 and MUST reserve it exclusively for the economic restore journal and its integrity constraints. Migration 1013 MUST apply transactionally, preserve all prior migrations and data, and be safe to rerun. It MUST NOT claim migration 1012, alert delivery, R8, or non-economic restoration behavior.

#### Scenario: Canonical upgrade applies 1013 once

- GIVEN an economic database recorded through migration 1011
- WHEN the canonical economic migration plan runs
- THEN migration 1013 applies after 1011 and records its version
- AND journal persistence and integrity constraints are available

#### Scenario: Upgrade rerun preserves ordering

- GIVEN migration 1013 is already recorded
- WHEN the economic migration plan runs again
- THEN 1013 is skipped without duplicate objects or data loss
- AND versions 1007–1011 remain unchanged

#### Scenario: Migration 1013 fails atomically

- GIVEN migration 1013 encounters a schema error
- WHEN the migration framework applies it
- THEN its journal schema changes and version record are rolled back together
- AND the database remains eligible for a corrected rerun
