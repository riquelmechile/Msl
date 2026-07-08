import OpenAI from "openai";
import type { SupplierMirrorStore } from "@msl/memory";
import {
  selectSupplierMirrorDeepSeekModel,
  estimateSupplierMirrorDeepSeekCostMicros,
  SUPPLIER_MIRROR_DEEPSEEK_V4_FLASH,
} from "./supplierMirrorDeepSeekPolicy.js";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";

export type SupplierMirrorAnalysisInput = {
  supplierId: string;
  supplierName: string;
  question?: string; // optional specific question from CEO
};

export type SupplierMirrorAnalysisFinding = {
  kind: "stock-alert" | "price-opportunity" | "mapping-suggestion" | "policy-recommendation" | "general-insight";
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
    const stockObservations: Array<{ itemId: string; quantity: number | null; status: string }> = [];
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
      } catch { /* skip */ }
    }

    // ── Build prompt ──────────────────────────────────────
    const model = selectSupplierMirrorDeepSeekModel({
      operation: "supplier-extraction",
      hardPolicyConflict: false,
    });

    const itemsSummary = items.slice(0, 50).map(i =>
      `- ${i.supplierItemId}: ${i.title} | SKU: ${i.sku ?? "N/A"} | Precio: ${i.price ?? "N/A"} ${i.currency ?? ""} | Confianza: ${i.confidence}`
    ).join("\n");

    const stockSummary = stockObservations.map(s =>
      `- ${s.itemId}: stock=${s.quantity ?? "?"} | status=${s.status}`
    ).join("\n");

    const mappingSummary = mappings.slice(0, 30).map(m =>
      `- ${m.supplierItemId} → ${m.targetSellerId}/${m.targetItemId} (state: ${m.state})`
    ).join("\n");

    const policySummary = policies.map(p =>
      `- scope: ${p.scopeType}/${p.scopeId} | targets: ${p.targetSellerIds.join(",")} | lowStock: ${p.lowStockThreshold} | autoPause: ${p.autoPauseAllowed}`
    ).join("\n");

    const systemPrompt = [
      "Sos un asesor interno de Supplier Mirror para el CEO de MSL.",
      "Analizás datos de proveedores y generás hallazgos accionables.",
      "Reglas:",
      "- No sugerir publicar, pausar, o cambiar precios sin aprobación explícita del CEO.",
      "- Priorizar alertas de stock bajo y oportunidades de margen.",
      "- Detectar discrepancias entre stock del proveedor y mappings activos.",
      "- Responder en español, directo, sin markdown excesivo.",
      "- Cada hallazgo debe incluir: qué, por qué, evidencia, acción sugerida.",
    ].join("\n");

    const userPrompt = [
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
      notifications.slice(0, 5).map(n => `- [${n.type}] ${n.reason}`).join("\n") || "(sin notificaciones)",
      `\n### Fallback lessons aprendidas (${fallbackPolicies.length}):`,
      fallbackPolicies.map(f => `- ${f.policyType}: ${f.decision.summary ?? "ver detalle"}`).join("\n") || "(sin lecciones)",
      `\n\nAnalizá los datos y devolvé hallazgos en este formato JSON:`,
      `{ "findings": [{ "kind": "stock-alert|price-opportunity|mapping-suggestion|policy-recommendation|general-insight", "severity": "info|warning|critical", "summary": "una línea", "detail": "explicación", "evidenceIds": ["id1"] }], "summary": "resumen general en 2-3 oraciones" }`,
    ].join("\n");

    // ── Call DeepSeek ─────────────────────────────────────
    const startTime = Date.now();
    const completion = await this.openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    } as any);

    const usage = completion.usage ?? { prompt_tokens: 0, completion_tokens: 0 };
    const cacheHitTokens = (completion as any).usage?.prompt_cache_hit_tokens ?? 0;
    const cacheMissTokens = (completion as any).usage?.prompt_cache_miss_tokens ?? usage.prompt_tokens;
    const durationMs = Date.now() - startTime;

    // ── Parse response ────────────────────────────────────
    let parsed: { findings?: SupplierMirrorAnalysisFinding[]; summary?: string } = {};
    try {
      const content = completion.choices[0]?.message?.content ?? "{}";
      parsed = JSON.parse(content);
    } catch {
      parsed = { findings: [], summary: "DeepSeek response could not be parsed." };
    }

    // ── Record cost ───────────────────────────────────────
    const costMicros = estimateSupplierMirrorDeepSeekCostMicros({
      model,
      promptCacheHitTokens: cacheHitTokens,
      promptCacheMissTokens: cacheMissTokens,
      outputTokens: usage.completion_tokens,
    });

    if (this.ledger) {
      try {
        this.ledger.insertEntry({
          entryId: `supplier-mirror-advisor:${supplierId}:${Date.now()}`,
          agentId: "supplier-mirror-advisor",
          operation: "supplier-extraction",
          provider: "deepseek",
          model,
          promptCacheHitTokens: cacheHitTokens,
          promptCacheMissTokens: cacheMissTokens,
          outputTokens: usage.completion_tokens,
          estimatedCostMicros: costMicros ?? 0,
          metadata: { supplierId, supplierName },
        });
      } catch { /* ledger is best-effort */ }
    }

    return {
      findings: parsed.findings ?? [],
      summary: parsed.summary ?? "Análisis completado.",
      modelUsed: model,
      costMicros: costMicros ?? 0,
      cacheHitTokens,
      cacheMissTokens,
      outputTokens: usage.completion_tokens,
    };
  }
}
