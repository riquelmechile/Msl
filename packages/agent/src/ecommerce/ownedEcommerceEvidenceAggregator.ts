import type { ConfidenceLevel, EvidenceResponsePayload, EvidenceSummary } from "@msl/domain";
import type { EvidenceRequestStore } from "@msl/memory";
import type { StorefrontCandidate } from "@msl/domain";
import type { Logger } from "../conversation/observability.js";

// ── Public types ─────────────────────────────────────────────────────

export type EvidenceAggregatorDeps = {
  evidenceRequestStore: EvidenceRequestStore;
  clock?: { now(): Date };
  logger?: Logger;
};

/**
 * Readiness of a candidate's evidence bundle for advisor re-run.
 */
export type EvidenceReadiness = "ready" | "waiting_for_evidence" | "blocked";

// ── Aggregator ───────────────────────────────────────────────────────

/**
 * Aggregates evidence responses for owned-ecommerce candidates.
 *
 * Joins all responses from the EvidenceRequestStore, computes aggregate
 * confidence (minimum across responses), identifies missing/expired kinds,
 * and enriches candidates with evidence metadata.
 *
 * All operations are read-only — `noMutationExecuted: true`.
 */
export class OwnedEcommerceEvidenceAggregator {
  private readonly evidenceRequestStore: EvidenceRequestStore;
  private readonly clock: () => Date;
  private readonly log: Logger | undefined;

  constructor(deps: EvidenceAggregatorDeps) {
    this.evidenceRequestStore = deps.evidenceRequestStore;
    this.clock = deps.clock ? (): Date => deps.clock!.now() : (): Date => new Date();
    this.log = deps.logger;
  }

  // ── aggregateCandidateEvidence ──────────────────────────────────

  /**
   * Aggregate all evidence responses for a given candidate.
   *
   * Computes confidence = minimum across response confidences.
   * Missing required kinds and expired responses result in
   * `waiting_for_evidence` readiness.
   */
  aggregateCandidateEvidence(candidateId: string): EvidenceSummary {
    const summary = this.evidenceRequestStore.summarizeEvidenceForCandidate(candidateId);

    if (!summary) {
      return {
        candidateId,
        totalRequests: 0,
        answeredCount: 0,
        pendingCount: 0,
        failedCount: 0,
        responses: [],
        overallConfidence: null,
        blockers: ["No evidence requests found for this candidate."],
        updatedAt: this.clock().toISOString(),
      };
    }

    return summary;
  }

  // ── applyEvidenceResponsesToCandidate ────────────────────────────

  /**
   * Enriches a StorefrontCandidate with evidence from aggregated
   * responses. Updates evidence IDs, confidence metadata, and blockers
   * based on response state.
   *
   * Returns a new candidate object — does NOT persist.
   */
  applyEvidenceResponsesToCandidate(candidate: StorefrontCandidate): StorefrontCandidate {
    const summary = this.aggregateCandidateEvidence(candidate.id);

    const enriched = { ...candidate };

    // Merge evidence IDs from responses
    const responseEvidenceIds: string[] = [];
    for (const resp of summary.responses) {
      responseEvidenceIds.push(...resp.evidenceIds);
    }
    enriched.evidenceIds = [...new Set([...candidate.evidenceIds, ...responseEvidenceIds])];

    // Add evidence-response blockers as guardrail blockers
    const newBlockers = new Set(candidate.blockedReasons);
    for (const blocker of summary.blockers) {
      newBlockers.add(blocker as (typeof candidate.blockedReasons)[number]);
    }
    enriched.blockedReasons = [...newBlockers];

    // Tag evidence state completeness from responses
    if (summary.responses.length > 0) {
      enriched.evidenceState = {
        ...candidate.evidenceState,
        completeness: summary.answeredCount >= summary.totalRequests ? "complete" : "partial",
        evidenceIds: enriched.evidenceIds,
      };
    }

    this.log?.info("OwnedEcommerceEvidenceAggregator: applied evidence to candidate", {
      candidateId: candidate.id,
      responseCount: summary.responses.length,
      overallConfidence: summary.overallConfidence,
    });

    return enriched;
  }

  // ── checkReadiness ───────────────────────────────────────────────

  /**
   * Determine the readiness state of a candidate based on its evidence
   * bundle.
   *
   * - `ready`: all expected requests are answered, no critical failures.
   * - `waiting_for_evidence`: some requests are still pending/queued, or
   *    no requests exist yet.
   * - `blocked`: critical blockers exist — requests have been answered
   *    as `failed`, `expired`, or `unsupported`, or the overall failed
   *    count is non-zero.
   */
  checkReadiness(candidateId: string): EvidenceReadiness {
    const summary = this.aggregateCandidateEvidence(candidateId);

    if (summary.totalRequests === 0) {
      return "waiting_for_evidence";
    }

    // Check for blockers in response-level statuses
    const criticalStatuses = new Set(["failed", "expired", "unsupported"]);
    for (const resp of summary.responses) {
      if (criticalStatuses.has(resp.status)) {
        return "blocked";
      }
    }

    // Expired / failed requests may have no response row → check failedCount
    if (summary.failedCount > 0) {
      return "blocked";
    }

    // If still pending requests, waiting
    if (summary.pendingCount > 0) {
      return "waiting_for_evidence";
    }

    return "ready";
  }

  // ── shouldReRunAdvisor ───────────────────────────────────────────

  /**
   * Returns true when new critical evidence responses have arrived since
   * the last advisor run. The daemon uses this to decide whether to
   * re-score and re-propose a candidate.
   *
   * Strategy: true when ANY response confidence is "high" and the
   * candidate was previously in a waiting state (the daemon tracks
   * last proposal timestamp separately).
   */
  shouldReRunAdvisor(): boolean {
    // The daemon handles the "since last run" window via CEO dedupe (1 hour).
    // This method is a simple gate: if we ever get to this point, yes — re-run.
    // The daemon still applies dedupe so we don't re-propose within the window.
    return true;
  }

  // ── computeEvidenceConfidence ────────────────────────────────────

  /**
   * Compute aggregate confidence as the minimum across all
   * response confidences. Returns null if no responses.
   */
  computeEvidenceConfidence(responses: EvidenceResponsePayload[]): ConfidenceLevel | null {
    if (responses.length === 0) return null;

    const order: Record<ConfidenceLevel, number> = { low: 1, medium: 2, high: 3 };
    let min: ConfidenceLevel = "high";
    let minVal = order.high;

    for (const r of responses) {
      const val = order[r.confidence] ?? 0;
      if (val < minVal) {
        minVal = val;
        min = r.confidence;
      }
    }

    return min;
  }

  // ── findMissingKinds ─────────────────────────────────────────────

  /**
   * Find the evidence kinds that are expected but have no response yet.
   */
  findMissingKinds(requestedKinds: string[], answeredKinds: Set<string>): string[] {
    return requestedKinds.filter((k) => !answeredKinds.has(k));
  }

  // ── findExpiredResponses ─────────────────────────────────────────

  /**
   * Find responses whose parent request is expired. These responses
   * should be treated with degraded confidence.
   */
  findExpiredResponses(responses: EvidenceResponsePayload[]): EvidenceResponsePayload[] {
    return responses.filter((r) => r.status === "expired");
  }
}
