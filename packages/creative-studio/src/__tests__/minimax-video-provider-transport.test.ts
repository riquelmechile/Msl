import { describe, it, expect, vi, afterEach } from "vitest";
import { MinimaxVideoProvider } from "../infrastructure/providers/minimax/minimax-video-provider.js";
import {
  MinimaxFakeTransport,
  type MinimaxVideoResponse,
} from "../infrastructure/providers/minimax/minimaxTransport.js";
import type { CreativeAssetRequest, CreativeJobKind } from "../contracts/creative-requests.js";

// ── Factory ──────────────────────────────────────────────────────────

function makeRequest(overrides: Partial<CreativeAssetRequest> = {}): CreativeAssetRequest {
  return {
    requestId: "cj_test123",
    requestedByAgent: "creative-assets-daemon",
    sellerId: "test-seller",
    channel: "mercadolibre",
    kind: "product-clip-6s",
    objective: "ctr",
    budgetTier: "low",
    references: [
      {
        type: "product-image",
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

describe("MinimaxVideoProvider (transport)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("constructs with transport and no client", () => {
    const transport = new MinimaxFakeTransport();
    // Use short polling for tests
    const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);
    expect(provider).toBeInstanceOf(MinimaxVideoProvider);
  });

  it("throws when neither client nor transport is provided", () => {
    expect(() => new MinimaxVideoProvider(undefined, undefined, 1, 3)).toThrow(
      "either client or transport must be provided",
    );
  });

  describe("supports", () => {
    const transport = new MinimaxFakeTransport();
    const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

    const supported: CreativeJobKind[] = [
      "product-clip-6s",
      "product-clip-10s",
      "ml-clip-vertical-30s",
    ];
    const unsupported: CreativeJobKind[] = [
      "product-cover-i2i",
      "product-gallery-i2i",
      "storefront-hero",
      "storefront-banner",
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
    it("returns cost based on duration", () => {
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const cost6s = provider.estimate(makeRequest({ kind: "product-clip-6s" }));
      expect(cost6s).toBeCloseTo(0.102); // 6 * 0.017

      const cost10s = provider.estimate(makeRequest({ kind: "product-clip-10s" }));
      expect(cost10s).toBeCloseTo(0.33); // 10 * 0.033

      const cost30s = provider.estimate(makeRequest({ kind: "ml-clip-vertical-30s" }));
      expect(cost30s).toBeCloseTo(0.99); // 30 * 0.033
    });
  });

  describe("execute", () => {
    it("returns download URL on success — no HTTP", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest());

      expect(result.provider).toBe("minimax");
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.kind).toBe("video");
      expect(result.outputs[0]?.storageUri).toBe(
        "https://fake-cdn.minimax.io/video/fake-file-001.mp4",
      );
      expect(result.status).toBe("needs-human-review");
      expect(result.noMutationExecuted).toBe(true);
      expect(result.actualCostUsd).toBeCloseTo(0.102); // 6 * 0.017
      assertNoFetchCalls();
    });

    it("returns failed status when polling times out", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport({
        videoQueryResponse: {
          base_resp: { status_code: 0, status_message: "success" },
          status: "processing",
        },
      });
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest());

      expect(result.status).toBe("failed");
      expect(result.outputs).toHaveLength(0);
      expect(result.actualCostUsd).toBeUndefined();
      assertNoFetchCalls();
    });

    it("returns empty outputs on video creation error", async () => {
      vi.spyOn(globalThis, "fetch");
      const errorVideoResponse: MinimaxVideoResponse = {
        base_resp: { status_code: 1004, status_message: "Auth failed" },
        task_id: "",
      };
      const transport = new MinimaxFakeTransport({
        videoResponse: errorVideoResponse,
      });
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest());

      expect(result.outputs).toHaveLength(0);
      expect(result.status).toBe("failed");
      assertNoFetchCalls();
    });

    it("returns video output with first_frame_image reference", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(
        makeRequest({
          references: [{ type: "product-image", uri: "https://example.com/product.jpg" }],
        }),
      );

      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.kind).toBe("video");
      assertNoFetchCalls();
    });

    it("handles empty references", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest({ references: [] }));

      expect(result.outputs).toHaveLength(1);
      assertNoFetchCalls();
    });

    it("handles ml-clip-vertical-30s correctly", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport();
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest({ kind: "ml-clip-vertical-30s" }));

      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.kind).toBe("video");
      assertNoFetchCalls();
    });

    it("handles failed query response (status=failed)", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport({
        videoQueryResponse: {
          base_resp: { status_code: 0, status_message: "success" },
          status: "failed",
        },
      });
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest());

      expect(result.status).toBe("failed");
      expect(result.outputs).toHaveLength(0);
      assertNoFetchCalls();
    });

    it("handles query response with error status_code", async () => {
      vi.spyOn(globalThis, "fetch");
      const transport = new MinimaxFakeTransport({
        videoQueryResponse: {
          base_resp: { status_code: 1008, status_message: "Insufficient balance" },
          status: "processing",
        },
      });
      const provider = new MinimaxVideoProvider(undefined, undefined, 1, 3, transport);

      const result = await provider.execute(makeRequest());

      // Status code != 0 in query → pollVideoTask returns failed immediately
      expect(result.status).toBe("failed");
      assertNoFetchCalls();
    });
  });
});
