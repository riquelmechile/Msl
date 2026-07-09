import OpenAI from "openai";
import type { SupplierMirrorStore } from "@msl/memory";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

export type SupplierMirrorAnalysisInput = {
  supplierId: string;
  supplierName: string;
  question?: string; // optional specific question from CEO
};

export type SupplierMirrorAnalysisFinding = {
  kind:
    | "stock-alert"
    | "price-opportunity"
    | "mapping-suggestion"
    | "policy-recommendation"
    | "general-insight";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

export type SupplierMirrorAnalysis = {
  findings: SupplierMirrorAnalysisFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

export class SupplierMirrorDeepSeekAdvisor {
  private store: SupplierMirrorStore;
  private gateway: DeepSeekReasoningGateway | null = null;
  private openai: OpenAI;
  private ledger: WorkforceCostCacheLedgerStore | undefined;
  private sellerIds: string[];

  constructor(input: {
    store: SupplierMirrorStore;
    openai: OpenAI;
    sellerIds: string[];
    ledger?: WorkforceCostCacheLedgerStore;
  }) {
    this.store = input.store;
    this.openai = input.openai;
    this.sellerIds = input.sellerIds;
    this.ledger = input.ledger;
  }

  /**
   * Lazily initializes the reasoning gateway, sharing the singleton
   * OpenAI client. Keeps constructor signature unchanged for
   * backward compat with AgentLoop.
   */
  private getGateway(): DeepSeekReasoningGateway {
    if (!this.gateway) {
      this.gateway = new DeepSeekReasoningGateway(this.openai, this.ledger);
    }
    return this.gateway;
  }

  async analyze(input: SupplierMirrorAnalysisInput): Promise<SupplierMirrorAnalysis> {
    const { supplierId, supplierName, question } = input;

    // ── Gather evidence from store ────────────────────────
    const [items, policies, mappings, notifications, fallbackPolicies] = await Promise.all([
      this.store.listSupplierItemSnapshots(supplierId),
      this.store.listTargetPolicies(supplierId).catch(() => []),
      this.store.listApprovedItemMappings(supplierId).catch(() => []),
      this.store.listNotificationEvents({ supplierId, limit: 20 }).catch(() => []),
      this.store.listLearnedFallbackPolicies(supplierId).catch(() => []),
    ]);

    // Get latest stock observations for each item
    const stockObservations: Array<{ itemId: string; quantity: number | null; status: string }> =
      [];
    for (const item of items.slice(0, 50)) {
      try {
        const obs = await this.store.listStockObservations(supplierId, item.supplierItemId);
        const latest = obs[obs.length - 1];
        if (latest) {
          stockObservations.push({
            itemId: item.supplierItemId,
            quantity: latest.quantity,
            status: latest.status,
          });
        }
      } catch {
        /* skip */
      }
    }

    // ── Build prompt blocks ──────────────────────────────
    const itemsSummary = items
      .slice(0, 50)
      .map(
        (i) =>
          `- ${i.supplierItemId}: ${i.title} | SKU: ${i.sku ?? "N/A"} | Precio: ${i.price ?? "N/A"} ${i.currency ?? ""} | Confianza: ${i.confidence}`,
      )
      .join("\n");

    const stockSummary = stockObservations
      .map((s) => `- ${s.itemId}: stock=${s.quantity ?? "?"} | status=${s.status}`)
      .join("\n");

    const mappingSummary = mappings
      .slice(0, 30)
      .map(
        (m) => `- ${m.supplierItemId} → ${m.targetSellerId}/${m.targetItemId} (state: ${m.state})`,
      )
      .join("\n");

    const policySummary = policies
      .map(
        (p) =>
          `- scope: ${p.scopeType}/${p.scopeId} | targets: ${p.targetSellerIds.join(",")} | lowStock: ${p.lowStockThreshold} | autoPause: ${p.autoPauseAllowed}`,
      )
      .join("\n");

    // Spanish system prompt preserved from pre-gateway implementation
    const stablePrefix = [
      "Sos un asesor interno de Supplier Mirror para el CEO de MSL.",
      "Analizás datos de proveedores y generás hallazgos accionables.",
      "Reglas:",
      "- No sugerir publicar, pausar, o cambiar precios sin aprobación explícita del CEO.",
      "- Priorizar alertas de stock bajo y oportunidades de margen.",
      "- Detectar discrepancias entre stock del proveedor y mappings activos.",
      "- Responder en español, directo, sin markdown excesivo.",
      "- Cada hallazgo debe incluir: qué, por qué, evidencia, acción sugerida.",
    ].join("\n");

    const volatileInput = [
      `## Proveedor: ${supplierName} (${supplierId})`,
      question ? `\n### Consulta del CEO: ${question}\n` : "",
      `\n### Items del proveedor (${items.length} total, mostrando ${Math.min(50, items.length)}):`,
      itemsSummary || "(sin items)",
      `\n### Stock actual:`,
      stockSummary || "(sin datos de stock)",
      `\n### Mappings activos (${mappings.length}):`,
      mappingSummary || "(sin mappings)",
      `\n### Políticas:`,
      policySummary || "(sin políticas)",
      `\n### Notificaciones recientes (${notifications.length}):`,
      notifications
        .slice(0, 5)
        .map((n) => `- [${n.type}] ${n.reason}`)
        .join("\n") || "(sin notificaciones)",
      `\n### Fallback lessons aprendidas (${fallbackPolicies.length}):`,
      fallbackPolicies
        .map((f) => `- ${f.policyType}: ${String((f.decision as { summary: string }).summary ?? "ver detalle")}`)
        .join("\n") || "(sin lecciones)",
      `\n\nAnalizá los datos y devolvé hallazgos en este formato JSON:`,
      `{ "findings": [{ "kind": "stock-alert|price-opportunity|mapping-suggestion|policy-recommendation|general-insight", "severity": "info|warning|critical", "summary": "una línea", "detail": "explicación", "evidenceIds": ["id1"] }], "summary": "resumen general en 2-3 oraciones" }`,
    ].join("\n");

    // ── Call DeepSeek via gateway ─────────────────────────
    const gateway = this.getGateway();
    const result = await gateway.reason({
      laneId: "supplier-mirror",
      level: ReasoningLevel.Classification,
      stablePrefix,
      volatileInput,
      departmentId: "supplier-mirror",
      agentId: "supplier-mirror-advisor",
    });

    // ── Parse response ────────────────────────────────────
    const telemetry = result.costTelemetry;
    let parsed: { findings?: SupplierMirrorAnalysisFinding[]; summary?: string } = {};
    try {
      const content = result.rawResponse ?? "{}";
      parsed = JSON.parse(content) as {
        findings?: SupplierMirrorAnalysisFinding[];
        summary?: string;
      };
    } catch {
      parsed = { findings: [], summary: "DeepSeek response could not be parsed." };
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
