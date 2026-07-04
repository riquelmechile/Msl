import type { LaneId } from "./lanes.js";

export const SUPPLIER_MIRROR_DEEPSEEK_PROVIDER = "deepseek";
export const SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH = "deepseek-v4-flash";
export const SUPPLIER_MIRROR_DEEPSEEK_V4_PRO = "deepseek-v4-pro";

export type SupplierMirrorDeepSeekModel =
  | typeof SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH
  | typeof SUPPLIER_MIRROR_DEEPSEEK_V4_PRO;

export type SupplierMirrorDeepSeekOperation =
  | "supplier-extraction"
  | "supplier-classification"
  | "policy-conflict";

export type SupplierMirrorDeepSeekPricing = {
  model: SupplierMirrorDeepSeekModel;
  inputCacheHitMicrosPerMillionTokens: number;
  inputCacheMissMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  source: "deepseek-official-pricing-2026-07";
};

export const SUPPLIER_MIRROR_DEEPSEEK_PRICING: Readonly<
  Record<SupplierMirrorDeepSeekModel, SupplierMirrorDeepSeekPricing>
> = Object.freeze({
  [SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH]: Object.freeze({
    model: SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH,
    inputCacheHitMicrosPerMillionTokens: 2_800,
    inputCacheMissMicrosPerMillionTokens: 140_000,
    outputMicrosPerMillionTokens: 280_000,
    source: "deepseek-official-pricing-2026-07",
  }),
  [SUPPLIER_MIRROR_DEEPSEEK_V4_PRO]: Object.freeze({
    model: SUPPLIER_MIRROR_DEEPSEEK_V4_PRO,
    inputCacheHitMicrosPerMillionTokens: 3_625,
    inputCacheMissMicrosPerMillionTokens: 435_000,
    outputMicrosPerMillionTokens: 870_000,
    source: "deepseek-official-pricing-2026-07",
  }),
});

export type SupplierMirrorDeepSeekPromptPlanInput = {
  laneId?: LaneId;
  supplierId: string;
  supplierName: string;
  targetSellerIds?: readonly string[];
  policySummary?: string | undefined;
  evidenceIds?: readonly string[];
};

export type SupplierMirrorDeepSeekPromptPlan = {
  stablePrefix: string;
  cacheableContextBlock: string;
  volatileContextBlock: string;
  metadata: Readonly<Record<string, string>>;
};

export function selectSupplierMirrorDeepSeekModel(input: {
  operation: SupplierMirrorDeepSeekOperation;
  hardPolicyConflict?: boolean;
}): SupplierMirrorDeepSeekModel {
  return input.operation === "policy-conflict" || input.hardPolicyConflict === true
    ? SUPPLIER_MIRROR_DEEPSEEK_V4_PRO
    : SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH;
}

export function estimateSupplierMirrorDeepSeekCostMicros(input: {
  model: string;
  promptCacheHitTokens?: number | undefined;
  promptCacheMissTokens?: number | undefined;
  outputTokens?: number | undefined;
}): number | undefined {
  const pricing = SUPPLIER_MIRROR_DEEPSEEK_PRICING[input.model as SupplierMirrorDeepSeekModel];
  if (!pricing) return undefined;
  const hitCost =
    ((input.promptCacheHitTokens ?? 0) * pricing.inputCacheHitMicrosPerMillionTokens) / 1_000_000;
  const missCost =
    ((input.promptCacheMissTokens ?? 0) * pricing.inputCacheMissMicrosPerMillionTokens) / 1_000_000;
  const outputCost = ((input.outputTokens ?? 0) * pricing.outputMicrosPerMillionTokens) / 1_000_000;
  return Math.ceil(hitCost + missCost + outputCost);
}

export function buildSupplierMirrorDeepSeekPromptPlan(
  input: SupplierMirrorDeepSeekPromptPlanInput,
): SupplierMirrorDeepSeekPromptPlan {
  const laneId = input.laneId ?? "cost-supplier";
  const targetSellerIds = [...(input.targetSellerIds ?? [])].sort();
  const evidenceIds = [...(input.evidenceIds ?? [])].sort();
  const stablePrefix = [
    "You are the Supplier Mirror evidence lane for the CEO.",
    "Keep all supplier-worker activity internal and return bounded evidence to the CEO only.",
    "Do not publish listings, change prices, pause listings, message suppliers, or mutate external systems.",
  ].join("\n");
  const cacheableContextBlock = [
    "## Supplier Mirror Cacheable Context",
    `- laneId: ${laneId}`,
    `- supplierId: ${input.supplierId}`,
    `- supplierName: ${input.supplierName}`,
    `- targetSellerIds: ${targetSellerIds.join(", ") || "pending"}`,
    `- policySummary: ${input.policySummary ?? "pending CEO policy"}`,
    "- autonomy: proposal-only except verified approved emergency pauses",
  ].join("\n");
  const volatileContextBlock = [
    "## Supplier Mirror Refreshable Evidence",
    `- evidenceIds: ${evidenceIds.join(", ") || "none"}`,
    "- Put changing supplier snapshots, prices, and stock observations here so stable prefixes remain cacheable.",
  ].join("\n");

  return {
    stablePrefix,
    cacheableContextBlock,
    volatileContextBlock,
    metadata: Object.freeze({
      provider: SUPPLIER_MIRROR_DEEPSEEK_PROVIDER,
      modelDefault: SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH,
      modelEscalation: SUPPLIER_MIRROR_DEEPSEEK_V4_PRO,
      cacheStrategy: "stable-prefix-plus-refreshable-evidence",
      laneId,
    }),
  };
}
