## Exploration: Dual-Account ML API Integration + Product Sync Engine (Phase 7)

### Current State

The codebase has a solid but intentionally stubbed ML API layer ready for real integration:

**`packages/mercadolibre/` — ML API Client:**
- `OAuthTokenState`: Single-account token storage (sellerId, accessToken, refreshToken, scopes, expiry). Plain object, no on-disk persistence, no encryption.
- `AccessEvaluation`: Discriminated union (`UsableAccess | ReconnectRequired`) — evaluates token validity.
- `MlcApiClient`: READ-ONLY interface with 4 methods: `getListings`, `getOrders`, `getMessages`, `getReputation`. Each returns a typed snapshot with freshness/confidence metadata.
- `MercadoLibreApiTransport`: Pluggable HTTP layer (`request` method) — never implemented with real HTTP. Stub only.
- `evaluateOAuthAccess`: Checks expiry/revocation, returns access or reconnect error.
- Normalization functions (`normalizeListings`, `normalizeOrders`, `normalizeMessages`, `normalizeReputation`): Robust parsing of raw ML API JSON into typed summaries with completeness and confidence scoring.
- **No WRITE methods** (POST/PUT items). **No category endpoint.** **No users/me endpoint.**

**`packages/tools/` — MCP Tool Layer:**
- `createMlcReadTools`: Wraps `MlcApiClient` into `CustomBusinessTool` instances with blocking/mismatch handling via `ReadToolBlocked`.
- `ApprovalQueueRepository`: In-memory only (no persistence). Write pipeline: prepare → approve → execute → audit.
- `DirectWriteExecutor`: Interface defined but NEVER connected to ML API writes.

**`packages/agent/` — Conversational Agent:**
- Full DeepSeek-powered loop with 6 tools: `get_business_context` (Cortex), `prepare_action`, `simulate_actor`, `detect_probes`, `propose_honey_pot`. **No sync or dual-account tools.**
- Strategy parser/store: CEO rules parsed from Spanish, persisted in SQLite with lifecycle (active/archived/superseded). Strategies are injected into system prompt — but NOT programmatically applied to products.
- Autonomy engine: Levels 0–5, KPI tracking, auto-degradation, auto-approval for low-risk. KPIs track margins/success/safety/accuracy but NOT ML platform metrics (level, reputation, sales volume).
- `sellerId` is hardcoded as `"seller-1"` throughout the mock client.

**`packages/memory/` — Cortex Neural Graph:**
- `GraphEngine`: SQLite-backed graph with spreading activation, Hebbian learning, Darwinian pruning.
- Stores actor profiles, probe results, simulation records.
- `get_business_context` tool queries Cortex for activated nodes.
- **No sync state nodes yet.**

**Key Structural Gap**: The entire system assumes a SINGLE seller account. `OAuthTokenState` is singular. `MlcApiClient` validates that the requested `sellerId` matches the connected one and rejects if mismatched. Multi-account requires a fundamental extension of this model.

**What's stubbed vs real:**
| Component | Stubbed | Needs Implementation |
|-----------|---------|---------------------|
| HTTP transport | ✅ (interface only) | Real fetch with OAuth |
| OAuth flow | ✅ (token object only) | Auth code flow, redirect URI |
| Token storage | ✅ (in-memory) | Encrypted SQLite |
| Token refresh | ❌ (no logic) | Refresh rotation |
| ML API reads | ✅ (normalization) | Pipe to real API |
| ML API writes | ❌ | POST/PUT /items |
| Categories | ❌ | GET /categories |
| Users/me | ❌ | GET /users/me |
| Multi-account | ❌ | Plasticov + Maustian |
| Product sync | ❌ | Extract → Transform → Publish |
| Sync state | ❌ | Tracking table |

### Affected Areas

- **`packages/mercadolibre/src/index.ts`** — Core. Must add: `MlcApiClient` write methods, multi-account `OAuthManager`, `MercadoLibreApiTransport` real implementation, categories and users/me normalization, refresh token rotation. ~435 lines today, will grow significantly.

- **`packages/mercadolibre/` — New files needed:** `oauth-manager.ts` (multi-account OAuth storage + refresh), `transport.ts` (real HTTP fetch), `write-client.ts` or extension of existing client, `category-normalizer.ts`, `user-normalizer.ts`.

- **`packages/domain/src/seller.ts`** — Must extend: `SellerAccount` type currently has `displayName` but no RUT/tax-id, no account-type distinction (factory vs storefront). Add `accountRole`, `taxId`, `parentAccountId`.

- **`packages/tools/src/index.ts`** — New MCP tools: `sync_products`, `list_ml_categories`, `get_sync_status`, `initiate_sync`, `publish_product`, `get_ml_account_info`. Must wire through the write approval pipeline.

- **`packages/agent/src/conversation/agentLoop.ts`** — Must register sync tools. Mock client needs sync-aware mock responses. Strategy-aware sync routing (CEO says "publicá electrónica en Maustian" → triggers sync).

- **`packages/agent/src/conversation/types.ts`** — New types: `SyncJob`, `SyncStatus`, `ProductMapping`, `PlasticovListing → MaustianListing`.

- **`packages/memory/` — GraphEngine / schema** — New tables: `sync_jobs`, `product_mappings`. New Cortex node types: `sync_batch`, `published_product`. Sync outcomes feed Hebbian learning.

- **New package `packages/sync/`** — Product Sync Engine. Core logic: extract listings from Plasticov, apply CEO strategies (margin calculation, category filter, competitive pricing), transform into Maustian-ready listings, track sync state for differential updates. ~500–800 lines estimated.

- **`openspec/specs/mercadolibre-account-integration/spec.md`** — Will need deltas for multi-account, OAuth storage, write endpoints.

- **`openspec/specs/custom-business-mcp-tools/spec.md`** — Will need deltas for sync tools, dual-account reads.

### Approaches

#### 1. **Layered Extension: Extend Existing Packages In-Place**

Keep everything in `packages/mercadolibre/` and `packages/tools/`. Extend `MlcApiClient` with write methods. Add `OAuthManager` as a new module. Sync logic lives in a new `packages/sync/` package that composes ML client + CEO strategies + Cortex.

- **Pros**: Minimizes package count (1 new package vs 2–3). Reuses existing normalization patterns. `MlcApiClient` already has the right shape for extension. Read tools in `packages/tools` directly applicable.
- **Cons**: `packages/mercadolibre/` becomes the "kitchen sink" (OAuth, read, write, sync, categories, users). SRP degradation. Harder to test sync in isolation.
- **Effort**: Medium-High

#### 2. **Domain-Driven: Separate OAuth, ML API, Sync Engine**

Three new packages:
- `packages/oauth/` — Multi-account OAuth manager (token storage, refresh, encryption). Thin, focused.
- Extend `packages/mercadolibre/` — Add write methods, categories, users/me. Stays as thin API client.
- `packages/sync/` — Product sync engine. Composes OAuth (for both accounts) + ML API (read Plasticov, write Maustian) + CEO strategies + Cortex for state/lookback.

Present `packages/tools/` as MCP adapter layer over all three.

- **Pros**: Clean separation of concerns. Each package independently testable. OAuth reusable beyond ML (future platforms?). Sync package testable with stubs. Matches Clean/Hexagonal architecture philosophy.
- **Cons**: More boilerplate (3+ new packages). More wiring code at tool layer. Cross-package dependency management in monorepo.
- **Effort**: High

#### 3. **Monolith-First: All in `packages/mercadolibre/`, Extract Later**

Put OAuth, read, write, sync, categories, and users all in `packages/mercadolibre/`. Refactor into separate packages later once patterns stabilize. Define clear internal module boundaries (`oauth/`, `client/`, `sync/`, `categories/`) within the single package.

- **Pros**: Fastest to implement. No package scaffolding overhead. Easy to iterate. Internal boundaries can become package boundaries later.
- **Cons**: Package bloat. Internal coupling risk. Merge conflicts on heavy package. Harder to enforce internal boundaries without tooling.
- **Effort**: Medium

#### 4. **Hybrid: Minimal New Surface, Strategic Splits**

Keep read/write in `packages/mercadolibre/`. Extract OAuth to `packages/mercadolibre/src/oauth/` (internal module, not new package). New `packages/sync/` for engine only. `packages/tools/` gains sync-specific MCP tools. CEO strategy engine in `packages/agent/` feeds sync decisions.

- **Pros**: Balances SRP with implementation speed. Only 1 new package. OAuth stays internal but isolated. Sync package testable independently. Matches existing architecture pattern (agent orchestration, memory storage, tools surface).
- **Cons**: OAuth stays coupled to ML package (can't reuse for other platforms). Internal OAuth module boundary requires discipline.
- **Effort**: Medium

### Recommendation

**Approach 2 (Domain-Driven)** with pragmatic scope control:

1. **Phase 7a — OAuth Foundation (`packages/oauth/` or internal `mercadolibre/src/oauth/`)**: Multi-account encrypted token storage, refresh rotation, pluggable HTTP transport. This MUST come first because nothing else works without real auth.

2. **Phase 7b — ML API Write Surface (extend `packages/mercadolibre/`)**: POST/PUT `/items`, GET `/categories/{id}`, GET `/users/me`. Normalization functions for each. Keep the existing `MlcApiClient` pattern.

3. **Phase 7c — Product Sync Engine (`packages/sync/`)**: Extract listings from Plasticov (read via ML API), apply CEO strategies programmatically (margin calculation: cost + CEO margin%), transform listing data (title, price, description), publish to Maustian (write via ML API). Track sync state in Cortex + dedicated SQLite tables. Differential sync (only changed listings, no full reload).

4. **Phase 7d — MCP Tools + Agent Integration**: Expose sync tools, wire through autonomy engine (auto-sync at BAJO_RIESGO+ with strategy compliance), feed Cortex with sync outcomes for Hebbian learning.

**Why Domain-Driven wins here:**
- OAuth is a cross-cutting concern that WILL be reused (future ML integrations, other platforms).
- Sync engine has complex logic (strategy application, pricing math, differential tracking) that deserves its own test surface.
- The existing pattern already separates concerns (domain → ML client → tools → agent). Adding a sync package follows the grain.
- Platinum KPIs and business logic belong in the sync package, not the ML API client.

### Risks

- **OAuth credential security**: Must encrypt tokens at rest (SQLite with encryption layer or libsodium). Tokens in plaintext on disk = catastrophic if compromised. Both accounts control $120M CLP/year in sales.
- **ML API rate limits**: Unknown limits on POST /items for new Maustian account. Bulk publishing 1,247 products may trigger throttling. Need backpressure/batching from day one.
- **Account verification timing**: Maustian needs business RUT verification, MercadoLibre may take days/weeks. OAuth must handle "pending verification" states gracefully.
- **Dual-account confusion**: Agent must never cross-publish (publish Plasticov product under Plasticov credentials or Maustian product under Maustian credentials thinking it's Plasticov). OAuth token binding MUST be per-account and validated at EVERY API call.
- **Strategy-API mismatch**: CEO strategies are parsed from natural Spanish text but the sync engine applies them programmatically. Margin "50%" needs to become `price = cost / (1 - 0.50)` = `cost * 2`. Wrong interpretation = wrong pricing = business impact.
- **Sync state integrity**: If sync fails mid-batch, must know exactly what was published and what wasn't. Idempotency is critical — publishing the same product twice creates duplicates on ML.
- **Platinum strategy over-optimization**: Aggressively optimizing for Platinum KPIs (response time <2min, claims <2%) could trigger anti-bot detection or violate ML fair use policies.

### Ready for Proposal

**Yes** — the codebase is well-understood, the gaps are clear, and the approach is well-justified. The orchestrator should launch `sdd-propose` with:
- **Change name**: `dual-account-ml-api`
- **Scope**: OAuth multi-account → ML API write surface → Product Sync Engine → MCP tools → Agent integration
- **Out of scope**: Real ML API credentials (build pluggable, test with stubs), UI changes (MVP is conversational), Maustian account creation (user handles ML-side registration)
- **Critical prerequisites**: Register ML app for OAuth before `sdd-apply` (user action outside SDD)
