// ── Consolidated Pricing Tables ──────────────────────────────────────

/**
 * DeepSeek pricing per million tokens as of 2026-07.
 * Consolidates supplier-mirror and general DeepSeek pricing into one table.
 *
 * Prices in microCLP (1 micro = 0.000001 CLP).
 * source: deepseek-official-pricing-2026-07
 */
export const REASONING_PRICING: Readonly<Record<string, Readonly<ModelPricingRecord>>> =
  Object.freeze({
    "deepseek-v4-flash": Object.freeze({
      model: "deepseek-v4-flash",
      inputCacheHitMicrosPerMillionTokens: 2_800,
      inputCacheMissMicrosPerMillionTokens: 140_000,
      outputMicrosPerMillionTokens: 280_000,
      source: "deepseek-official-pricing-2026-07",
    }),
    "deepseek-v4-pro": Object.freeze({
      model: "deepseek-v4-pro",
      inputCacheHitMicrosPerMillionTokens: 3_625,
      inputCacheMissMicrosPerMillionTokens: 435_000,
      outputMicrosPerMillionTokens: 870_000,
      source: "deepseek-official-pricing-2026-07",
    }),
  });

export type ModelPricingRecord = {
  model: string;
  inputCacheHitMicrosPerMillionTokens: number;
  inputCacheMissMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  source: string;
};

// ── Cost Estimation ──────────────────────────────────────────────────

export type EstimateCostInput = {
  cacheHitTokens?: number;
  cacheMissTokens?: number;
  outputTokens?: number;
};

/**
 * Estimate cost in microCLP for a given model and token usage.
 * Returns undefined when the model has no known pricing.
 */
export function estimateCost(model: string, input: EstimateCostInput): number | undefined {
  const pricing = REASONING_PRICING[model];
  if (!pricing) return undefined;

  const hitCost =
    ((input.cacheHitTokens ?? 0) * pricing.inputCacheHitMicrosPerMillionTokens) / 1_000_000;
  const missCost =
    ((input.cacheMissTokens ?? 0) * pricing.inputCacheMissMicrosPerMillionTokens) / 1_000_000;
  const outputCost = ((input.outputTokens ?? 0) * pricing.outputMicrosPerMillionTokens) / 1_000_000;

  return Math.ceil(hitCost + missCost + outputCost);
}
