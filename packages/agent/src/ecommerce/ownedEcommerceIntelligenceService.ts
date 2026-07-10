import type { StorefrontCandidate, SupplierWebSignalPayload } from "@msl/domain";
import type { GraphEngine, OwnedEcommerceStore, EvidenceRequestStore } from "@msl/memory";
import { isValidSupplierWebSignal } from "@msl/domain";
import type { Logger } from "../conversation/observability.js";
import type { AccountBrainService } from "../conversation/accountBrainService.js";
import type { CreativeJobQueueStore } from "../conversation/creativeJobQueueStore.js";
import type { DeepSeekTransport } from "../conversation/transports/deepseekTransport.js";
import { OwnedEcommerceCortexReasoner } from "./ownedEcommerceCortexReasoner.js";
import { scoreCandidate, type ChannelComparisonInput } from "./storefrontCandidateScorer.js";
import {
  buildProjection,
  type ScoredCandidate,
  type StorefrontProjectionPreparation,
  type DeepSeekEnrichment,
} from "./storefrontProjectionBuilder.js";
import type { StorefrontCandidateScore } from "@msl/domain";
import crypto from "node:crypto";
import { OwnedEcommerceMerchandisingAdvisor } from "./ownedEcommerceMerchandisingAdvisor.js";
import { validate as validateAdvisorOutput } from "./merchandisingAdvisorValidator.js";
import type { OwnedEcommerceEvidenceAggregator } from "./ownedEcommerceEvidenceAggregator.js";

// ── Public types ─────────────────────────────────────────────────────

/** Constructor dependencies — every field is optional. */
export type OwnedEcommerceIntelligenceDeps = {
  cortex?: GraphEngine;
  reasoner?: OwnedEcommerceCortexReasoner;
  accountBrainService?: AccountBrainService;
  deepSeekTransport?: DeepSeekTransport;
  creativeJobQueueStore?: CreativeJobQueueStore;
  ownedEcommerceStore?: OwnedEcommerceStore;
  evidenceRequestStore?: EvidenceRequestStore;
  evidenceAggregator?: OwnedEcommerceEvidenceAggregator;
  logger?: Logger;
};

/** Result envelope returned by every intelligence method. */
export type IntelligenceResult = {
  candidates: StorefrontCandidate[];
  scores: Record<string, StorefrontCandidateScore>;
  projection?: StorefrontProjectionPreparation | undefined;
  cortexUnavailable?: boolean | undefined;
  errors: string[];
  noMutationExecuted: true;
};

// ── Service ──────────────────────────────────────────────────────────

/**
 * Central intelligence pipeline for owned-ecommerce operations.
 *
 * Composes Cortex reasoning → deterministic scoring → optional
 * AccountBrain channel comparison → optional DeepSeek SEO/GEO →
 * projection assembly.  Every optional dependency degrades gracefully:
 * absent → skip that step (never fail).
 */
export class OwnedEcommerceIntelligenceService {
  private readonly cortex: GraphEngine | undefined;
  private readonly reasoner: OwnedEcommerceCortexReasoner;
  private readonly accountBrainService: AccountBrainService | undefined;
  private readonly deepSeekTransport: DeepSeekTransport | undefined;
  private readonly creativeJobQueueStore: CreativeJobQueueStore | undefined;
  private readonly ownedEcommerceStore: OwnedEcommerceStore | undefined;
  private readonly evidenceRequestStore: EvidenceRequestStore | undefined;
  private readonly evidenceAggregator: OwnedEcommerceEvidenceAggregator | undefined;
  private readonly log: Logger | undefined;

  constructor(deps: OwnedEcommerceIntelligenceDeps = {}) {
    this.cortex = deps.cortex;
    this.reasoner = deps.reasoner ?? new OwnedEcommerceCortexReasoner();
    this.accountBrainService = deps.accountBrainService;
    this.deepSeekTransport = deps.deepSeekTransport;
    this.creativeJobQueueStore = deps.creativeJobQueueStore;
    this.ownedEcommerceStore = deps.ownedEcommerceStore;
    this.evidenceRequestStore = deps.evidenceRequestStore;
    this.evidenceAggregator = deps.evidenceAggregator;
    this.log = deps.logger;
  }

  // ── prepareFromSupplierWebSignal ───────────────────────────────

  /**
   * Process a `SupplierWebSignalPayload` through the full intelligence
   * pipeline and return buffered results.
   *
   * **Pipeline**:
   * 1. Validate the signal.
   * 2. If Cortex is available → run `reasoner.findSupplierProductContext`.
   *    If Cortex is unavailable → return `{ cortexUnavailable, candidates: [] }`.
   * 3. Build `StorefrontCandidate`(s) with provenance.
   * 4. Score each candidate.
   * 5. Optionally: AccountBrain channel comparison.
   * 6. Optionally: DeepSeek SEO/GEO enrichment.
   * 7. Optionally: Build projection.
   *
   * @param signal — Incoming supplier-web-signal from the message bus.
   * @param sellerId — Optional seller scope for Cortex isolation.
   * @returns `IntelligenceResult` with `noMutationExecuted: true`.
   */
  async prepareFromSupplierWebSignal(
    signal: SupplierWebSignalPayload,
    sellerId?: string,
  ): Promise<IntelligenceResult> {
    const errors: string[] = [];

    // 1. Validate
    if (!isValidSupplierWebSignal(signal)) {
      return {
        candidates: [],
        scores: {},
        errors: ["Invalid SupplierWebSignalPayload"],
        noMutationExecuted: true,
      };
    }

    // 2. Cortex query
    if (!this.cortex) {
      this.log?.warn("Cortex unavailable — returning degraded result", {
        signalKind: signal.signalKind,
        supplierId: signal.supplierId,
      });
      const result: IntelligenceResult = {
        candidates: [],
        scores: {},
        errors: [],
        noMutationExecuted: true,
      };
      result.cortexUnavailable = true;
      return result;
    }

    const cortex = this.cortex;
    let context;
    try {
      context = this.reasoner.findSupplierProductContext(
        cortex,
        signal.supplierId,
        signal.supplierItemId,
        sellerId,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log?.error("Cortex query failed", err instanceof Error ? err : undefined, {
        supplierId: signal.supplierId,
        supplierItemId: signal.supplierItemId,
      });
      const result: IntelligenceResult = {
        candidates: [],
        scores: {},
        errors: [`Cortex query failed: ${msg}`],
        noMutationExecuted: true,
      };
      result.cortexUnavailable = true;
      return result;
    }

    // 3. Build candidates with provenance
    const provenance = this.reasoner.buildCandidateProvenance(context);

    const candidate: StorefrontCandidate = {
      id: crypto.randomUUID(),
      itemRef: `supplier:${signal.supplierId}:${signal.supplierItemId}`,
      title: `Supplier product ${signal.supplierItemId} from ${signal.supplierId}`,
      provenance,
      evidenceIds: provenance.evidenceIds,
      evidenceState: {
        stockFreshness: "unknown",
        marginFreshness: "unknown",
        supplierFreshness: "fresh",
        completeness: "partial",
        evidenceIds: provenance.evidenceIds,
      },
      stock: {
        status: "unknown",
        authority: "unknown",
      },
      blockedReasons: [],
      redactedReasons: [],
      createdAt: new Date().toISOString(),
    };

    const candidates = [candidate];

    // 4. AccountBrain channel comparison (F1)
    let channelComparison: ChannelComparisonInput | undefined;
    if (this.accountBrainService) {
      try {
        const candidateSellers: string[] = [];
        if (sellerId) candidateSellers.push(sellerId);
        if (signal.affectedSellerIds) {
          for (const id of signal.affectedSellerIds) {
            if (!candidateSellers.includes(id)) candidateSellers.push(id);
          }
        }
        if (candidateSellers.length > 0) {
          const comparison = this.accountBrainService.compareAccountAssets({
            candidateSellerIds: candidateSellers,
            opportunity: `Supplier product ${signal.supplierItemId} from ${signal.supplierId}`,
          });
          channelComparison = {
            recommendedSellerId: comparison.recommendedSellerId,
            confidence: comparison.confidence,
          };
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.log?.warn("AccountBrain comparison failed — channel recommendation skipped", {
          error: errorMsg,
        });
        // Degrade gracefully — scorer runs without channel comparison
      }
    } else {
      // No AccountBrain available — skip channel recommendation
      channelComparison = undefined;
    }

    // 5. Score (with optional channel comparison)
    const scores: Record<string, StorefrontCandidateScore> = {};
    for (const c of candidates) {
      try {
        scores[c.id] = scoreCandidate(c, channelComparison);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log?.error("Scoring failed for candidate", err instanceof Error ? err : undefined, {
          candidateId: c.id,
        });
        errors.push(`Scoring failed for candidate ${c.id}: ${msg}`);
      }
    }

    // 5b. Check for outstanding evidence and mark candidates
    if (this.evidenceAggregator) {
      for (const c of candidates) {
        try {
          const readiness = await this.evidenceAggregator.checkReadiness(c.id);
          if (readiness === "waiting_for_evidence" || readiness === "blocked") {
            // Mark candidate as waiting for evidence
            if (!c.blockedReasons.includes("incomplete-evidence" as never)) {
              c.blockedReasons = [...c.blockedReasons, "incomplete-evidence" as never];
            }
            this.log?.info(
              "OwnedEcommerceIntelligenceService: candidate marked waiting_for_evidence",
              { candidateId: c.id, readiness },
            );
          }
        } catch {
          // Evidence check is best-effort
        }
      }
    }

    // 6. Creative delegation (F2)
    let creativeRequestId: string | undefined;
    for (const c of candidates) {
      const s = scores[c.id];
      if (s?.recommendedAction === "request-creative-assets") {
        if (this.creativeJobQueueStore && sellerId) {
          try {
            // 24-hour dedup: include date in jobId so same candidate only
            // creates one request per day
            const dateKey = new Date().toISOString().slice(0, 10);
            const jobId = `creative:ecommerce:${c.id}:${dateKey}`;
            this.creativeJobQueueStore.createJob({
              jobId,
              requestId: crypto.randomUUID(),
              sellerId,
              kind: "storefront-hero",
              channel: "storefront",
              estimatedCostUsd: 0,
              payloadJson: JSON.stringify({
                candidateId: c.id,
                itemRef: c.itemRef,
                title: c.title,
                noMutationExecuted: true,
              }),
            });
            creativeRequestId = jobId;
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.log?.warn("Creative job enqueue failed — marking missingMedia without request", {
              error: errorMsg,
            });
            // Degrade gracefully — missingMedia recorded without creative request
          }
        }
        // If creativeJobQueueStore absent → skip, missingMedia recorded without request
      }
    }

    // 7. DeepSeek merchandising advisor — gated by feature flag and transport
    let deepSeekEnrichment: DeepSeekEnrichment | undefined;

    const advisorEnabled = process.env.MSL_OWNED_ECOMMERCE_ADVISOR_ENABLED === "true";
    if (advisorEnabled && this.deepSeekTransport) {
      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: this.deepSeekTransport,
        ...(this.log !== undefined ? { logger: this.log } : {}),
        ...(sellerId !== undefined ? { sellerId } : {}),
      });

      this.log?.info("[owned-ecommerce] DeepSeek advisor enabled — enriching candidates", {
        candidateCount: candidates.length,
        sellerId: sellerId ?? "unknown",
      });

      for (const c of candidates) {
        const score = scores[c.id];
        if (!score) continue;

        // Skip blocked candidates — advisor does NOT unblock them
        if (score.blockers.length > 0) {
          this.log?.info("Skipping advisor for blocked candidate", { candidateId: c.id });
          continue;
        }

        try {
          const seoResult = await advisor.draftSeoGeoCopy(c);
          const tradeoffResult = await advisor.explainChannelTradeoffs(c);

          // Validate both results through the pure-function validator
          const seoValidation = validateAdvisorOutput(seoResult);
          const tradeoffValidation = validateAdvisorOutput(tradeoffResult);

          // Build DeepSeekEnrichment from validated advisor output
          // Use conditional spreads to satisfy exactOptionalPropertyTypes
          const seoSug = seoValidation.sanitizedResult.seoSuggestions;
          const geoSug = seoValidation.sanitizedResult.geoSuggestions;
          deepSeekEnrichment = {
            ...(seoSug.seoTitle !== undefined ? { seoTitle: seoSug.seoTitle } : {}),
            ...(seoSug.seoDescription !== undefined
              ? { seoDescription: seoSug.seoDescription }
              : {}),
            ...(seoSug.keywords !== undefined ? { keywords: seoSug.keywords } : {}),
            ...(geoSug.geoSummary !== undefined ? { geoSummary: geoSug.geoSummary } : {}),
            ...(geoSug.faq !== undefined ? { faq: geoSug.faq } : {}),
          };

          if (!seoValidation.usable || !tradeoffValidation.usable) {
            this.log?.warn(
              "Advisor output partially blocked by validator — using sanitized enrichment",
              {
                candidateId: c.id,
                blockedClaimCount:
                  seoValidation.blockedClaims.length + tradeoffValidation.blockedClaims.length,
              },
            );
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.log?.warn("Advisor call failed — degrading gracefully, enrichment skipped", {
            candidateId: c.id,
            error: errorMsg,
          });
          // Degrade gracefully — enrichment stays undefined for this candidate
        }
      }
    } else {
      if (!advisorEnabled) {
        this.log?.info("[owned-ecommerce] DeepSeek advisor disabled — step 7 skipped");
      } else {
        this.log?.info("[owned-ecommerce] DeepSeek transport absent — step 7 skipped");
      }
    }

    // 8. Build projection
    let projection: StorefrontProjectionPreparation | undefined;
    const scoredCandidates: ScoredCandidate[] = [];
    for (const c of candidates) {
      const score = scores[c.id];
      if (score) {
        scoredCandidates.push({ candidate: c, score });
      }
    }

    if (scoredCandidates.length > 0) {
      try {
        projection = buildProjection(scoredCandidates, deepSeekEnrichment);
        // Inject creative request ref into projection media
        if (projection.media.missingImages && creativeRequestId) {
          projection.media.creativeRequestId = creativeRequestId;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log?.error("Projection build failed", err instanceof Error ? err : undefined, {});
        errors.push(`Projection build failed: ${msg}`);
      }
    }

    const result: IntelligenceResult = {
      candidates,
      scores,
      errors,
      noMutationExecuted: true,
    };
    if (projection !== undefined) {
      result.projection = projection;
    }
    return result;
  }

  // ── discoverStorefrontCandidates ───────────────────────────────

  /**
   * Discover storefront candidates by spreading activation from supplier
   * seed nodes in Cortex.  No hardcoded rules — purely Cortex-driven.
   *
   * When Cortex is unavailable, returns `{ cortexUnavailable, candidates: [] }`.
   *
   * @param sellerId — Optional seller scope.
   * @returns `IntelligenceResult` with `noMutationExecuted: true`.
   */
  discoverStorefrontCandidates(sellerId?: string): IntelligenceResult {
    if (!this.cortex) {
      const result: IntelligenceResult = {
        candidates: [],
        scores: {},
        errors: [],
        noMutationExecuted: true,
      };
      result.cortexUnavailable = true;
      return result;
    }

    const cortex = this.cortex;

    try {
      // Find supplier seed nodes in Cortex
      const supplierNodes = cortex.queryByMetadata({
        type: "supplier",
        ...(sellerId ? { sellerId } : {}),
        limit: 20,
      });

      if (supplierNodes.length === 0) {
        return {
          candidates: [],
          scores: {},
          errors: [],
          noMutationExecuted: true,
        };
      }

      // Spread activation from all supplier nodes
      const nodeIds = supplierNodes.map((n) => n.id);
      const spread = cortex.spreadActivation(nodeIds, {
        maxDepth: 3,
        activationThreshold: 0.01,
        decayFactor: 0.5,
        ...(sellerId ? { sellerId } : {}),
      });

      // Build candidates from activated product nodes
      const candidates: StorefrontCandidate[] = [];

      for (const activated of spread.activatedNodes) {
        if (activated.activation < 0.05) continue; // Skip weak activations

        const cand: StorefrontCandidate = {
          id: crypto.randomUUID(),
          itemRef: `cortex-node:${activated.id}`,
          title: activated.label,
          provenance: {
            source: "cortex",
            sourceId: `cortex:${activated.id}`,
            snapshotIds: [],
            cortexNodeIds: [String(activated.id)],
            evidenceIds: [`cortex-evidence:${activated.id}`],
          },
          evidenceIds: [`cortex-evidence:${activated.id}`],
          evidenceState: {
            stockFreshness: "unknown",
            marginFreshness: "unknown",
            supplierFreshness: "unknown",
            completeness: "partial",
            evidenceIds: [`cortex-evidence:${activated.id}`],
          },
          stock: {
            status: "unknown",
            authority: "unknown",
          },
          blockedReasons: [],
          redactedReasons: [],
          createdAt: new Date().toISOString(),
        };

        candidates.push(cand);
      }

      const scores: Record<string, StorefrontCandidateScore> = {};
      for (const c of candidates) {
        scores[c.id] = scoreCandidate(c);
      }

      const scoredCandidates: ScoredCandidate[] = [];
      for (const c of candidates) {
        const score = scores[c.id];
        if (score) {
          scoredCandidates.push({ candidate: c, score });
        }
      }

      let projection: StorefrontProjectionPreparation | undefined;
      if (scoredCandidates.length > 0) {
        projection = buildProjection(scoredCandidates, undefined);
      }

      const result: IntelligenceResult = {
        candidates,
        scores,
        errors: [],
        noMutationExecuted: true,
      };
      if (projection !== undefined) {
        result.projection = projection;
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log?.error("Cortex discovery failed", err instanceof Error ? err : undefined);
      const result: IntelligenceResult = {
        candidates: [],
        scores: {},
        errors: [`Cortex discovery failed: ${msg}`],
        noMutationExecuted: true,
      };
      result.cortexUnavailable = true;
      return result;
    }
  }
}
