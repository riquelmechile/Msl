## Exploration: Jinpeng Supplier Runtime Enablement

### Current State

Supplier Mirror is merged as a safe foundation, but it is not yet production-wired for Jinpeng/XKP.

- The domain model supports suppliers, item snapshots, stock observations, target mappings, target policies, ledger records, notification events, and learned fallback policies.
- The SQLite store can persist all Supplier Mirror entities, but no runtime currently creates a Supplier Mirror store from environment configuration for Telegram or web chat.
- The worker/scheduler is disabled by default and supports 10-minute polling, explicit adapter registration, per-supplier rate limiting, ingestion persistence, and a stock-break monitor.
- The MercadoLibre supplier source adapter is API-first and requires an `MlcApiClient` plus a supplier seller id. It calls existing `getListings(sellerId, { status: "active" })` and `getItem(sellerId, itemId)` methods; this code is the only verified source behavior because MercadoLibre MCP documentation returned Unauthorized during exploration.
- XKP enrichment exists only as an adapter contract around an injected `XkpEnrichmentClient`; there is no real website client for `https://www.xkp.cl/products/` yet.
- The Telegram runtime creates strategy/session/autonomy/company-agent/workforce-cost stores from `MSL_TELEGRAM_SQLITE_PATH`, but does not create or pass `supplierMirrorStore` into `createAgentLoop()`.
- The web chat route also does not wire Supplier Mirror tools or durable Supplier Mirror storage.
- Existing CEO Supplier Mirror tools are read/proposal-only: review opportunities, review notifications, parse/propose pricing policy, record fallback lessons, and plan DeepSeek usage. They do not register suppliers, seed target policies, ingest suppliers, map items, start workers, or execute external mutations.

### Gaps for Jinpeng Runtime Enablement

- Runtime configuration is missing for:
  - Supplier Mirror SQLite path or reuse policy.
  - Jinpeng supplier id/name/profile URL/website URL.
  - Jinpeng MercadoLibre seller id or seller identifier resolved from the profile URL.
  - Target seller ids for Plasticov and/or Maustian.
  - Initial supplier-level target policy: low-stock threshold 2-3, `autoPauseAllowed: false` for first safe slice, pricing policy from CEO.
  - Disabled-by-default worker enable flag and poll interval override.
- No seed/register operation exists to upsert the Jinpeng supplier, supplier-level target policy, or approved/proposed item mappings.
- No runtime adapter registry exists for Jinpeng in Telegram/web/background processes.
- No operational command exists to run one read-only ingestion cycle and report evidence before enabling the scheduler.
- No real XKP website enrichment client exists; current enrichment support is a testable adapter boundary only.
- No safe pause executor is wired to MercadoLibre listing-status mutation. The stock-break monitor accepts a `pauseExecutor`, but production should initially use a dry-run/noop executor that only ledgers/delegates.
- No secret-safe validation script exists to verify OAuth/API access to the supplier seller profile without storing tokens or real seller ids in repo.

### Recommended First Production Slice

Build a small disabled-by-default operational bootstrap for Jinpeng, not a Telegram command first.

The first slice should add a Node/TypeScript CLI or script that:

1. Opens a Supplier Mirror SQLite store from an explicit env path.
2. Requires Jinpeng runtime env values without defaults for secrets/account ids.
3. Upserts the `jinpeng` supplier with metadata containing non-secret URLs and configured supplier seller id reference.
4. Upserts a supplier-level target policy with CEO-provided target seller ids, conservative low-stock threshold, `autoPauseAllowed: false`, and configured pricing policy.
5. Builds the MercadoLibre supplier adapter from existing ML runtime credentials/client patterns.
6. Runs one read-only ingestion cycle or validates adapter access in dry-run mode.
7. Prints bounded evidence and next required CEO decisions.

This is safer than starting with Telegram because it proves storage, credentials, supplier identity, and evidence collection before exposing natural-language operations. Once seeded and validated, Telegram can use the existing CEO review tools by receiving `supplierMirrorStore` in its agent config.

### Alternative Approaches and Tradeoffs

1. **CLI/script bootstrap first**
   - Pros: secret-safe, deterministic, testable, easy to keep disabled by default, avoids accidental worker start.
   - Cons: less natural for the CEO; needs an operator to run commands.
   - Effort: Medium.

2. **Telegram CEO command first**
   - Pros: matches user-facing CEO workflow and natural policy selection.
   - Cons: risks mixing account setup, secrets, ingestion, and policy approval in chat before runtime wiring is proven; harder to test safely.
   - Effort: Medium/High.

3. **Static seed migration/config file**
   - Pros: minimal runtime code and reproducible local state.
   - Cons: high risk of committing account identifiers or stale business policy; weak for progressive CEO decisions.
   - Effort: Low.

4. **Environment-only wiring**
   - Pros: deployment-friendly and keeps secrets out of repo.
   - Cons: insufficient for item mappings and CEO-learned policies; env becomes overloaded with business state.
   - Effort: Low/Medium.

### Risks / Secrets / Operational Safety

- Do not commit real OAuth tokens, seller ids if considered sensitive, or SQLite databases containing operational state.
- MercadoLibre docs could not be fetched through the MCP server because it returned Unauthorized; do not add new API assumptions beyond existing `MlcApiClient` methods until docs/API access is verified.
- Supplier profile URL may not directly provide the numeric seller id required by current client code; discovery must be validated with existing API/client behavior or operator-provided seller id.
- Keep `autoPauseAllowed: false` in the first production slice. The monitor can already pause if given an executor and approved policy, so production wiring must fail closed.
- The current monitor confirms a stock break from the latest high-confidence authoritative observation; first production should prefer dry-run monitor/notifications before any real pause executor.
- XKP website enrichment must not affect stock authority; any website stock-like data should remain catalog-enrichment/ignored for stock.

### Proposed Phased Plan

1. **PR 1 — Supplier Mirror runtime bootstrap and dry-run validation**
   - Add env parsing for Supplier Mirror runtime config.
   - Add a CLI/script for Jinpeng registration, supplier-level policy seeding, and one-shot ML API validation/ingestion dry run.
   - Add tests for missing env, no-default safety, supplier/policy upsert, and disabled-by-default behavior.
   - Expected review size: under 800 changed lines if kept to one script/module plus tests and `.env.example` docs.

2. **PR 2 — Telegram/web CEO review wiring**
   - Create/pass `supplierMirrorStore` in Telegram runtime when configured.
   - Optionally wire web chat later only if needed.
   - Add tests that Supplier Mirror tools are registered only when the store is configured.

3. **PR 3 — One-shot monitoring dry run**
   - Add an operator command/script to run stock-break monitor with a noop pause executor.
   - Ledger `defer`/notification events, but execute no external mutations.
   - Keep scheduler disabled unless explicitly enabled.

4. **PR 4 — XKP enrichment client**
   - Add a bounded fetch/parse client for `https://www.xkp.cl/products/` as enrichment only.
   - Persist photos/specs/categories without stock authority.

5. **Later — verified emergency pause**
   - Wire a real pause executor only after CEO approval, target mappings are approved, repeated dry-run evidence is stable, and rollback/re-enable behavior is tested.

### Open Product Questions for the User

- What are the real target seller ids for Plasticov and Maustian in this deployment?
- Should the initial supplier-level target policy apply to Plasticov, Maustian, or both?
- What initial pricing policy should be stored for Jinpeng: x2, x3, x4, or fixed CLP uplift?
- Should the first low-stock threshold be 2 or 3 units?
- Should Jinpeng supplier identity use id `jinpeng`, `xkp`, or `jinpeng-xkp`? Existing tests use both `jinpeng` and `xkp`; production should pick one stable id before seeding.
- Can the operator provide/confirm the MercadoLibre supplier seller id behind `importadorjinpeng`, or should the first slice include a docs/API-backed discovery step once MercadoLibre documentation access works?

### Ready for Proposal

Yes. The proposal should target `jinpeng-supplier-runtime-enablement` and scope PR 1 to a disabled-by-default CLI/runtime bootstrap with dry-run API validation, supplier/policy seeding, and tests. Do not include website enrichment, Telegram natural commands, scheduler activation, or real pause execution in the first slice.

skill_resolution: paths-injected
