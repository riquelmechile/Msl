import type { LaneId } from "../lanes.js";
import type { CacheTelemetry } from "../lanes.js";

// ── Constants ──────────────────────────────────────────────────────────

const CREDENTIAL_REF_REDACTED = "[credential-ref-redacted]";

// ── Helpers ────────────────────────────────────────────────────────────

function readNumericCounter(
  usage: Record<string, unknown> | null | undefined,
  key: "prompt_cache_hit_tokens" | "prompt_cache_miss_tokens",
): number | null {
  const value = usage?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Token estimation ───────────────────────────────────────────────────

export function estimateTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 0;
  for (const msg of messages) {
    total += Math.ceil(msg.content.length / 4);
  }
  return total;
}

// ── Cache telemetry ────────────────────────────────────────────────────

export function extractPromptCacheTelemetry(input: {
  provider: string;
  model: string;
  laneId: LaneId;
  usage?: Record<string, unknown> | null;
  credentialRef?: string;
  measuredAt?: string;
}): CacheTelemetry {
  return {
    provider: input.provider,
    model: input.model,
    laneId: input.laneId,
    promptCacheHitTokens: readNumericCounter(input.usage, "prompt_cache_hit_tokens"),
    promptCacheMissTokens: readNumericCounter(input.usage, "prompt_cache_miss_tokens"),
    ...(input.credentialRef ? { credentialRefRedacted: CREDENTIAL_REF_REDACTED } : {}),
    measuredAt: input.measuredAt ?? new Date().toISOString(),
  };
}
