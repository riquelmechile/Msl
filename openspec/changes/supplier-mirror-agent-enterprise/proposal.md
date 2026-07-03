# Proposal: Supplier Mirror Agent Enterprise

## Intent

Build Supplier Mirror for MSL's CEO-led Agent Enterprise. The user speaks only with the CEO via Telegram; internal supplier workers stay hidden. This is not a scraper.

## Scope

### In Scope
- Many-supplier registry; start with Jinpeng/XKP.
- Source strategy: ML stock authority; XKP enrichment; WhatsApp later; ML API/docs first; isolated scraper fallback.
- Plasticov, Maustian, or both as symmetric targets by supplier/item/category policy.
- Low-stock publication around 2-3 units, ~10-minute monitoring, short verification, allowed emergency pause, CEO notice.
- Natural-language pricing (`x2`, `x3`, `x4`, CLP uplift, learned policy), price alerts, Cortex fallback learning.
- DeepSeek V4 Flash for extraction/classification; V4 Pro only for hard policy reasoning.

### Out of Scope
- Blind publishing/price mutation outside approval/autonomy gates.
- Extending old Plasticov→Maustian guard.
- First-slice WhatsApp automation.

## Capabilities

### New Capabilities
- `supplier-mirror`: Registry, evidence, mappings, target policies, stock monitor, pause behavior, pricing, learning hooks.

### Modified Capabilities
- `multi-agent-orchestration`: CEO coordinates supplier lanes with CEO-only UX.
- `mercadolibre-account-integration`: ML API/docs authoritative; scraper is fallback evidence.
- `business-memory-cache`: Supplier tables with freshness/confidence/evidence.
- `action-approval-safety`: Audited emergency pause after verification.
- `autonomy-engine`: Progressive supplier autonomy from evidence.
- `cortex-darwinian-feedback`: Learn pricing, notifications, stock, outcomes, errors.

## Approach

Add `supplierMirrorStore`/read-model tables: `suppliers`, `supplier_items`, `stock_observations`, `item_mappings`, `target_policy`, `sync_ledger`. Run polling separately. Scraper adapters use low concurrency, jitter/backoff, evidence scoring, raw payload/hash capture, selectors/JSON-LD/embedded JSON fallbacks. Mutations consume normalized evidence only.

## Affected Areas

- `packages/mercadolibre/src/index.ts`: ML reads, publish/update/status.
- `packages/mercadolibre/src/accountRoles.ts`: avoid old guard.
- `packages/mercadolibre/src/sync/*`: reference only.
- `packages/memory/src/operationalReadModel.ts` or `supplierMirrorStore.ts`: tables/evidence/ledger.
- `packages/agent/src/conversation/*`: CEO policy/learning/alerts.
- `packages/workers/src/index.ts`, `packages/bot/src/index.ts`: poller/runtime wiring.

## DeepSeek Cost Strategy

Use stable CEO/supplier/lane prefixes, cacheable supplier context, and batches. Track cache hit/miss/output tokens and cost. Avoid deprecated `deepseek-chat`/`deepseek-reasoner` aliases.

## Risks

- False pause: short verification, evidence score, audit, CEO notice.
- Scraper brittleness: API-first isolated fallback.
- Wrong account targeting: explicit target policy, not old guard.
- LLM cost drift: stable prefixes, batching, V4 Flash default, ledger.

## Rollback Plan

Disable polling/proposals, preserve `sync_ledger`, pause only affected mirror-created mappings if required, and fall back to manual CEO-approved actions.

## Suggested Phased Slices

1. Data model and evidence contracts.
2. Stock monitor and emergency pause.
3. Account/pricing policy proposals.
4. XKP enrichment and scraper fallback.
5. Cortex/DeepSeek cost learning.

## Open Questions

- What evidence threshold unlocks first autonomous emergency pauses per supplier?
- Should low-stock default be 2 or 3 units by category/account?

## Success Criteria

- [ ] Supplier items target Plasticov, Maustian, or both without old sync guard.
- [ ] Stock breaks verify, pause affected listings when allowed, notify CEO with evidence.
- [ ] Pricing and notification preferences persist as fallback policy.
