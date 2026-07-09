import OpenAI from "openai";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { DeepSeekReasoningGateway } from "../reasoning/DeepSeekReasoningGateway.js";
import { ReasoningLevel } from "../reasoning/reasoningTypes.js";

// ── Types ────────────────────────────────────────────────────────────

export type CreativeActionableFinding = {
  itemId: string;
  title?: string;
  signalKind:
    | "low-image-count"
    | "moderation-blocked"
    | "poor-pictures-score"
    | "high-traffic-poor-creative"
    | "moderated-in-campaign"
    | "high-visit-low-conversion";
  severity: "warning" | "critical";
  pictureCount?: number;
  visits?: number;
  avgVisits?: number;
  orders?: number;
  conversionRate?: number;
};

export type CreativeEnrichmentInput = {
  daemonKind: "creative-assets" | "creative-commercial";
  actionableFindings: CreativeActionableFinding[];
  question?: string;
};

export type CreativeEnrichmentFinding = {
  kind: "creative-quality" | "conversion-risk" | "campaign-risk" | "priority-action";
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: string;
  evidenceIds: string[];
};

export type CreativeEnrichment = {
  findings: CreativeEnrichmentFinding[];
  summary: string;
  modelUsed: string;
  costMicros: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
};

// ── Advisor ──────────────────────────────────────────────────────────

export class CreativeDeepSeekAdvisor {
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

  async analyze(input: CreativeEnrichmentInput): Promise<CreativeEnrichment> {
    const { daemonKind, actionableFindings, question } = input;

    // ── Build prompt blocks ──────────────────────────────────
    const findingsSummary = actionableFindings
      .map((f) => {
        const parts = [`- ${f.signalKind} (${f.severity})`, `item: ${f.itemId}`];
        if (f.title) parts.push(`"${f.title}"`);
        if (f.pictureCount !== undefined) parts.push(`pictures: ${f.pictureCount}`);
        if (f.visits !== undefined) parts.push(`visits: ${f.visits}`);
        if (f.avgVisits !== undefined) parts.push(`avg_visits: ${f.avgVisits}`);
        if (f.orders !== undefined) parts.push(`orders: ${f.orders}`);
        if (f.conversionRate !== undefined)
          parts.push(`conversion: ${(f.conversionRate * 100).toFixed(1)}%`);
        return parts.join(" | ");
      })
      .join("\n");

    const daemonLabel =
      daemonKind === "creative-assets"
        ? "Activos Creativos (imágenes, moderación, calidad visual)"
        : "Comercial Creativo (tráfico, conversión)";

    // Spanish system prompt — creative analyst role
    const stablePrefix = [
      "Sos un asesor interno de Estrategia Creativa para el CEO de MSL.",
      `Analizás señales del daemon ${daemonLabel} y generás hallazgos accionables.`,
      "Reglas:",
      "- No sugerir acciones que requieran mutaciones sin aprobación explícita del CEO.",
      "- Priorizar hallazgos según severidad y urgencia (moderated-in-campaign es crítico).",
      "- Detectar patrones entre listings con problemas creativos similares.",
      "- Responder en español, directo, sin markdown excesivo.",
      "- Cada hallazgo debe incluir: qué, por qué, evidencia, acción sugerida.",
    ].join("\n");

    const volatileInput = [
      question ? `\n### Consulta del CEO: ${question}\n` : "",
      `\n### Hallazgos del daemon (${daemonKind}):`,
      findingsSummary || "(sin hallazgos)",
      `\n\nAnalizá los datos y devolvé hallazgos en este formato JSON:`,
      `{ "findings": [{ "kind": "creative-quality|conversion-risk|campaign-risk|priority-action", "severity": "info|warning|critical", "summary": "una línea", "detail": "explicación", "evidenceIds": ["itemId1"] }], "summary": "resumen general en 2-3 oraciones" }`,
    ].join("\n");

    // ── Call DeepSeek via gateway ────────────────────────────
    const gateway = this.getGateway();
    const result = await gateway.reason({
      laneId: daemonKind,
      level: ReasoningLevel.Classification,
      stablePrefix,
      volatileInput,
      departmentId: "creative",
      agentId: "creative-advisor",
    });

    // ── Parse response ───────────────────────────────────────
    const telemetry = result.costTelemetry;
    let parsed: { findings?: CreativeEnrichmentFinding[]; summary?: string } = {};
    try {
      const content = result.rawResponse ?? "{}";
      parsed = JSON.parse(content) as {
        findings?: CreativeEnrichmentFinding[];
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
