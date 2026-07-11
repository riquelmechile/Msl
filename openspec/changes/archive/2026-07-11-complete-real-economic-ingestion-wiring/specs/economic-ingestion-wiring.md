# Spec Delta: Economic Ingestion Wiring

## Capability: real-economic-ingestion

### REQ-WIRE-001: CLI Handlers Use Real Pipeline
**Priority:** P0
**Scenario:** User runs `npm run economic:ingest -- --seller source`
**Given** the economic ingestion pipeline and store are available
**When** the ingest command executes
**Then** the CLI constructs a real runtime via the shared factory
**And** calls `EconomicIngestionPipeline.run()` with the provided arguments
**And** returns real ingestion results (not hardcoded fake data)
**And** exit code reflects actual pipeline success/failure

### REQ-WIRE-002: CLI Status Queries Real Store
**Priority:** P0
**Scenario:** User runs `npm run economic:status -- --seller source`
**Given** previous ingestion runs exist for the seller
**When** the status command executes
**Then** the CLI queries `EconomicIngestionRunStore.getLastRunBySeller()`
**And** returns actual run data (not hardcoded `lastRun: null`)

### REQ-WIRE-003: CLI Coverage Queries Real Data
**Priority:** P0
**Scenario:** User runs `npm run economic:coverage -- --seller source`
**Given** cost components and snapshots exist for the seller
**When** the coverage command executes
**Then** the CLI queries the real store for coverage dimensions
**And** returns actual coverage states (not all "unverifiable")

### REQ-WIRE-004: CLI Reconcile Uses Real Service
**Priority:** P0
**Scenario:** User runs `npm run economic:reconcile -- --seller source`
**Given** revenue and cost data exist for the seller
**When** the reconcile command executes
**Then** the CLI calls `EconomicReconciliationService.reconcile()` with real data
**And** returns actual reconciliation results (not hardcoded "incomplete")

### REQ-WIRE-005: CLI Missing Queries Real Store
**Priority:** P0
**Scenario:** User runs `npm run economic:missing -- --seller source`
**Given** snapshots exist with declared missing inputs
**When** the missing command executes
**Then** the CLI queries the store for actual missing inputs
**And** returns real missing input data (not hardcoded list)

### REQ-WIRE-006: Shared Factory Exists
**Priority:** P0
**Scenario:** CLI, daemon, or CEO tool needs economic runtime
**Given** a valid seller slug
**When** `createEconomicIngestionRuntime(seller)` is called
**Then** it returns a fully constructed runtime with store, pipeline, fetcher, reconciliation
**And** all components are production-ready (not stubs)
**And** seller isolation is maintained

### REQ-WIRE-007: Run Store Persists Ingestion State
**Priority:** P0
**Scenario:** Pipeline executes an ingestion run
**Given** an EconomicIngestionRunStore is available
**When** the pipeline creates, updates, and completes a run
**Then** the run is persisted with seller, status, timestamps, and results
**And** subsequent status queries return the persisted run

### REQ-WIRE-008: Checkpoint Persists Progress
**Priority:** P0
**Scenario:** Pipeline completes a successful ingestion
**Given** a checkpoint mechanism exists
**When** the pipeline finishes processing orders
**Then** the checkpoint is updated with the last processed order date/id
**And** on failure, the checkpoint does NOT advance
**And** on resume, ingestion continues from the checkpoint

### REQ-WIRE-009: Daemon Is Wired in Production
**Priority:** P0
**Scenario:** `MSL_ECONOMIC_INGESTION_ENABLED=true` is set
**Given** the daemon scheduler starts
**When** economic ingestion daemon is registered
**Then** it uses the shared factory (same as CLI)
**And** executes ingestion on schedule
**And** respects feature gate when disabled

### REQ-WIRE-010: Evidence References Are Queryable
**Priority:** P1
**Scenario:** CEO agent calls `inspect_evidence_references`
**Given** evidence references were created by previous ingestion runs
**When** the tool executes
**Then** it queries the real store for evidence references
**And** returns actual evidence data (not "not yet available")
**And** maintains `noExternalMutationExecuted: true`

### REQ-WIRE-011: Idempotent Re-Ingestion
**Priority:** P0
**Scenario:** Same ingestion parameters are run twice
**Given** the first run completed and persisted data
**When** the second run executes with identical parameters
**Then** no duplicate cost components are created
**And** no duplicate snapshots are created
**And** the checkpoint correctly reflects the stable state

### REQ-WIRE-012: No PII in Any Output
**Priority:** P0
**Scenario:** Any CLI command, tool, or log output
**Given** the pipeline processed real ML order data
**When** any output is produced
**Then** it contains zero buyer PII (name, email, phone, address, document)
**And** it contains zero ML secrets (tokens, client secrets)
**And** it contains zero raw ML API payloads

### REQ-WIRE-013: Honest Partial Snapshots
**Priority:** P0
**Scenario:** Product cost and landed cost data are unavailable
**Given** the pipeline ingests real revenue and fee data
**When** snapshots are created
**Then** they are marked `partial` (not `complete`)
**And** `missingInputs` includes product cost and landed cost
**And** missing is NOT converted to zero
**And** profit fields reflect only known components

### REQ-WIRE-014: Readiness Detects Wiring State
**Priority:** P1
**Scenario:** Production readiness check for economic ingestion
**Given** the capability checker evaluates the wiring
**When** the CLI is stub or factory cannot be constructed
**Then** readiness is `blocked` (not `ready` or `degraded`)
**When** all components are wired but product cost is missing
**Then** readiness is `degraded` with honest reason
