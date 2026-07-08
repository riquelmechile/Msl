# Proposal: Product Ads Profitability Control

## Intent

Add a CFO-grade Product Ads control loop that runs daily measurement but emits seller-impacting recommendations (budget, pause, scale) only every 7 days to avoid overreacting to short-term noise. The loop protects margin, finds profitable scaling opportunities, detects budget waste, and labels data completeness before the CEO prepares approval-gated actions.

## Scope

### In Scope
- New read-only profitability daemon for per-product Ads economics inside each campaign: net contribution, margin strength, ROAS, CVR, CPC, units, conversion, and data completeness. Campaign-level averages SHALL NOT be used — products within the same campaign MUST be evaluated independently, since every product can have different price, margin, cost, CPC, and profitability behavior.
- Daily measurement and analysis (every scheduler cycle), but seller-impacting recommendations (budget increase, pause/reduce Ads, price/cost actions) emitted only on a 7-day cadence.
- CEO-facing findings for destructive cases, scale candidates, low-conversion diagnosis, and missing cost/unit data routing (data-quality notices surface daily; seller-impacting recs follow 7-day window).
- Daily lane registration and scheduler dispatch with no automatic MercadoLibre Product Ads mutation.

### Out of Scope
- Direct Product Ads budget, pause, resume, or bid mutations.
- Rewriting the existing `product-ads-monitor` v1 signals.
- Full external attribution modeling beyond available ML metrics and Cortex snapshots.

## Capabilities

### New Capabilities
- `product-ads-profitability-daemon`: Daily CFO control loop for Product Ads profitability, waste, scale recommendations, and data completeness.

### Modified Capabilities
- `daemon-scheduler`: Add the `product-ads-profitability` lane handler to scheduled daemon dispatch.
- `action-approval-safety`: Ensure Product Ads seller-impacting recommendations remain prepared/proposed actions requiring approval before execution.

## Approach

Implement a separate `productAdsProfitabilityDaemon` using shared Product Ads loading helpers. Compute signals only when required cost/unit evidence is complete; otherwise route missing data to the CEO instead of inventing partial profitability recommendations. Feed structured findings to the CEO lane so the CEO can reason and prepare Telegram approval-gated proposals.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/agent/src/workers/productAdsProfitabilityDaemon.ts` | New | CFO profitability signal detection. |
| `packages/agent/src/workers/productAdsShared.ts` | New | Shared Product Ads/cost/listing loading helpers. |
| `packages/agent/src/workers/daemonScheduler.ts` | Modified | Register profitability daemon handler. |
| `packages/agent/src/conversation/lanes.ts` | Modified | Add profitability lane contract. |
| `packages/agent/src/conversation/companyAgents.ts` | Modified | Add commercial department agent. |
| `packages/agent/tests/workers/productAdsProfitabilityDaemon.test.ts` | New | Behavior coverage for CFO rules. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Incomplete cost/unit data | Med | Label insufficient data and ask CEO for missing inputs. |
| False scaling confidence | Med | Require strong ROAS, CVR, margin, and completeness. |
| Duplicate v1/v2 alerts | Low | Use CFO-specific payloads, daily data-quality dedupe, and rolling 7-day seller-impacting recommendation identity per seller/campaign/item/tier. |

## Rollback Plan

Remove the new lane/handler export and daemon file; existing `product-ads-monitor` behavior remains unchanged.

## Dependencies

- Product Ads metrics snapshots with ROAS, CVR, units, spend, and views/prints.
- Cortex cost/listing snapshots populated by existing daemons.

## Success Criteria

- [ ] Daily findings distinguish critical negative contribution from low-margin warnings.
- [ ] Scale recommendations require strong ROAS, CVR, margin, and data completeness.
- [ ] Missing cost/unit data produces CEO routing, not invented profitability advice.
- [ ] All seller-impacting Ads actions remain approval-gated.
- [ ] Measurement runs daily; seller-impacting recommendations (budget, pause, scale) emit only on a 7-day cadence to avoid overreacting to short-term noise.
