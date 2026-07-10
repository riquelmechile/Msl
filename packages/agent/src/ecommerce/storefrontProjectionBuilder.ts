import type { EvidenceId } from "@msl/domain";
import type { StorefrontCandidateScore } from "@msl/domain";
import type { StorefrontCandidate } from "@msl/domain";
import crypto from "node:crypto";

// ── Public types ─────────────────────────────────────────────────────

/** Wraps a candidate with its computed score for the projection builder. */
export type ScoredCandidate = {
  candidate: StorefrontCandidate;
  score: StorefrontCandidateScore;
};

/** Enrichment data from an optional DeepSeek SEO/GEO advisor. */
export type DeepSeekEnrichment = {
  seoTitle?: string;
  seoDescription?: string;
  geoSummary?: string;
  keywords?: string[];
  faq?: Array<{ question: string; answer: string; evidenceIds: string[] }>;
};

/** Readiness verdict produced by the projection builder. */
export type StorefrontReadinessResult = {
  status: "ready" | "blocked" | "needs-review";
  reason?: string;
  evidenceIds: string[];
};

/**
 * Static storefront projection — catalog, SEO, GEO, media, pricing,
 * inventory, and readiness — assembled without mutations.
 *
 * All projections carry `noMutationExecuted: true`.
 */
export type StorefrontProjectionPreparation = {
  projectionId: string;
  candidateId: string;
  title: string;
  slug: string;
  categoryPath: string[];
  seo: {
    title: string;
    description: string;
    keywords: string[];
  };
  geo: {
    intentSummary: string;
    faq: Array<{ question: string; answer: string; evidenceIds: string[] }>;
  };
  media: {
    images: string[];
    missingImages: boolean;
    creativeRequestId?: string;
  };
  pricing: {
    suggestedPrice?: number;
    marginPct?: number;
    missingCost: boolean;
  };
  inventory: {
    stockKnown: boolean;
    stockAvailable?: number;
    supplierFreshness?: string;
  };
  readiness: StorefrontReadinessResult;
  evidenceIds: string[];
  noMutationExecuted: true;
};

// ── Helpers ──────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

// ── Builder ──────────────────────────────────────────────────────────

/**
 * Pure function: builds a deterministic `StorefrontProjectionPreparation`
 * from a list of scored candidates and optional DeepSeek enrichment.
 *
 * The highest-scored candidate is selected.  When DeepSeek enrichment is
 * absent, SEO/GEO fields fall back to deterministic defaults derived from
 * the candidate data.
 *
 * @param scoredCandidates — Non-empty list of scored candidates.
 *   When empty the function returns a minimal blocked projection.
 * @param deepSeekResult — Optional AI-generated SEO/GEO content.
 *   Omitted → deterministic fallback.
 * @returns A projection with `noMutationExecuted: true`.
 */
export function buildProjection(
  scoredCandidates: ScoredCandidate[],
  deepSeekResult?: DeepSeekEnrichment,
): StorefrontProjectionPreparation {
  // ── Select best candidate ──────────────────────────────────────

  if (scoredCandidates.length === 0) {
    // Minimal fallback — blocked projection with no candidates
    const fallbackId = crypto.randomUUID();
    return {
      projectionId: fallbackId,
      candidateId: "",
      title: "No candidates available",
      slug: "no-candidates",
      categoryPath: [],
      seo: {
        title: "No candidates available",
        description: "",
        keywords: [],
      },
      geo: { intentSummary: "", faq: [] },
      media: { images: [], missingImages: true },
      pricing: { missingCost: true },
      inventory: { stockKnown: false },
      readiness: {
        status: "blocked",
        reason: "No candidates available for projection",
        evidenceIds: [],
      },
      evidenceIds: [],
      noMutationExecuted: true,
    };
  }

  const sorted = [...scoredCandidates].sort((a, b) => b.score.score - a.score.score);
  const best = sorted[0];
  if (!best) {
    // Should not happen — guarded by caller, but defensive
    const fallbackId = crypto.randomUUID();
    return {
      projectionId: fallbackId,
      candidateId: "",
      title: "No candidates available",
      slug: "no-candidates",
      categoryPath: [],
      seo: { title: "No candidates available", description: "", keywords: [] },
      geo: { intentSummary: "", faq: [] },
      media: { images: [], missingImages: true },
      pricing: { missingCost: true },
      inventory: { stockKnown: false },
      readiness: {
        status: "blocked",
        reason: "No candidates available for projection",
        evidenceIds: [],
      },
      evidenceIds: [],
      noMutationExecuted: true,
    };
  }
  const { candidate, score: candidateScore } = best;

  // ── Derive fields from candidate ───────────────────────────────

  const projectionId = crypto.randomUUID();
  const candidateId = candidate.id;
  const title = candidate.title;
  const slug = slugify(title);

  // Category path — derived from provenance or evidence metadata
  const categoryPath: string[] = [];

  // SEO
  const seoTitle = deepSeekResult?.seoTitle ?? `${title} — Owned Ecommerce Storefront`;
  const seoDescription =
    deepSeekResult?.seoDescription ??
    `Storefront listing for ${title}. Evidence-backed pricing and availability.`;
  const keywords = deepSeekResult?.keywords ?? [];

  // GEO
  const intentSummary = deepSeekResult?.geoSummary ?? `Purchase-intent listing for ${title}.`;
  const faq = deepSeekResult?.faq ?? [];

  // Media
  const hasBlockers = candidateScore.blockers.length > 0;
  const missingImages = candidate.evidenceState.completeness !== "complete" || hasBlockers;

  const media: StorefrontProjectionPreparation["media"] = {
    images: [], // No actual images in the projection at this stage
    missingImages,
  };

  // Pricing
  const marginPct = candidate.margin?.value;
  const missingCost = !candidate.margin;

  const pricing: StorefrontProjectionPreparation["pricing"] = {
    missingCost,
  };
  if (marginPct !== undefined) {
    pricing.marginPct = Number(marginPct.toFixed(2));
  }

  // Inventory
  const stockKnown = candidate.stock.status !== "unknown";
  const stockQty = candidate.stock.quantity;
  const supplierFreshness = candidate.evidenceState.supplierFreshness;

  const inventory: StorefrontProjectionPreparation["inventory"] = {
    stockKnown,
    supplierFreshness,
  };
  if (stockQty !== undefined) {
    inventory.stockAvailable = stockQty;
  }

  // Readiness
  const readiness: StorefrontReadinessResult = (() => {
    if (candidateScore.blockers.length > 0) {
      return {
        status: "blocked",
        reason: candidateScore.blockers.join("; "),
        evidenceIds: candidate.evidenceIds,
      };
    }
    if (candidateScore.warnings.length > 0) {
      return {
        status: "needs-review",
        reason: candidateScore.warnings.join("; "),
        evidenceIds: candidate.evidenceIds,
      };
    }
    return {
      status: "ready",
      evidenceIds: candidate.evidenceIds,
    };
  })();

  // Collect all evidence IDs
  const evidenceIds: EvidenceId[] = [...candidate.evidenceIds];

  return {
    projectionId,
    candidateId,
    title,
    slug,
    categoryPath,
    seo: { title: seoTitle, description: seoDescription, keywords },
    geo: { intentSummary, faq },
    media,
    pricing,
    inventory,
    readiness,
    evidenceIds,
    noMutationExecuted: true,
  };
}
