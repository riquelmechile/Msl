import type { ToolDefinition } from "./types.js";
import { safeString } from "./types.js";
import type {
  EconomicOutcomeReader as EconomicOutcomeStore,
  FinanceDirectorAssessmentStore,
} from "@msl/memory";
import type { AssessmentType } from "@msl/domain";
import { FinanceDirectorEvidenceAssembler } from "../../finance/FinanceDirectorEvidenceAssembler.js";
import type { FinanceDirectorAdvisor } from "../../finance/FinanceDirectorAdvisor.js";

// ── Factory input ──────────────────────────────────────────────────────────

export type FinanceDirectorToolsInput = {
  economicStore?: EconomicOutcomeStore;
  assessmentStore?: FinanceDirectorAssessmentStore;
  advisorFactory?: () => FinanceDirectorAdvisor | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function safeAssessmentType(value: unknown): AssessmentType | undefined {
  if (typeof value !== "string") return undefined;
  const validTypes = new Set<string>([
    "account-health",
    "order-profitability",
    "product-profitability",
    "ads-profitability",
    "proposal-review",
    "outcome-review",
    "missing-cost-review",
    "cross-account-comparison",
    "cash-risk-indicator",
  ]);
  return validTypes.has(value) ? (value as AssessmentType) : undefined;
}

// ── ask_finance_director ───────────────────────────────────────────────────

export function createAskFinanceDirectorTool(input: FinanceDirectorToolsInput): ToolDefinition {
  return {
    name: "ask_finance_director",
    description:
      "Ask the Finance Director a financial question about a seller account. The Finance Director analyzes unit economics snapshots, economic outcomes, and profit data to provide a structured FinancialAssessment. Returns a FinancialAssessment with summary, verified facts, hypotheses, risks, and recommendations. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose financial data to analyze. One of: plasticov, maustian.",
        },
        question: {
          type: "string",
          description:
            "The financial question to ask the Finance Director. E.g., 'Are we profitable on product X?', 'What risks do we face?', 'Is this proposal financially viable?'",
        },
        assessmentType: {
          type: "string",
          description:
            "Optional assessment type. One of: account-health, order-profitability, product-profitability, ads-profitability, proposal-review, outcome-review, missing-cost-review, cross-account-comparison, cash-risk-indicator.",
        },
      },
      required: ["sellerId", "question"],
    },
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!input.economicStore) {
        return {
          status: "error",
          error: "Economic Outcome Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      const advisor = input.advisorFactory?.();
      if (!advisor) {
        return {
          status: "error",
          error: "Finance Director Advisor no está disponible (DeepSeek no configurado)",
          noExternalMutationExecuted: true,
        };
      }

      const question = safeString(args.question);
      const assessmentType =
        safeAssessmentType(args.assessmentType ?? args.question) ?? "account-health";

      try {
        const assembler = new FinanceDirectorEvidenceAssembler(input.economicStore);
        const evidence = assembler.assembleEvidence({
          sellerId,
          currency: "CLP",
          maxSnapshots: 50,
          maxOutcomes: 25,
          maxAge: 90 * 86400000,
        });

        const result = await advisor.analyze({
          evidence,
          objective: question,
          sellerId,
          assessmentType,
        });

        // Persist to assessment store if available
        if (input.assessmentStore) {
          try {
            input.assessmentStore.insertAssessment(result.assessment);
          } catch {
            // Best effort — assessment still returned
          }
        }

        return {
          status: "ok",
          data: result.assessment,
          modelUsed: result.modelUsed,
          fallbackUsed: result.assessment.fallbackUsed,
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Finance Director analysis failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── review_financial_health ────────────────────────────────────────────────

export function createReviewFinancialHealthTool(input: FinanceDirectorToolsInput): ToolDefinition {
  return {
    name: "review_financial_health",
    description:
      "Review the overall financial health of a seller account across all evidence domains. The Finance Director synthesizes available economic snapshots, outcomes, and profit data into a comprehensive account-health FinancialAssessment. Returns a FinancialAssessment. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID whose financial health to review. One of: plasticov, maustian.",
        },
        timeWindow: {
          type: "string",
          description: "Optional time window for evidence. E.g., '7d', '30d', '90d'. Default: 90d.",
        },
      },
      required: ["sellerId"],
    },
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!input.economicStore) {
        return {
          status: "error",
          error: "Economic Outcome Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      const advisor = input.advisorFactory?.();
      if (!advisor) {
        return {
          status: "error",
          error: "Finance Director Advisor no está disponible (DeepSeek no configurado)",
          noExternalMutationExecuted: true,
        };
      }

      const timeWindowRaw = safeString(args.timeWindow);
      const days = timeWindowRaw ? parseInt(timeWindowRaw.replace("d", ""), 10) : 90;
      const maxAge = (Number.isNaN(days) ? 90 : Math.max(1, Math.min(days, 365))) * 86400000;

      try {
        const assembler = new FinanceDirectorEvidenceAssembler(input.economicStore);
        const evidence = assembler.assembleEvidence({
          sellerId,
          currency: "CLP",
          maxSnapshots: 50,
          maxOutcomes: 25,
          maxAge,
        });

        const result = await advisor.analyze({
          evidence,
          objective: `Review financial health for ${sellerId} over the last ${days} days`,
          sellerId,
          assessmentType: "account-health",
        });

        if (input.assessmentStore) {
          try {
            input.assessmentStore.insertAssessment(result.assessment);
          } catch {
            // Best effort
          }
        }

        return {
          status: "ok",
          data: result.assessment,
          modelUsed: result.modelUsed,
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Financial health review failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── explain_economic_outcome ───────────────────────────────────────────────

export function createExplainEconomicOutcomeTool(input: FinanceDirectorToolsInput): ToolDefinition {
  return {
    name: "explain_economic_outcome",
    description:
      "Ask the Finance Director to explain a specific economic outcome. Retrieves the outcome from the store, assembles related evidence, and produces a structured FinancialAssessment explaining the outcome. Returns a FinancialAssessment. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID that owns the outcome. One of: plasticov, maustian.",
        },
        outcomeId: {
          type: "string",
          description: "Economic outcome ID to explain.",
        },
      },
      required: ["sellerId", "outcomeId"],
    },
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
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

      if (!input.economicStore) {
        return {
          status: "error",
          error: "Economic Outcome Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      const advisor = input.advisorFactory?.();
      if (!advisor) {
        return {
          status: "error",
          error: "Finance Director Advisor no está disponible (DeepSeek no configurado)",
          noExternalMutationExecuted: true,
        };
      }

      try {
        // Verify the outcome exists and belongs to the seller
        const outcome = input.economicStore.getOutcome(outcomeId, sellerId);
        if (!outcome) {
          return {
            status: "error",
            error: `Outcome ${outcomeId} no encontrado para seller ${sellerId}`,
            noExternalMutationExecuted: true,
          };
        }

        const assembler = new FinanceDirectorEvidenceAssembler(input.economicStore);
        const evidence = assembler.assembleEvidence({
          sellerId,
          currency: "CLP",
          outcomeIds: [outcomeId],
          maxSnapshots: 50,
          maxOutcomes: 25,
          maxAge: 90 * 86400000,
        });

        const result = await advisor.analyze({
          evidence,
          objective: `Explain economic outcome ${outcomeId} for ${sellerId}`,
          sellerId,
          assessmentType: "outcome-review",
        });

        if (input.assessmentStore) {
          try {
            input.assessmentStore.insertAssessment(result.assessment);
          } catch {
            // Best effort
          }
        }

        return {
          status: "ok",
          data: result.assessment,
          modelUsed: result.modelUsed,
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Outcome explanation failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── review_proposal_profitability ──────────────────────────────────────────

export function createReviewProposalProfitabilityTool(
  input: FinanceDirectorToolsInput,
): ToolDefinition {
  return {
    name: "review_proposal_profitability",
    description:
      "Ask the Finance Director to review a specific proposal's profitability without approving or executing it. Evaluates the financial viability of a proposal using available evidence. Returns a FinancialAssessment. Does NOT change approval state. Read-only: no external mutations are executed.",
    parameters: {
      type: "object",
      properties: {
        sellerId: {
          type: "string",
          description: "Seller ID that owns the proposal. One of: plasticov, maustian.",
        },
        proposalId: {
          type: "string",
          description: "Proposal ID to review for profitability.",
        },
      },
      required: ["sellerId", "proposalId"],
    },
    async execute(args: Record<string, unknown>): Promise<Record<string, unknown>> {
      const sellerId = safeString(args.sellerId);
      if (!sellerId) {
        return {
          status: "error",
          error: "sellerId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      const proposalId = safeString(args.proposalId);
      if (!proposalId) {
        return {
          status: "error",
          error: "proposalId es obligatorio",
          noExternalMutationExecuted: true,
        };
      }

      if (!input.economicStore) {
        return {
          status: "error",
          error: "Economic Outcome Store no está disponible",
          noExternalMutationExecuted: true,
        };
      }

      const advisor = input.advisorFactory?.();
      if (!advisor) {
        return {
          status: "error",
          error: "Finance Director Advisor no está disponible (DeepSeek no configurado)",
          noExternalMutationExecuted: true,
        };
      }

      try {
        const assembler = new FinanceDirectorEvidenceAssembler(input.economicStore);
        const evidence = assembler.assembleEvidence({
          sellerId,
          currency: "CLP",
          maxSnapshots: 50,
          maxOutcomes: 25,
          maxAge: 90 * 86400000,
        });

        const result = await advisor.analyze({
          evidence,
          objective: `Review profitability of proposal ${proposalId} for ${sellerId}`,
          sellerId,
          assessmentType: "proposal-review",
        });

        // Explicitly do NOT change approval state
        // This tool only returns an assessment — no mutation

        if (input.assessmentStore) {
          try {
            input.assessmentStore.insertAssessment(result.assessment);
          } catch {
            // Best effort
          }
        }

        return {
          status: "ok",
          data: result.assessment,
          modelUsed: result.modelUsed,
          proposalReviewed: proposalId,
          approvalChanged: false,
          noExternalMutationExecuted: true,
        };
      } catch (err) {
        return {
          status: "error",
          error: err instanceof Error ? err.message : "Proposal profitability review failed",
          noExternalMutationExecuted: true,
        };
      }
    },
  };
}

// ── Tool factory ───────────────────────────────────────────────────────────

export function createFinanceDirectorTools(input: FinanceDirectorToolsInput): ToolDefinition[] {
  return [
    createAskFinanceDirectorTool(input),
    createReviewFinancialHealthTool(input),
    createExplainEconomicOutcomeTool(input),
    createReviewProposalProfitabilityTool(input),
  ];
}
