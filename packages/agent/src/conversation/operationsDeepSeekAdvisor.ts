import type { DeepSeekTransport } from "./transports/deepseekTransport.js";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Types ────────────────────────────────────────────────────────────

export type OperationsAnalysisFinding = {
  kind: "claim-risk" | "reputation-trend" | "priority-action";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

export type OperationsAnalysisInput = {
  sellerId: string;
  openClaims: Array<{
    claimId: string;
    reason: string;
    sellerId: string;
    itemId: string;
  }>;
  reputationScore: number;
  question?: string;
};

export type OperationsAnalysis = {
  findings: OperationsAnalysisFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

// ── Advisor ──────────────────────────────────────────────────────────

export class OperationsDeepSeekAdvisor {
  private gateway: DeepSeekReasoningGateway | null = null;
  private transport: DeepSeekTransport;
  private ledger: WorkforceCostCacheLedgerStore | undefined;
  private sellerIds: string[];

  constructor(input: {
    transport: DeepSeekTransport;
    sellerIds: string[];
    ledger?: WorkforceCostCacheLedgerStore;
  }) {
    this.transport = input.transport;
    this.sellerIds = input.sellerIds;
    this.ledger = input.ledger;
  }

  /**
   * Lazily initializes the reasoning gateway, sharing the singleton
   * transport. Keeps constructor signature compatible with the
   * SupplierMirrorDeepSeekAdvisor pattern.
   */
  private getGateway(): DeepSeekReasoningGateway {
    if (!this.gateway) {
      this.gateway = new DeepSeekReasoningGateway(this.transport, this.ledger);
    }
    return this.gateway;
  }

  async analyze(input: OperationsAnalysisInput): Promise<OperationsAnalysis> {
    const { sellerId, openClaims, reputationScore, question } = input;

    // ── Build prompt blocks ──────────────────────────────────
    const claimsSummary = openClaims
      .map(
        (c) =>
          `- #${c.claimId}: ${c.reason || "sin motivo"} | item: ${c.itemId} | seller: ${c.sellerId}`,
      )
      .join("\n");

    // Spanish system prompt — operational analysis role
    const stablePrefix = [
      "Sos un asesor interno de Operaciones para el CEO de MSL.",
      "Analizás señales operativas (reclamos abiertos, reputación) y generás hallazgos accionables.",
      "Reglas:",
      "- No sugerir acciones que requieran mutaciones sin aprobación explícita del CEO.",
      "- Priorizar reclamos abiertos y riesgos de reputación.",
      "- Detectar patrones entre reclamos y métricas de reputación.",
      "- Responder en español, directo, sin markdown excesivo.",
      "- Cada hallazgo debe incluir: qué, por qué, evidencia, acción sugerida.",
    ].join("\n");

    const volatileInput = [
      `## Seller: ${sellerId}`,
      question ? `\n### Consulta del CEO: ${question}\n` : "",
      `\n### Reclamos abiertos (${openClaims.length}):`,
      claimsSummary || "(sin reclamos)",
      `\n### Puntaje de reputación: ${reputationScore}`,
      `\n\nAnalizá los datos y devolvé hallazgos en este formato JSON:`,
      `{ "findings": [{ "kind": "claim-risk|reputation-trend|priority-action", "severity": "info|warning|critical", "summary": "una línea", "detail": "explicación", "evidenceIds": ["id1"] }], "summary": "resumen general en 2-3 oraciones" }`,
    ].join("\n");

    // ── Call DeepSeek via gateway ────────────────────────────
    const gateway = this.getGateway();
    const result = await gateway.reason({
      laneId: "operations-manager",
      level: ReasoningLevel.Classification,
      stablePrefix,
      volatileInput,
      departmentId: "operations",
      agentId: "operations-advisor",
    });

    // ── Parse response ───────────────────────────────────────
    const telemetry = result.costTelemetry;
    let parsed: { findings?: OperationsAnalysisFinding[]; summary?: string } = {};
    try {
      const content = result.rawResponse ?? "{}";
      parsed = JSON.parse(content) as {
        findings?: OperationsAnalysisFinding[];
        summary?: string;
      };
    } catch {
      parsed = {
        findings: [],
        summary: "DeepSeek response could not be parsed.",
      };
    }

    return {
      findings: parsed.findings ?? [],
      summary: parsed.summary ?? "Análisis completado.",
      modelUsed: result.modelUsed,
      costMicros: telemetry.estimatedCostMicros,
      cacheHitTokens: telemetry.cacheHitTokens,
      cacheMissTokens: telemetry.cacheMissTokens,
      outputTokens: telemetry.outputTokens,
    };
  }
}
