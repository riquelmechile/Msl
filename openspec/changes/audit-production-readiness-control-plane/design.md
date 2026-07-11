# Design: Audit Production Readiness Control Plane

## Architecture

The Production Readiness Control Plane follows a checker pattern with 7 specialized checkers feeding into a central `ProductionReadinessService`. Each checker independently evaluates one aspect of readiness.

## Corrections Applied

### 1. `ProductionReadinessService` — Checker Isolation
Added `safeCheck` wrapper with `try/catch` per checker. If one checker throws, that checker's result degrades gracefully without crashing the entire readiness evaluation.

### 2. `agentLoop.ts` — CEO Tool Wiring
Wired `inspect_production_readiness` CEO tool into the `AgentLoop` `toolMap`. Previously the tool was defined but never registered, making it unreachable at runtime.

### 3. `secretSanitizer.ts` — URL Credential Stripping
Added URL credential stripping: sanitizer now removes `user:password` from URLs (e.g., `postgres://user:pass@host` becomes `postgres://***@host`) before display.

### 4. `DatabaseReadinessChecker.ts` — Access Check + Temp File Cleanup
- Added `R_OK` flag to `accessSync` call so the checker verifies read permission, not just existence.
- Added `try/finally` block around temp file creation to guarantee cleanup even on failure.

### 5. `ROADMAP.md` — Documentation Corrections
Corrected: commit refs, env var count (66 not 75+), SQLite check scope, CEO tool wiring status.

## Design Decisions

| Decision | Rationale |
|---|---|
| Checker isolation via `safeCheck` wrapper | Failure of one checker must not block the others; partial results are still actionable |
| CEO tool: always-available (no conditional registration) | The tool is safe to query regardless of environment; runtime gates handle the actual blocking |
| Economic learning daemon: deferred to PR 2/4 | Requires scheduler configuration changes that belong in the next PR |
| URL sanitization: strip `user:password` before display | Prevents accidental credential leak in logs and CLI output |
