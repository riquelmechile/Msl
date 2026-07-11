# structured-observability Specification

## Purpose

A JSON-structured logging pipeline with correlation IDs and sanitization, wired into
all daemons and store modules. Built on the existing `createLogger()` foundation.
Gated behind `MSL_STRUCTURED_LOGGING_ENABLED`.

## Requirements

### Requirement: JSON-Structured Log Output

Every log entry produced by the observability pipeline MUST be a JSON object
containing `{ level, component, msg, ts, correlationId }`. The `correlationId`
SHALL be a UUID v4 generated at the start of each logical operation.

#### Scenario: Structured log emitted

- GIVEN `MSL_STRUCTURED_LOGGING_ENABLED=true` and the market-catalog daemon runs
- WHEN the daemon emits an info log for listing count
- THEN the output is a JSON object with level="info", component="market-catalog", and
  a UUID `correlationId`

#### Scenario: Feature flag disabled

- GIVEN `MSL_STRUCTURED_LOGGING_ENABLED=false`
- WHEN any daemon or store emits a log
- THEN the legacy `console.log`/`console.warn`/`console.error` behavior is used
- AND no JSON-structured output is produced

### Requirement: Correlation ID Propagation

A `correlationId` MUST be generated at the entry point of each daemon handler
invocation and propagated to every log entry from that invocation. Stores called
during the invocation SHALL inherit the caller's `correlationId`.

#### Scenario: Correlation ID flows through daemon and store

- GIVEN the operations-manager daemon is invoked with sellerId "plasticov"
- WHEN it calls `OperationalReadModel.querySnapshots()` and emits logs
- THEN all log entries from both the daemon and the read model SHALL share the
  same `correlationId`

#### Scenario: Distinct correlation IDs across invocations

- GIVEN the operations-manager daemon fires twice
- WHEN each invocation emits logs
- THEN the two invocations MUST have different `correlationId` values

### Requirement: Log Sanitization

The observability pipeline MUST sanitize log messages and context objects to
exclude secrets. Prompt text and LLM response content SHALL NOT appear in durable
logs or the SQLite prompt column. API keys, tokens, and credentials SHALL be
redacted.

#### Scenario: Prompt text excluded from logs

- GIVEN a daemon composes an LLM prompt containing product titles
- WHEN a structured log entry is emitted with context
- THEN the `prompt` field is redacted to `"[REDACTED: prompt]"` or excluded
- AND no prompt text appears in any SQLite prompt column

#### Scenario: API key redacted

- GIVEN a log context object contains `{ apiKey: "sk-abc123" }`
- WHEN the log is sanitized
- THEN the `apiKey` value is replaced with `"[REDACTED]"`

### Requirement: Daemon and Store Wiring

All 15 daemon handlers and all store factory functions MUST accept an optional
logger parameter. When `MSL_STRUCTURED_LOGGING_ENABLED` is true, the shared
`createLogger()` SHALL be injected. Otherwise the parameter MAY be undefined.

#### Scenario: Daemon receives logger

- GIVEN `MSL_STRUCTURED_LOGGING_ENABLED=true`
- WHEN `startDaemonScheduler()` is called
- THEN each daemon handler receives a structured logger instance
- AND log entries from that daemon carry the correct `component` key

#### Scenario: Store receives logger

- GIVEN `MSL_STRUCTURED_LOGGING_ENABLED=true`
- WHEN `createSqliteEconomicOutcomeStore(db, { logger })` is called
- THEN the store uses the injected logger for all write/query operations
- AND log entries carry `component="economic-outcome-store"`

### Requirement: Correlation ID in Health Checks

System health checks and DLQ monitor runs SHALL each generate their own
`correlationId`. Health check log entries MUST include the `correlationId` for
traceability.

#### Scenario: Health check log carries correlation ID

- GIVEN `MSL_STRUCTURED_LOGGING_ENABLED=true`
- WHEN `runSystemHealthCheck()` executes
- THEN all log entries produced during the health check share one `correlationId`
- AND the health check result log includes that same ID
