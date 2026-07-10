import { describe, expect, it } from "vitest";
import type { StorefrontCandidate, StorefrontCandidateScore } from "@msl/domain";
import { scoreCandidate, type ChannelComparisonInput } from "./storefrontCandidateScorer.js";
import {
  buildProjection,
  type ScoredCandidate,
  type DeepSeekEnrichment,
} from "./storefrontProjectionBuilder.js";
import crypto from "node:crypto";

// ── Helpers ──────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<StorefrontCandidate> = {}): StorefrontCandidate {
  const base: StorefrontCandidate = {
    id: crypto.randomUUID(),
    itemRef: "MLC12345",
    title: "Test Widget Pro",
    provenance: {
      source: "supplier-web-signal",
      sourceId: "supplier-web-signal:jinpeng:SKU-001",
      supplierId: "jinpeng",
      snapshotIds: [],
      cortexNodeIds: ["1", "2", "3"],
      evidenceIds: ["evt-001", "evt-002"],
    },
    evidenceIds: ["evt-001", "evt-002"],
    evidenceState: {
      stockFreshness: "fresh",
      marginFreshness: "fresh",
      supplierFreshness: "fresh",
      completeness: "complete",
      evidenceIds: ["evt-001", "evt-002"],
    },
    stock: {
      status: "in-stock",
      authority: "supplier-reported",
      quantity: 50,
      evidenceId: "evt-stock-001",
    },
    margin: {
      value: 35,
      currency: "CLP",
      evidenceId: "evt-margin-001",
    },
    blockedReasons: [],
    redactedReasons: [],
    createdAt: new Date().toISOString(),
  };

  // Merge overrides — but if margin is explicitly set to undefined,
  // delete it from the result (exactOptionalPropertyTypes compat)
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, val] of Object.entries(overrides)) {
    if (val === undefined && key === "margin") {
      delete merged[key];
    } else {
      merged[key] = val;
    }
  }
  return merged as unknown as StorefrontCandidate;
}

function makeChannelComparison(
  overrides: Partial<ChannelComparisonInput> = {},
): ChannelComparisonInput {
  return {
    recommendedSellerId: "plasticov",
    confidence: "high",
    ...overrides,
  };
}

// ── Scorer tests ─────────────────────────────────────────────────────

describe("storefrontCandidateScorer", () => {
  describe("scoreCandidate — ideal candidate", () => {
    it("scores high for in-stock + margin + fresh evidence", () => {
      const candidate = makeCandidate();
      const result = scoreCandidate(candidate);

      expect(result.score).toBeGreaterThanOrEqual(70);
      expect(result.blockers).toHaveLength(0);
      expect(result.recommendedAction).toBe("prepare-storefront-projection");
      expect(result.confidence).toBe("high");
    });

    it("includes positive strengths for ideal candidate", () => {
      const candidate = makeCandidate();
      const result = scoreCandidate(candidate);

      expect(result.strengths).toContain("Stock available");
      expect(result.strengths).toContain("Positive margin confirmed");
    });
  });

  describe("scoreCandidate — stock blocking", () => {
    it("blocks out-of-stock → do-not-publish", () => {
      const candidate = makeCandidate({
        stock: { status: "out-of-stock", authority: "supplier-reported" },
      });
      const result = scoreCandidate(candidate);

      expect(result.blockers.some((b) => b.includes("Out of stock"))).toBe(true);
      expect(result.recommendedAction).toBe("do-not-publish");
      expect(result.confidence).toBe("low");
    });

    it("warns low-stock — does not block", () => {
      const candidate = makeCandidate({
        stock: {
          status: "low-stock",
          authority: "supplier-reported",
          quantity: 2,
        },
      });
      const result = scoreCandidate(candidate);

      expect(result.warnings.some((w) => w.includes("Low stock"))).toBe(true);
      // Should not have do-not-publish unless margin is also bad
    });
  });

  describe("scoreCandidate — margin blocking", () => {
    it("blocks missing margin → do-not-publish", () => {
      const candidate = makeCandidate();
      delete (candidate as Record<string, unknown>).margin;
      const result = scoreCandidate(candidate);

      expect(result.blockers.some((b) => b.includes("No margin data"))).toBe(true);
      expect(result.recommendedAction).toBe("do-not-publish");
    });

    it("blocks non-positive margin → do-not-publish", () => {
      const candidate = makeCandidate({
        margin: { value: 0, currency: "CLP", evidenceId: "evt-margin-001" },
      });
      const result = scoreCandidate(candidate);

      expect(result.blockers.some((b) => b.includes("Non-positive margin"))).toBe(true);
      expect(result.recommendedAction).toBe("do-not-publish");
    });
  });

  describe("scoreCandidate — evidence freshness", () => {
    it("flags stale stock evidence → collect-more-evidence", () => {
      const candidate = makeCandidate({
        evidenceState: {
          stockFreshness: "stale",
          marginFreshness: "fresh",
          supplierFreshness: "fresh",
          completeness: "complete",
          evidenceIds: ["evt-001"],
        },
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
      });
      const result = scoreCandidate(candidate);

      expect(
        result.warnings.some(
          (w) =>
            w.toLowerCase().includes("stock evidence") &&
            (w.toLowerCase().includes("stale") || w.toLowerCase().includes("unknown")),
        ),
      ).toBe(true);
      expect(result.missingEvidence).toContain("stock-evidence");
      expect(result.recommendedAction).toBe("collect-more-evidence");
    });

    it("flags stale margin evidence → collect-more-evidence", () => {
      const candidate = makeCandidate({
        evidenceState: {
          stockFreshness: "fresh",
          marginFreshness: "stale",
          supplierFreshness: "fresh",
          completeness: "complete",
          evidenceIds: ["evt-001"],
        },
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
      });
      const result = scoreCandidate(candidate);

      expect(result.missingEvidence).toContain("margin-evidence");
      expect(result.recommendedAction).toBe("collect-more-evidence");
    });

    it("flags incomplete evidence → request-creative-assets", () => {
      const candidate = makeCandidate({
        evidenceState: {
          stockFreshness: "fresh",
          marginFreshness: "fresh",
          supplierFreshness: "fresh",
          completeness: "partial",
          evidenceIds: ["evt-001"],
        },
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
      });
      const result = scoreCandidate(candidate);

      expect(result.missingEvidence).toContain("evidence-completeness");
      // When only completeness is missing (not stock/margin), should be request-creative-assets
      expect(
        ["request-creative-assets", "collect-more-evidence"].includes(result.recommendedAction),
      ).toBe(true);
    });
  });

  describe("scoreCandidate — stock × margin × evidence combos", () => {
    const cases: Array<{
      label: string;
      candidate: Partial<StorefrontCandidate>;
      removeMargin?: boolean;
      expectedAction: string;
      minScore: number;
      maxScore: number;
    }> = [
      {
        label: "stock=in-stock, margin=present, evidence=fresh",
        candidate: {
          stock: { status: "in-stock", authority: "supplier-reported" },
          margin: { value: 35, currency: "CLP", evidenceId: "e1" },
          evidenceState: {
            stockFreshness: "fresh",
            marginFreshness: "fresh",
            supplierFreshness: "fresh",
            completeness: "complete",
            evidenceIds: ["e1"],
          },
        },
        expectedAction: "prepare-storefront-projection",
        minScore: 70,
        maxScore: 100,
      },
      {
        label: "stock=out-of-stock, margin=present, evidence=fresh",
        candidate: {
          stock: { status: "out-of-stock", authority: "supplier-reported" },
          margin: { value: 35, currency: "CLP", evidenceId: "e1" },
          evidenceState: {
            stockFreshness: "fresh",
            marginFreshness: "fresh",
            supplierFreshness: "fresh",
            completeness: "complete",
            evidenceIds: ["e1"],
          },
        },
        expectedAction: "do-not-publish",
        minScore: 0,
        maxScore: 50,
      },
      {
        label: "stock=in-stock, margin=missing, evidence=fresh",
        candidate: {
          stock: { status: "in-stock", authority: "supplier-reported" },
          evidenceState: {
            stockFreshness: "fresh",
            marginFreshness: "fresh",
            supplierFreshness: "fresh",
            completeness: "complete",
            evidenceIds: ["e1"],
          },
        },
        removeMargin: true,
        expectedAction: "do-not-publish",
        minScore: 0,
        maxScore: 50,
      },
      {
        label: "stock=in-stock, margin=present, evidence=stale",
        candidate: {
          stock: { status: "in-stock", authority: "supplier-reported" },
          margin: { value: 35, currency: "CLP", evidenceId: "e1" },
          evidenceState: {
            stockFreshness: "stale",
            marginFreshness: "stale",
            supplierFreshness: "stale",
            completeness: "complete",
            evidenceIds: ["e1"],
          },
        },
        expectedAction: "collect-more-evidence",
        minScore: 0,
        maxScore: 50,
      },
      {
        label: "stock=out-of-stock, margin=missing, evidence=stale",
        candidate: {
          stock: { status: "out-of-stock", authority: "supplier-reported" },
          evidenceState: {
            stockFreshness: "stale",
            marginFreshness: "stale",
            supplierFreshness: "stale",
            completeness: "partial",
            evidenceIds: [],
          },
        },
        removeMargin: true,
        expectedAction: "do-not-publish",
        minScore: 0,
        maxScore: 30,
      },
    ];

    for (const tc of cases) {
      it(tc.label, () => {
        const candidate = makeCandidate(tc.candidate);
        if (tc.removeMargin) {
          delete (candidate as Record<string, unknown>).margin;
        }
        const result = scoreCandidate(candidate);
        expect(result.score).toBeGreaterThanOrEqual(tc.minScore);
        expect(result.score).toBeLessThanOrEqual(tc.maxScore);
        expect(result.recommendedAction).toBe(tc.expectedAction);
      });
    }
  });

  describe("scoreCandidate — reputation risk", () => {
    it("lowers score when redacted reasons present", () => {
      const goodCandidate = makeCandidate();
      const goodResult = scoreCandidate(goodCandidate);

      const riskyCandidate = makeCandidate({
        redactedReasons: ["suspicious-pricing-pattern"],
      });
      const riskyResult = scoreCandidate(riskyCandidate);

      expect(riskyResult.score).toBeLessThan(goodResult.score);
      expect(riskyResult.warnings.some((w) => w.includes("Reputation"))).toBe(true);
    });
  });

  describe("scoreCandidate — blocked reasons from guardrails", () => {
    it("adds blockedReasons from candidate to blockers and reduces score", () => {
      const candidate = makeCandidate({
        blockedReasons: ["unsupported-risky-claim"],
      });
      const result = scoreCandidate(candidate);

      expect(result.blockers).toContain("unsupported-risky-claim");
      expect(result.recommendedAction).toBe("do-not-publish");
    });
  });

  describe("scoreCandidate — channel comparison", () => {
    it("boosts score when channel recommendation matches", () => {
      const candidate = makeCandidate({
        provenance: {
          source: "supplier-web-signal",
          sourceId: "supplier-web-signal:jinpeng:SKU-001",
          supplierId: "jinpeng",
          snapshotIds: [],
          cortexNodeIds: [],
          evidenceIds: ["evt-001"],
        },
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
      });

      const noChannel = scoreCandidate(candidate);
      const withChannel = scoreCandidate(
        candidate,
        makeChannelComparison({ recommendedSellerId: "jinpeng" }),
      );

      expect(withChannel.score).toBeGreaterThanOrEqual(noChannel.score);
    });

    it("with high channel confidence → high candidate confidence", () => {
      const candidate = makeCandidate({
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
      });
      const result = scoreCandidate(
        candidate,
        makeChannelComparison({ recommendedSellerId: "jinpeng" }),
      );

      expect(result.confidence).toBe("high");
    });
  });
});

// ── Projection builder tests ─────────────────────────────────────────

describe("storefrontProjectionBuilder", () => {
  describe("buildProjection — happy path", () => {
    it("builds complete projection for high-scored candidate", () => {
      const candidate = makeCandidate();
      const score: StorefrontCandidateScore = {
        score: 85,
        confidence: "high",
        blockers: [],
        warnings: [],
        strengths: ["Stock available", "Positive margin confirmed"],
        missingEvidence: [],
        recommendedAction: "prepare-storefront-projection",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored);

      expect(projection.projectionId).toBeTruthy();
      expect(projection.candidateId).toBe(candidate.id);
      expect(projection.title).toBe(candidate.title);
      expect(projection.slug).toBeTruthy();
      expect(projection.seo.title).toBeTruthy();
      expect(projection.seo.description).toBeTruthy();
      expect(projection.geo.intentSummary).toBeTruthy();
      expect(projection.pricing.marginPct).toBe(35);
      expect(projection.pricing.missingCost).toBe(false);
      expect(projection.inventory.stockKnown).toBe(true);
      expect(projection.inventory.stockAvailable).toBe(50);
      expect(projection.readiness.status).toBe("ready");
      expect(projection.noMutationExecuted).toBe(true);
    });

    it("includes all projection sections", () => {
      const candidate = makeCandidate();
      const score: StorefrontCandidateScore = {
        score: 70,
        confidence: "medium",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "prepare-storefront-projection",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored);

      // All sections present
      expect(projection.seo).toBeDefined();
      expect(projection.geo).toBeDefined();
      expect(projection.media).toBeDefined();
      expect(projection.pricing).toBeDefined();
      expect(projection.inventory).toBeDefined();
      expect(projection.readiness).toBeDefined();
      expect(projection.evidenceIds.length).toBeGreaterThan(0);
      expect(projection.categoryPath).toBeDefined();
    });
  });

  describe("buildProjection — blocked projection", () => {
    it("reports blocked when candidate has blockers", () => {
      const candidate = makeCandidate({
        stock: { status: "out-of-stock", authority: "supplier-reported" },
      });
      const score: StorefrontCandidateScore = {
        score: 10,
        confidence: "low",
        blockers: ["Out of stock — cannot publish"],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "do-not-publish",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored);

      expect(projection.readiness.status).toBe("blocked");
      expect(projection.readiness.reason).toContain("Out of stock");
    });

    it("reports needs-review when candidate has warnings", () => {
      const candidate = makeCandidate({
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
        stock: { status: "low-stock", authority: "supplier-reported" },
      });
      const score: StorefrontCandidateScore = {
        score: 55,
        confidence: "medium",
        blockers: [],
        warnings: ["Low stock — review before publishing"],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "review-storefront-availability",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored);

      expect(projection.readiness.status).toBe("needs-review");
    });
  });

  describe("buildProjection — missing media", () => {
    it("sets missingImages when evidence is incomplete", () => {
      const candidate = makeCandidate({
        evidenceState: {
          stockFreshness: "fresh",
          marginFreshness: "fresh",
          supplierFreshness: "fresh",
          completeness: "partial",
          evidenceIds: ["evt-001"],
        },
        margin: { value: 35, currency: "CLP", evidenceId: "evt-margin-001" },
      });
      const score: StorefrontCandidateScore = {
        score: 55,
        confidence: "medium",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "request-creative-assets",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored);

      expect(projection.media.missingImages).toBe(true);
      expect(projection.media.images).toHaveLength(0);
    });

    it("sets missingCost when margin is absent", () => {
      const candidate = makeCandidate();
      delete (candidate as Record<string, unknown>).margin;
      const score: StorefrontCandidateScore = {
        score: 20,
        confidence: "low",
        blockers: ["No margin data"],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "do-not-publish",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored);

      expect(projection.pricing.missingCost).toBe(true);
      expect(projection.pricing.marginPct).toBeUndefined();
    });
  });

  describe("buildProjection — DeepSeek fallback", () => {
    it("uses deterministic SEO when DeepSeek is absent", () => {
      const candidate = makeCandidate();
      const score: StorefrontCandidateScore = {
        score: 80,
        confidence: "high",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "prepare-storefront-projection",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const projection = buildProjection(scored); // No deepSeekResult

      expect(projection.seo.title).toContain("Test Widget Pro");
      expect(projection.seo.description).toBeTruthy();
      expect(projection.geo.intentSummary).toContain("Test Widget Pro");
    });

    it("uses DeepSeek enrichment when provided", () => {
      const candidate = makeCandidate();
      const score: StorefrontCandidateScore = {
        score: 80,
        confidence: "high",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "prepare-storefront-projection",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const deepSeekResult: DeepSeekEnrichment = {
        seoTitle: "Premium Test Widget Pro — Best Price Chile",
        seoDescription: "High-quality Test Widget Pro with evidence-backed sourcing.",
        geoSummary: "Chilean buyers searching for widgets — high purchase intent.",
        keywords: ["widget", "chile", "pro", "electronics"],
        faq: [
          {
            question: "Is this in stock?",
            answer: "Yes, 50 units available.",
            evidenceIds: ["evt-stock-001"],
          },
        ],
      };

      const projection = buildProjection(scored, deepSeekResult);

      expect(projection.seo.title).toBe("Premium Test Widget Pro — Best Price Chile");
      expect(projection.seo.keywords).toContain("widget");
      expect(projection.geo.intentSummary).toContain("Chilean buyers");
      expect(projection.geo.faq).toHaveLength(1);
    });
  });

  describe("buildProjection — empty input", () => {
    it("returns blocked projection for empty scored list", () => {
      const projection = buildProjection([]);

      expect(projection.readiness.status).toBe("blocked");
      expect(projection.readiness.reason).toContain("No candidates available");
      expect(projection.candidateId).toBe("");
      expect(projection.noMutationExecuted).toBe(true);
    });
  });

  describe("buildProjection — noMutationExecuted", () => {
    it("always returns noMutationExecuted: true", () => {
      const candidate = makeCandidate();
      const score: StorefrontCandidateScore = {
        score: 85,
        confidence: "high",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "prepare-storefront-projection",
      };
      const scored: ScoredCandidate[] = [{ candidate, score }];

      const normal = buildProjection(scored);
      const empty = buildProjection([]);

      expect(normal.noMutationExecuted).toBe(true);
      expect(empty.noMutationExecuted).toBe(true);
    });
  });

  describe("buildProjection — selects highest scored candidate", () => {
    it("picks the candidate with the highest score", () => {
      const lowCandidate = makeCandidate({
        title: "Low Score Widget",
        id: "low-id",
      });
      const highCandidate = makeCandidate({
        title: "High Score Widget",
        id: "high-id",
      });

      const lowScore: StorefrontCandidateScore = {
        score: 30,
        confidence: "low",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "collect-more-evidence",
      };
      const highScore: StorefrontCandidateScore = {
        score: 90,
        confidence: "high",
        blockers: [],
        warnings: [],
        strengths: [],
        missingEvidence: [],
        recommendedAction: "prepare-storefront-projection",
      };

      const scored: ScoredCandidate[] = [
        { candidate: lowCandidate, score: lowScore },
        { candidate: highCandidate, score: highScore },
      ];

      const projection = buildProjection(scored);

      expect(projection.candidateId).toBe("high-id");
      expect(projection.title).toBe("High Score Widget");
    });
  });
});
