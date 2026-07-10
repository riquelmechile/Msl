import crypto from "node:crypto";
import type { FinancialAssessment } from "@msl/domain";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";

// ── Stable Block A: Identity + Rules (NEVER changes within a lane) ──────

const BLOCK_A = `You are the Finance Director for MSL, an AI agent enterprise operating MercadoLibre stores in Chile.
Your mission: maximize sustainable net profit, cash flow, and return on capital without destroying reputation, stock, compliance, or future capacity.

RULES (NEVER violate):
1. NEVER invent financial values. Only use numbers present in the provided evidence.
2. Missing data is NOT zero. If a cost is missing, say it's missing — don't assume zero.
3. An observed outcome is NOT verified. Treat observed as provisional.
4. Association is NOT causation. Don't claim causality without sufficient evidence.
5. An approval is NOT proof of profitability. Approved proposals may still lose money.
6. NEVER mix CLP and USD. Do not compare or aggregate across currencies.
7. NEVER mix Plasticov and Maustian data. Each account is independent.
8. NEVER recommend direct mutations (publish, change price, activate ads, spend money).
9. ALWAYS explain uncertainty. If confidence < 0.7, say why.
10. NEVER present partial data as complete.
11. NEVER guarantee profit.
12. ALWAYS include seller scope in every claim.

Output format: You MUST return a structured financial assessment in JSON with:
- summary: string — one paragraph in Spanish
- verifiedFacts: string[] — bullet list of facts directly supported by evidence
- hypotheses: { statement: string; confidence: number; evidence: string }[]
- risks: { description: string; severity: "low"|"medium"|"high"|"critical"; probability: number }[]
- opportunities: { description: string; estimatedImpact: string }[]
- missingEvidence: { kind: string; reason: string; targetAgent: string; priority: "low"|"medium"|"high" }[]
- recommendations: { action: string; rationale: string; urgency: "investigate"|"monitor"|"request_evidence"|"prepare_proposal"|"escalate" }[]
- requestsForEvidence: { kind: string; targetAgent: string; reason: string; priority: "low"|"medium"|"high"; ttl: number }[]
- confidence: number — 0-1 overall confidence
- uncertaintyReasons: string[] — why confidence is not 1.0
- assessmentType: string

DEFINITIONS:
- Revenue = gross sales before any costs
- Contribution Profit = revenue minus variable costs (product_cost, marketplace_fee, shipping, advertising, seller_discount)
- Net Profit = revenue minus ALL costs (including fixed costs: refund, return, tax, financing, landed_cost, packaging, other)
- Net Margin = Net Profit / Revenue
- ROAS = revenue from ads / ad spend (ROAS > 1 does NOT guarantee net profit)`;

// ── Stable Block B: Company Context ───────────────────────────────────────

const BLOCK_B = `COMPANY CONTEXT:
- Plasticov and Maustian are independent MercadoLibre Chile (MLC) commercial accounts
- They are parallel channels, not a factory/store hierarchy
- Each account has independent pricing, listing types, titles, and exposure strategies
- Base currency: CLP (Chilean Peso)
- Some products have own stock, others are supplier-sourced/arbitrage
- CEO strategies and policies are set by the human CEO — you advise, never override
- Other agents: cost-supplier (cost/margin), product-ads-profitability (ad economics), account-brain (strategic tracking)
- You are the Finance Director — the transversal financial manager. You integrate evidence from specialists.`;

// ── Block hashes ───────────────────────────────────────────────────────────

const BLOCK_A_HASH = crypto.createHash("sha256").update(BLOCK_A).digest("hex");
const BLOCK_B_HASH = crypto.createHash("sha256").update(BLOCK_B).digest("hex");

// ── Input types ────────────────────────────────────────────────────────────

export type PromptBuildOpts = {
  objective: string;
  evidence: FinanceDirectorEvidence;
  sellerId: string;
  assessmentType?: string;
  sessionContext?: string;
  priorAssessment?: Partial<FinancialAssessment> | null;
};

export type PromptResult = {
  stablePrefix: string;
  cacheableContext: string;
  volatileInput: string;
  blockHashes: {
    blockA: string;
    blockB: string;
    blockC?: string;
    blockD?: string;
  };
};

// ── Builder ────────────────────────────────────────────────────────────────

export class FinanceDirectorPromptBuilder {
  /**
   * Builds a 3-block prompt for the DeepSeekReasoningGateway:
   * 1. stablePrefix: Block A (identity+rules, NEVER changes)
   * 2. cacheableContext: Block B + Block C (company context + session context)
   * 3. volatileInput: Block D (dynamic evidence, changes every call)
   */
  buildPrompt(opts: PromptBuildOpts): PromptResult {
    const { objective, evidence, sellerId, assessmentType, sessionContext, priorAssessment } = opts;

    // ── Block C: Session Context ─────────────────────────────────────────
    let blockC = `SELLER: ${sellerId}`;
    if (assessmentType) {
      blockC += `\nAssessment type: ${assessmentType}`;
    }
    if (sessionContext) {
      blockC += `\n\nSession Context:\n${sessionContext}`;
    }
    if (priorAssessment) {
      blockC += `\n\nPrior assessment hypotheses:\n${
        (priorAssessment.hypotheses ?? [])
          .map((h: { statement: string; confidence: number }) => `- [${h.confidence}] ${h.statement}`)
          .join("\n") || "(none)"
      }`;
      const pending = (priorAssessment.requestsForEvidence ?? [])
        .map((r: { kind: string }) => r.kind)
        .join(", ");
      if (pending) {
        blockC += `\nPending evidence requests: ${pending}`;
      }
    }

    // ── Block D: Dynamic Evidence ────────────────────────────────────────
    const snapshotSummary = evidence.snapshots
      .map((s) => {
        const missing = s.missingInputs.length > 0 ? ` missing=[${s.missingInputs.join(", ")}]` : "";
        return `- snapshot ${s.snapshotId}: revenue=${s.grossRevenue} ${evidence.sellerCurrency}, netProfit=${s.netProfit}, margin=${(s.netMargin * 100).toFixed(1)}%, status=${s.calculationStatus}${missing}`;
      })
      .join("\n");

    const outcomeSummary = evidence.outcomes
      .map((o) => `- outcome ${o.outcomeId}: status=${o.status}, seller=${o.sellerId}${o.orderId ? `, order=${o.orderId}` : ""}`)
      .join("\n");

    const profitBlock = evidence.profitSummary
      ? `Profit Summary: totalRevenue=${evidence.profitSummary.totalRevenue}, totalCosts=${evidence.profitSummary.totalCosts}, netProfit=${evidence.profitSummary.netProfit}, netMargin=${evidence.profitSummary.netMargin}, snapshotCount=${evidence.profitSummary.snapshotCount}`
      : "No profit summary available.";

    const missingBlock =
      evidence.missingInputs.length > 0
        ? `Missing inputs (${evidence.missingInputs.length}):\n${evidence.missingInputs.map((m) => `- ${m}`).join("\n")}`
        : "No missing inputs reported.";

    const blockD = [
      `OBJECTIVE: ${objective}`,
      `SELLER: ${sellerId}`,
      `CURRENCY: ${evidence.sellerCurrency}`,
      `Evidence timestamp: ${new Date(evidence.evidenceTimestamp).toISOString()}`,
      "",
      `Snapshots (${evidence.snapshots.length}):`,
      snapshotSummary || "(no snapshots)",
      "",
      `Outcomes (${evidence.outcomes.length}):`,
      outcomeSummary || "(no outcomes)",
      "",
      profitBlock,
      "",
      missingBlock,
    ].join("\n");

    // ── Compute hashes ───────────────────────────────────────────────────
    const blockCHash = crypto.createHash("sha256").update(blockC).digest("hex");
    const blockDHash = crypto.createHash("sha256").update(blockD).digest("hex");

    return {
      stablePrefix: BLOCK_A,
      cacheableContext: `${BLOCK_B}\n\n${blockC}`,
      volatileInput: blockD,
      blockHashes: {
        blockA: BLOCK_A_HASH,
        blockB: BLOCK_B_HASH,
        blockC: blockCHash,
        blockD: blockDHash,
      },
    };
  }
}
