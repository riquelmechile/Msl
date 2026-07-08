import OpenAI from "openai";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Types ────────────────────────────────────────────────────────────

export type CostSupplierActionableFinding = {
  itemId: string;
  title?: string;
  signalKind:
    | "low-margin"
    | "critical-margin"
    | "below-cost"
    | "restock-opportunity";
  severity: "info" | "warning" | "critical";
  price: number;
  cost: number;
  margin: number;
  stock?: number;
  visits?: number;
};

export type CostSupplierEnrichmentInput = {
  actionableFindings: CostSupplierActionableFinding[];
  question?: string;
};

export type CostSupplierEnrichmentFinding = {
  kind: "margin-risk" | "cost-anomaly" | "pricing-opportunity" | "priority-action";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

export type CostSupplierEnrichment = {
  findings: CostSupplierEnrichmentFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

// ── Advisor ──────────────────────────────────────────────────────────

export class CostSupplierDeepSeekAdvisor {
  private gateway: DeepSeekReasoningGateway | null = null;
  private openai: OpenAI;
  private ledger: WorkforceCostCacheLedgerStore | undefined;
  private sellerIds: string[];

  constructor(input: {
    openai: OpenAI;
    sellerIds: string[];
    ledger?: WorkforceCostCacheLedgerStore;
  }) {
    this.openai = input.openai;
    this.sellerIds = input.sellerIds;
    this.ledger = input.ledger;
  }

  /**
   * Lazily initializes the reasoning gateway, sharing the singleton
   * OpenAI client. Keeps constructor signature compatible with the
   * existing advisor pattern.
   */
  private getGateway(): DeepSeekReasoningGateway {
    if (!this.gateway) {
      this.gateway = new DeepSeekReasoningGateway(this.openai, this.ledger);
    }
    return this.gateway;
  }

  async analyze(input: CostSupplierEnrichmentInput): Promise<CostSupplierEnrichment> {
    const { actionableFindings, question } = input;

    // ── Build prompt blocks ──────────────────────────────────
    const findingsSummary = actionableFindings
      .map((f) => {
        const parts = [
          `- ${f.signalKind} (${f.severity})`,
          `item: ${f.itemId}`,
        ];
        if (f.title) parts.push(`"${f.title}"`);
        parts.push(`price: $${f.price}`);
        parts.push(`cost: $${f.cost}`);
        parts.push(`margin: ${(f.margin * 100).toFixed(1)}%`);
        if (f.stock !== undefined) parts.push(`stock: ${f.stock}`);
        if (f.visits !== undefined) parts.push(`visits: ${f.visits}`);
        return parts.join(" | ");
      })
      .join("\n");

    // Spanish system prompt — cost/supply analyst role
    const stablePrefix = [
      "Sos un asesor interno de Costo y Proveedores para el CEO de MSL.",
      "Analizás señales de margen, costo y reposición, y generás hallazgos accionables.",
      "Reglas:",
      "- No sugerir acciones que requieran mutaciones sin aprobación explícita del CEO.",
      "- Priorizar hallazgos según severidad y urgencia (below-cost y critical-margin son críticos).",
      "- Detectar patrones entre listings con márgenes bajos y productos similares.",
      "- Responder en español, directo, sin markdown excesivo.",
      "- Cada hallazgo debe incluir: qué, por qué, evidencia, acción sugerida.",
    ].join("\n");

    const volatileInput = [
      question ? `\n### Consulta del CEO: ${question}\n` : "",
      `\n### Hallazgos del daemon cost-supplier (${actionableFindings.length}):`,
      findingsSummary || "(sin hallazgos)",
      `\n\nAnalizá los datos y devolvé hallazgos en este formato JSON:`,
      `{ "findings": [{ "kind": "margin-risk|cost-anomaly|pricing-opportunity|priority-action", "severity": "info|warning|critical", "summary": "una línea", "detail": "explicación", "evidenceIds": ["itemId1"] }], "summary": "resumen general en 2-3 oraciones" }`,
    ].join("\n");

    // ── Call DeepSeek via gateway ────────────────────────────
    const gateway = this.getGateway();
    const result = await gateway.reason({
      laneId: "cost-supplier",
      level: ReasoningLevel.Classification,
      stablePrefix,
      volatileInput,
      departmentId: "cost-supplier",
      agentId: "cost-supplier-advisor",
    });

    // ── Parse response ───────────────────────────────────────
    const telemetry = result.costTelemetry;
    let parsed: { findings?: CostSupplierEnrichmentFinding[]; summary?: string } = {};
    try {
      const content = result.rawResponse ?? "{}";
      parsed = JSON.parse(content) as {
        findings?: CostSupplierEnrichmentFinding[];
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
