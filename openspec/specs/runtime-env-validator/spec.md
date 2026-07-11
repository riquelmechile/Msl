# runtime-env-validator Specification

## Purpose

Startup validation that required environment variables are set and configured correctly before the agent company begins operation. Catches misconfigurations early with clear diagnostic messages.

## Requirements

### Requirement: Environment Variable Validation

`validateRuntimeEnv()` MUST check that all required environment variables are present and valid at process startup. Checks SHALL include: API keys (MINIMAX_API_KEY, DEEPSEEK_API_KEY, ML_API_TOKEN), base URLs (MINIMAX_API_HOST, DEEPSEEK_BASE_URL, ML_API_BASE_URL), and operational config (MSL_CREATIVE_STUDIO_STORAGE_PATH, MSL_CREATIVE_STUDIO_ENABLED). Missing required vars SHALL log at ERROR level. Non-critical missing vars SHALL log at WARN level.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| All required vars present | All API keys and critical config set | validateRuntimeEnv() called | Returns { valid: true, warnings: [] } |
| Missing API key | MINIMAX_API_KEY not set | validateRuntimeEnv() called | Returns { valid: false, errors: ["MINIMAX_API_KEY: missing"] } |
| Optional var missing | ML_API_BASE_URL not set | validateRuntimeEnv() called | Returns { valid: true, warnings: ["ML_API_BASE_URL: not set; ML features disabled"] } |
| creative-studio disabled | MSL_CREATIVE_STUDIO_ENABLED=false | validateRuntimeEnv() called | Creative vars not required; no errors for missing creative config |

### Requirement: Env Variable Name Fix

The system MUST accept `MINIMAX_API_HOST` as the canonical env var for the MiniMax API base URL. `MINIMAX_BASE_URL` (legacy name) SHALL be read as a fallback when `MINIMAX_API_HOST` is not set. When only `MINIMAX_BASE_URL` is detected, the system SHALL log a deprecation warning: "MINIMAX_BASE_URL is deprecated; use MINIMAX_API_HOST instead". The `.env.example` file MUST list `MINIMAX_API_HOST` and MUST NOT list `MINIMAX_BASE_URL`.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Canonical var set | MINIMAX_API_HOST="https://api.minimax.chat" | Creative daemon reads config | Uses MINIMAX_API_HOST value |
| Legacy var only | MINIMAX_BASE_URL set; MINIMAX_API_HOST unset | Creative daemon reads config | Uses MINIMAX_BASE_URL; deprecation warning logged |
| Both set | Both vars set | Creative daemon reads config | MINIMAX_API_HOST wins; MINIMAX_BASE_URL ignored |
| Neither set | Neither var set | Creative daemon starts | Returns empty findings; validateRuntimeEnv warns |
| .env.example corrected | .env.example inspected | Diff checked | MINIMAX_API_HOST present; MINIMAX_BASE_URL absent |

### Requirement: Missing Env Var Documentation

`.env.example` MUST include all environment variables consumed by the creative-studio daemon: `MINIMAX_API_HOST`, `MINIMAX_REQUEST_TIMEOUT_MS`, `MSL_CREATIVE_STUDIO_STORAGE_PATH`, `MSL_CREATIVE_STUDIO_ML_AUTO_DIAGNOSE`, `ML_API_TOKEN`, `ML_API_BASE_URL`, `MSL_CREATIVE_STUDIO_MAX_CONCURRENT_JOBS`, `MSL_CREATIVE_STUDIO_MIN_COOLDOWN_MS`. Each entry SHALL include a comment describing its purpose.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| All daemon vars documented | .env.example inspected | Creative-studio section read | All 8 vars present with comments |
| New developer follows .env.example | Developer copies .env.example → .env.local | Creative daemon starts | All required vars configured; no hidden config needed |

### Requirement: Degraded Capability Policy

The runtime environment validator MUST define and enforce a `degraded` capability policy. A capability declared as `degraded` SHALL allow the process to start in production but SHALL log at WARN level. This is distinct from `blocking` (fails startup) and `optional` (silently skipped).

#### Scenario: Degraded capability allows startup

- GIVEN a required DB is unreachable but configured as capability `degraded`
- WHEN `validateRuntimeEnv()` runs
- THEN the validation result is `{ valid: true }` with a WARN-level degradation entry
- AND the process starts with the degraded capability noted

#### Scenario: Blocking capability still fails startup

- GIVEN a `blocking` capability check fails (e.g., missing critical API key)
- WHEN `validateRuntimeEnv()` runs
- THEN the validation result is `{ valid: false }` with an ERROR-level entry
- AND the process does not start

#### Scenario: Degraded capability documented in result

- GIVEN a DB integrity check is `degraded`
- WHEN `validateRuntimeEnv()` returns
- THEN the result includes `degradedCapabilities: ["database-integrity"]`
- AND each entry contains the degradation reason

### Requirement: Database Integrity and WAL Checks

`validateRuntimeEnv()` MUST include a database integrity section that verifies every managed database passes `PRAGMA integrity_check` and that WAL files are within acceptable limits (under 200 MB) at startup.

#### Scenario: DB integrity passes at startup

- GIVEN all managed databases are healthy
- WHEN `validateRuntimeEnv()` runs the database integrity section
- THEN the check result is `{ dbIntegrity: "ok" }`
- AND the overall validation result is valid

#### Scenario: DB integrity fails at startup

- GIVEN the Cortex database returns corruption from `PRAGMA integrity_check`
- WHEN `validateRuntimeEnv()` runs
- THEN the capability `database-integrity` is reported as `degraded`
- AND the specific database and error detail are included in the diagnostics

#### Scenario: WAL file exceeds threshold at startup

- GIVEN a database WAL file is 400 MB at process startup
- WHEN `validateRuntimeEnv()` runs
- THEN the capability `wal-health` is reported as `degraded`
- AND a WARN entry is logged with the WAL size and database name
