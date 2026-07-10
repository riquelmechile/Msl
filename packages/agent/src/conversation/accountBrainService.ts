import type { AccountAssetStore } from "./accountAssetStore.js";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import type { CeoInboxStore } from "./ceoInboxStore.js";
import type { AgentWorkSessionStore } from "../sessions/AgentWorkSessionStore.js";
import type { GraphEngine } from "@msl/memory";
import type { AccountRisk, AccountOpportunity, AccountStrategy } from "@msl/domain";

// ── Public types ──────────────────────────────────────────────────────────

export type AccountBrainStatusInput = {
  sellerId: string;
  /** ISO date from which to query agent activity (default: start of today). */
  since?: string;
  includeLessons?: boolean;
  includeCosts?: boolean;
  includeCortex?: boolean;
  includePendingApprovals?: boolean;
};

export type AccountBrainStatus = {
  sellerId: string;
  status: "active" | "missing_account_asset" | "unavailable";
  health: HealthSummary | "unavailable";
  capabilities: CapabilitySummary[] | "unavailable";
  profitGoal: ProfitGoalSummary | "unavailable";
  risks: AccountRisk[] | "unavailable";
  opportunities: AccountOpportunity[] | "unavailable";
  strategy: (AccountStrategy & { sellerId?: string })[] | "unavailable";
  agentActivity: AgentActivitySummary | "unavailable";
  pendingApprovals: ApprovalSummary[] | "unavailable";
  costAndCache: CostCacheSummary | "unavailable";
  cortex: CortexSummary | "unavailable";
  recommendedFocus: string[];
  confidence: "high" | "medium" | "low";
  evidence: EvidenceRow[];
  noMutationExecuted: true;
};

export type CompareAccountAssetsInput = {
  /** Optional product/opportunity description for capability-matching. */
  opportunity?: string;
  /** Seller IDs to compare (default: all active accounts). */
  candidateSellerIds?: string[];
  /** Goal-driven weight adjustment. */
  goal?: ScoreGoal;
  includeEvidence?: boolean;
};

export type AccountAssetComparison = {
  recommendedSellerId: string | null;
  confidence: "high" | "medium" | "low";
  ranking: RankingEntry[];
  decisionLogic: string;
  evidence: EvidenceRow[];
  suggestedNextAction: SuggestedNextAction;
  noMutationExecuted: true;
};

// ── Sub-types ──────────────────────────────────────────────────────────────

type HealthSummary = {
  currentStatus: string;
  reputation?: string;
  salesVelocity?: number;
  marginProfile?: number;
  latestSnapshot?: string;
};

type CapabilitySummary = {
  kind: string;
  status: string;
  health?: string;
};

type ProfitGoalSummary = {
  value: number;
};

export type AgentActivitySummary = {
  sessionsToday: number;
  status: string;
  agentIds: string[];
  observations?: Record<string, number>;
  proposals: number;
  lessons: number;
  recentLessons?: string[];
};

type ApprovalSummary = {
  proposalId: string;
  senderAgentId: string;
  proposalType: string;
  riskLevel: string;
  status: string;
  summary: string;
  createdAt: string;
};

export type CostCacheSummary = {
  /** "unavailable" when cost ledger is absent. */
  perAgent: Record<string, { costMicros: number; entries: number }> | "unavailable";
  cacheEfficiency: number | "unavailable";
  totalEstimatedCostMicros: number | "unavailable";
};

type CortexSummary = {
  /** Count of seller-scoped nodes visible in Cortex. */
  nodeCount: number;
  /** Presence of an account_asset root node. */
  hasAccountNode: boolean;
  /** Sample of recent global memory nodes (max 5). */
  recentGlobalNodes: string[];
};

type EvidenceRow = {
  source: string;
  sellerId?: string;
  observation: string;
};

type RankingEntry = {
  sellerId: string;
  score: number;
  capabilities: CapabilitySummary[];
  health: HealthSummary | "unavailable";
  risks: AccountRisk[] | "unavailable";
  opportunities: AccountOpportunity[] | "unavailable";
  profitGoal: ProfitGoalSummary | "unavailable";
  costLoad: CostCacheSummary | "unavailable";
  missingCapabilities?: string[];
  strengths: string[];
  weaknesses: string[];
};

type SuggestedNextAction = {
  kind: string;
  description: string;
  requiresApproval: true;
};

type ScoreGoal =
  "maximize_profit" | "reduce_risk" | "grow_reputation" | "clear_stock" | "test_market";

// ── Scoring weights ────────────────────────────────────────────────────────

type ScoringWeights = {
  capabilityMatch: number;
  health: number;
  risk: number;
  profitGoal: number;
  opportunityFit: number;
  costLoad: number;
};

const DEFAULT_WEIGHTS: ScoringWeights = {
  capabilityMatch: 0.25,
  health: 0.2,
  risk: 0.2,
  profitGoal: 0.2,
  opportunityFit: 0.1,
  costLoad: 0.05,
};

const GOAL_WEIGHT_ADJUSTMENTS: Record<ScoreGoal, Partial<ScoringWeights>> = {
  maximize_profit: { profitGoal: 2.0, opportunityFit: 1.5 },
  reduce_risk: { risk: 2.0 },
  grow_reputation: { health: 2.0 },
  clear_stock: { health: 1.5 },
  test_market: { capabilityMatch: 1.5 },
};

// ── Health score map ───────────────────────────────────────────────────────

function healthScore(status: string): number {
  switch (status) {
    case "healthy":
      return 100;
    case "degraded":
      return 50;
    case "at-risk":
      return 25;
    case "critical":
      return 0;
    default:
      return 50;
  }
}

function cloneWeights(w: ScoringWeights): ScoringWeights {
  return {
    capabilityMatch: w.capabilityMatch,
    health: w.health,
    risk: w.risk,
    profitGoal: w.profitGoal,
    opportunityFit: w.opportunityFit,
    costLoad: w.costLoad,
  };
}

// ── Service class ──────────────────────────────────────────────────────────

export class AccountBrainService {
  constructor(
    private readonly accountAsset?: AccountAssetStore,
    private readonly sessionStore?: AgentWorkSessionStore,
    private readonly costLedger?: WorkforceCostCacheLedgerStore,
    private readonly ceoInbox?: CeoInboxStore,
    private readonly cortex?: GraphEngine,
  ) {}

  // ── Safe wrappers ───────────────────────────────────────────────────

  private unavailableIfMissing<T>(store: unknown, fn: () => T): T | "unavailable" {
    if (!store) return "unavailable";
    try {
      return fn();
    } catch {
      return "unavailable";
    }
  }

  // ── getAccountBrainStatus ────────────────────────────────────────────

  getAccountBrainStatus(
    sellerId: string,
    options: AccountBrainStatusInput = { sellerId },
  ): AccountBrainStatus {
    const evidence: EvidenceRow[] = [];
    const asset = this.accountAsset?.getAccountAsset(sellerId) ?? null;

    if (!asset) {
      return {
        sellerId,
        status: "missing_account_asset",
        health: "unavailable",
        capabilities: "unavailable",
        profitGoal: "unavailable",
        risks: "unavailable",
        opportunities: "unavailable",
        strategy: "unavailable",
        agentActivity: "unavailable",
        pendingApprovals: "unavailable",
        costAndCache: "unavailable",
        cortex: "unavailable",
        recommendedFocus: ["Create account asset record in AccountAssetStore first."],
        confidence: "high",
        evidence: [
          {
            source: "AccountAssetStore",
            sellerId,
            observation: "No account asset found.",
          },
        ],
        noMutationExecuted: true,
      };
    }

    evidence.push({
      source: "AccountAssetStore",
      sellerId,
      observation: `Account found: ${asset.name}, status=${asset.status}, risk=${asset.riskLevel}`,
    });

    // ── Health ─────────────────────────────────────────────────────
    const health: HealthSummary | "unavailable" = this.unavailableIfMissing(
      this.accountAsset,
      () => {
        const history = this.accountAsset!.getHealthHistory(sellerId);
        const latest = history.length > 0 ? history[history.length - 1] : undefined;
        if (!latest) return "unavailable";
        evidence.push({
          source: "AccountAssetStore.health",
          sellerId,
          observation: `Latest health: ${latest.status}`,
        });
        return {
          currentStatus: latest.status,
          ...(latest.reputation ? { reputation: latest.reputation } : {}),
          ...(latest.salesVelocity != null ? { salesVelocity: latest.salesVelocity } : {}),
          ...(latest.marginProfile != null ? { marginProfile: latest.marginProfile } : {}),
          latestSnapshot: latest.recordedAt,
        };
      },
    );

    // ── Capabilities ───────────────────────────────────────────────
    const capabilities: CapabilitySummary[] | "unavailable" = this.unavailableIfMissing(
      this.accountAsset,
      () => {
        const caps = this.accountAsset!.getCapabilities(sellerId);
        evidence.push({
          source: "AccountAssetStore.capabilities",
          sellerId,
          observation: `${caps.length} capabilities loaded`,
        });
        return caps.map((c) => ({
          kind: c.kind,
          status: c.status,
          ...(c.health ? { health: c.health.status } : {}),
        }));
      },
    );

    // ── Profit goal ────────────────────────────────────────────────
    const profitGoal: ProfitGoalSummary | "unavailable" = this.unavailableIfMissing(
      this.accountAsset,
      () => {
        const goal = this.accountAsset!.getProfitGoal(sellerId);
        if (goal == null) return "unavailable";
        evidence.push({
          source: "AccountAssetStore.profitGoal",
          sellerId,
          observation: `Profit goal: ${goal}`,
        });
        return { value: goal };
      },
    );

    // ── Risks ──────────────────────────────────────────────────────
    const risks: AccountRisk[] | "unavailable" = this.unavailableIfMissing(
      this.accountAsset,
      () => {
        const r = this.accountAsset!.getRisks(sellerId);
        evidence.push({
          source: "AccountAssetStore.risks",
          sellerId,
          observation: `${r.length} risks loaded`,
        });
        return r;
      },
    );

    // ── Opportunities ──────────────────────────────────────────────
    const opportunities: AccountOpportunity[] | "unavailable" = this.unavailableIfMissing(
      this.accountAsset,
      () => {
        const o = this.accountAsset!.getOpportunities(sellerId);
        evidence.push({
          source: "AccountAssetStore.opportunities",
          sellerId,
          observation: `${o.length} opportunities loaded`,
        });
        return o;
      },
    );

    // ── Strategy ───────────────────────────────────────────────────
    const strategy: (AccountStrategy & { sellerId?: string })[] | "unavailable" =
      this.unavailableIfMissing(this.accountAsset, () => {
        const notes = this.accountAsset!.getStrategyNotes(sellerId);
        const globalNotes = notes.filter((n) => n.sellerId === undefined);
        const sellerNotes = notes.filter((n) => n.sellerId === sellerId);
        evidence.push({
          source: "AccountAssetStore.strategy",
          sellerId,
          observation: `${sellerNotes.length} account-specific, ${globalNotes.length} global strategies`,
        });
        return notes;
      });

    // ── Agent activity ─────────────────────────────────────────────
    const includeLessons = options.includeLessons !== false;
    const agentActivity: AgentActivitySummary | "unavailable" = this.unavailableIfMissing(
      this.sessionStore,
      () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const since: string = options.since ?? today.toISOString();
        const shift = this.sessionStore!.summarizeShift(sellerId, since);

        const agentIds: string[] = [];
        for (const sid of shift.completedSessionIds.slice(0, 10)) {
          const s = this.sessionStore!.getSession(sid, sellerId);
          if (s) agentIds.push(s.agentId);
        }

        const obsSummary: Record<string, number> = {};
        for (const [kind, count] of Object.entries(shift.observationCounts)) {
          if (count > 0) obsSummary[kind] = count;
        }

        const recentLessons: string[] = [];
        if (includeLessons && agentIds.length > 0) {
          const firstAgentId = agentIds[0];
          if (firstAgentId) {
            const lessons = this.sessionStore!.listRecentLessons(sellerId, firstAgentId, 5);
            for (const l of lessons) {
              if (l.transferable) recentLessons.push(l.lesson);
            }
          }
        }

        evidence.push({
          source: "AgentWorkSessionStore",
          sellerId,
          observation: `${shift.sessionCount} sessions, ${shift.proposalCount} proposals, ${shift.lessonCount} lessons`,
        });

        return {
          sessionsToday: shift.sessionCount,
          status: shift.sessionCount > 0 ? "active" : "idle",
          agentIds: [...new Set(agentIds)],
          ...(Object.keys(obsSummary).length > 0 ? { observations: obsSummary } : {}),
          proposals: shift.proposalCount,
          lessons: includeLessons ? shift.lessonCount : 0,
          ...(recentLessons.length > 0 ? { recentLessons } : {}),
        };
      },
    );

    // ── Pending approvals ──────────────────────────────────────────
    const includeApprovals = options.includePendingApprovals !== false;
    const pendingApprovals: ApprovalSummary[] | "unavailable" = includeApprovals
      ? this.unavailableIfMissing(this.ceoInbox, () => {
          const pending = this.ceoInbox!.getBySellerId(sellerId).filter(
            (p) => p.status === "pending" || p.status === "routed",
          );
          evidence.push({
            source: "CeoInboxStore",
            sellerId,
            observation: `${pending.length} pending approvals`,
          });
          return pending.map((p) => ({
            proposalId: p.proposal_id,
            senderAgentId: p.sender_agent_id,
            proposalType: p.proposal_type,
            riskLevel: p.risk_level,
            status: p.status,
            summary: p.normalized_summary || p.proposal_type,
            createdAt: p.created_at,
          }));
        })
      : "unavailable";

    // ── Cost and cache ─────────────────────────────────────────────
    const includeCosts = options.includeCosts !== false;
    const costAndCache: CostCacheSummary | "unavailable" = includeCosts
      ? this.unavailableIfMissing(this.costLedger, () => {
          const byAgent = this.costLedger!.aggregateCostByAgentAndSeller?.(sellerId);
          const cacheEff = this.costLedger!.aggregateCacheEfficiencyBySeller?.(sellerId) ?? 0;

          const perAgent: Record<string, { costMicros: number; entries: number }> = {};
          let totalCost = 0;
          if (byAgent) {
            for (const [agentId, ag] of byAgent) {
              perAgent[agentId] = {
                costMicros: ag.costMicros,
                entries: ag.entries,
              };
              totalCost += ag.costMicros;
            }
          }

          evidence.push({
            source: "WorkforceCostCacheLedgerStore",
            sellerId,
            observation: `Total cost: ${totalCost} micros, cache efficiency: ${(cacheEff * 100).toFixed(0)}%`,
          });

          return {
            perAgent: Object.keys(perAgent).length > 0 ? perAgent : "unavailable",
            cacheEfficiency: cacheEff,
            totalEstimatedCostMicros: totalCost,
          };
        })
      : "unavailable";

    // ── Cortex ─────────────────────────────────────────────────────
    const includeCortex = options.includeCortex !== false;
    const cortexResult: CortexSummary | "unavailable" = includeCortex
      ? this.unavailableIfMissing(this.cortex, () => {
          const sellerNodes = this.cortex!.getNodesBySeller(sellerId);
          const hasAccountNode = sellerNodes.some((n) => n.label.startsWith("account_asset:"));

          // Query for global nodes (no seller filter) as recent memory
          let globalNodes: Array<{ label: string }> = [];
          try {
            globalNodes = this.cortex!.queryByMetadata({ limit: 5 }).filter(
              (n) => !n.metadata.sellerId,
            );
          } catch {
            // queryByMetadata returns [] on error already, but double-wrap for safety
          }

          evidence.push({
            source: "Cortex",
            sellerId,
            observation: `${sellerNodes.length} seller-scoped nodes, account node: ${hasAccountNode}`,
          });

          return {
            nodeCount: sellerNodes.length,
            hasAccountNode,
            recentGlobalNodes: globalNodes.map((n) => n.label),
          };
        })
      : "unavailable";

    // ── Confidence ─────────────────────────────────────────────────
    let confidence: "high" | "medium" | "low" = "high";
    if (health === "unavailable" && capabilities === "unavailable") {
      confidence = "low";
    } else if (
      health === "unavailable" ||
      capabilities === "unavailable" ||
      agentActivity === "unavailable"
    ) {
      confidence = "medium";
    }

    // ── Recommended focus ──────────────────────────────────────────
    const recommendedFocus: string[] = [];

    if (health !== "unavailable") {
      const h = health;
      if (h.currentStatus === "critical" || h.currentStatus === "at-risk") {
        recommendedFocus.push(`Health is ${h.currentStatus} — prioritize recovery actions.`);
      }
    }

    if (risks !== "unavailable") {
      const criticalRisks = risks.filter((r) => r.severity === "critical");
      for (const r of criticalRisks.slice(0, 3)) {
        recommendedFocus.push(
          `Critical risk: ${r.risk}${r.mitigation ? ` (mitigation: ${r.mitigation})` : ""}`,
        );
      }
    }

    if (opportunities !== "unavailable") {
      const highConfidenceOpps = opportunities.filter((o) => (o.confidence ?? 0) >= 0.7);
      for (const o of highConfidenceOpps.slice(0, 3)) {
        recommendedFocus.push(
          `High-confidence opportunity: ${o.opportunity} (impact: ${o.estimatedImpact}, confidence: ${((o.confidence ?? 0) * 100).toFixed(0)}%)`,
        );
      }
    }

    if (recommendedFocus.length === 0) {
      recommendedFocus.push("No critical items — account operating normally.");
    }

    return {
      sellerId,
      status: "active",
      health,
      capabilities,
      profitGoal,
      risks,
      opportunities,
      strategy,
      agentActivity,
      pendingApprovals,
      costAndCache,
      cortex: cortexResult,
      recommendedFocus,
      confidence,
      evidence,
      noMutationExecuted: true,
    };
  }

  // ── compareAccountAssets ────────────────────────────────────────────

  compareAccountAssets(input: CompareAccountAssetsInput): AccountAssetComparison {
    const evidence: EvidenceRow[] = [];

    // Resolve candidates
    let candidateIds = input.candidateSellerIds;
    if (!candidateIds || candidateIds.length === 0) {
      try {
        candidateIds = this.accountAsset?.listActive().map((a) => a.sellerId) ?? [];
      } catch {
        candidateIds = [];
      }
    }

    if (candidateIds.length === 0) {
      return {
        recommendedSellerId: null,
        confidence: "low",
        ranking: [],
        decisionLogic: "No candidate sellers available to compare.",
        evidence: [
          {
            source: "AccountBrainService",
            observation: "No candidates.",
          },
        ],
        suggestedNextAction: {
          kind: "collect_more_evidence",
          description: "Register active accounts in AccountAssetStore first.",
          requiresApproval: true,
        },
        noMutationExecuted: true,
      };
    }

    // Gather brain status per candidate
    const statuses: Map<string, AccountBrainStatus> = new Map();
    for (const sid of candidateIds) {
      const status = this.getAccountBrainStatus(sid, { sellerId: sid });
      statuses.set(sid, status);
      evidence.push(...status.evidence);
    }

    // Build weights with goal adjustment
    const goal = input.goal || undefined;
    const weights = cloneWeights(DEFAULT_WEIGHTS);
    if (goal) {
      const adj = GOAL_WEIGHT_ADJUSTMENTS[goal] ?? {};
      for (const key of Object.keys(weights) as (keyof ScoringWeights)[]) {
        const multiplier = adj[key];
        if (multiplier !== undefined) {
          weights[key] = weights[key] * multiplier;
        }
      }
    }

    // Score each candidate
    const rankings: RankingEntry[] = [];
    for (const sid of candidateIds) {
      const status = statuses.get(sid);
      if (!status) continue;
      const score = this.computeScore(status, weights);
      const entry = this.buildRankingEntry(sid, status, score);
      rankings.push(entry);
    }

    // Sort descending
    rankings.sort((a, b) => b.score - a.score);

    // Determine confidence
    let confidence: "high" | "medium" | "low" = "high";
    const decisionLogicParts: string[] = [];

    if (rankings.length >= 2) {
      const firstRank = rankings[0];
      const secondRank = rankings[1];
      if (!firstRank || !secondRank) {
        confidence = "low";
        decisionLogicParts.push("Ranking data incomplete.");
      } else {
        const delta = firstRank.score - secondRank.score;
        if (delta < 5) {
          confidence = "low";
          decisionLogicParts.push(
            `Score delta ${delta.toFixed(1)} < 5 — insufficient differentiation.`,
          );
        } else if (delta < 15) {
          confidence = "medium";
          decisionLogicParts.push(`Score delta ${delta.toFixed(1)} (medium confidence).`);
        } else {
          decisionLogicParts.push(`Clear winner with delta ${delta.toFixed(1)}.`);
        }
      }
    } else {
      confidence = "low";
      decisionLogicParts.push("Only one candidate — insufficient for comparison.");
    }

    // Describe decision logic
    decisionLogicParts.push(
      [
        `Weighted factors: capabilityMatch=${weights.capabilityMatch.toFixed(2)}`,
        `health=${weights.health.toFixed(2)}`,
        `risk=${weights.risk.toFixed(2)}`,
        `profitGoal=${weights.profitGoal.toFixed(2)}`,
        `opportunityFit=${weights.opportunityFit.toFixed(2)}`,
        `costLoad=${weights.costLoad.toFixed(2)}`,
      ].join(", "),
    );
    if (goal) {
      decisionLogicParts.push(`Goal-driven adjustment: ${goal}`);
    }

    const recommendedSellerId = rankings.length > 0 ? (rankings[0]?.sellerId ?? null) : null;

    const suggestedNextAction: SuggestedNextAction =
      confidence === "low"
        ? {
            kind: "collect_more_evidence",
            description:
              "Scores too close or data insufficient. Review per-account details manually.",
            requiresApproval: true,
          }
        : {
            kind: "recommend_account",
            description: `Recommend "${recommendedSellerId}" for this product/opportunity. Requires CEO approval before any ML action.`,
            requiresApproval: true,
          };

    return {
      recommendedSellerId,
      confidence,
      ranking: rankings,
      decisionLogic: decisionLogicParts.join(" "),
      evidence,
      suggestedNextAction,
      noMutationExecuted: true,
    };
  }

  // ── Scoring ──────────────────────────────────────────────────────────

  private computeScore(status: AccountBrainStatus, weights: ScoringWeights): number {
    let capabilityScore = 0;
    if (Array.isArray(status.capabilities)) {
      const activeCaps = status.capabilities.filter((c) => c.status === "active").length;
      const totalCaps = status.capabilities.length;
      capabilityScore = totalCaps > 0 ? (activeCaps / totalCaps) * 100 : 50;
    }

    let healthScoreVal = 0;
    if (status.health !== "unavailable") {
      const h = status.health;
      healthScoreVal = healthScore(h.currentStatus);
    }

    let riskScore = 0;
    if (Array.isArray(status.risks)) {
      const r = status.risks;
      // Invert: high risk count = low score
      const weightedSeverity = r.reduce(
        (sum, r) =>
          sum +
          (r.severity === "critical"
            ? 40
            : r.severity === "high"
              ? 25
              : r.severity === "medium"
                ? 10
                : 2),
        0,
      );
      riskScore = Math.max(0, 100 - weightedSeverity);
    } else {
      riskScore = 50;
    }

    let profitScore = 0;
    if (status.profitGoal !== "unavailable") {
      const pg = status.profitGoal;
      profitScore = Math.min(100, pg.value);
    }

    let opportunityScore = 0;
    if (Array.isArray(status.opportunities)) {
      const opps = status.opportunities;
      if (opps.length > 0) {
        const avgConfidence = opps.reduce((sum, o) => sum + (o.confidence ?? 0.5), 0) / opps.length;
        opportunityScore = Math.min(100, avgConfidence * 100);
      }
    }

    let costScore = 100;
    if (status.costAndCache !== "unavailable") {
      const cc = status.costAndCache;
      if (cc.totalEstimatedCostMicros !== "unavailable") {
        costScore = Math.max(0, 100 - cc.totalEstimatedCostMicros / 10_000);
      }
    }

    const totalWeight =
      weights.capabilityMatch +
      weights.health +
      weights.risk +
      weights.profitGoal +
      weights.opportunityFit +
      weights.costLoad;

    const weightedSum =
      capabilityScore * weights.capabilityMatch +
      healthScoreVal * weights.health +
      riskScore * weights.risk +
      profitScore * weights.profitGoal +
      opportunityScore * weights.opportunityFit +
      costScore * weights.costLoad;

    return totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 10) / 10 : 50;
  }

  private buildRankingEntry(
    sellerId: string,
    status: AccountBrainStatus,
    score: number,
  ): RankingEntry {
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const missingCapabilities: string[] = [];

    if (status.health !== "unavailable") {
      const h = status.health;
      if (h.currentStatus === "healthy") strengths.push("Healthy account");
      else if (h.currentStatus === "critical") weaknesses.push("Health is critical");
      else if (h.currentStatus === "at-risk") weaknesses.push("Health is at-risk");
    }

    if (Array.isArray(status.risks)) {
      const criticalRisks = status.risks.filter((r) => r.severity === "critical");
      if (criticalRisks.length > 0) {
        weaknesses.push(`${criticalRisks.length} critical risk(s)`);
      } else if (status.risks.length === 0) {
        strengths.push("No active risks");
      }
    }

    if (Array.isArray(status.capabilities)) {
      const caps = status.capabilities;
      const missing = caps.filter((c) => c.status === "missing");
      if (missing.length > 0) {
        for (const m of missing) missingCapabilities.push(m.kind);
      }
      const activeCaps = caps.filter((c) => c.status === "active");
      strengths.push(`${activeCaps.length}/${caps.length} active capabilities`);
    }

    if (status.opportunities !== "unavailable") {
      const opps = status.opportunities;
      if (opps.length > 0) {
        strengths.push(`${opps.length} opportunities detected`);
      }
    }

    return {
      sellerId,
      score,
      capabilities: Array.isArray(status.capabilities) ? status.capabilities : [],
      health: status.health,
      risks: Array.isArray(status.risks) ? status.risks : [],
      opportunities: Array.isArray(status.opportunities) ? status.opportunities : [],
      profitGoal: status.profitGoal,
      costLoad: status.costAndCache,
      ...(missingCapabilities.length > 0 ? { missingCapabilities } : {}),
      strengths,
      weaknesses,
    };
  }
}
