import type { DaemonHandler, DaemonFinding } from "./daemonTypes.js";
import {
  loadProductAdsContext,
  enrichWithEconomics,
  type ProductAdEconomics,
  type ProductAdsContext,
} from "./productAdsShared.js";

// ── Signal thresholds ────────────────────────────────────────────────

const SCALE_ROAS_THRESHOLD = 2.0;
const SCALE_MARGIN_THRESHOLD = 0.2; // 20%
const SCALE_CVR_THRESHOLD = 0.02; // 2%
const WASTE_COST_RATIO = 0.5;
const WASTE_CVR_THRESHOLD = 0.01; // 1%
const UNDERINVESTED_MARGIN_THRESHOLD = 0.3; // 30%
const UNDERINVESTED_SOV_THRESHOLD = 0.1; // 10%
const RECOMMENDATION_WINDOW_DAYS = 7;

// ── Recommendation signal tiers ──────────────────────────────────────

type SignalTier =
  | "margin-consuming"
  | "scale-candidate"
  | "budget-waste"
  | "underinvested"
  | "unit-economics";

// ── Daemon handler ───────────────────────────────────────────────────

/**
 * Product Ads Profitability Control daemon.
 *
 * CFO-grade per-product analysis inside Product Ads campaigns.
 * Measures daily on every scheduler cycle. Seller-impacting recommendations
 * (budget, pause, scale) emit only on a rolling 7-day cadence per
 * sellerId + campaignId + itemId + signal tier.
 *
 * Data-quality notices for missing cost/unit evidence emit daily and
 * SHALL NOT carry seller-impacting action proposals.
 * Campaign-level ROAS/ACOS averages are NEVER substituted for per-product
 * economics — every product inside a campaign is evaluated independently.
 */
export const productAdsProfitabilityDaemon: DaemonHandler = async ({
  reader,
  cortex,
  bus,
  sellerIds,
}) => {
  const findings: DaemonFinding[] = [];
  const messageIds: string[] = [];
  const now = new Date();
  const capturedAt = now.toISOString();
  const todayYmd = capturedAt.slice(0, 10); // YYYY-MM-DD
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - RECOMMENDATION_WINDOW_DAYS);
  const windowStart = sevenDaysAgo.toISOString();

  // ── Load context ──────────────────────────────────────────────────

  let ctx: ProductAdsContext;
  try {
    ctx = await loadProductAdsContext(reader, cortex, sellerIds);
  } catch (err) {
    console.error(
      "[product-ads-profitability] Failed to load context:",
      err instanceof Error ? err.message : String(err),
    );
    return { findings, proposalEnqueued: false, messageIds };
  }

  if (ctx.ads.length === 0) {
    return { findings, proposalEnqueued: false, messageIds };
  }

  const economics = enrichWithEconomics(
    ctx.ads,
    ctx.listingPrice,
    ctx.costMap,
  );

  if (economics.length === 0) {
    return { findings: [], proposalEnqueued: false, messageIds };
  }

  // ── Per-product signal detection ──────────────────────────────────

  // Each product evaluated independently — no campaign-level averaging
  type ProductFinding = {
    product: ProductAdEconomics;
    signal: SignalTier;
    severity: "critical" | "warning" | "info";
    kind: "alert" | "opportunity" | "info";
    summary: string;
    evidenceIds: string[];
    actionability: "seller-impacting" | "data-quality";
  };

  const productFindings: ProductFinding[] = [];

  for (const prod of economics) {
    // ── Data-quality routing: insufficient cost data → daily notice ──
    if (prod.dataCompleteness === "insufficient") {
      productFindings.push({
        product: prod,
        signal: "unit-economics",
        severity: "info",
        kind: "info",
        summary: `Insufficient cost data for advertised product ${prod.itemId} (campaign ${prod.campaignId}, ad ${prod.adId}): cannot compute profitability economics.`,
        evidenceIds: [
          `cost_snapshot:${prod.itemId}`,
          `product-ads-insights:ad:${prod.adId}`,
        ],
        actionability: "data-quality",
      });
      continue; // Skip seller-impacting signals when cost is missing
    }

    // ── 1. Margin-consuming (critical) ──────────────────────────────
    // netContribution <= 0 where netContribution = (price × units) − (cost × units) − adSpend
    if (
      prod.netContribution !== undefined &&
      prod.netContribution <= 0
    ) {
      productFindings.push({
        product: prod,
        signal: "margin-consuming",
        severity: "critical",
        kind: "alert",
        summary: `Margin-consuming ad: product ${prod.itemId} in campaign ${prod.campaignId} — net contribution ${prod.netContribution.toFixed(0)} CLP (ad spend ${prod.adSpend.toFixed(0)}, revenue ${prod.revenue.toFixed(0)})`,
        evidenceIds: [
          `listing_snapshot:${prod.itemId}`,
          `cost_snapshot:${prod.itemId}`,
          `product-ads-insights:ad:${prod.adId}`,
        ],
        actionability: "seller-impacting",
      });
    }

    // ── 2. High-ROAS scale candidate (opportunity) ──────────────────
    // Per-product ROAS > 2.0 AND net margin > 20% AND CVR > 2%
    if (
      prod.roas !== undefined &&
      prod.roas > SCALE_ROAS_THRESHOLD &&
      prod.contributionMarginPct !== undefined &&
      prod.contributionMarginPct > SCALE_MARGIN_THRESHOLD &&
      prod.cvr !== undefined &&
      prod.cvr > SCALE_CVR_THRESHOLD
    ) {
      productFindings.push({
        product: prod,
        signal: "scale-candidate",
        severity: "info",
        kind: "opportunity",
        summary: `Scale candidate: product ${prod.itemId} — ROAS ${prod.roas.toFixed(2)}, margin ${(prod.contributionMarginPct * 100).toFixed(0)}%, CVR ${(prod.cvr * 100).toFixed(1)}%`,
        evidenceIds: [
          `listing_snapshot:${prod.itemId}`,
          `cost_snapshot:${prod.itemId}`,
          `product-ads-insights:ad:${prod.adId}`,
        ],
        actionability: "seller-impacting",
      });
    }

    // ── 3. Budget waste (warning) ────────────────────────────────────
    // Ad investment > cost × 0.5 AND CVR < 1%
    if (
      prod.costPerUnit !== undefined &&
      prod.adSpend > prod.costPerUnit * WASTE_COST_RATIO &&
      prod.cvr !== undefined &&
      prod.cvr < WASTE_CVR_THRESHOLD
    ) {
      productFindings.push({
        product: prod,
        signal: "budget-waste",
        severity: "warning",
        kind: "alert",
        summary: `Budget waste: product ${prod.itemId} — ad spend ${prod.adSpend.toFixed(0)} exceeds 50% of cost, CVR only ${(prod.cvr * 100).toFixed(1)}%`,
        evidenceIds: [
          `cost_snapshot:${prod.itemId}`,
          `product-ads-insights:ad:${prod.adId}`,
        ],
        actionability: "seller-impacting",
      });
    }

    // ── 4. Underinvested (info) ─────────────────────────────────────
    // Net margin > 30% AND SoV < 10%
    if (
      prod.contributionMarginPct !== undefined &&
      prod.contributionMarginPct > UNDERINVESTED_MARGIN_THRESHOLD &&
      prod.sov !== undefined &&
      prod.sov < UNDERINVESTED_SOV_THRESHOLD
    ) {
      productFindings.push({
        product: prod,
        signal: "underinvested",
        severity: "info",
        kind: "info",
        summary: `Underinvested: product ${prod.itemId} — margin ${(prod.contributionMarginPct * 100).toFixed(0)}%, SoV only ${(prod.sov * 100).toFixed(1)}%`,
        evidenceIds: [
          `listing_snapshot:${prod.itemId}`,
          `cost_snapshot:${prod.itemId}`,
          `product-ads-insights:ad:${prod.adId}`,
        ],
        actionability: "seller-impacting",
      });
    }

    // ── 5. Unit economics (info) ────────────────────────────────────
    // Always emitted for products with full cost data as informational
    if (prod.dataCompleteness === "full" || prod.dataCompleteness === "partial") {
      const margin = prod.contributionMarginPct !== undefined
        ? `${(prod.contributionMarginPct * 100).toFixed(0)}%`
        : "unknown";
      const beCpa = prod.breakEvenCpa !== undefined
        ? `${prod.breakEvenCpa.toFixed(0)} CLP`
        : "unknown";
      productFindings.push({
        product: prod,
        signal: "unit-economics",
        severity: "info",
        kind: "info",
        summary: `Unit economics: product ${prod.itemId} — margin ${margin}, break-even CPA ${beCpa}, CPC ${prod.cpc?.toFixed(0) ?? "N/A"} CLP`,
        evidenceIds: [
          `listing_snapshot:${prod.itemId}`,
          `cost_snapshot:${prod.itemId}`,
          `product-ads-insights:ad:${prod.adId}`,
        ],
        actionability: "seller-impacting",
      });
    }
  }

  // ── Apply rolling 7-day cadence for seller-impacting recs ────────

  const dedupedFindings: typeof productFindings = [];

  for (const pf of productFindings) {
    // For data-quality notices: daily allowed, always emit
    if (pf.actionability === "data-quality") {
      // Look up recent data-quality notice for same identity
      const recent = bus.lookupRecentByDedupePrefix(
        `product-ads-data-gap:${pf.product.sellerId}:${pf.product.campaignId}:${pf.product.itemId}:${todayYmd}`,
        windowStart,
      );
      if (recent.length > 0) {
        continue; // Already emitted today for this product — skip
      }
      dedupedFindings.push(pf);
      continue;
    }

    // For seller-impacting recommendations: rolling 7-day cadence
    // Look up recent seller-impacting rec for same identity prefix
    const identityPrefix = `product-ads-cfo:${pf.product.sellerId}:${pf.product.campaignId}:${pf.product.itemId}:${pf.signal}`;
    const recent = bus.lookupRecentByDedupePrefix(identityPrefix, windowStart);
    if (recent.length > 0) {
      continue; // Within 7-day window — suppress
    }

    dedupedFindings.push(pf);
  }

  // ── Enqueue individually with identity-aware dedupe keys ──────────

  let proposalEnqueued = false;

  for (const pf of dedupedFindings) {
    findings.push({
      kind: pf.kind,
      severity: pf.severity,
      summary: pf.summary,
      evidenceIds: pf.evidenceIds,
    });

    // Build identity-aware dedupe key so lookupRecentByDedupePrefix
    // can find previously enqueued proposals from the last 7 days.
    const dedupeKey =
      pf.actionability === "data-quality"
        ? `product-ads-data-gap:${pf.product.sellerId}:${pf.product.campaignId}:${pf.product.itemId}:${todayYmd}`
        : `product-ads-cfo:${pf.product.sellerId}:${pf.product.campaignId}:${pf.product.itemId}:${pf.signal}:${capturedAt.slice(0, 13)}`;

    const recommendationIdentity =
      pf.actionability === "data-quality"
        ? `product-ads-data-gap:${pf.product.sellerId}:${pf.product.campaignId}:${pf.product.itemId}:${todayYmd}`
        : `product-ads-cfo:${pf.product.sellerId}:${pf.product.campaignId}:${pf.product.itemId}:${pf.signal}`;

    const recommendedAction =
      pf.actionability === "data-quality"
        ? "Provide missing cost/unit data so profitability analysis can run on this product. No seller-impacting actions can be recommended without cost evidence."
        : pf.signal === "margin-consuming"
          ? "Review margin-consuming ad immediately — consider pausing or reducing budget for this product"
          : pf.signal === "budget-waste"
            ? "Review budget-waste product — reduce ad spend or improve conversion before continuing"
            : pf.signal === "scale-candidate"
              ? "Scale budget on high-ROAS product — expand campaign investment on this proven performer"
              : "Review underinvested opportunities and unit economics insights";

    const msg = bus.enqueue({
      senderAgentId: "product-ads-profitability",
      receiverAgentId: "ceo",
      messageType: "proposal",
      payloadJson: JSON.stringify({
        type: "proposal",
        tier: pf.signal,
        severity: pf.severity,
        summary: pf.summary,
        findings: [
          {
            kind: pf.kind,
            severity: pf.severity,
            summary: pf.summary,
            evidenceIds: pf.evidenceIds,
            actionability: pf.actionability,
            recommendationIdentity,
          },
        ],
        recommendedAction,
        recommendationWindowDays: RECOMMENDATION_WINDOW_DAYS,
        capturedAt,
        noMutationExecuted: true,
      }),
      dedupeKey,
    });
    messageIds.push(msg.messageId);
    proposalEnqueued = true;
  }

  return {
    findings,
    proposalEnqueued,
    messageIds,
  };
};
