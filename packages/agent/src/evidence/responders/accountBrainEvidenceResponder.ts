import type {
  ConfidenceLevel,
  EvidenceRequestPayload,
  EvidenceResponsePayload,
  EvidenceTargetAgentId,
} from "@msl/domain";
import type { EvidenceResponder } from "../evidenceResponseRouter.js";

// ── Fake transport contract ───────────────────────────────────────────

export type AccountRankingEntry = {
  sellerId: string;
  accountName: string;
  reputationScore: number;
  channelFitScore: number;
  claimHistoryScore: number;
};

/** Minimal fake transport slice used by the account-brain responder. */
export type AccountBrainTransport = {
  /** Rank accounts by channel fit for a given product/projection. */
  rankAccounts(productName?: string, category?: string): AccountRankingEntry[];
  /** Get decision logic used for the ranking. */
  getDecisionLogic(): string;
};

// ── Responder ─────────────────────────────────────────────────────────

/**
 * Answers evidence requests of kind `account-channel-fit` and `claim-support`
 * by querying a fake reputation/channel transport. Returns recommended
 * sellers based on channel fit and claim history. Read-only — never mixes accounts.
 */
export class AccountBrainEvidenceResponder implements EvidenceResponder {
  readonly agentId: EvidenceTargetAgentId = "account-brain";

  private readonly transport: AccountBrainTransport;

  constructor(transport: AccountBrainTransport) {
    this.transport = transport;
  }

  canHandle(request: EvidenceRequestPayload): boolean {
    return request.kind === "account-channel-fit" || request.kind === "claim-support";
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async answer(request: EvidenceRequestPayload): Promise<EvidenceResponsePayload> {
    const ranking = this.transport.rankAccounts(request.productName, request.category);
    const decisionLogic = this.transport.getDecisionLogic();

    const hasData = ranking.length > 0;

    if (!hasData) {
      return {
        type: "evidence-response",
        responseId: `er-${request.requestId}-${Date.now()}`,
        requestId: request.requestId,
        correlationId: request.correlationId,
        sourceAgentId: this.agentId,
        targetAgentId: request.sourceAgentId,
        ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
        ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
        status: "answered",
        answer: "No account ranking data available for the given criteria.",
        structuredEvidence: { ranking: [], decisionLogic },
        evidenceIds: [],
        confidence: "low",
        blockers: ["No account data available for channel-fit analysis."],
        warnings: [],
        createdAt: new Date().toISOString(),
        noMutationExecuted: true,
      };
    }

    const topAccount = ranking[0]!;
    const recommendedSellerId = topAccount.sellerId;
    const recommendedAccountName = topAccount.accountName;

    const confidence = this.computeConfidence(ranking);

    const structuredEvidence: Readonly<Record<string, unknown>> = {
      recommendedSellerId,
      recommendedAccountName,
      ranking: ranking.map((r) => ({
        sellerId: r.sellerId,
        accountName: r.accountName,
        reputationScore: r.reputationScore,
        channelFitScore: r.channelFitScore,
        claimHistoryScore: r.claimHistoryScore,
      })),
      decisionLogic,
    };

    return {
      type: "evidence-response",
      responseId: `er-${request.requestId}-${Date.now()}`,
      requestId: request.requestId,
      correlationId: request.correlationId,
      sourceAgentId: this.agentId,
      targetAgentId: request.sourceAgentId,
      ...(request.sellerId !== undefined ? { sellerId: request.sellerId } : {}),
      ...(request.candidateId !== undefined ? { candidateId: request.candidateId } : {}),
      status: "answered",
      answer:
        request.kind === "claim-support"
          ? `Recommended account for claim support: ${recommendedAccountName} (${recommendedSellerId}). ` +
            `Claim history score: ${topAccount.claimHistoryScore}.`
          : `Best channel fit: ${recommendedAccountName} (${recommendedSellerId}). ` +
            `Channel fit score: ${topAccount.channelFitScore}.`,
      structuredEvidence,
      evidenceIds: [`ev-account-${request.requestId}`],
      confidence,
      blockers: [],
      warnings:
        ranking.length < 2 ? ["Only one account available for comparison — limited context."] : [],
      createdAt: new Date().toISOString(),
      noMutationExecuted: true,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private computeConfidence(ranking: AccountRankingEntry[]): ConfidenceLevel {
    if (ranking.length === 0) return "low";
    const top = ranking[0]!;
    const score = (top.reputationScore + top.channelFitScore + top.claimHistoryScore) / 3;
    if (score >= 80) return "high";
    if (score >= 50) return "medium";
    return "low";
  }
}
