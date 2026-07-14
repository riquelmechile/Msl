import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";
import type { EconomicLearningStore } from "@msl/memory";

// ── Helpers ────────────────────────────────────────────────────────────────

function safeLimit(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) return max;
  return Math.min(Math.floor(value), max);
}

// ── explain_economic_learning ──────────────────────────────────────────────

export function createExplainEconomicLearningTool(store?: EconomicLearningStore): ToolDefinition {
  return {
    name: "explain_economic_learning",
    description:
      "Explain the economic learning trajectory for a specific outcome. Returns eligibility, attributions, plans, events, and key findings. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        outcomeId: {
          type: "string",
          description: "Economic outcome ID to explain.",
        },
        sellerId: {
          type: "string",
          description: "Seller ID that owns the outcome. One of: plasticov, maustian.",
        },
      },
      required: ["outcomeId", "sellerId"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      const outcomeId = safeString(args.outcomeId);
      if (!outcomeId) {
        return {
          status: "error",
          error: "outcomeId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Economic Learning Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      try {
        // Gather evidence from store
        const eligibility = store.getEligibility(outcomeId, sellerId);
        const attributions = store.listAttributionsByOutcome(outcomeId, sellerId);
        const plan = store.getLatestPlan(outcomeId, sellerId);
        const events = store.listByOutcome(outcomeId, sellerId);

        // Determine whether the outcome exists in any form
        const hasAnyData = eligibility || attributions.length > 0 || plan || events.length > 0;

        if (!hasAnyData) {
          return {
            status: "error",
            error: `No economic learning data found for outcome ${outcomeId} under seller ${sellerId}`,
            noExternalMutationExecuted: true,
          };
        }

        // Seller mismatch guard: if eligibility exists and seller doesn't match
        if (eligibility && eligibility.sellerId !== sellerId) {
          return {
            status: "error",
            error: `Outcome ${outcomeId} belongs to seller ${eligibility.sellerId}, not ${sellerId}`,
            noExternalMutationExecuted: true,
          };
        }

        // Build structured explanation
        const explanation: Record<string, unknown> = {
          outcomeId,
          sellerId,
        };

        if (eligibility) {
          explanation.eligibility = {
            eligible: eligibility.eligible,
            outcomeStatus: eligibility.outcomeStatus,
            completeness: eligibility.completeness,
            confidence: eligibility.confidence,
            evidenceQuality: eligibility.evidenceQuality,
            hasVerifiedEconomicImpact: eligibility.hasVerifiedEconomicImpact,
            hasAttributionTargets: eligibility.hasAttributionTargets,
            reasonCodes: eligibility.reasonCodes,
            evaluatedAt: eligibility.evaluatedAt,
          };
        }

        if (attributions.length > 0) {
          explanation.attributions = attributions.map((a) => ({
            attributionId: a.attributionId,
            targetType: a.targetType,
            targetId: a.targetId,
            strength: a.strength,
            confidence: a.confidence,
            evaluator: a.evaluator,
            createdAt: a.createdAt,
          }));
        }

        if (plan) {
          explanation.reinforcementPlan = {
            planId: plan.planId,
            status: plan.status,
            confidence: plan.confidence,
            attributionStrength: plan.attributionStrength,
            signalDirection: plan.economicSignal?.direction,
            signalMagnitude: plan.economicSignal?.magnitude,
            targetNodesCount: plan.targetNodes.length,
            targetEdgesCount: plan.targetEdges.length,
            proposedAdjustmentsCount: plan.proposedAdjustments.length,
            lessonCandidatesCount: plan.lessonCandidates.length,
            blockedTargetsCount: plan.blockedTargets.length,
            policyVersion: plan.reinforcementPolicyVersion,
            createdAt: plan.createdAt,
          };
        }

        if (events.length > 0) {
          explanation.learningEvents = events.map((e) => {
            const event: Record<string, unknown> = {
              eventId: e.eventId,
              planId: e.planId,
              status: e.status,
              appliedAt: e.appliedAt,
              adjustmentsCount: e.adjustments.length,
              policiesVersion: e.reinforcementPolicyVersion,
            };
            if (e.reversedAt !== undefined) {
              event.reversedAt = e.reversedAt;
            }
            if (e.errorCode !== undefined) {
              event.errorCode = e.errorCode;
            }
            return event;
          });
        }

        // Compose key findings
        const findings: string[] = [];
        if (eligibility) {
          if (eligibility.eligible) {
            findings.push(
              `Outcome ${outcomeId} was eligible for economic learning (status: ${eligibility.outcomeStatus})`,
            );
          } else {
            findings.push(
              `Outcome ${outcomeId} was blocked from economic learning: ${eligibility.reasonCodes.join(", ")}`,
            );
          }
        }
        if (events.length > 0) {
          const applied = events.filter((e) => e.status === "processed");
          const reversed = events.filter((e) => e.status === "reversed");
          const failed = events.filter((e) => e.status === "failed");
          if (applied.length > 0) findings.push(`${applied.length} learning event(s) applied`);
          if (reversed.length > 0) findings.push(`${reversed.length} learning event(s) reversed`);
          if (failed.length > 0) findings.push(`${failed.length} learning event(s) failed`);
        }
        if (plan) {
          findings.push(`Reinforcement plan ${plan.planId} is ${plan.status}`);
        }

        explanation.keyFindings = findings;

        return {
          status: "ok",
          data: explanation,
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Economic learning explanation failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── inspect_economic_learning_status ───────────────────────────────────────

export function createInspectEconomicLearningStatusTool(
  store?: EconomicLearningStore,
): ToolDefinition {
  return {
    name: "inspect_economic_learning_status",
    description:
      "Inspect the economic learning status of a specific outcome. Returns a compact status overview with eligibility, attribution, plan, and event counts. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        outcomeId: {
          type: "string",
          description: "Economic outcome ID to inspect.",
        },
        sellerId: {
          type: "string",
          description: "Seller ID that owns the outcome. One of: plasticov, maustian.",
        },
      },
      required: ["outcomeId", "sellerId"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      const outcomeId = safeString(args.outcomeId);
      if (!outcomeId) {
        return {
          status: "error",
          error: "outcomeId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Economic Learning Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      try {
        const eligibility = store.getEligibility(outcomeId, sellerId);
        const attributions = store.listAttributionsByOutcome(outcomeId, sellerId);
        const plan = store.getLatestPlan(outcomeId, sellerId);
        const events = store.listByOutcome(outcomeId, sellerId);

        const hasAnyData = eligibility || attributions.length > 0 || plan || events.length > 0;

        if (!hasAnyData) {
          return {
            status: "error",
            error: `No economic learning data found for outcome ${outcomeId} under seller ${sellerId}`,
            noExternalMutationExecuted: true,
          };
        }

        if (eligibility && eligibility.sellerId !== sellerId) {
          return {
            status: "error",
            error: `Outcome ${outcomeId} belongs to seller ${eligibility.sellerId}, not ${sellerId}`,
            noExternalMutationExecuted: true,
          };
        }

        // Determine last event timestamp
        const sortedEvents = [...events].sort((a, b) => b.appliedAt - a.appliedAt);
        const lastEventTimestamp = sortedEvents.length > 0 ? sortedEvents[0]!.appliedAt : undefined;

        // Count attribution strengths
        const attributionStrengths: Record<string, number> = {};
        for (const attr of attributions) {
          attributionStrengths[attr.strength] = (attributionStrengths[attr.strength] ?? 0) + 1;
        }

        const overview: Record<string, unknown> = {
          outcomeId,
          sellerId,
          eligibility: eligibility
            ? {
                eligible: eligibility.eligible,
                reasonCodes: eligibility.reasonCodes,
                evaluatedAt: eligibility.evaluatedAt,
              }
            : null,
          attributions: {
            count: attributions.length,
            strengths: attributionStrengths,
          },
          plan: plan
            ? {
                planId: plan.planId,
                status: plan.status,
                createdAt: plan.createdAt,
              }
            : null,
          events: {
            count: events.length,
            ...(lastEventTimestamp !== undefined ? { lastEventTimestamp } : {}),
          },
        };

        return {
          status: "ok",
          data: overview,
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Economic learning status inspection failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── list_economic_learning_events ──────────────────────────────────────────

export function createListEconomicLearningEventsTool(
  store?: EconomicLearningStore,
): ToolDefinition {
  return {
    name: "list_economic_learning_events",
    description:
      "List recent economic learning events for a seller. Returns event summaries bounded to max 20 results. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose events to list. One of: plasticov, maustian.",
        },
        limit: {
          type: "number",
          description: "Maximum number of events to return (default 20, max 20).",
        },
      },
      required: ["sellerId"],
    },
    execute(args: Record<string, unknown>): Record<string, unknown> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!store) {
        return {
          status: "error",
          error: "Economic Learning Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      try {
        const limit = safeLimit(args.limit, 20);
        const events = store.listBySeller(sellerId, { limit });

        const summaries = events.map((e) => {
          const summary: Record<string, unknown> = {
            eventId: e.eventId,
            outcomeId: e.outcomeId,
            planId: e.planId,
            status: e.status,
            appliedAt: e.appliedAt,
          };
          if (e.reversedAt !== undefined) {
            summary.reversedAt = e.reversedAt;
          }
          if (e.errorCode !== undefined) {
            summary.errorCode = e.errorCode;
          }
          return summary;
        });

        return {
          status: "ok",
          data: {
            sellerId,
            count: summaries.length,
            events: summaries,
          },
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Economic learning event listing failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── Tool factory ───────────────────────────────────────────────────────────

export function createEconomicLearningTools(store?: EconomicLearningStore): ToolDefinition[] {
  return [
    createExplainEconomicLearningTool(store),
    createInspectEconomicLearningStatusTool(store),
    createListEconomicLearningEventsTool(store),
  ];
}
