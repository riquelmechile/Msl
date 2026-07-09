import type { DeepSeekTransport } from "./transports/deepseekTransport.js";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Types ────────────────────────────────────────────────────────────

export type CatalogActionableFinding = {
  itemId: string;
  sellerId: string;
  title: string;
  price: number;
  status: string;
  visits: number;
  categoryId: string;
  categoryMedian?: number;
  signalKind: "low-visit" | "above-market" | "relist-expiring";
  severity: "warning" | "critical";
};

export type CatalogAnalysisInput = {
  actionableFindings: CatalogActionableFinding[];
  question?: string;
};

export type CatalogAnalysisFinding = {
  kind: "visibility-risk" | "pricing-strategy" | "relist-priority" | "catalog-insight";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

export type CatalogAnalysis = {
  findings: CatalogAnalysisFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

// ── Advisor ──────────────────────────────────────────────────────────

export class CatalogDeepSeekAdvisor {
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

  async analyze(input: CatalogAnalysisInput): Promise<CatalogAnalysis> {
    const { actionableFindings, question } = input;

    // ── Build prompt blocks ──────────────────────────────────
    const findingsSummary = actionableFindings
      .map(
        (f) =>
          `- ${f.signalKind} (${f.severity}): "${f.title}" (item: ${f.itemId}) | ` +
          `price: $${f.price} | visits: ${f.visits} | category: ${f.categoryId}${f.categoryMedian ? ` | median: $${f.categoryMedian}` : ""}`,
      )
      .join("\n");

    // Spanish system prompt — catalog analyst role
    const stablePrefix = [
      "Sos un asesor interno de Catálogo para el CEO de MSL.",
      "Analizás señales de catálogo (visitas bajas, precios sobre mediana, expiración de relist) y generás hallazgos accionables.",
      "Reglas:",
      "- No sugerir acciones que requieran mutaciones sin aprobación explícita del CEO.",
      "- Priorizar hallazgos según severidad y urgencia (relist próximo a expirar es crítico).",
      "- Detectar patrones entre listings con baja visibilidad y precios fuera de mercado.",
      "- Responder en español, directo, sin markdown excesivo.",
      "- Cada hallazgo debe incluir: qué, por qué, evidencia, acción sugerida.",
    ].join("\n");

    const volatileInput = [
      question ? `\n### Consulta del CEO: ${question}\n` : "",
      `\n### Hallazgos del catálogo (${actionableFindings.length}):`,
      findingsSummary || "(sin hallazgos)",
      `\n\nAnalizá los datos y devolvé hallazgos en este formato JSON:`,
      `{ "findings": [{ "kind": "visibility-risk|pricing-strategy|relist-priority|catalog-insight", "severity": "info|warning|critical", "summary": "una línea", "detail": "explicación", "evidenceIds": ["itemId1"] }], "summary": "resumen general en 2-3 oraciones" }`,
    ].join("\n");

    // ── Call DeepSeek via gateway ────────────────────────────
    const gateway = this.getGateway();
    const result = await gateway.reason({
      laneId: "market-catalog",
      level: ReasoningLevel.Classification,
      stablePrefix,
      volatileInput,
      departmentId: "catalog",
      agentId: "catalog-advisor",
    });

    // ── Parse response ───────────────────────────────────────
    const telemetry = result.costTelemetry;
    let parsed: { findings?: CatalogAnalysisFinding[]; summary?: string } = {};
    try {
      const content = result.rawResponse ?? "{}";
      parsed = JSON.parse(content) as {
        findings?: CatalogAnalysisFinding[];
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
