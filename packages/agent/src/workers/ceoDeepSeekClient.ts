import crypto from "node:crypto";
import OpenAI from "openai";
import { getDeepSeekClient } from "../conversation/deepseekClient.js";
import {
  buildDeepSeekChatCompletionRequest,
  resolveDeepSeekRuntimeConfig,
  resolveDeepSeekUserId,
} from "@msl/domain";
import type { DeepSeekRuntimeConfig } from "@msl/domain";
import type { GraphEngine } from "@msl/memory";
import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";

// ── Constants ────────────────────────────────────────────────────────

const VALID_PROPOSAL_TYPES = new Set([
  "pause-campaign",
  "adjust-campaign-budget",
  "review-campaign-structure",
  "resume-campaign",
]);

const DEFAULT_TIMEOUT_MS = 5000;
const DEPT_ID = "product-ads-ceo-profitability";

// ── Types ────────────────────────────────────────────────────────────

export type CeoFinding = {
  sellerId: string;
  campaignId: string;
  itemId: string;
  adId?: string;
  signal: string;
  severity: string;
  summary: string;
  evidenceIds: string[];
  capturedAt: string;
  recommendationIdentity: string;
};

export type CeoDeepSeekClient = {
  /**
   * Enriches findings with Cortex context, calls DeepSeek Flash once per
   * batch, validates structured JSON output, records cost in the workforce
   * ledger, and returns a Map of recommendationIdentity → proposalType.
   *
   * On error, timeout, or invalid response this throws — the caller (handler)
   * catches and falls back to the static SIGNAL_TO_ACTION map.
   */
  reason(
    findings: CeoFinding[],
    cortex: GraphEngine,
    ledger: WorkforceCostCacheLedgerStore,
  ): Promise<Map<string, string>>;
};

// ── Prompt blocks ────────────────────────────────────────────────────
// Stable prefix designed for prefix caching via cacheBlocks pattern.
// In a future iteration the policy block can be cached via Cortex
// cacheBlocks while only the context + findings are refreshed.

const POLICY_BLOCK = `You are a CFO-grade profitability analyst for MercadoLibre Product Ads.
Your task is to analyze each profitability finding and recommend the best action.

Valid actions (proposalType):
- pause-campaign — Stop the campaign immediately. Use for margin-consuming ads with severe losses.
- adjust-campaign-budget — Increase or reallocate budget. Use for scale candidates or underinvested campaigns.
- review-campaign-structure — Review campaign structure, targeting, or creative. Use for budget waste or unit-economics issues.
- resume-campaign — Resume a previously paused campaign.

Return a JSON object where each key is a finding's recommendationIdentity
and each value is an object: { "proposalType": "<valid action>", "rationale": "<why>" }`;

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Creates a CeoDeepSeekClient or returns null when DEEPSEEK_API_KEY is
 * unset — handler falls back to the static SIGNAL_TO_ACTION map.
 */
export function createCeoDeepSeekClient(
  runtime?: DeepSeekRuntimeConfig,
): CeoDeepSeekClient | null {
  const resolved = runtime ?? resolveDeepSeekRuntimeConfig();
  if (!resolved.apiKey) return null;

  const openai = getDeepSeekClient(resolved.apiKey, resolved.baseURL);

  return new CeoDeepSeekClientImpl(openai, resolved.model);
}

// ── Implementation ──────────────────────────────────────────────────

class CeoDeepSeekClientImpl implements CeoDeepSeekClient {
  private openai: OpenAI;
  private model: string;

  constructor(openai: OpenAI, model: string) {
    this.openai = openai;
    this.model = model;
  }

  async reason(
    findings: CeoFinding[],
    cortex: GraphEngine,
    ledger: WorkforceCostCacheLedgerStore,
  ): Promise<Map<string, string>> {
    // 1. Cortex enrichment — query historical profitability data
    const contextBlocks: string[] = [];
    for (const f of findings) {
      const nodes = cortex.queryByMetadata({
        type: "profitability",
        sellerId: f.sellerId,
        limit: 5,
      });
      if (nodes.length > 0) {
        contextBlocks.push(
          `--- ${f.recommendationIdentity} ---`,
          ...nodes.map((n) => JSON.stringify(n.metadata)),
        );
      }
    }
    const cortexContext =
      contextBlocks.length > 0
        ? contextBlocks.join("\n")
        : "no historical data available";

    // 2. Build prompt
    const prompt = `${POLICY_BLOCK}

CORTEX CONTEXT:
${cortexContext}

FINDINGS:
${JSON.stringify(findings, null, 2)}`;

    // 3. Call DeepSeek Flash with structured output + AbortController timeout
    const userId = resolveDeepSeekUserId({ laneId: DEPT_ID });

    const request = buildDeepSeekChatCompletionRequest({
      model: this.model,
      messages: [{ role: "user" as const, content: prompt }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response_format: { type: "json_object" as any },
      stream: false as const,
      ...(userId ? { userId, user: userId } : {}),
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let completion;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      completion = await this.openai.chat.completions.create(request as any, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    // 4. Record cost ledger entry
    const usage = completion.usage;
    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();
    ledger.insertEntry({
      entryId,
      agentId: "product-ads-ceo-profitability",
      laneId: "product-ads-ceo-profitability",
      departmentId: DEPT_ID,
      provider: "deepseek",
      model: this.model,
      operation: "chat.completions.create",
      promptCacheHitTokens: usage?.prompt_tokens_details
        ? ("cached_tokens" in usage.prompt_tokens_details
            ? (usage.prompt_tokens_details as { cached_tokens?: number }).cached_tokens
            : undefined)
        : undefined,
      inputTokens: usage?.prompt_tokens ?? undefined,
      outputTokens: usage?.completion_tokens ?? undefined,
      estimatedCostMicros: undefined, // cost estimation out of scope for v1
      currency: "CLP",
      cacheStatus: usage?.prompt_tokens_details
        ? ("cached_tokens" in usage.prompt_tokens_details &&
            (usage.prompt_tokens_details as { cached_tokens?: number }).cached_tokens &&
            (usage.prompt_tokens_details as { cached_tokens?: number }).cached_tokens! > 0
          ? "hit"
          : "miss")
        : "unknown",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metadata: { model: this.model, source: "ceo-deepseek-client" } as any,
      measuredAt: now,
    });

    // 5. Parse and validate response
    const raw = completion.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty response from DeepSeek");

    let parsed: Record<string, { proposalType: string; rationale?: string }>;
    try {
      parsed = JSON.parse(raw) as Record<string, { proposalType: string; rationale?: string }>;
    } catch {
      throw new Error("Invalid JSON response from DeepSeek");
    }

    // 6. Validate each proposalType; invalid → throw so caller falls back
    const recommendations = new Map<string, string>();
    for (const [identity, rec] of Object.entries(parsed)) {
      if (!rec.proposalType || !VALID_PROPOSAL_TYPES.has(rec.proposalType)) {
        throw new Error(
          `Invalid proposalType "${rec.proposalType}" for finding ${identity}`,
        );
      }
      recommendations.set(identity, rec.proposalType);
    }

    return recommendations;
  }
}
