import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import type { StorefrontCandidate, StorefrontCandidateScore } from "@msl/domain";
import { DeepSeekFakeTransport } from "../conversation/transports/deepseekTransport.js";
import type { DeepSeekChatResponse } from "../conversation/transports/deepseekTransport.js";
import {
  OwnedEcommerceMerchandisingAdvisor,
  type MerchandisingAdvisorResult,
  type RankingReasoning,
} from "./ownedEcommerceMerchandisingAdvisor.js";
import {
  buildStableSystemPrompt,
  buildEvidenceBlock,
  buildOutputSchema,
  buildFullPrompt,
  hashStablePrompt,
  hashEvidenceBlock,
} from "./ownedEcommerceAdvisorPrompt.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<StorefrontCandidate> = {}): StorefrontCandidate {
  const base: StorefrontCandidate = {
    id: crypto.randomUUID(),
    itemRef: "MLC12345",
    title: "Bicicleta Mountain Bike Pro",
    provenance: {
      source: "supplier-web-signal",
      sourceId: "supplier-web-signal:jinpeng:SKU-001",
      supplierId: "jinpeng",
      snapshotIds: [],
      cortexNodeIds: ["1", "2", "3"],
      evidenceIds: ["evt-001", "evt-002"],
    },
    evidenceIds: ["evt-001", "evt-002"],
    evidenceState: {
      stockFreshness: "fresh",
      marginFreshness: "fresh",
      supplierFreshness: "fresh",
      completeness: "complete",
      evidenceIds: ["evt-001", "evt-002"],
    },
    stock: {
      status: "in-stock",
      authority: "stock-authoritative",
      quantity: 150,
      evidenceId: "evt-001",
    },
    margin: {
      value: 42,
      currency: "USD",
      evidenceId: "evt-002",
    },
    blockedReasons: [],
    redactedReasons: [],
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...overrides, id: overrides.id ?? base.id };
}

function makeScore(
  candidateId: string,
  overrides: Partial<StorefrontCandidateScore> = {},
): StorefrontCandidateScore {
  return {
    score: 75,
    confidence: "high",
    blockers: [],
    warnings: [],
    strengths: ["Positive margin confirmed", "Stock available"],
    missingEvidence: [],
    recommendedAction: "prepare-storefront-projection",
    ...overrides,
    ...(overrides.confidence ? { confidence: overrides.confidence } : {}),
  };
}

/** Builds a fake DeepSeek response JSON string with ranking reasoning. */
function rankingFixture(candidates: StorefrontCandidate[]): string {
  const reasoning = candidates.map((c, i) => ({
    rank: i + 1,
    candidateId: c.id,
    rationale: `Top pick for ${c.title} — strong margin and stock.`,
    evidenceIds: c.evidenceIds.slice(0, 1),
    fallback: false,
  }));

  return JSON.stringify({
    reasoning,
    positioningAngles: ["Best seller potential", "High margin opportunity"],
    confidence: 0.85,
  });
}

/** Builds a fake DeepSeek response for SEO/GEO copy. */
function seoGeoFixture(candidate: StorefrontCandidate): string {
  return JSON.stringify({
    seoSuggestions: {
      seoTitle: `${candidate.title} — Comprá Online | Envío Rápido`,
      seoDescription: `${candidate.title} disponible en tienda propia. Precio competitivo, stock garantizado, envío a todo Chile.`,
      keywords: [candidate.title.toLowerCase(), "tienda online", "envío rápido"],
    },
    geoSuggestions: {
      geoSummary: `Compra ${candidate.title} con confianza. Producto verificado, precio transparente.`,
      faq: [
        {
          question: "¿Tienen stock disponible?",
          answer: "Sí, stock verificado por el proveedor.",
          evidenceIds: ["evt-001"],
        },
      ],
    },
    confidence: 0.9,
  });
}

/** Builds a fake DeepSeek response for channel tradeoffs. */
function channelTradeoffsFixture(): string {
  return JSON.stringify({
    channelTradeoffs: [
      {
        channel: "Plasticov",
        upsides: ["Alto tráfico", "Compradores frecuentes"],
        risks: ["Comisión ML reduce margen"],
        overallAssessment: "Buen canal para volumen, margen ajustado por comisiones.",
      },
      {
        channel: "Maustian",
        upsides: ["Nicho de fidelización"],
        risks: ["Menor tráfico que Plasticov"],
        overallAssessment: "Ideal para productos premium con compradores recurrentes.",
      },
      {
        channel: "owned-ecommerce",
        upsides: ["Sin comisiones", "Control total de SEO"],
        risks: ["Requiere inversión en tráfico"],
        overallAssessment: "Mejor margen neto, requiere estrategia de adquisición.",
      },
      {
        channel: "unknown",
        upsides: [],
        risks: ["Sin datos suficientes"],
        overallAssessment: "Requiere más evidencia para evaluar.",
      },
    ],
    confidence: 0.8,
  });
}

/** Builds a fake DeepSeek response for experiment proposal. */
function experimentFixture(): string {
  return JSON.stringify({
    experimentProposal: {
      hypothesis:
        "Un título SEO optimizado aumentará el CTR en Google Shopping un 15% vs título genérico.",
      metric: "CTR en Google Shopping (Search Console)",
      stopRule: "500 impresiones o 14 días, lo que ocurra primero.",
      expectedLearning:
        "Validar si el SEO copy de DeepSeek supera al título derivado del producto.",
    },
    confidence: 0.75,
  });
}

/** Builds a fake DeepSeek response for missing evidence. */
function missingEvidenceFixture(candidateId: string): string {
  return JSON.stringify({
    missingEvidenceRequests: [
      {
        category: "cost",
        severity: "high",
        description: "Sin datos de costo del proveedor — no se puede calcular margen real.",
        candidateId,
        targetAgentId: "cost-supplier",
        question: "¿Cuál es el costo unitario actual del producto y la moneda?",
      },
      {
        category: "images",
        severity: "medium",
        description: "Sin imágenes de producto — necesario para storefront.",
        candidateId,
        targetAgentId: "creative-assets",
        question: "¿Hay imágenes de producto disponibles para este SKU?",
      },
    ],
    confidence: 0.7,
  });
}

/** Creates a DeepSeekChatResponse wrapping a JSON string as content. */
function fakeCompletion(jsonContent: string): DeepSeekChatResponse {
  return {
    id: `fake-cmpl-${crypto.randomUUID().slice(0, 8)}`,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: jsonContent },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 150,
      total_tokens: 350,
    },
  };
}

/** Creates a throwing DeepSeekChatResponse that will be caught as transport failure. */
function throwingTransport(): DeepSeekFakeTransport {
  // Create a transport that throws on createChatCompletion
  class ThrowingTransport extends DeepSeekFakeTransport {
    override async createChatCompletion(): Promise<DeepSeekChatResponse> {
      throw new Error("Simulated DeepSeek API failure");
    }
  }
  return new ThrowingTransport();
}

// ── Tests: Advisor ───────────────────────────────────────────────────

describe("OwnedEcommerceMerchandisingAdvisor", () => {
  describe("rankCandidatesWithReasoning", () => {
    // Scenario 1: with FakeTransport returns ranked list with rationale
    it("with FakeTransport returns ranked list with rationale", async () => {
      const candidates = [
        makeCandidate({ title: "Bike A" }),
        makeCandidate({ title: "Bike B" }),
        makeCandidate({ title: "Bike C" }),
      ];

      const transport = new DeepSeekFakeTransport([fakeCompletion(rankingFixture(candidates))]);

      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: transport,
        sellerId: "test-seller",
      });

      const result = await advisor.rankCandidatesWithReasoning(candidates);

      expect(result.reasoning).toHaveLength(3);
      expect(result.reasoning[0]!.rank).toBe(1);
      expect(result.reasoning[0]!.candidateId).toBe(candidates[0]!.id);
      expect(result.reasoning[0]!.rationale).toBeTruthy();
      expect(result.noMutationExecuted).toBe(true);
    });

    // Scenario 2: without transport returns score-order fallback
    it("without transport returns score-order fallback", async () => {
      const candidates = [
        makeCandidate({ id: "low-score", title: "Low Score" }),
        makeCandidate({ id: "high-score", title: "High Score" }),
      ];

      const scores: Record<string, StorefrontCandidateScore> = {
        "low-score": makeScore("low-score", { score: 30 }),
        "high-score": makeScore("high-score", { score: 90 }),
      };

      const advisor = new OwnedEcommerceMerchandisingAdvisor({ sellerId: "test-seller" });

      const result = await advisor.rankCandidatesWithReasoning(candidates, { scores });

      expect(result.reasoning).toHaveLength(2);
      // Higher score should be ranked first in fallback
      expect(result.reasoning[0]!.candidateId).toBe("high-score");
      expect(result.reasoning[0]!.fallback).toBe(true);
      expect(result.reasoning[1]!.candidateId).toBe("low-score");
      expect(result.reasoning[1]!.fallback).toBe(true);
      expect(result.noMutationExecuted).toBe(true);
    });
  });

  describe("draftSeoGeoCopy", () => {
    // Scenario 3: with FakeTransport returns SEO/GEO content
    it("with FakeTransport returns SEO/GEO content", async () => {
      const candidate = makeCandidate({ title: "Zapatillas Running" });

      const transport = new DeepSeekFakeTransport([fakeCompletion(seoGeoFixture(candidate))]);

      const advisor = new OwnedEcommerceMerchandisingAdvisor({ deepSeekTransport: transport });

      const result = await advisor.draftSeoGeoCopy(candidate);

      expect(result.seoSuggestions.seoTitle).toBeTruthy();
      expect(result.seoSuggestions.seoDescription).toBeTruthy();
      expect(result.seoSuggestions.keywords).toBeDefined();
      expect(result.geoSuggestions.geoSummary).toBeTruthy();
      expect(result.geoSuggestions.faq).toBeDefined();
      expect(result.geoSuggestions.faq!.length).toBeGreaterThan(0);
      expect(result.noMutationExecuted).toBe(true);
    });

    // Scenario 4: without transport returns empty enrichment (title-based fallback)
    it("without transport returns title-based fallback enrichment", async () => {
      const candidate = makeCandidate({ title: "Monitor 4K" });

      const advisor = new OwnedEcommerceMerchandisingAdvisor();

      const result = await advisor.draftSeoGeoCopy(candidate);

      expect(result.seoSuggestions.seoTitle).toContain("Monitor 4K");
      expect(result.seoSuggestions.seoDescription).toContain("Monitor 4K");
      expect(result.geoSuggestions.geoSummary).toContain("Monitor 4K");
      expect(result.seoSuggestions.keywords).toEqual([]);
      expect(result.geoSuggestions.faq).toEqual([]);
      expect(result.noMutationExecuted).toBe(true);
    });
  });

  describe("explainChannelTradeoffs", () => {
    // Scenario 5: returns all 4 channels
    it("with FakeTransport returns all 4 channels", async () => {
      const candidate = makeCandidate();

      const transport = new DeepSeekFakeTransport([fakeCompletion(channelTradeoffsFixture())]);

      const advisor = new OwnedEcommerceMerchandisingAdvisor({ deepSeekTransport: transport });

      const result = await advisor.explainChannelTradeoffs(candidate);

      const channelNames = result.channelTradeoffs.map((ct) => ct.channel);
      expect(channelNames).toContain("Plasticov");
      expect(channelNames).toContain("Maustian");
      expect(channelNames).toContain("owned-ecommerce");
      expect(channelNames).toContain("unknown");
      expect(result.noMutationExecuted).toBe(true);
    });

    // Also test fallback returns 4 channels
    it("fallback returns 4 channels with empty assessments", async () => {
      const candidate = makeCandidate();

      const advisor = new OwnedEcommerceMerchandisingAdvisor();

      const result = await advisor.explainChannelTradeoffs(candidate);

      expect(result.channelTradeoffs).toHaveLength(4);
      expect(result.channelTradeoffs.map((ct) => ct.channel).sort()).toEqual([
        "Maustian",
        "Plasticov",
        "owned-ecommerce",
        "unknown",
      ]);
      expect(result.noMutationExecuted).toBe(true);
    });
  });

  describe("proposeStorefrontExperiment", () => {
    // Scenario 6: returns hypothesis, metric, stopRule
    it("with FakeTransport returns hypothesis, metric, stopRule", async () => {
      const candidate = makeCandidate({ title: "Nuevo Producto Categoría X" });

      const transport = new DeepSeekFakeTransport([fakeCompletion(experimentFixture())]);

      const advisor = new OwnedEcommerceMerchandisingAdvisor({ deepSeekTransport: transport });

      const result = await advisor.proposeStorefrontExperiment(candidate);

      expect(result.experimentProposal).not.toBeNull();
      expect(result.experimentProposal!.hypothesis).toBeTruthy();
      expect(result.experimentProposal!.metric).toBeTruthy();
      expect(result.experimentProposal!.stopRule).toBeTruthy();
      expect(result.experimentProposal!.expectedLearning).toBeTruthy();
      expect(result.noMutationExecuted).toBe(true);
    });

    it("fallback returns null experimentProposal", async () => {
      const candidate = makeCandidate();

      const advisor = new OwnedEcommerceMerchandisingAdvisor();

      const result = await advisor.proposeStorefrontExperiment(candidate);

      expect(result.experimentProposal).toBeNull();
      expect(result.noMutationExecuted).toBe(true);
    });
  });

  describe("identifyMissingEvidence", () => {
    // Scenario 7: returns requests with valid targetAgentIds
    it("with FakeTransport returns requests with valid targetAgentIds", async () => {
      const candidate = makeCandidate();
      const validAgents = new Set([
        "cost-supplier",
        "market-catalog",
        "creative-assets",
        "account-brain",
        "supplier-manager",
      ]);

      const transport = new DeepSeekFakeTransport([
        fakeCompletion(missingEvidenceFixture(candidate.id)),
      ]);

      const advisor = new OwnedEcommerceMerchandisingAdvisor({ deepSeekTransport: transport });

      const result = await advisor.identifyMissingEvidence(candidate);

      expect(result.missingEvidenceRequests.length).toBeGreaterThan(0);
      for (const mr of result.missingEvidenceRequests) {
        expect(mr.candidateId).toBe(candidate.id);
        expect(validAgents.has(mr.targetAgentId)).toBe(true);
        expect(mr.question).toBeTruthy();
      }
      expect(result.noMutationExecuted).toBe(true);
    });

    it("fallback returns empty missing evidence requests", async () => {
      const candidate = makeCandidate();

      const advisor = new OwnedEcommerceMerchandisingAdvisor();

      const result = await advisor.identifyMissingEvidence(candidate);

      expect(result.missingEvidenceRequests).toEqual([]);
      expect(result.noMutationExecuted).toBe(true);
    });
  });

  // Scenario 8: All results have noMutationExecuted: true
  describe("noMutationExecuted contract", () => {
    it("all methods return noMutationExecuted: true (fallback)", async () => {
      const candidate = makeCandidate();
      const advisor = new OwnedEcommerceMerchandisingAdvisor();

      const results = await Promise.all([
        advisor.rankCandidatesWithReasoning([candidate]),
        advisor.draftSeoGeoCopy(candidate),
        advisor.explainChannelTradeoffs(candidate),
        advisor.proposeStorefrontExperiment(candidate),
        advisor.identifyMissingEvidence(candidate),
      ]);

      for (const result of results) {
        expect(result.noMutationExecuted).toBe(true);
      }
    });

    it("empty candidates ranking returns noMutationExecuted: true", async () => {
      const advisor = new OwnedEcommerceMerchandisingAdvisor();

      const result = await advisor.rankCandidatesWithReasoning([]);

      expect(result.reasoning).toEqual([]);
      expect(result.noMutationExecuted).toBe(true);
    });
  });

  // Scenario 9: Transport failure degrades gracefully
  describe("error handling", () => {
    it("transport failure degrades gracefully — rankCandidatesWithReasoning", async () => {
      const candidates = [makeCandidate()];
      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: throwingTransport(),
      });

      // Should NOT throw
      const result = await advisor.rankCandidatesWithReasoning(candidates);
      expect(result.noMutationExecuted).toBe(true);
      expect(result.reasoning.length).toBeGreaterThan(0);
      expect(result.reasoning[0]!.fallback).toBe(true);
    });

    it("transport failure degrades gracefully — draftSeoGeoCopy", async () => {
      const candidate = makeCandidate();
      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: throwingTransport(),
      });

      // Should NOT throw
      const result = await advisor.draftSeoGeoCopy(candidate);
      expect(result.noMutationExecuted).toBe(true);
      expect(result.seoSuggestions.seoTitle).toBeTruthy();
    });

    it("transport failure degrades gracefully — explainChannelTradeoffs", async () => {
      const candidate = makeCandidate();
      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: throwingTransport(),
      });

      const result = await advisor.explainChannelTradeoffs(candidate);
      expect(result.noMutationExecuted).toBe(true);
      expect(result.channelTradeoffs).toHaveLength(4);
    });

    it("transport failure degrades gracefully — proposeStorefrontExperiment", async () => {
      const candidate = makeCandidate();
      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: throwingTransport(),
      });

      const result = await advisor.proposeStorefrontExperiment(candidate);
      expect(result.noMutationExecuted).toBe(true);
      expect(result.experimentProposal).toBeNull();
    });

    it("transport failure degrades gracefully — identifyMissingEvidence", async () => {
      const candidate = makeCandidate();
      const advisor = new OwnedEcommerceMerchandisingAdvisor({
        deepSeekTransport: throwingTransport(),
      });

      const result = await advisor.identifyMissingEvidence(candidate);
      expect(result.noMutationExecuted).toBe(true);
      expect(result.missingEvidenceRequests).toEqual([]);
    });
  });
});

// ── Tests: Prompt Builder ────────────────────────────────────────────

describe("OwnedEcommerceAdvisorPrompt", () => {
  // Scenario 10 (prompt): Stable prompt hash identical across calls with same config
  it("stable prompt hash is identical across calls with same config", () => {
    const config = { sellerId: "plasticov" };
    const prompt1 = buildStableSystemPrompt(config);
    const prompt2 = buildStableSystemPrompt(config);

    const hash1 = hashStablePrompt(prompt1 + "\n\n" + buildOutputSchema());
    const hash2 = hashStablePrompt(prompt2 + "\n\n" + buildOutputSchema());

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // sha256 hex digest
  });

  // Scenario 11: Stable prompt hash different with different sellerId
  it("stable prompt hash is different with different sellerId", () => {
    const prompt1 = buildStableSystemPrompt({ sellerId: "plasticov" });
    const prompt2 = buildStableSystemPrompt({ sellerId: "maustian" });

    const hash1 = hashStablePrompt(prompt1 + "\n\n" + buildOutputSchema());
    const hash2 = hashStablePrompt(prompt2 + "\n\n" + buildOutputSchema());

    expect(hash1).not.toBe(hash2);
  });

  // Scenario 12: Evidence hash changes with different candidates
  it("evidence hash changes with different candidates", () => {
    const candidateA = makeCandidate({ id: "cand-a", title: "Product A" });
    const candidateB = makeCandidate({ id: "cand-b", title: "Product B" });

    const evidenceA = buildEvidenceBlock([candidateA]);
    const evidenceB = buildEvidenceBlock([candidateB]);

    const hashA = hashEvidenceBlock(evidenceA);
    const hashB = hashEvidenceBlock(evidenceB);

    expect(hashA).not.toBe(hashB);
  });

  // Scenario 13: Evidence hash stable for same candidates
  it("evidence hash is stable for same candidates", () => {
    const candidate = makeCandidate({ id: "stable-cand", title: "Stable Product" });

    const evidence1 = buildEvidenceBlock([candidate]);
    const evidence2 = buildEvidenceBlock([candidate]);

    const hash1 = hashEvidenceBlock(evidence1);
    const hash2 = hashEvidenceBlock(evidence2);

    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64);
  });

  // Scenario 14: Safety policy (A block) always included in stable prompt
  it("safety policy (A block) is always included in stable prompt", () => {
    const prompt = buildStableSystemPrompt({ sellerId: "test" });

    expect(prompt).toContain("Website Manager");
    expect(prompt).toContain("noMutationExecuted");
    expect(prompt).toContain("CEO");
    expect(prompt).toContain("Plasticov");
    expect(prompt).toContain("Maustian");
    expect(prompt).toContain("Owned Ecommerce");
  });

  // Scenario 15: buildFullPrompt returns correct hashes
  it("buildFullPrompt returns hashes matching direct computation", () => {
    const candidate = makeCandidate();

    const full = buildFullPrompt([candidate], { sellerId: "test" });

    const directStableHash = hashStablePrompt(
      buildStableSystemPrompt({ sellerId: "test" }) + "\n\n" + buildOutputSchema(),
    );
    const directEvidenceHash = hashEvidenceBlock(buildEvidenceBlock([candidate]));

    expect(full.stableHash).toBe(directStableHash);
    expect(full.evidenceHash).toBe(directEvidenceHash);
    expect(full.fullPrompt).toContain("Website Manager");
    expect(full.fullPrompt).toContain(candidate.title);
  });

  // Additional: empty candidates evidence block
  it("evidence block handles empty candidates", () => {
    const block = buildEvidenceBlock([]);
    expect(block).toContain("sin candidatos");
    const hash = hashEvidenceBlock(block);
    expect(hash.length).toBe(64);
  });

  // Additional: output schema is stable and includes key fields
  it("output schema is stable across calls and includes expected fields", () => {
    const schema1 = buildOutputSchema();
    const schema2 = buildOutputSchema();
    expect(schema1).toBe(schema2);
    expect(schema1).toContain("reasoning");
    expect(schema1).toContain("seoSuggestions");
    expect(schema1).toContain("confidence");
    expect(schema1).toContain("json");
  });
});
