import crypto from "node:crypto";
import type { AssessmentType, FinancialAssessment, Currency } from "@msl/domain";
import type { DeepSeekTransport } from "../conversation/transports/deepseekTransport.js";
import type { WorkforceCostCacheLedgerStore } from "../conversation/workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";
import type { FinanceDirectorEvidence } from "./FinanceDirectorEvidenceAssembler.js";
import { FinanceDirectorPromptBuilder } from "./FinanceDirectorPromptBuilder.js";
import { FinanceDirectorValidator } from "./FinanceDirectorValidator.js";
import { FinanceDirectorFallback } from "./FinanceDirectorFallback.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type SessionContext = {
  correlationId?: string;
  workSessionId?: string;
  priorAssessment?: Partial<FinancialAssessment> | null;
  history?: string;
};

export type AnalyzeInput = {
  evidence: FinanceDirectorEvidence;
  objective: string;
  sellerId: string;
  assessmentType: AssessmentType;
  sessionContext?: SessionContext;
};

export type AnalyzeResult = {
  assessment: FinancialAssessment;
  modelUsed: string;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
  costMicros: number;
};

// ── Advisor ────────────────────────────────────────────────────────────────

export class FinanceDirectorAdvisor {
  private gateway: DeepSeekReasoningGateway | null = null;
  private transport: DeepSeekTransport;
  private ledger: WorkforceCostCacheLedgerStore | undefined;
  private promptBuilder: FinanceDirectorPromptBuilder;
  private validator: FinanceDirectorValidator;
  private fallback: FinanceDirectorFallback;

  constructor(input: { transport: DeepSeekTransport; ledger?: WorkforceCostCacheLedgerStore }) {
    this.transport = input.transport;
    this.ledger = input.ledger;
    this.promptBuilder = new FinanceDirectorPromptBuilder();
    this.validator = new FinanceDirectorValidator();
    this.fallback = new FinanceDirectorFallback();
  }

  /**
   * Lazily initializes the reasoning gateway, sharing the singleton transport.
   * Keeps the constructor signature compatible with the existing advisor pattern.
   */
  private getGateway(): DeepSeekReasoningGateway {
    if (!this.gateway) {
      this.gateway = new DeepSeekReasoningGateway(this.transport, this.ledger);
    }
    return this.gateway;
  }

  /**
   * Analyzes financial evidence and returns a structured FinancialAssessment.
   *
   * Flow:
   *   1. Build prompt via FinanceDirectorPromptBuilder
   *   2. Call DeepSeekReasoningGateway
   *   3. Parse response into partial FinancialAssessment
   *   4. Validate via FinanceDirectorValidator
   *   5. If invalid → retry once with correction feedback
   *   6. If still invalid OR DeepSeek unavailable → use FinanceDirectorFallback
   */
  async analyze(input: AnalyzeInput): Promise<AnalyzeResult> {
    const { evidence, objective, sellerId, assessmentType, sessionContext } = input;

    // ── Build prompt ───────────────────────────────────────────────────
    const prompt = this.promptBuilder.buildPrompt({
      objective,
      evidence,
      sellerId,
      assessmentType,
      ...(sessionContext?.history !== undefined ? { sessionContext: sessionContext.history } : {}),
      ...(sessionContext?.priorAssessment !== undefined
        ? { priorAssessment: sessionContext.priorAssessment }
        : {}),
    });

    // ── Call DeepSeek ──────────────────────────────────────────────────
    const gateway = this.getGateway();

    let result;
    try {
      result = await gateway.reason({
        laneId: "finance-director",
        level: ReasoningLevel.Recommendation,
        stablePrefix: prompt.stablePrefix,
        cacheableContext: prompt.cacheableContext,
        volatileInput: prompt.volatileInput,
        departmentId: "finance",
        agentId: "finance-director-advisor",
        sellerId,
      });
    } catch {
      // Gateway threw → fallback
      return this.buildFallbackResult(evidence, objective, sellerId, assessmentType, prompt);
    }

    // ── Gateway fallback → deterministic fallback ──────────────────────
    if (result.status === "fallback") {
      return this.buildFallbackResult(evidence, objective, sellerId, assessmentType, prompt);
    }

    // ── Parse response ─────────────────────────────────────────────────
    let parsed: Partial<FinancialAssessment> | null = null;
    let rawResponse: string | null = result.rawResponse ?? null;

    try {
      rawResponse = rawResponse ?? "";
      parsed = this.parseResponse(rawResponse);
    } catch {
      // Invalid JSON → attempt retry with correction
      rawResponse = await this.retryWithCorrection(
        gateway,
        prompt,
        "Response was not valid JSON. Please return valid JSON only.",
      );
      if (rawResponse) {
        try {
          parsed = this.parseResponse(rawResponse);
        } catch {
          parsed = null;
        }
      }
    }

    // ── Validate ───────────────────────────────────────────────────────
    if (parsed) {
      const validation = this.validator.validate(parsed, evidence);

      if (!validation.valid) {
        // Attempt retry with validation feedback
        const feedback = validation.issues.map((i) => `${i.rule}: ${i.detail}`).join("\n");
        rawResponse = await this.retryWithCorrection(
          gateway,
          prompt,
          `Your assessment has validation issues:\n${feedback}\n\nPlease correct these issues and return a valid JSON response.`,
        );

        if (rawResponse) {
          try {
            parsed = this.parseResponse(rawResponse);
          } catch {
            parsed = null;
          }
        } else {
          parsed = null;
        }
      }
    }

    // ── If still invalid or unparseable → fallback ─────────────────────
    if (!parsed) {
      return this.buildFallbackResult(evidence, objective, sellerId, assessmentType, prompt);
    }

    // ── Build final assessment ─────────────────────────────────────────
    const now = Date.now();
    const assessmentId = `fa-${now}-${crypto.randomUUID().slice(0, 8)}`;

    const assessment: FinancialAssessment = Object.freeze({
      assessmentId,
      sellerId,
      objective,
      assessmentType,
      generatedAt: now,
      currencies: [evidence.sellerCurrency] as readonly Currency[],
      evidenceIds: Object.freeze([
        ...evidence.snapshots.map((s) => s.snapshotId),
        ...evidence.outcomes.map((o) => o.outcomeId),
      ]),
      outcomeIds: Object.freeze(evidence.outcomes.map((o) => o.outcomeId)),
      snapshotIds: Object.freeze(evidence.snapshots.map((s) => s.snapshotId)),
      summary: parsed.summary ?? "Assessment completed.",
      verifiedFacts: Object.freeze(parsed.verifiedFacts ?? []),
      hypotheses: Object.freeze(parsed.hypotheses ?? []),
      risks: Object.freeze(parsed.risks ?? []),
      opportunities: Object.freeze(parsed.opportunities ?? []),
      missingEvidence: Object.freeze(parsed.missingEvidence ?? []),
      confidence:
        typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      uncertaintyReasons: Object.freeze(parsed.uncertaintyReasons ?? []),
      recommendations: Object.freeze(parsed.recommendations ?? []),
      requestsForEvidence: Object.freeze(parsed.requestsForEvidence ?? []),
      modelUsed: result.modelUsed,
      fallbackUsed: false,
      promptBlockHashes: Object.freeze({ ...prompt.blockHashes }),
      ...(sessionContext?.workSessionId ? { workSessionId: sessionContext.workSessionId } : {}),
      ...(sessionContext?.correlationId ? { correlationId: sessionContext.correlationId } : {}),
      noMutationExecuted: true as const,
    });

    const telemetry = result.costTelemetry;

    return {
      assessment,
      modelUsed: result.modelUsed,
      cacheHitTokens: telemetry.cacheHitTokens,
      cacheMissTokens: telemetry.cacheMissTokens,
      outputTokens: telemetry.outputTokens,
      costMicros: telemetry.estimatedCostMicros,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private parseResponse(raw: string): Partial<FinancialAssessment> {
    // Try to extract JSON from the response (handle markdown code blocks)
    let jsonStr = raw.trim();

    // Remove markdown JSON fences if present
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(jsonStr);
    if (jsonMatch && jsonMatch[1]) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed: unknown = JSON.parse(jsonStr);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Response is not a JSON object");
    }

    return parsed;
  }

  private async retryWithCorrection(
    gateway: DeepSeekReasoningGateway,
    originalPrompt: ReturnType<FinanceDirectorPromptBuilder["buildPrompt"]>,
    correction: string,
  ): Promise<string | null> {
    try {
      const retryResult = await gateway.reason({
        laneId: "finance-director",
        level: ReasoningLevel.Recommendation,
        stablePrefix: originalPrompt.stablePrefix,
        cacheableContext: originalPrompt.cacheableContext,
        volatileInput: `${originalPrompt.volatileInput}\n\n[SYSTEM CORRECTION]\n${correction}`,
        departmentId: "finance",
        agentId: "finance-director-advisor",
      });

      if (retryResult.status === "fallback" || !retryResult.rawResponse) {
        return null;
      }

      return retryResult.rawResponse;
    } catch {
      return null;
    }
  }

  private buildFallbackResult(
    evidence: FinanceDirectorEvidence,
    objective: string,
    sellerId: string,
    assessmentType: AssessmentType,
    prompt: ReturnType<FinanceDirectorPromptBuilder["buildPrompt"]>,
  ): AnalyzeResult {
    const assessment = this.fallback.buildFallbackAssessment(
      evidence,
      objective,
      sellerId,
      assessmentType,
    );

    void prompt; // Block hashes preserved in call site for telemetry

    return {
      assessment,
      modelUsed: "none",
      cacheHitTokens: 0,
      cacheMissTokens: 0,
      outputTokens: 0,
      costMicros: 0,
    };
  }
}
