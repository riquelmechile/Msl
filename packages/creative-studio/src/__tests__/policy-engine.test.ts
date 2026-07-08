import { describe, it, expect } from "vitest";
import { PolicyEngine } from "../domain/policy-engine.js";
import type { CreativeAssetRequest } from "../contracts/creative-requests.js";

function makeValidRequest(overrides?: Partial<CreativeAssetRequest>): CreativeAssetRequest {
  return {
    requestId: "cj_01JZ123456",
    requestedByAgent: "creative-assets-daemon",
    sellerId: "maustian",
    channel: "mercadolibre",
    kind: "product-cover-i2i",
    objective: "ctr",
    budgetTier: "low",
    references: [
      {
        type: "supplier-image",
        uri: "s3://supplier/sku-443/front.jpg",
        sha256: "abc123",
      },
    ],
    constraints: {
      preserveProductTruth: true,
      noBrandInfringement: true,
      requiresHumanApproval: true,
    },
    ...overrides,
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine();

  describe("validate", () => {
    it("allows a valid request with all requirements met", () => {
      const result = engine.validate(makeValidRequest());
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("rejects a request with missing cj_ prefix in requestId", () => {
      const result = engine.validate(makeValidRequest({ requestId: "bad-id" }));
      expect(result.valid).toBe(false);
      expect(result.issues).toContain("requestId must start with 'cj_' prefix");
    });

    it("rejects a product-cover-i2i request with no references", () => {
      const result = engine.validate(makeValidRequest({ references: [] }));
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
      expect(
        result.issues.some((i) => i.includes("requires at least one reference")),
      ).toBe(true);
    });

    it("rejects preserveProductTruth requests without references for product kinds", () => {
      const result = engine.validate(
        makeValidRequest({
          references: [],
          kind: "ml-clip-vertical-30s",
        }),
      );
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.includes("preserveProductTruth")),
      ).toBe(true);
    });

    it("allows non-product kind requests without references", () => {
      const result = engine.validate(
        makeValidRequest({
          kind: "social-pack",
          references: [],
          constraints: {
            preserveProductTruth: false,
            noBrandInfringement: true,
            requiresHumanApproval: true,
          },
        }),
      );
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it("rejects image-to-image kinds with no references (empty prompt equivalent)", () => {
      const result = engine.validate(
        makeValidRequest({
          kind: "product-gallery-i2i",
          references: [],
        }),
      );
      expect(result.valid).toBe(false);
      expect(
        result.issues.some((i) => i.includes("reference image")),
      ).toBe(true);
    });

    it("allows voiceover kind without references", () => {
      const result = engine.validate(
        makeValidRequest({
          kind: "voiceover",
          references: [],
          constraints: {
            preserveProductTruth: false,
            noBrandInfringement: false,
            requiresHumanApproval: false,
          },
        }),
      );
      expect(result.valid).toBe(true);
    });

    it("accumulates multiple validation issues", () => {
      const result = engine.validate(
        makeValidRequest({
          requestId: "no-prefix",
          kind: "product-cover-i2i",
          references: [],
        }),
      );
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});
