# Tasks: MercadoLibre Dual-Account Production Connection

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 1800–2400 |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1: env loading + registry + state → PR 2: health + smoke service → PR 3: readiness + observability + CLI → PR 4: CEO tools + ingest hardening + docs + verify |
| Delivery strategy | auto-forecast |
| Chain strategy | feature-branch-chain |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
800-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Shared env loader + registry + state types | PR 1 | Base: feature branch; standalone deliverable with tests |
| 2 | Health service + smoke service | PR 2 | Base: PR 1 branch; depends on registry+state |
| 3 | Readiness integration + observability + CLI | PR 3 | Base: PR 2 branch; wires everything together |
| 4 | CEO tools + ingest hardening + docs + verify | PR 4 | Base: PR 3 branch; polish and finalize |

## Phase 1: Shared Environment Loading

- [x] **T1.1** — Create `packages/mercadolibre/src/env.ts` (NEW): `loadRepositoryEnvironment(options?)` with deterministic repo-root detection (walk up for `package.json` with `workspaces`), manual K=V parser for `.env` then `.env.local`, respect pre-existing `process.env` values, `MSL_SKIP_ENV_FILE` skip mode. Complexity: medium.
- [x] **T1.2** — Wire `loadRepositoryEnvironment()` into `scripts/start-bot.mjs`, `start-mcp.mjs`, `start-worker-ingestion.mjs`, `start-agent-daemons.mjs` (MODIFIED): replace inline `loadEnvIfPresent` implementations with shared import. Remove inline env parsers.
- [x] **T1.3** — Wire `loadRepositoryEnvironment()` into `scripts/ingest-orders.mjs`, `ingest-items.mjs`, `ingest-claims.mjs` (MODIFIED): replace inline env loading with shared import.
- [x] **T1.4** — Wire env loader into `apps/web` (Next.js): ensure `loadRepositoryEnvironment()` is called server-side (e.g., in `instrumentation.ts` or API route middleware) so root `.env.local` is loaded without `apps/web/.env.local` symlink. Document symlink removal.
- [x] **T1.5** — Wire env loader into MCP `runtimeDependencies`, bot startup, worker entry points (MODIFIED): ensure all long-running processes call loader once at startup.
- [x] **T1.6** — Unit tests for `loadRepositoryEnvironment` in `packages/mercadolibre/src/env.test.ts` (NEW): test from various cwds, CI skip mode, `.env.local` overrides `.env`, pre-existing `process.env` protection, missing files non-fatal. Complexity: medium.
- [x] **T1.7** — Update `.env.example` and `docs/production-secrets-setup.md` to document new env loading behavior. Remove symlink creation step from setup docs.

## Phase 2: Account Registry & State Model

- [x] **T2.1** — Create `packages/mercadolibre/src/connection/state.ts` (NEW): pure types — `MercadoLibreConnectionStatus`, `OAuthTokenStatus`, `MercadoLibreAccountConnectionHealth`, `RefreshErrorCode` enum, `MlAccountEntry` interface. No runtime code.
- [x] **T2.2** — Create `packages/mercadolibre/src/connection/registry.ts` (NEW): `createMercadoLibreAccountRegistry({ env, resolveOAuthConfigs, tokenStore })` — derives seller entries from env vars (`MERCADOLIBRE_SOURCE_SELLER_ID`, `MERCADOLIBRE_TARGET_SELLER_ID`) + oauthConfig app bindings + token store. Never hardcodes seller IDs. Returns `MlAccountEntry[]`.
- [x] **T2.3** — Unit tests for registry in `packages/mercadolibre/src/connection/registry.test.ts` (NEW): valid config, duplicate seller IDs, incomplete config, cross-binding detection, unknown seller, missing env vars.

## Phase 3: Connection Health Service

- [x] **T3.1** — Create `packages/mercadolibre/src/connection/healthService.ts` (NEW): `createMercadoLibreConnectionHealthService({ registry, oauthManager, store, smokeService, clock? })` with modes: inspect-only (token decrypt + expiry eval, no API call), refresh-if-needed (delegate to `ensureValidToken`), smoke-read (identity + orders + items via smokeService), no-network (config validation only). Returns sanitized `MercadoLibreAccountConnectionHealth` per seller — no tokens/secrets in output.
- [x] **T3.2** — Enhance `packages/mercadolibre/src/oauth/oauthManager.ts` (MODIFIED): add `MercadoLibreRefreshError` class with `code: RefreshErrorCode` field. Classify API errors: `invalid_grant` → typed error, `invalid_client` → typed error, network errors → `network_error` with `retryable: true`, 429 → `rate_limited`, malformed response → `malformed_response`. Preserve old token until new one persists. Inject clock for testability.
- [x] **T3.3** — Unit tests for health service in `packages/mercadolibre/src/connection/healthService.test.ts` (NEW): all modes, all error states (invalid_grant, network error, decryption failure), seller isolation, identity verification, no PII in output.

## Phase 4: Read-Only Smoke Service

- [x] **T4.1** — Create `packages/mercadolibre/src/connection/smokeService.ts` (NEW): `createMercadoLibreReadOnlySmokeService({ oauthManager, store })` — identity check (GET `/users/{sellerId}` matches expected ID), orders (GET `/orders/search` with `limit=3`, no persist), items (GET `/users/{sellerId}/items/search` with small limit, no mutation). `noNetwork` option for offline mode. Returns sanitized smoke results — endpoint names + statuses only, zero PII.
- [x] **T4.2** — Unit tests for smoke service in `packages/mercadolibre/src/connection/smokeService.test.ts` (NEW): correct identity, identity mismatch, orders/item limits, timeouts, rate limit responses, API errors, no PII in output, noNetwork mode.

## Phase 5: Production Readiness Integration

- [x] **T5.1** — Modify `packages/agent/src/readiness/SellerAccountReadinessChecker.ts` (MODIFIED): add `checkMercadoLibreConnectionReadiness(ctx, healthServiceFactory)` — calls `healthService.inspect()` for both sellers, replacing env-only checks with live token validation. Read readiness separate from write readiness. Write stays `blocked` with reason `write-capability-not-implemented`.
- [x] **T5.2** — Add `assertMercadoLibreWriteDisabled()` to `packages/agent/src/readiness/runtimeGates.ts` (MODIFIED): throws `MercadoLibreWriteBlockedError` for any write operation. Blocks: publish, update item, stock, price, ads, questions, messages, cancellations, claims actions.
- [x] **T5.3** — Unit tests for readiness integration: update `packages/agent/src/readiness/readiness.test.ts` (MODIFIED) to cover live token validation, read/write separation, write-block gate, degraded-not-blocking scenarios.

## Phase 6: Runtime Health & Observability

- [x] **T6.1** — Wire `onTokenRefresh` callback to metrics/logging in MCP `runtimeDependencies`, bot, and scripts (MODIFIED): token refresh events emit to `createMetrics()` and `createLogger()` with sellerId and outcome.
- [x] **T6.2** — Add ML connection health to RuntimeHealth system: periodic health events with structured log events (`meli-account-configured`, `meli-token-inspected`, `meli-refresh-*`, `meli-identity-*`, `meli-smoke-*`, `meli-reauthorization-required`). Per-seller in consolidated health report.
- [x] **T6.3** — Unit tests for observability wiring: verify `onTokenRefresh` fires on successful refresh, structured events emitted, metrics queryable per seller.

## Phase 7: CLI Commands

- [x] **T7.1** — Create `packages/mercadolibre/src/connection/cli.ts` (NEW): export functions `meliConnectionStatus`, `meliRefresh`, `meliSmoke`, `meliConnectUrl` with `--seller`, `--json` flags. `meli:connect:url` generates OAuth authorization URL for the specified seller.
- [x] **T7.2** — Add npm scripts to `package.json` (MODIFIED): `meli:connection:status`, `meli:refresh`, `meli:smoke`, `meli:connect:url` — each runs the CLI via `tsx`.
- [x] **T7.3** — Unit tests for CLI in `packages/mercadolibre/src/connection/cli.test.ts` (NEW): status, refresh, smoke, JSON output format, invalid seller, missing env vars, exit codes.

## Phase 8: CEO Tools

- [x] **T8.1** — Create `packages/mcp/src/tools/connectionTools.ts` (NEW): `registerConnectionTools` — CEO MCP tools: `inspect_mercadolibre_connections`, `inspect_mercadolibre_account_health`, `run_mercadolibre_read_smoke`. Read-only, no mutations, sanitized output. Follow existing tool patterns (auth guard, `jsonResult`/`blockedResult`).
- [x] **T8.2** — Wire into `packages/mcp/src/tools/index.ts` (MODIFIED): export `registerConnectionTools`, register in MCP server creation.
- [x] **T8.3** — Unit tests for CEO tools in `packages/mcp/src/tools/connectionTools.test.ts` (NEW): seller filter, health report, explicit smoke, `noExternalMutationExecuted` guarantee, sanitized output.

## Phase 9: Ingest Scripts Hardening

- [x] **T9.1** — Add `--limit`, `--max-pages`, `--dry-run`, `--no-persist` options to `scripts/ingest-claims.mjs`, `ingest-items.mjs`, `ingest-orders.mjs` (MODIFIED). `--dry-run` fetches but does not persist; `--no-persist` skips DB writes.
- [x] **T9.2** — Add `--json` output option to ingest scripts: structured output with counts, status, errors.
- [x] **T9.3** — Add seller validation before execution: verify configured seller ID exists and has a valid read capability before making API calls. Use shared registry.
- [x] **T9.4** — Add rate limiting and abort signal handling: respect `SIGTERM`/`SIGINT` with graceful shutdown, add delay between pages, respect `AbortController` for timeouts.

## Phase 10: Documentation & SDD Artifacts

- [x] **T10.1** — Create `docs/operations/mercadolibre-dual-account-production-connection.md` (NEW): operational guide covering status checks, refresh, smoke testing, troubleshooting.
- [x] **T10.2** — Update `README.md`, `ROADMAP.md`, `ARCHITECTURE.md` (MODIFIED): reflect new connection health capabilities and CLI commands.
- [x] **T10.3** — Update `docs/production-secrets-setup.md`, `docs/vps-deployment.md` (MODIFIED): remove symlink workaround, document new env loading.
- [x] **T10.4** — Update `docs/README.md` (MODIFIED): add link to new operations doc.
- [x] **T10.5** — Update `.env.example` (MODIFIED): document new env vars, remove symlink references.
- [x] **T10.6** — Create SDD artifacts: `threat-model.md`, `secrets-policy.md`, `oauth-lifecycle.md`, `account-isolation-policy.md`, `read-only-production-policy.md`, `smoke-test-plan.md`, `recovery-runbook.md` under `docs/operations/`.

## Phase 11: End-to-End Verification

- [ ] **T11.1** — Run full test suite: `npm run test`, `npm run typecheck`, `npm run format:check`, `npm run lint` (new files only). Zero regressions.
- [ ] **T11.2** — Manual smoke tests with sanitized output: `meli:connection:status`, `meli:smoke` for Plasticov + Maustian. Verify no tokens/secrets in output. Verify no ML mutations.
- [ ] **T11.3** — Security verification: `git diff --staged` contains no secrets, no SQLite files, no `.env.local` symlink, `apps/web/.env.local` does not exist.
- [ ] **T11.4** — Verify `npm run dev` from `apps/web` works without symlink. Verify all scripts start with shared env loader.
- [ ] **T11.5** — Run `npm run test:e2e` — pass or document pre-existing failures.
- [ ] **T11.6** — Create `verify-report.md` with checklist results.
- [ ] **T11.7** — Update `sdd/{change}/archive` entry: snapshot delta specs after implementation.

## Export

- [ ] **T12.1** — Update `packages/mercadolibre/src/index.ts` (MODIFIED): export new connection module types (`MercadoLibreConnectionStatus`, `MercadoLibreAccountConnectionHealth`, `RefreshErrorCode`, `MlAccountEntry`) and factories (`loadRepositoryEnvironment`, `createMercadoLibreAccountRegistry`, `createMercadoLibreConnectionHealthService`, `createMercadoLibreReadOnlySmokeService`).
