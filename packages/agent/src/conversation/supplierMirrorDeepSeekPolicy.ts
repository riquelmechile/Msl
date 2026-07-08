import type { LaneId } from "./lanes.js";

// ── Consolidated imports from gateway modules ───────────────────────
// Pricing tables and model selection logic now live in the reasoning
// gateway modules. This file re-exports for backward compatibility.

export {
  DEEPSEEK_V4_FLASH as SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH,
  DEEPSEEK_V4_PRO as SUPPLIER_MIRROR_DEEPSEEK_V4_PRO,
} from "../reasoning/modelRouter.js";

export { REASONING_PRICING as SUPPLIER_MIRROR_DEEPSEEK_PRICING } from "../reasoning/costEstimator.js";

import { estimateCost } from "../reasoning/costEstimator.js";

import { DEEPSEEK_V4_FLASH, DEEPSEEK_V4_PRO } from "../reasoning/modelRouter.js";

/**
 * Backward-compatible cost estimation wrapper.
 * Accepts the old parameter shape (single input object) and
 * delegates to the consolidated estimateCost in costEstimator.
 */
export function estimateSupplierMirrorDeepSeekCostMicros(input: {
  model: string;
  promptCacheHitTokens?: number | undefined;
  promptCacheMissTokens?: number | undefined;
  outputTokens?: number | undefined;
}): number | undefined {
  return (
    estimateCost(input.model, {
      cacheHitTokens: input.promptCacheHitTokens,
      cacheMissTokens: input.promptCacheMissTokens,
      outputTokens: input.outputTokens,
    }) ?? undefined
  );
}

export const SUPPLIER_MIRROR_DEEPSEEK_PROVIDER = "deepseek";

export type SupplierMirrorDeepSeekModel = typeof DEEPSEEK_V4_FLASH | typeof DEEPSEEK_V4_PRO;

export type SupplierMirrorDeepSeekOperation =
  | "supplier-extraction"
  | "supplier-classification"
  | "policy-conflict";

// ── Backward Compat Wrapper ──────────────────────────────────────────

/**
 * Model selection for supplier mirror operations.
 * Consolidated gateway-side — this wrapper preserved for backward compat.
 */
export function selectSupplierMirrorDeepSeekModel(input: {
  operation: string;
  hardPolicyConflict?: boolean;
}): string {
  return input.operation === "policy-conflict" || input.hardPolicyConflict === true
    ? DEEPSEEK_V4_PRO
    : DEEPSEEK_V4_FLASH;
}

export type SupplierMirrorDeepSeekPricing = {
  model: SupplierMirrorDeepSeekModel;
  inputCacheHitMicrosPerMillionTokens: number;
  inputCacheMissMicrosPerMillionTokens: number;
  outputMicrosPerMillionTokens: number;
  source: "deepseek-official-pricing-2026-07";
};

// ── Prompt Plan Builder (kept local) ─────────────────────────────────

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
      modelDefault: DEEPSEEK_V4_FLASH,
      modelEscalation: DEEPSEEK_V4_PRO,
      cacheStrategy: "stable-prefix-plus-refreshable-evidence",
      laneId,
    }),
  };
}
