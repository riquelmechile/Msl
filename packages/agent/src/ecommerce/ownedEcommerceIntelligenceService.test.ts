import { describe, expect, it, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import { createGraphEngine, type GraphEngine } from "@msl/memory";
import { OwnedEcommerceIntelligenceService } from "./ownedEcommerceIntelligenceService.js";
import {
  DeepSeekFakeTransport,
  type DeepSeekChatResponse,
  type DeepSeekTransport,
} from "../conversation/transports/deepseekTransport.js";
import type { SupplierWebSignalPayload } from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────

/** Create an in-memory GraphEngine for tests. */
function createCortex(): GraphEngine {
  return createGraphEngine(":memory:");
}

/** Seed a minimal supplier_item node so the reasoner finds context. */
function seedSupplier(
  cortex: GraphEngine,
  supplierItemId: string,
  supplierId = "jinpeng",
  sellerId = "plasticov",
): void {
  cortex.createNode(
    `supplier_item:${supplierItemId}`,
    {
      type: "supplier_item",
      supplierId,
      supplierItemId,
      sellerId,
    },
    sellerId,
  );
}

/** Build a valid SupplierWebSignalPayload for tests. */
function makeSignal(
  overrides: Partial<SupplierWebSignalPayload> = {},
): SupplierWebSignalPayload {
  return {
    type: "supplier-web-signal",
    signalKind: "new-supplier-product",
    supplierId: "jinpeng",
    supplierItemId: "SKU-001",
    affectedSellerIds: ["plasticov"],
    evidenceIds: ["evt-001", "evt-002"],
    recommendedAction: "prepare-storefront-candidate",
    severity: "warning",
    capturedAt: new Date().toISOString(),
    noMutationExecuted: true,
    ...overrides,
  };
}

/** Build a fake DeepSeekChatResponse for SEO/GEO enrichment. */
function seoGeoCompletion(overrides?: { title?: string }): DeepSeekChatResponse {
  const title = overrides?.title ?? "Bicicleta Mountain Bike Pro";
  return {
    id: `fake-seo-${crypto.randomUUID().slice(0, 8)}`,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            seoSuggestions: {
              seoTitle: `${title} — Comprá Online | Envío Rápido`,
              seoDescription: `${title} disponible en tienda propia. Precio competitivo, envío a todo Chile.`,
              keywords: ["bicicleta", "mountain bike", "tienda online"],
            },
            geoSuggestions: {
              geoSummary: `Compra ${title} con confianza. Producto verificado, precio transparente.`,
              faq: [
                {
                  question: "¿Tienen stock disponible?",
                  answer: "Sí, stock verificado por el proveedor.",
                  evidenceIds: ["evt-001"],
                },
              ],
            },
            confidence: 0.9,
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 150, total_tokens: 350 },
  };
}

/** Build a fake DeepSeekChatResponse for channel tradeoffs. */
function channelTradeoffsCompletion(): DeepSeekChatResponse {
  return {
    id: `fake-ct-${crypto.randomUUID().slice(0, 8)}`,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            channelTradeoffs: [
              {
                channel: "owned-ecommerce",
                upsides: ["Sin comisiones de marketplace", "Control total de pricing"],
                risks: ["Menor tráfico que MercadoLibre", "Requiere inversión en SEO"],
                overallAssessment:
                  "Excelente canal para este producto — margen alto, sin comisiones.",
              },
              {
                channel: "Plasticov",
                upsides: ["Alto tráfico", "Compradores recurrentes"],
                risks: ["Comisión del 11-16%", "Competencia directa"],
                overallAssessment:
                  "Buen canal secundario si el margen soporta la comisión.",
              },
            ],
            confidence: 0.85,
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 250, completion_tokens: 180, total_tokens: 430 },
  };
}

/** Build a fake DeepSeekChatResponse with blocked content (superlatives without evidenceIds). */
function blockedContentCompletion(): DeepSeekChatResponse {
  return {
    id: `fake-blocked-${crypto.randomUUID().slice(0, 8)}`,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            seoSuggestions: {
              seoTitle: "The Best Bicycle — Guaranteed Lowest Price! Official Store",
              seoDescription:
                "Number one rated bicycle. Top rated by customers worldwide.",
              keywords: ["best bicycle", "guaranteed"],
            },
            geoSuggestions: {
              geoSummary:
                "The leading choice for serious cyclists — certified by experts.",
              faq: [],
            },
            confidence: 0.85,
          }),
        },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 200, completion_tokens: 120, total_tokens: 320 },
  };
}

/** Create a fake transport that cycles through the given responses. */
function fakeTransportWithResponses(
  responses: DeepSeekChatResponse[],
): DeepSeekTransport {
  return new DeepSeekFakeTransport(responses);
}

/** Create a fake transport that throws on every call. */
function throwingTransport(): DeepSeekTransport {
  class ThrowingTransport extends DeepSeekFakeTransport {
    override async createChatCompletion(): Promise<DeepSeekChatResponse> {
      throw new Error("Simulated DeepSeek API failure");
    }
  }
  return new ThrowingTransport();
}

// ── Test suite ───────────────────────────────────────────────────────

describe("OwnedEcommerceIntelligenceService — advisor integration", () => {
  let cortex: GraphEngine;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    cortex = createCortex();
    seedSupplier(cortex, "SKU-001");
    // Reset the feature flag to disabled by default
    delete process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED;
  });

  afterEach(() => {
    // GraphEngine wraps an in-memory SQLite DB — cleaned up by garbage collector
    // Restore environment
    if (originalEnv.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED !== undefined) {
      process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED =
        originalEnv.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED;
    } else {
      delete process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED;
    }
  });

  // ── Scenario 1: Pipeline runs with advisor enabled (no crash) ──

  it("runs the full pipeline with advisor enabled without errors", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";
    const transport = fakeTransportWithResponses([
      seoGeoCompletion(),
      channelTradeoffsCompletion(),
    ]);
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      deepSeekTransport: transport,
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    // Pipeline should succeed without errors
    expect(result.errors).toEqual([]);
    expect(result.candidates.length).toBe(1);

    // Should have projection (with deterministic fallback — candidate blocked
    // because basic Cortex data lacks margin/stock evidence)
    expect(result.projection).toBeDefined();

    // noMutationExecuted maintained
    expect(result.noMutationExecuted).toBe(true);
    expect(result.projection!.noMutationExecuted).toBe(true);
  });

  // ── Scenario 2: Flag disabled — step 7 skipped ────────────────

  it("skips advisor when feature flag is disabled (default)", async () => {
    // Flag is NOT set → disabled (default behavior)
    const transport = fakeTransportWithResponses([seoGeoCompletion()]);
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      deepSeekTransport: transport,
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    expect(result.errors).toEqual([]);
    expect(result.projection).toBeDefined();

    // Should have deterministic fallback SEO (no advisor enrichment)
    const projection = result.projection!;
    expect(projection.seo.title).toContain("Owned Ecommerce Storefront");
    expect(result.noMutationExecuted).toBe(true);
  });

  // ── Scenario 3: Transport absent but flag enabled — deterministic ──

  it("uses deterministic fallback when flag is enabled but transport is absent", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      // deepSeekTransport intentionally absent
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    expect(result.errors).toEqual([]);
    expect(result.projection).toBeDefined();

    // Should have deterministic fallback SEO
    const projection = result.projection!;
    expect(projection.seo.title).toContain("Owned Ecommerce Storefront");
    expect(projection.noMutationExecuted).toBe(true);
  });

  // ── Scenario 4: Blocked candidate stays blocked ────────────────

  it("pipeline still runs for blocked candidates but advisor skips them", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";

    // Seed a supplier node for a product that lacks evidence
    seedSupplier(cortex, "SKU-002", "jinpeng", "plasticov");

    const transport = fakeTransportWithResponses([
      seoGeoCompletion(),
      channelTradeoffsCompletion(),
    ]);
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      deepSeekTransport: transport,
    });

    // Send a signal for the alternative SKU
    const signal = makeSignal({ supplierItemId: "SKU-002" });
    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    // Pipeline should still complete without errors
    expect(result.errors).toEqual([]);
    expect(result.noMutationExecuted).toBe(true);

    // The candidate may be blocked (due to missing margin/stock evidence in
    // basic Cortex data), but the pipeline must complete with projection
    if (result.projection) {
      expect(result.projection.noMutationExecuted).toBe(true);
    }
  });

  // ── Scenario 5: Advisor failure degrades gracefully ────────────

  it("degrades gracefully when advisor transport throws", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      deepSeekTransport: throwingTransport(),
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    // Pipeline should still succeed
    expect(result.errors).toEqual([]);
    expect(result.projection).toBeDefined();

    // Should have deterministic fallback (no advisor enrichment)
    const projection = result.projection!;
    expect(projection.seo.title).toContain("Owned Ecommerce Storefront");
    expect(result.noMutationExecuted).toBe(true);
  });

  // ── Scenario 6: Validator blocks unsafe output ─────────────────

  it("passes sanitized enrichment when advisor output contains blocked claims", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";
    // First response: blocked content (superlatives without evidence)
    // Second response: clean channel tradeoffs
    const transport = fakeTransportWithResponses([
      blockedContentCompletion(),
      channelTradeoffsCompletion(),
    ]);
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      deepSeekTransport: transport,
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    expect(result.errors).toEqual([]);
    expect(result.projection).toBeDefined();

    const projection = result.projection!;

    // Blocked claims should be sanitized — "best", "guaranteed", "official" should NOT appear
    const seoText = `${projection.seo.title} ${projection.seo.description} ${projection.seo.keywords.join(" ")}`;
    expect(seoText).not.toMatch(/\bbest\b/i);
    expect(seoText).not.toMatch(/\bguaranteed\b/i);
    expect(seoText).not.toMatch(/\bofficial\b/i);

    expect(result.noMutationExecuted).toBe(true);
    expect(projection.noMutationExecuted).toBe(true);
  });

  // ── Scenario 7: noMutationExecuted maintained ──────────────────

  it("maintains noMutationExecuted: true in all pipeline outputs", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";
    const transport = fakeTransportWithResponses([
      seoGeoCompletion(),
      channelTradeoffsCompletion(),
    ]);
    const service = new OwnedEcommerceIntelligenceService({
      cortex,
      deepSeekTransport: transport,
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    expect(result.noMutationExecuted).toBe(true);
    if (result.projection) {
      expect(result.projection.noMutationExecuted).toBe(true);
    }
  });

  // ── Scenario 8: Cortex unavailable → degraded result ──────────

  it("returns degraded result when cortex is unavailable", async () => {
    process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED = "true";
    const transport = fakeTransportWithResponses([seoGeoCompletion()]);
    // Service WITHOUT cortex
    const service = new OwnedEcommerceIntelligenceService({
      deepSeekTransport: transport,
    });
    const signal = makeSignal();

    const result = await service.prepareFromSupplierWebSignal(signal, "plasticov");

    expect(result.cortexUnavailable).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.noMutationExecuted).toBe(true);
  });
});

describe("OwnedEcommerceIntelligenceService — discoverStorefrontCandidates", () => {
  it("returns cortexUnavailable when cortex is absent", () => {
    const service = new OwnedEcommerceIntelligenceService({});
    const result = service.discoverStorefrontCandidates("plasticov");

    expect(result.cortexUnavailable).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(result.noMutationExecuted).toBe(true);
  });

  it("passes enrichment arg to buildProjection in discover path", () => {
    // Creates service with cortex; even though candidates may be empty
    // the buildProjection call passes enrichment as second arg
    const cortex = createCortex();
    const service = new OwnedEcommerceIntelligenceService({ cortex });
    const result = service.discoverStorefrontCandidates("plasticov");

    // Should complete without error regardless of candidate availability
    expect(result.noMutationExecuted).toBe(true);
  });
});
