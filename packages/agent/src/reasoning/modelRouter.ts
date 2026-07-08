import { ReasoningLevel } from "./reasoningTypes.js";

// ── Model Constants ──────────────────────────────────────────────────

export const DEEPSEEK_V4_FLASH = "deepseek-v4-flash";
export const DEEPSEEK_V4_PRO = "deepseek-v4-pro";

// ── Model Selection ──────────────────────────────────────────────────

/**
 * Selects the DeepSeek model based on reasoning level and optional forcePro.
 *
 * | Level                           | forcePro=false | forcePro=true |
 * |----------------------------------|----------------|---------------|
 * | classification, summarization, prioritization | flash | pro |
 * | recommendation, decision         | pro            | pro           |
 *
 * Exported for use by SupplierMirrorDeepSeekPolicy and other policy modules.
 */
export function selectModel(
  level: ReasoningLevel,
  forcePro?: boolean,
): "deepseek-v4-flash" | "deepseek-v4-pro" {
  if (forcePro) return DEEPSEEK_V4_PRO;

  switch (level) {
    case ReasoningLevel.Classification:
    case ReasoningLevel.Summarization:
    case ReasoningLevel.Prioritization:
      return DEEPSEEK_V4_FLASH;
    case ReasoningLevel.Recommendation:
    case ReasoningLevel.Decision:
      return DEEPSEEK_V4_PRO;
  }
}
