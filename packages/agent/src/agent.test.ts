import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { answerBusinessQuestion, type BusinessContext } from "./index.js";
import { hasRejectionPattern, resolveTurnOutcome } from "./conversation/agentLoop.js";
import { createCompanyAgentStore } from "./conversation/companyAgentStore.js";
import { createCompanyAgentLearningStore } from "./conversation/companyAgentLearningStore.js";
import { createRequestAgentEvidenceTool } from "./conversation/tools.js";
import {
  createGraphEngine,
  createSqliteSupplierMirrorStore,
  type SupplierMirrorStore,
} from "@msl/memory";
import { EscribanoObserver } from "./conversation/escribano.js";
import type { AgentProposal, ConversationState } from "./conversation/types.js";
import {
  applySupplierPricingPolicy,
  createSupplierMirrorTools,
  parseSupplierPricingPolicyText,
} from "./conversation/supplierMirrorTools.js";

const context: BusinessContext = {
  sellerId: "seller-1",
  knownFacts: ["MLC", "supplier after sale"],
  learnedPreferences: [],
};

describe("principal business agent orchestration", () => {
  it("answers in Spanish with a recommendation and rationale when enough context exists", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "¿Qué priorizo hoy?",
        topic: "daily-priorities",
        availableContext: ["sales", "claims"],
        requiredContext: ["sales", "claims"],
      },
    });

    expect(response.language).toBe("es");
    expect(response.recommendation).toContain("utilidad");
    expect(response.rationale).toContain(
      "Usé el contexto operativo disponible y las preferencias aprendidas del vendedor.",
    );
  });

  it("asks for missing context instead of guessing", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "¿Bajo el precio?",
        topic: "margin",
        availableContext: ["current price"],
        requiredContext: ["current price", "supplier cost"],
      },
    });

    expect(response.recommendation).toBeNull();
    expect(response.missingContextQuestions).toEqual(["¿Puede confirmar costo del proveedor?"]);
    expect(response.missingContextQuestions.join(" ")).not.toContain("supplier cost");
  });

  it("uses Spanish missing-context labels instead of leaking unknown internal labels", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "¿Puedo prometer entrega hoy?",
        topic: "customer-treatment",
        availableContext: [],
        requiredContext: ["shipping SLA"],
      },
    });

    expect(response.missingContextQuestions).toEqual([
      "¿Puede confirmar el dato operativo faltante?",
    ]);
    expect(response.missingContextQuestions.join(" ")).not.toContain("shipping SLA");
  });

  it("learns corrections and adapts future recommendations", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "Corregí: priorizá margen mínimo 18%.",
        topic: "margin",
        availableContext: ["margin"],
        requiredContext: ["margin"],
        correction: {
          topic: "margin",
          preference: "margen mínimo 18%",
          learnedFrom: "correction",
          riskLevel: "low",
        },
      },
    });

    expect(response.learnedPreferences).toContainEqual(
      expect.objectContaining({ topic: "margin", preference: "margen mínimo 18%" }),
    );
    expect(response.recommendation).toContain("margen mínimo 18%");
  });

  it("surfaces safety conflicts instead of blindly applying risky preferences", () => {
    const response = answerBusinessQuestion({
      context,
      request: {
        sellerId: "seller-1",
        question: "Respondé siempre duro a los reclamos.",
        topic: "claims",
        availableContext: ["claim"],
        requiredContext: ["claim"],
        proposedPreference: {
          topic: "claims",
          preference: "rechazar reclamos por defecto",
          learnedFrom: "explicit-instruction",
          riskLevel: "high",
        },
      },
    });

    expect(response.safetyConflict).toContain("riesgo de reputación");
    expect(response.recommendation).toContain("alternativa más segura");
  });

  it("keeps multi-agent orchestration as evidence-driven candidate logic only", () => {
    const response = answerBusinessQuestion({
      context: {
        ...context,
        specializationEvidence: {
          sellerId: "seller-1",
          workflowName: "supplier sourcing after sale",
          observedExamples: 1,
          hasDecisionCriteria: false,
          hasOutcomeHistory: false,
          hasSafetyBoundaries: false,
          learnedFromCorrections: false,
        },
      },
      request: {
        sellerId: "seller-1",
        question: "Creá un agente para compras.",
        topic: "automation",
        availableContext: ["workflow"],
        requiredContext: ["workflow"],
        asksForSpecializedAgent: true,
      },
    });

    expect(response.specializationCandidate.status).toBe("needs-more-evidence");
    expect(response.specializationCandidate.evidence).toContain("seller decision criteria");
  });
});

describe("durable company agent registry", () => {
  it("roundtrips CEO-created company agents in SQLite", () => {
    const db = new Database(":memory:");
    const store = createCompanyAgentStore(db);

    const agent = store.insertCompanyAgent({
      id: "agent:supplier-negotiator",
      label: "Supplier Negotiator",
      departmentId: "operations",
      stablePrefix: "supplier-negotiator",
      refreshableContextProvider: "supplier-negotiator-context",
      inputs: ["supplier costs"],
      outputs: ["negotiation evidence"],
      requiredEvidenceKinds: ["supplier-cost"],
      boundaries: ["No supplier messages without CEO confirmation."],
    });

    expect(agent.source).toBe("ceo-created");
    expect(agent.status).toBe("active");
    expect(store.getCompanyAgent("agent:supplier-negotiator")?.profile.label).toBe(
      "Supplier Negotiator",
    );
    expect(store.listCompanyAgents()).toHaveLength(1);
    expect(store.count()).toBe(1);

    db.close();
  });

  it("persists CEO-created company agents across database reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "msl-company-agents-"));
    const dbPath = join(tempDir, "company-agents.sqlite");
    let db: Database.Database | undefined;
    let reopenedDb: Database.Database | undefined;

    try {
      db = new Database(dbPath);
      const store = createCompanyAgentStore(db);
      store.insertCompanyAgent({
        id: "agent:ceo-created-persistent",
        label: "Persistent CEO Agent",
        departmentId: "operations",
        stablePrefix: "persistent-ceo-agent",
        refreshableContextProvider: "persistent-ceo-agent-context",
        inputs: ["supplier costs"],
        outputs: ["durable evidence"],
        requiredEvidenceKinds: ["supplier-cost"],
        boundaries: ["Evidence only; no external mutations."],
      });
      db.close();
      db = undefined;

      reopenedDb = new Database(dbPath);
      const reopenedStore = createCompanyAgentStore(reopenedDb);

      expect(reopenedStore.getCompanyAgent("agent:ceo-created-persistent")?.profile).toMatchObject({
        agentId: "agent:ceo-created-persistent",
        label: "Persistent CEO Agent",
        requiredEvidenceKinds: ["supplier-cost"],
      });
      expect(reopenedStore.listCompanyAgents().map((agent) => agent.id)).toContain(
        "agent:ceo-created-persistent",
      );

      reopenedDb.close();
      reopenedDb = undefined;
    } finally {
      reopenedDb?.close();
      db?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips malformed JSON rows instead of crashing registry reads", () => {
    const db = new Database(":memory:");
    const store = createCompanyAgentStore(db);
    store.insertCompanyAgent({
      id: "agent:valid",
      label: "Valid Agent",
      departmentId: "operations",
      stablePrefix: "valid-agent",
      refreshableContextProvider: "valid-agent-context",
      inputs: [],
      outputs: [],
      requiredEvidenceKinds: ["valid-evidence"],
      boundaries: ["Evidence only."],
    });
    db.prepare(
      `
        INSERT INTO company_agents (
          id,
          lane_id,
          label,
          department_id,
          stable_prefix,
          refreshable_context_provider,
          inputs,
          outputs,
          required_evidence_kinds,
          boundaries,
          source,
          status
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'ceo-created', 'active')
      `,
    ).run(
      "agent:poisoned",
      "Poisoned Agent",
      "operations",
      "poisoned-agent",
      "poisoned-agent-context",
      "not json",
      "[]",
      "[]",
      "[]",
    );

    expect(store.getCompanyAgent("agent:poisoned")).toBeUndefined();
    expect(store.listCompanyAgents().map((agent) => agent.id)).toEqual(["agent:valid"]);

    db.close();
  });

  it("resolves durable agents in request_agent_evidence when a registry is injected", () => {
    const db = new Database(":memory:");
    const store = createCompanyAgentStore(db);
    store.insertCompanyAgent({
      id: "agent:catalog-auditor",
      label: "Catalog Auditor",
      departmentId: "operations",
      stablePrefix: "catalog-auditor",
      refreshableContextProvider: "catalog-auditor-context",
      inputs: ["catalog snapshots"],
      outputs: ["catalog evidence"],
      requiredEvidenceKinds: ["catalog-snapshot"],
      boundaries: ["Evidence only; no listing edits."],
    });

    const tool = createRequestAgentEvidenceTool(store);
    const response = tool.execute({
      targetAgent: "agent:catalog-auditor",
      scope: "Review catalog coverage",
      requestedEvidenceKinds: ["catalog-snapshot"],
      existingEvidenceIds: ["ev-1"],
    });

    expect(response).toMatchObject({
      status: "evidence-ready",
      targetAgent: "agent:catalog-auditor",
      requiredEvidenceKinds: ["catalog-snapshot"],
      evidenceIds: ["ev-1"],
      noMutationExecuted: true,
    });

    db.close();
  });

  it("blocks archived and unknown company agents", () => {
    const db = new Database(":memory:");
    const store = createCompanyAgentStore(db);
    store.insertCompanyAgent({
      id: "agent:archived",
      label: "Archived Agent",
      departmentId: "commercial",
      stablePrefix: "archived-agent",
      refreshableContextProvider: "archived-agent-context",
      inputs: [],
      outputs: [],
      requiredEvidenceKinds: ["commercial-context"],
      boundaries: ["Archived agent must not receive work."],
    });
    store.archiveCompanyAgent("agent:archived");

    const tool = createRequestAgentEvidenceTool(store);
    const archived = tool.execute({
      targetAgent: "agent:archived",
      scope: "Review archived work",
      requestedEvidenceKinds: ["commercial-context"],
    });
    const unknown = tool.execute({
      targetAgent: "agent:missing",
      scope: "Review missing work",
      requestedEvidenceKinds: ["commercial-context"],
    });

    expect(archived).toMatchObject({
      status: "blocked",
      missingInputs: ["active targetAgent"],
      noMutationExecuted: true,
    });
    expect(unknown).toMatchObject({
      status: "blocked",
      missingInputs: ["known targetAgent"],
      noMutationExecuted: true,
    });

    db.close();
  });
});

describe("durable company agent learning store", () => {
  it("persists agent lessons across database reopen", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "msl-agent-lessons-"));
    const dbPath = join(tempDir, "agent-lessons.sqlite");
    let db: Database.Database | undefined;
    let reopenedDb: Database.Database | undefined;

    try {
      db = new Database(dbPath);
      const store = createCompanyAgentLearningStore(db);
      store.insertAgentLesson({
        lessonId: "lesson:pricing-001",
        targetAgentId: "pricing-analyst",
        departmentId: "commercial",
        scope: "agent",
        lessonType: "outcome-lesson",
        summary: "Supplier evidence changed the price decision.",
        evidenceIds: ["evidence:price-1"],
        confidence: 0.8,
        impact: 0.7,
        outcome: "avoided low-margin listing",
      });
      db.close();
      db = undefined;

      reopenedDb = new Database(dbPath);
      const reopenedStore = createCompanyAgentLearningStore(reopenedDb);

      expect(reopenedStore.listAgentLessons({ targetAgentId: "pricing-analyst" })).toEqual([
        expect.objectContaining({
          lessonId: "lesson:pricing-001",
          targetAgentId: "pricing-analyst",
          departmentId: "commercial",
          evidenceIds: ["evidence:price-1"],
          outcome: "avoided low-margin listing",
        }),
      ]);
      reopenedDb.close();
      reopenedDb = undefined;
    } finally {
      reopenedDb?.close();
      db?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips malformed learning rows instead of poisoning reads", () => {
    const db = new Database(":memory:");
    const store = createCompanyAgentLearningStore(db);
    store.insertAgentLesson({
      lessonId: "lesson:valid",
      targetAgentId: "catalog-coach",
      departmentId: "operations",
      scope: "department",
      lessonType: "research-finding",
      summary: "Catalog evidence should be refreshed before analysis.",
      evidenceIds: ["evidence:catalog-1"],
      confidence: 0.75,
      impact: 0.6,
    });
    db.prepare(
      `
        INSERT INTO company_agent_lessons (
          lesson_id,
          target_agent_id,
          department_id,
          scope,
          lesson_type,
          summary,
          evidence_ids,
          confidence,
          impact,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      `,
    ).run(
      "lesson:poisoned",
      "catalog-coach",
      "operations",
      "department",
      "research-finding",
      "Poisoned lesson",
      "not json",
      0.7,
      0.6,
    );

    expect(store.listAgentLessons().map((lesson) => lesson.lessonId)).toEqual(["lesson:valid"]);

    db.close();
  });
});

async function seedSupplierMirrorStore(store: SupplierMirrorStore): Promise<void> {
  await store.upsertSupplier({
    id: "jinpeng",
    name: "Jinpeng",
    enabled: true,
    primarySource: "mercadolibre-api",
    metadata: {},
    createdAt: "2026-07-04T00:00:00.000Z",
    updatedAt: "2026-07-04T00:00:00.000Z",
  });
  await store.upsertSupplierItemSnapshot({
    supplierId: "jinpeng",
    supplierItemId: "jp-1",
    mlItemId: "MLC-SUP-1",
    title: "Supplier Pump",
    categoryId: "MLC1743",
    price: 25000,
    currency: "CLP",
    snapshot: { brand: "Jinpeng" },
    source: "mercadolibre-api",
    confidence: "high",
    freshness: "fresh",
    evidenceId: "evidence:item-1",
    capturedAt: "2026-07-04T00:01:00.000Z",
  });
  await store.recordStockObservation({
    id: "stock-1",
    supplierId: "jinpeng",
    supplierItemId: "jp-1",
    source: "mercadolibre-api",
    authority: "stock-authoritative",
    quantity: 2,
    status: "low-stock",
    confidence: "high",
    evidenceId: "evidence:stock-1",
    capturedAt: "2026-07-04T00:02:00.000Z",
  });
  await store.upsertTargetPolicy({
    scopeType: "supplier",
    scopeId: "jinpeng",
    supplierId: "jinpeng",
    targetSellerIds: ["plasticov"],
    lowStockThreshold: 3,
    autoPauseAllowed: false,
    pricingPolicy: { kind: "multiplier", multiplier: 3 },
  });
  await store.upsertTargetMapping({
    supplierId: "jinpeng",
    supplierItemId: "jp-1",
    targetSellerId: "plasticov",
    targetItemId: "MLC-TARGET-1",
    policyRef: { scopeType: "supplier", scopeId: "jinpeng", supplierId: "jinpeng" },
    state: "approved",
    approvedAt: "2026-07-04T00:03:00.000Z",
    evidenceIds: ["evidence:mapping-1"],
  });
  await store.recordNotificationEvent({
    id: "notify-1",
    type: "pause-deferred",
    status: "pending",
    supplierId: "jinpeng",
    supplierItemId: "jp-1",
    targetSellerId: "plasticov",
    targetItemId: "MLC-TARGET-1",
    reason: "Auto-pause disabled by policy.",
    evidenceIds: ["evidence:stock-1"],
    metadata: { policy: "manual" },
    createdAt: "2026-07-04T00:04:00.000Z",
  });
}

describe("Supplier Mirror CEO tools and pricing policy", () => {
  it("parses and applies deterministic multiplier and CLP uplift policies", () => {
    expect(parseSupplierPricingPolicyText("usar x3 para Jinpeng")).toEqual({
      status: "parsed",
      policy: { kind: "multiplier", multiplier: 3 },
      normalized: "x3",
    });
    expect(parseSupplierPricingPolicyText("sumar +50.000 CLP")).toEqual({
      status: "parsed",
      policy: { kind: "fixed-uplift-clp", amount: 50000 },
      normalized: "+50000 CLP",
    });
    expect(
      applySupplierPricingPolicy({
        supplierPrice: 25000,
        policy: { kind: "multiplier", multiplier: 4 },
      }),
    ).toMatchObject({ status: "priced", proposedPrice: 100000 });
  });

  it("reviews supplier opportunities and notifications without worker selection or mutation", async () => {
    const db = new Database(":memory:");
    const store = createSqliteSupplierMirrorStore(db);
    await seedSupplierMirrorStore(store);

    const tools = new Map(createSupplierMirrorTools(store).map((tool) => [tool.name, tool]));
    const opportunities = await tools.get("review_supplier_mirror_opportunities")!.execute({
      supplierId: "jinpeng",
    });
    const notifications = await tools.get("review_supplier_mirror_notifications")!.execute({
      supplierId: "jinpeng",
    });

    expect(opportunities).toMatchObject({
      status: "ready",
      noMutationExecuted: true,
      workerSelectionExposed: false,
      opportunities: [
        {
          supplier: { id: "jinpeng" },
          item: { supplierItemId: "jp-1", price: 25000 },
          latestStockObservation: { status: "low-stock", evidenceId: "evidence:stock-1" },
          mappings: [{ targetSellerId: "plasticov", state: "approved" }],
          policy: { targetSellerIds: ["plasticov"], pricingPolicy: { kind: "multiplier" } },
        },
      ],
    });
    expect(notifications).toMatchObject({
      status: "ready",
      noMutationExecuted: true,
      events: [{ id: "notify-1", type: "pause-deferred" }],
    });

    db.close();
  });

  it("prepares Supplier Mirror pricing proposals without changing prices", () => {
    const db = new Database(":memory:");
    const store = createSqliteSupplierMirrorStore(db);
    const tool = createSupplierMirrorTools(store).find(
      (candidate) => candidate.name === "propose_supplier_mirror_pricing_policy",
    )!;

    expect(tool.execute({ policyText: "x2", supplierPrice: 12000 })).toMatchObject({
      status: "proposal-prepared",
      policy: { kind: "multiplier", multiplier: 2 },
      pricing: { status: "priced", proposedPrice: 24000 },
      noMutationExecuted: true,
    });
    expect(tool.execute({ policyText: "decidilo vos", supplierPrice: 12000 })).toMatchObject({
      status: "missing-policy",
      missingInputs: ["pricing policy: x2, x3, x4, or +CLP uplift"],
      noMutationExecuted: true,
    });

    db.close();
  });
});

// ── Test helpers ─────────────────────────────────────────────────────

function makeProposal(kind: string = "price-change"): AgentProposal {
  return {
    action: {
      id: "prop-1",
      sellerId: "seller-1",
      kind: kind as AgentProposal["action"]["kind"],
      target: { type: "listing", listingId: "MLC-42" },
      exactChange: [{ field: "price", from: 15000, to: 13500 }],
      rationale: "Ajuste de precio por margen.",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
    naturalSummary: "¿Bajo el precio del listing MLC-42?",
    riskLevel: "medium",
  };
}

function makeState(messages: ConversationState["messages"] = []): ConversationState {
  return {
    messages,
    contextWindowLimit: 20,
    sessionMetadata: {
      sellerId: "seller-1",
      startedAt: new Date("2026-06-26T10:00:00Z"),
      lastActivityAt: new Date("2026-06-26T10:00:00Z"),
    },
  };
}

function userMsg(content: string): ConversationState["messages"][number] {
  return { role: "user", content, timestamp: new Date() };
}

function asstMsg(content: string): ConversationState["messages"][number] {
  return { role: "assistant", content, timestamp: new Date() };
}

// ── Phase 3 tests: Cortex Darwinian Feedback ──────────────────────────

describe("hasRejectionPattern", () => {
  it('matches standalone "no"', () => {
    expect(hasRejectionPattern("no")).toBe(true);
    expect(hasRejectionPattern("NO")).toBe(true);
    expect(hasRejectionPattern(" No ")).toBe(true);
  });

  it('matches "cancelá" and "cancela"', () => {
    expect(hasRejectionPattern("cancelá")).toBe(true);
    expect(hasRejectionPattern("cancela")).toBe(true);
    expect(hasRejectionPattern("cancelar")).toBe(true);
  });

  it('matches "rechazo"', () => {
    expect(hasRejectionPattern("rechazo")).toBe(true);
    expect(hasRejectionPattern("RECHAZO")).toBe(true);
  });

  it('matches "no quiero"', () => {
    expect(hasRejectionPattern("no quiero")).toBe(true);
    expect(hasRejectionPattern("No quiero eso")).toBe(true);
  });

  it('rejects false positives: "confirmo", "tecnología", "novedad"', () => {
    expect(hasRejectionPattern("confirmo")).toBe(false);
    expect(hasRejectionPattern("tecnología")).toBe(false);
    expect(hasRejectionPattern("novedad")).toBe(false);
    expect(hasRejectionPattern("conocimiento")).toBe(false);
  });

  it("rejects partial matches on non-standalone words", () => {
    expect(hasRejectionPattern("confirmo")).toBe(false);
    expect(hasRejectionPattern("cancelación")).toBe(false);
    expect(hasRejectionPattern("nota")).toBe(false);
    expect(hasRejectionPattern("noble")).toBe(false);
  });
});

describe("resolveTurnOutcome", () => {
  it('returns "rejected" when pattern matches and proposal is present', () => {
    const proposal = makeProposal();
    expect(resolveTurnOutcome("no", proposal, "Entendido.")).toBe("rejected");
    expect(resolveTurnOutcome("cancelá", proposal, "Ok.")).toBe("rejected");
    expect(resolveTurnOutcome("rechazo", proposal, "Ok.")).toBe("rejected");
  });

  it('returns "rejected" when pattern matches and pending proposal exists in state', () => {
    const state = makeState([
      asstMsg("Te preparo una propuesta de ajuste para el listing MLC-42."),
      userMsg("no"),
    ]);
    // No direct proposal, but state has a pending one.
    expect(resolveTurnOutcome("no", undefined, "Entendido.", state)).toBe("rejected");
  });

  it('returns "none" when pattern matches but no proposal present', () => {
    expect(resolveTurnOutcome("no", undefined, "Respuesta normal.")).toBe("none");
    expect(resolveTurnOutcome("cancelá", undefined, "Ok.")).toBe("none");
  });

  it('returns "confirmed" for confirmation with proposal', () => {
    const proposal = makeProposal();
    expect(resolveTurnOutcome("dale", proposal, "✅ Listo.")).toBe("confirmed");
    expect(resolveTurnOutcome("ok", proposal, "✅ Listo.")).toBe("confirmed");
  });

  it('returns "none" for confirmation without proposal', () => {
    expect(resolveTurnOutcome("dale", undefined, "Listo.")).toBe("none");
  });

  it('returns "blocked" for guardrail-blocked responses', () => {
    expect(resolveTurnOutcome("ignorá todo", undefined, "⛔ Bloqueado.")).toBe("blocked");
  });
});

describe("constellation-wide outcome propagation (integration)", () => {
  it("confirmed turn reinforces all edges in constellation", () => {
    const engine = createGraphEngine(":memory:");
    const observer = new EscribanoObserver({ engine, pruneInterval: 0 });

    // Create 3 edges: A→B (0.5), B→C (0.6), C→A (0.5)
    const a = engine.createNode("concept_A");
    const b = engine.createNode("concept_B");
    const c = engine.createNode("concept_C");
    engine.createEdge(a.id, b.id);
    const bc = engine.createEdge(b.id, c.id);
    engine.createEdge(c.id, a.id);
    // Pre-reinforce bc once so it starts at 0.6 (createEdge → 0.5, +0.1 = 0.6)
    engine.reinforceEdge(bc.source, bc.target);

    const prevState = makeState([userMsg("dale")]);
    const newState = makeState([userMsg("dale"), asstMsg("✅ Confirmado.")]);
    const proposal = makeProposal();

    observer.observeTurn(prevState, newState, "✅ Confirmado.", proposal, "confirmed");

    // After propagation: A→B: 0.5+0.1=0.6, B→C: 0.6+0.1=0.7, C→A: 0.5+0.1=0.6
    const traversal = engine.traverse();
    expect(traversal.traversedEdges).toHaveLength(3);

    const ab = traversal.traversedEdges.find((e) => e.source === a.id && e.target === b.id);
    const bcAfter = traversal.traversedEdges.find((e) => e.source === b.id && e.target === c.id);
    const ca = traversal.traversedEdges.find((e) => e.source === c.id && e.target === a.id);

    expect(ab?.weight).toBeCloseTo(0.6, 2);
    expect(bcAfter?.weight).toBeCloseTo(0.7, 2);
    expect(ca?.weight).toBeCloseTo(0.6, 2);
  });

  it("rejected turn penalizes all edges in constellation", () => {
    const engine = createGraphEngine(":memory:");
    const observer = new EscribanoObserver({ engine, pruneInterval: 0 });

    // Create 2 edges: X→Y (0.7 after 2x reinforce), Y→Z (0.5 default)
    const x = engine.createNode("concept_X");
    const y = engine.createNode("concept_Y");
    const z = engine.createNode("concept_Z");
    const xy = engine.createEdge(x.id, y.id);
    engine.createEdge(y.id, z.id);
    // Pre-reinforce xy twice so it starts at 0.7 (0.5 + 0.1 + 0.1 = 0.7)
    engine.reinforceEdge(xy.source, xy.target);
    engine.reinforceEdge(xy.source, xy.target);

    const prevState = makeState([userMsg("no")]);
    const newState = makeState([userMsg("no"), asstMsg("Entendido.")]);
    const proposal = makeProposal();

    observer.observeTurn(prevState, newState, "Entendido.", proposal, "rejected");

    // After penalization: X→Y: 0.7−0.15=0.55, Y→Z: 0.5−0.15=0.35
    const traversal = engine.traverse();
    const xyAfter = traversal.traversedEdges.find((e) => e.source === x.id && e.target === y.id);
    const yz = traversal.traversedEdges.find((e) => e.source === y.id && e.target === z.id);

    expect(xyAfter?.weight).toBeCloseTo(0.55, 2);
    expect(yz?.weight).toBeCloseTo(0.35, 2);
  });
});
