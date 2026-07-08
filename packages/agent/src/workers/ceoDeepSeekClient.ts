import OpenAI from "openai";
import { getDeepSeekClient } from "../conversation/deepseekClient.js";
import {
  resolveDeepSeekRuntimeConfig,
  type DeepSeekRuntimeConfig,
} from "../conversation/deepseekRuntime.js";
import type { GraphEngine } from "@msl/memory";
import type { AutonomyEngine } from "../conversation/autonomyEngine.js";
import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Constants ────────────────────────────────────────────────────────

const VALID_PROPOSAL_TYPES = new Set([
  "pause-campaign",
  "adjust-campaign-budget",
  "review-campaign-structure",
  "resume-campaign",
]);

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
   * Enriches findings with Cortex context, calls DeepSeek via the
   * reasoning gateway, validates structured JSON output, and returns
   * a Map of recommendationIdentity → proposalType.
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
// Stable prefix designed for prefix caching via the gateway's 3-block
// prompt cache strategy (stablePrefix + cacheableContext + volatileInput).

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

export type CeoDeepSeekClientDeps = {
  autonomy?: AutonomyEngine;
};

/**
 * Creates a CeoDeepSeekClient or returns null when DEEPSEEK_API_KEY is
 * unset — handler falls back to the static SIGNAL_TO_ACTION map.
 *
 * The gateway is created lazily inside the impl, sharing the singleton
 * OpenAI client from getDeepSeekClient().
 */
export function createCeoDeepSeekClient(
  runtime?: DeepSeekRuntimeConfig,
  _deps?: CeoDeepSeekClientDeps,
): CeoDeepSeekClient | null {
  const resolved = runtime ?? resolveDeepSeekRuntimeConfig();
  if (!resolved.apiKey) return null;

  const openai = getDeepSeekClient(resolved.apiKey, resolved.baseURL);
  const gateway = new DeepSeekReasoningGateway(openai, undefined, _deps?.autonomy);

  return new CeoDeepSeekClientImpl(gateway);
}

// ── Implementation ──────────────────────────────────────────────────

class CeoDeepSeekClientImpl implements CeoDeepSeekClient {
  private gateway: DeepSeekReasoningGateway;

  constructor(gateway: DeepSeekReasoningGateway) {
    this.gateway = gateway;
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
      contextBlocks.length > 0 ? contextBlocks.join("\n") : "no historical data available";

    // 2. Build ReasoningCall and delegate to gateway
    const result = await this.gateway.reason(
      {
        laneId: DEPT_ID,
        level: ReasoningLevel.Recommendation,
        stablePrefix: POLICY_BLOCK,
        cacheableContext: `CORTEX CONTEXT:\n${cortexContext}`,
        volatileInput: `FINDINGS:\n${JSON.stringify(findings, null, 2)}`,
        departmentId: DEPT_ID,
        agentId: "product-ads-ceo-profitability",
      },
      ledger, // pass the call-site ledger for cost recording
    );

    // 3. Handle fallback — translate to throw for backward compat
    if (result.status === "fallback") {
      throw new Error(result.summary);
    }

    // 4. Parse and validate response
    const raw = result.rawResponse;
    if (!raw) throw new Error("Empty response from DeepSeek");

    let parsed: Record<string, { proposalType: string; rationale?: string }>;
    try {
      parsed = JSON.parse(raw) as Record<string, { proposalType: string; rationale?: string }>;
    } catch {
      throw new Error("Invalid JSON response from DeepSeek");
    }

    // 5. Validate each proposalType; invalid → throw so caller falls back
    const recommendations = new Map<string, string>();
    for (const [identity, rec] of Object.entries(parsed)) {
      if (!rec.proposalType || !VALID_PROPOSAL_TYPES.has(rec.proposalType)) {
        throw new Error(`Invalid proposalType "${rec.proposalType}" for finding ${identity}`);
      }
      recommendations.set(identity, rec.proposalType);
    }

    return recommendations;
  }
}
