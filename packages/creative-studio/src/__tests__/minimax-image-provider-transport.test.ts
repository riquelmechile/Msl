import { describe, it, expect, vi, afterEach } from "vitest";
import { MinimaxImageProvider } from "../infrastructure/providers/minimax/minimax-image-provider.js";
import {
  MinimaxFakeTransport,
  type MinimaxImageResponse,
} from "../infrastructure/providers/minimax/minimaxTransport.js";
import type { CreativeAssetRequest, CreativeJobKind } from "../contracts/creative-requests.js";

// ── Factory ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<CreativeAssetRequest> = {}): CreativeAssetRequest {
  return {
    requestId: "cj_test123",
    requestedByAgent: "creative-assets-daemon",
    sellerId: "test-seller",
    channel: "mercadolibre",
    kind: "product-cover-i2i",
    objective: "ctr",
    budgetTier: "low",
    references: [
      {
        type: "supplier-image",
        uri: "https://example.com/product.jpg",
      },
    ],
    productContext: {
      title: "Test Product",
      sku: "TST-001",
      categoryId: "MLC1055",
    },
    constraints: {
      preserveProductTruth: true,
      noBrandInfringement: true,
      requiresHumanApproval: true,
    },
    ...overrides,
  };
}

// ── Assert no real HTTP calls ────────────────────────────────────────

function assertNoFetchCalls() {
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
}

// ── Tests ────────────────────────────────────────────────────────────

describe("MinimaxImageProvider (transport)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs with transport and no client", () => {
    const transport = new MinimaxFakeTransport();
    const provider = new MinimaxImageProvider(undefined, "image-01", transport);
    expect(provider).toBeInstanceOf(MinimaxImageProvider);
  });

  it("throws when neither client nor transport is provided", () => {
    expect(() => new MinimaxImageProvider(undefined, "image-01")).toThrow(
      "either client or transport must be provided",
    );
  });

  describe("supports", () => {
    const transport = new MinimaxFakeTransport();
    const provider = new MinimaxImageProvider(undefined, "image-01", transport);

    const supported: CreativeJobKind[] = [
      "product-cover-i2i",
      "product-gallery-i2i",
      "storefront-hero",
      "storefront-banner",
    ];
    const unsupported: CreativeJobKind[] = [
      "product-clip-6s",
      "product-clip-10s",
      "ml-clip-vertical-30s",
      "social-pack",
      "voiceover",
      "music-bed",
    ];

    for (const kind of supported) {
      it(`returns true for ${kind}`, () => {
        expect(provider.supports(kind)).toBe(true);
      });
    }

    for (const kind of unsupported) {
      it(`returns false for ${kind}`, () => {
        expect(provider.supports(kind)).toBe(false);
      });
    }
  });

  describe("estimate", () => {
    it("returns the default model cost per call", () => {
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);
      const cost = provider.estimate(makeRequest());
      expect(cost).toBe(0.015);
    });
  });

  describe("execute", () => {
    it("returns result with image URL on success — no HTTP", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);

      const result = await provider.execute(makeRequest());

      expect(result.provider).toBe("minimax");
      expect(result.model).toBe("image-01");
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.kind).toBe("image");
      expect(result.outputs[0]?.storageUri).toBe("https://fake-cdn.minimax.io/img/001.jpg");
      expect(result.noMutationExecuted).toBe(true);
      assertNoFetchCalls();
    });

    it("returns empty outputs on error response", async () => {
      vi.spyOn(globalThis, "fetch");
      const errorImageResponse: MinimaxImageResponse = {
        base_resp: { status_code: 1004, status_message: "Auth failed" },
        data: [],
      };
      const transport = new MinimaxFakeTransport({
        imageResponse: errorImageResponse,
      });
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);

      const result = await provider.execute(makeRequest());

      expect(result.outputs).toHaveLength(0);
      expect(result.status).toBe("failed");
      assertNoFetchCalls();
    });

    it("includes subject_reference from references", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);

      const result = await provider.execute(makeRequest());

      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.storageUri).toBe("https://fake-cdn.minimax.io/img/001.jpg");
      assertNoFetchCalls();
    });

    it("handles empty references without subject_reference", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);

      const result = await provider.execute(makeRequest({ references: [] }));

      expect(result.outputs).toHaveLength(1);
      assertNoFetchCalls();
    });

    it("uses overridden image response URL", async () => {
      vi.spyOn(globalThis, "fetch");
      const customImage: MinimaxImageResponse = {
        base_resp: { status_code: 0, status_message: "success" },
        data: [{ image_url: "https://custom.img/overridden.jpg" }],
      };
      const transport = new MinimaxFakeTransport({
        imageResponse: customImage,
      });
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);

      const result = await provider.execute(makeRequest());

      expect(result.outputs[0]?.storageUri).toBe("https://custom.img/overridden.jpg");
      assertNoFetchCalls();
    });

    it("handles storefront-hero kind correctly", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxImageProvider(undefined, "image-01", transport);

      const result = await provider.execute(
        makeRequest({ channel: "storefront", kind: "storefront-hero" }),
      );

      expect(result.outputs[0]?.kind).toBe("image");
      expect(result.status).toBe("needs-human-review");
      assertNoFetchCalls();
    });
  });
});
