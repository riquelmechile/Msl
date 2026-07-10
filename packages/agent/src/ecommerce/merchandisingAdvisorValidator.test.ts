import { describe, expect, it } from "vitest";
import { validate } from "./merchandisingAdvisorValidator.js";
import type { MerchandisingAdvisorResult } from "./ownedEcommerceMerchandisingAdvisor.js";

// ── Helpers ──────────────────────────────────────────────────────────

/** Construct a minimal valid result that should pass validation. */
function cleanResult(
  overrides: Partial<MerchandisingAdvisorResult> = {},
): MerchandisingAdvisorResult {
  return {
    reasoning: [],
    positioningAngles: [],
    seoSuggestions: {},
    geoSuggestions: {},
    channelTradeoffs: [],
    missingEvidenceRequests: [],
    experimentProposal: null,
    confidence: 0.8,
    noMutationExecuted: true,
    ...overrides,
  };
}

/** Build reasoning entry with a rationale. */
function reasoningEntry(
  candidateId: string,
  rationale: string,
  evidenceIds: string[] = [],
): MerchandisingAdvisorResult["reasoning"][number] {
  return { rank: 1, candidateId, rationale, evidenceIds };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("MerchandisingAdvisorValidator", () => {
  describe("superlative detection", () => {
    // Test 1: Blocks "best" without evidenceId
    it('blocks "best" without evidenceId', () => {
      const result = cleanResult({
        reasoning: [
          reasoningEntry("c1", "This is the best product for the storefront — unmatched value."),
        ],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.length).toBeGreaterThan(0);
      expect(validated.blockedClaims[0]!).toContain("best");
      expect(validated.blockedClaims[0]!).toContain("reasoning[c1]");
    });

    // Test 2: Blocks "guaranteed" without evidenceId
    it('blocks "guaranteed" without evidenceId', () => {
      const result = cleanResult({
        seoSuggestions: {
          seoTitle: "Guaranteed lowest price — buy now!",
        },
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.toLowerCase().includes("guaranteed"))).toBe(
        true,
      );
      expect(validated.blockedClaims.some((c) => c.includes("seoTitle"))).toBe(true);
    });

    // Test 3: Blocks "official" without evidenceId
    it('blocks "official" without evidenceId', () => {
      const result = cleanResult({
        positioningAngles: ["Official distributor for this product line."],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.toLowerCase().includes("official"))).toBe(true);
    });

    // Test 4: Blocks "number one" without evidenceId
    it('blocks "number one" without evidenceId', () => {
      const result = cleanResult({
        geoSuggestions: {
          geoSummary: "The number one storefront for premium products in this category.",
        },
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.toLowerCase().includes("number one"))).toBe(
        true,
      );
    });
  });

  describe("publish/checkout language detection", () => {
    // Test 5: Blocks publish recommendation
    it('blocks publish recommendation ("publish now")', () => {
      const result = cleanResult({
        reasoning: [reasoningEntry("c2", "This product is ready. Publish now to capture demand.")],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.toLowerCase().includes("publish"))).toBe(true);
      // Verify sanitized reasoning
      expect(validated.sanitizedResult.reasoning[0]!.rationale).toContain("[sanitized");
    });

    // Test 6: Blocks checkout activation recommendation
    it('blocks checkout activation recommendation ("activate checkout")', () => {
      const result = cleanResult({
        reasoning: [
          reasoningEntry("c3", "Activate checkout for this item — it is ready for sale."),
        ],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(
        validated.blockedClaims.some((c) => c.toLowerCase().includes("activate checkout")),
      ).toBe(true);
      expect(validated.sanitizedResult.reasoning[0]!.rationale).toContain("[sanitized");
    });
  });

  describe("medical/technical claims", () => {
    // Test 7: Blocks medical claim without evidenceId
    it("blocks medical claim without evidenceId", () => {
      const result = cleanResult({
        seoSuggestions: {
          seoDescription:
            "Producto curativo con certificación FDA. Tratamiento natural para la salud.",
        },
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.length).toBeGreaterThan(0);
      expect(validated.blockedClaims.some((c) => c.includes("medical"))).toBe(true);
      expect(validated.blockedClaims.some((c) => c.includes("seoDescription"))).toBe(true);
    });

    it("allows medical claim WITH evidenceId", () => {
      const result = cleanResult({
        reasoning: [
          reasoningEntry("c4", "This product is FDA approved for medical use.", ["evt-fda-001"]),
        ],
      });

      const validated = validate(result);

      // Should NOT block since it has evidenceIds
      const hasMedicalBlock = validated.blockedClaims.some(
        (c) => c.includes("FDA") || c.includes("medical"),
      );
      expect(hasMedicalBlock).toBe(false);
      expect(validated.usable).toBe(true);
    });
  });

  describe("clean pass", () => {
    // Test 8: Allows valid claim with evidenceId
    it("allows valid claim with evidenceId", () => {
      const result = cleanResult({
        reasoning: [
          reasoningEntry("c5", "Top seller in this category based on historical data.", [
            "evt-001",
            "evt-002",
          ]),
        ],
        seoSuggestions: {
          seoTitle: "Product Title — Owned Ecommerce",
          seoDescription: "A solid product with verified stock and pricing.",
        },
        positioningAngles: ["Strong margin — 42% confirmed by supplier."],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(true);
      expect(validated.blockedClaims).toEqual([]);
      expect(validated.warnings).toEqual([]);
      // Sanitized result should be essentially unchanged
      expect(validated.sanitizedResult.reasoning).toHaveLength(1);
      expect(validated.sanitizedResult.reasoning[0]!.rationale).toBe(
        result.reasoning[0]!.rationale,
      );
    });

    it("blocks a superlative but passes clean result for a different claim", () => {
      // Partially sanitizes: one bad claim, one good
      const result = cleanResult({
        reasoning: [
          reasoningEntry("bad", "This is the guaranteed best product."), // no evidence → blocked
          reasoningEntry("good", "Verified stock and known margin structure.", ["evt-003"]), // evidence → allowed
        ],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false); // at least one blocked
      expect(validated.blockedClaims.length).toBeGreaterThan(0);
      // Good reasoning should be intact
      const goodReasoning = validated.sanitizedResult.reasoning.find(
        (r) => r.candidateId === "good",
      );
      expect(goodReasoning!.rationale).toBe("Verified stock and known margin structure.");
      // Bad reasoning should be sanitized
      const badReasoning = validated.sanitizedResult.reasoning.find((r) => r.candidateId === "bad");
      expect(badReasoning!.rationale).toContain("[sanitized");
    });
  });

  describe("invalid targetAgentIds", () => {
    // Test 10: Invalid targetAgentId flagged as warning
    it("flags invalid targetAgentId as warning but does not block usable result", () => {
      const result = cleanResult({
        missingEvidenceRequests: [
          {
            category: "cost",
            severity: "high",
            description: "Missing cost data",
            candidateId: "c6",
            targetAgentId: "invalid-agent" as never, // unknown agent
            question: "What is the cost?",
          },
          {
            category: "images",
            severity: "medium",
            description: "Missing images",
            candidateId: "c6",
            targetAgentId: "creative-assets", // valid
            question: "Are images available?",
          },
        ],
      });

      const validated = validate(result);

      expect(validated.warnings.length).toBeGreaterThan(0);
      expect(validated.warnings[0]!).toContain("invalid-agent");
      expect(validated.usable).toBe(true); // warning doesn't block
      // Both requests still present in sanitized result
      expect(validated.sanitizedResult.missingEvidenceRequests.length).toBe(2);
    });
  });

  describe("invented stock/margin data", () => {
    it("blocks specific numeric stock claims without evidenceIds", () => {
      const result = cleanResult({
        reasoning: [reasoningEntry("c7", "We have 150 units in stock ready to ship today.")],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.includes("invented"))).toBe(true);
      expect(validated.blockedClaims.some((c) => c.includes("units"))).toBe(true);
    });

    it("blocks specific margin percentage claims without evidenceIds", () => {
      const result = cleanResult({
        reasoning: [
          reasoningEntry("c8", "This product has a 42% margin making it highly profitable."),
        ],
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.includes("invented"))).toBe(true);
      expect(validated.blockedClaims.some((c) => c.includes("margin"))).toBe(true);
    });

    it("allows numeric claims WITH evidenceIds", () => {
      const result = cleanResult({
        reasoning: [reasoningEntry("c9", "Stock of 150 units confirmed by supplier.", ["evt-001"])],
      });

      const validated = validate(result);

      // Should NOT block — has evidenceIds
      const hasInventedBlock = validated.blockedClaims.some((c) => c.includes("invented"));
      expect(hasInventedBlock).toBe(false);
    });
  });

  describe("mixed-account cross-references", () => {
    it("blocks Plasticov reference in seoDescription without comparison context", () => {
      const result = cleanResult({
        seoSuggestions: {
          seoDescription: "Better than Plasticov listings — buy from our owned storefront.",
        },
      });

      const validated = validate(result);

      expect(validated.usable).toBe(false);
      expect(validated.blockedClaims.some((c) => c.includes("Plasticov"))).toBe(true);
    });

    it("allows Plasticov/Maustian references inside channel tradeoffs", () => {
      const result = cleanResult({
        channelTradeoffs: [
          {
            channel: "Plasticov",
            upsides: ["Plasticov has high traffic and fast checkout."],
            risks: ["Plasticov charges high commission fees."],
            overallAssessment: "Plasticov is the volume play but margins are tight.",
          },
          {
            channel: "Maustian",
            upsides: ["Maustian has loyal repeat buyers."],
            risks: [],
            overallAssessment: "Maustian is the niche loyalty channel.",
          },
        ],
      });

      const validated = validate(result);

      // Channel tradeoffs are the allowed context for cross-references
      expect(validated.usable).toBe(true);
      expect(validated.blockedClaims.filter((c) => c.includes("mixed-account"))).toEqual([]);
    });
  });

  describe("safety contract", () => {
    it("never throws on any input", () => {
      // Empty result
      expect(() => validate(cleanResult())).not.toThrow();

      // Result with every field populated
      const rich = cleanResult({
        reasoning: [
          reasoningEntry("c1", "Best product guaranteed!", []),
          reasoningEntry("c2", "Solid product.", ["evt-001"]),
        ],
        positioningAngles: ["Official supplier", "Verified stock"],
        seoSuggestions: {
          seoTitle: "Top rated — Buy Now!",
          seoDescription: "The leading choice.",
          keywords: ["best", "official"],
        },
        geoSuggestions: {
          geoSummary: "Number one storefront.",
          faq: [{ question: "Q1?", answer: "A1 certified by FDA.", evidenceIds: [] }],
        },
        channelTradeoffs: [
          {
            channel: "owned-ecommerce",
            upsides: ["Publish directly from your storefront."],
            risks: [],
            overallAssessment: "Best channel overall.",
          },
        ],
        missingEvidenceRequests: [
          {
            category: "cost",
            severity: "high",
            description: "Missing cost",
            candidateId: "c1",
            targetAgentId: "fake-agent" as never,
            question: "Cost?",
          },
        ],
        experimentProposal: {
          hypothesis: "Guaranteed improvement with SEO optimization.",
          metric: "CTR",
          stopRule: "14 days",
          expectedLearning: "Validated SEO impact.",
        },
      });

      expect(() => {
        validate(rich);
      }).not.toThrow();

      // Should have blocked claims and warnings
      const captured = validate(rich);
      expect(captured.blockedClaims.length).toBeGreaterThan(0);
      expect(captured.warnings.length).toBeGreaterThan(0);
      expect(captured.usable).toBe(false);
      expect(captured.sanitizedResult.noMutationExecuted).toBe(true);
    });
  });
});
