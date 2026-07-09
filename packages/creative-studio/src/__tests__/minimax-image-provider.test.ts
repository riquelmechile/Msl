import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MinimaxImageProvider } from "../infrastructure/providers/minimax/minimax-image-provider.js";
import {
  MinimaxClient,
  MinimaxRequestError,
} from "../infrastructure/providers/minimax/minimax-client.js";
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

// ── Tests ────────────────────────────────────────────────────────────

describe("MinimaxImageProvider", () => {
  let client: MinimaxClient;
  let provider: MinimaxImageProvider;

  beforeEach(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response()));
    client = new MinimaxClient({
      apiKey: "sk-test",
      apiHost: "https://api.minimax.io",
      timeoutMs: 30000,
    });
    provider = new MinimaxImageProvider(client, "image-01");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("supports", () => {
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
      const cost = provider.estimate(makeRequest());
      expect(cost).toBe(0.015);
    });
  });

  describe("execute", () => {
    it("returns result with image URL on success", async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        status: 200,
        ok: true,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              base_resp: { status_code: 0, status_message: "success" },
              data: [{ image_url: "https://cdn.minimax.io/img/123.jpg" }],
            }),
          ),
      } as Response);

      const result = await provider.execute(makeRequest());

      expect(result.provider).toBe("minimax");
      expect(result.model).toBe("image-01");
      expect(result.outputs).toHaveLength(1);
      expect(result.outputs[0]?.kind).toBe("image");
      expect(result.outputs[0]?.storageUri).toBe("https://cdn.minimax.io/img/123.jpg");
      expect(result.noMutationExecuted).toBe(true);
    });

    it("returns empty outputs on provider error", async () => {
      vi.mocked(fetch).mockRejectedValueOnce(
        new MinimaxRequestError("provider_error", "Network failure"),
      );

      const result = await provider.execute(makeRequest());
      expect(result.outputs).toHaveLength(0);
      expect(result.status).toBe("failed");
    });

    it("uses correct aspect ratio for storefront channel", async () => {
      let capturedBody: string | undefined;
      vi.mocked(fetch).mockImplementationOnce((_url, opts) => {
        capturedBody = opts?.body as string;
        return Promise.resolve({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/456.jpg" }],
              }),
            ),
        } as Response);
      });

      await provider.execute(makeRequest({ channel: "storefront", kind: "storefront-hero" }));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(capturedBody!);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.aspect_ratio).toBe("16:9");
    });

    it("includes explicit 1200x1200 dimensions for mercadolibre channel", async () => {
      let capturedBody: string | undefined;
      vi.mocked(fetch).mockImplementationOnce((_url, opts) => {
        capturedBody = opts?.body as string;
        return Promise.resolve({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/ml.jpg" }],
              }),
            ),
        } as Response);
      });

      // Default is mercadolibre channel
      await provider.execute(makeRequest({ channel: "mercadolibre" }));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(capturedBody!);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.width).toBe(1200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.height).toBe(1200);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.aspect_ratio).toBe("1:1");
    });

    it("does NOT include explicit dimensions for non-ML channels", async () => {
      let capturedBody: string | undefined;
      vi.mocked(fetch).mockImplementationOnce((_url, opts) => {
        capturedBody = opts?.body as string;
        return Promise.resolve({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/sf.jpg" }],
              }),
            ),
        } as Response);
      });

      await provider.execute(makeRequest({ channel: "storefront", kind: "storefront-hero" }));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(capturedBody!);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.width).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.height).toBeUndefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.aspect_ratio).toBe("16:9");
    });

    it("includes subject_reference when references provided", async () => {
      let capturedBody: string | undefined;
      vi.mocked(fetch).mockImplementationOnce((_url, opts) => {
        capturedBody = opts?.body as string;
        return Promise.resolve({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/789.jpg" }],
              }),
            ),
        } as Response);
      });

      await provider.execute(makeRequest());
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(capturedBody!);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.subject_reference).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.subject_reference[0].image_file).toBe("https://example.com/product.jpg");
    });

    it("handles empty references without subject_reference", async () => {
      let capturedBody: string | undefined;
      vi.mocked(fetch).mockImplementationOnce((_url, opts) => {
        capturedBody = opts?.body as string;
        return Promise.resolve({
          status: 200,
          ok: true,
          text: () =>
            Promise.resolve(
              JSON.stringify({
                base_resp: { status_code: 0, status_message: "success" },
                data: [{ image_url: "https://cdn.minimax.io/img/000.jpg" }],
              }),
            ),
        } as Response);
      });

      await provider.execute(makeRequest({ references: [] }));
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const body = JSON.parse(capturedBody!);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(body.subject_reference).toBeUndefined();
    });
  });
});
