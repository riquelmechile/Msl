import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type {
  AssessmentType,
  EvidenceRequest,
  FinancialAssessment,
  FinancialComparison,
  FinancialRisk,
  Hypothesis,
  MissingEvidence,
  Opportunity,
  Recommendation,
} from "@msl/domain";
import {
  createSqliteFinanceDirectorAssessmentStore,
  type FinanceDirectorAssessmentStore,
} from "./financeDirectorAssessmentStore.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function createStore(): FinanceDirectorAssessmentStore {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  return createSqliteFinanceDirectorAssessmentStore(db);
}

const NOW = Date.now();

function makeAssessment(overrides: {
  sellerId: string;
  assessmentType?: AssessmentType;
  assessmentId?: string;
  objective?: string;
  generatedAt?: number;
  confidence?: number;
  outcomeIds?: string[];
  evidenceIds?: string[];
  snapshotIds?: string[];
  workSessionId?: string | undefined;
  correlationId?: string | undefined;
  fallbackUsed?: boolean;
  currencies?: Array<"CLP" | "USD">;
  hypotheses?: Hypothesis[];
  risks?: FinancialRisk[];
  opportunities?: Opportunity[];
  missingEvidence?: MissingEvidence[];
  recommendations?: Recommendation[];
  requestsForEvidence?: EvidenceRequest[];
  comparisons?: FinancialComparison[] | undefined;
  expectedImpact?: string | undefined;
  modelUsed?: string;
  summary?: string;
  verifiedFacts?: string[];
  uncertaintyReasons?: string[];
  accountId?: string | undefined;
}): FinancialAssessment {
  return {
    assessmentId: overrides.assessmentId ?? `assess-${Math.random().toString(36).slice(2, 10)}`,
    sellerId: overrides.sellerId,
    ...(overrides.accountId !== undefined ? { accountId: overrides.accountId } : {}),
    objective: overrides.objective ?? "Review profitability of order #123",
    assessmentType: overrides.assessmentType ?? "order-profitability",
    generatedAt: overrides.generatedAt ?? NOW,
    currencies: overrides.currencies ?? ["CLP"],
    evidenceIds: overrides.evidenceIds ?? [],
    outcomeIds: overrides.outcomeIds ?? [],
    snapshotIds: overrides.snapshotIds ?? [],
    summary: overrides.summary ?? "Assessment summary",
    verifiedFacts: overrides.verifiedFacts ?? [],
    hypotheses: overrides.hypotheses ?? [],
    risks: overrides.risks ?? [],
    opportunities: overrides.opportunities ?? [],
    missingEvidence: overrides.missingEvidence ?? [],
    ...(overrides.comparisons !== undefined ? { comparisons: overrides.comparisons } : {}),
    ...(overrides.expectedImpact !== undefined ? { expectedImpact: overrides.expectedImpact } : {}),
    confidence: overrides.confidence ?? 0.8,
    uncertaintyReasons: overrides.uncertaintyReasons ?? [],
    recommendations: overrides.recommendations ?? [],
    requestsForEvidence: overrides.requestsForEvidence ?? [],
    modelUsed: overrides.modelUsed ?? "deepseek-v4-pro",
    fallbackUsed: overrides.fallbackUsed ?? false,
    promptBlockHashes: {},
    ...(overrides.workSessionId !== undefined ? { workSessionId: overrides.workSessionId } : {}),
    ...(overrides.correlationId !== undefined ? { correlationId: overrides.correlationId } : {}),
    noMutationExecuted: true as const,
  };
}

function makeComplexAssessment(overrides: { sellerId: string }): FinancialAssessment {
  return {
    assessmentId: "assess-complex-1",
    sellerId: overrides.sellerId,
    accountId: "acc-123",
    objective: "Evaluate overall financial health for Q2 2026",
    assessmentType: "account-health",
    generatedAt: NOW,
    evidenceWindow: { start: NOW - 30 * 86400000, end: NOW },
    currencies: ["CLP", "USD"],
    evidenceIds: ["evid-1", "evid-2", "evid-3"],
    outcomeIds: ["out-1", "out-2"],
    snapshotIds: ["snap-1", "snap-2", "snap-3"],
    summary: "The account shows strong revenue growth but rising costs in shipping and advertising.",
    verifiedFacts: [
      "Revenue for Q2 is CLP 45,000,000",
      "Product cost margin is 38%",
    ],
    hypotheses: [
      {
        statement: "Shipping costs increased due to new carrier rate structure",
        confidence: 0.75,
        evidence: "Carrier rate sheet from May 2026",
      },
    ],
    risks: [
      {
        description: "Shipping cost trend may erode margins if unchecked",
        severity: "high",
        probability: 0.6,
      },
      {
        description: "USD exchange rate volatility",
        severity: "medium",
        probability: 0.4,
      },
    ],
    opportunities: [
      {
        description: "Renegotiate carrier contracts for Q3",
        estimatedImpact: "CLP 2,000,000/month savings",
      },
    ],
    missingEvidence: [
      {
        kind: "advertising-attribution",
        reason: "No ad campaign ROI data available",
        targetAgent: "product-ads-monitor",
        priority: "high",
      },
    ],
    comparisons: [
      {
        accountA: "plasticov",
        accountB: "maustian",
        metric: "net_margin",
        finding: "Plasticov margin is 12% vs Maustian 24% — shipping cost delta explains 70% of gap",
      },
    ],
    expectedImpact: "If shipping costs are addressed, net margin could improve by 3-5 points",
    confidence: 0.82,
    uncertaintyReasons: [
      "Ad spend data is estimated, not verified",
      "USD/CLP exchange rate was sampled weekly, not daily",
    ],
    recommendations: [
      {
        action: "Request ad-attribution evidence from Product Ads monitor",
        rationale: "Cannot fully assess profitability without ad ROI data",
        urgency: "request_evidence",
      },
      {
        action: "Monitor shipping cost trend weekly",
        rationale: "Early detection of carrier rate escalation",
        urgency: "monitor",
      },
    ],
    requestsForEvidence: [
      {
        kind: "advertising-attribution",
        targetAgent: "product-ads-monitor",
        reason: "Ad ROI is a blind spot — need campaign-level cost and conversion data",
        priority: "high",
        ttl: 604800000,
      },
    ],
    escalationRecommendation: "Escalate shipping cost trend to CEO for Q3 budget review",
    modelUsed: "deepseek-v4-pro",
    fallbackUsed: false,
    promptBlockHashes: {
      blockA: "abc123",
      blockB: "def456",
      blockC: "ghi789",
    },
    workSessionId: "ws-finance-001",
    correlationId: "corr-q2-review",
    noMutationExecuted: true as const,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("FinanceDirectorAssessmentStore", () => {
  // ── Insert and retrieve ────────────────────────────────────────────────

  it("inserts and retrieves an assessment", () => {
    const store = createStore();
    const assessment = makeAssessment({ sellerId: "plasticov" });

    store.insertAssessment(assessment);
    const retrieved = store.getAssessment(assessment.assessmentId, "plasticov");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.assessmentId).toBe(assessment.assessmentId);
    expect(retrieved!.sellerId).toBe("plasticov");
    expect(retrieved!.assessmentType).toBe(assessment.assessmentType);
    expect(retrieved!.objective).toBe(assessment.objective);
    expect(retrieved!.confidence).toBe(assessment.confidence);
  });

  it("returns null for non-existent assessment", () => {
    const store = createStore();
    const result = store.getAssessment("nonexistent", "plasticov");
    expect(result).toBeNull();
  });

  // ── Idempotent insert ──────────────────────────────────────────────────

  it("idempotent insert — same assessmentId twice does not duplicate", () => {
    const store = createStore();
    const assessment = makeAssessment({ sellerId: "plasticov", assessmentId: "fixed-1" });

    store.insertAssessment(assessment);

    // Insert again with same assessmentId — should not error
    const updated = makeAssessment({
      sellerId: "plasticov",
      assessmentId: "fixed-1",
      confidence: 0.95,
    });
    store.insertAssessment(updated);

    const retrieved = store.getAssessment("fixed-1", "plasticov");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.assessmentId).toBe("fixed-1");
    expect(retrieved!.confidence).toBe(0.95); // Updated in place
  });

  // ── Seller isolation ───────────────────────────────────────────────────

  it("seller isolation — seller A cannot see seller B's assessments", () => {
    const store = createStore();

    const plasticovAssessment = makeAssessment({ sellerId: "plasticov", assessmentId: "pa-1" });
    const maustianAssessment = makeAssessment({ sellerId: "maustian", assessmentId: "ma-1" });

    store.insertAssessment(plasticovAssessment);
    store.insertAssessment(maustianAssessment);

    // Plasticov should not see maustian's assessment
    const plasticovResult = store.getAssessment(maustianAssessment.assessmentId, "plasticov");
    expect(plasticovResult).toBeNull();

    // Maustian should not see plasticov's assessment
    const maustianResult = store.getAssessment(plasticovAssessment.assessmentId, "maustian");
    expect(maustianResult).toBeNull();

    // Each seller sees their own
    expect(store.getAssessment("pa-1", "plasticov")).not.toBeNull();
    expect(store.getAssessment("ma-1", "maustian")).not.toBeNull();
  });

  it("listBySeller respects seller isolation", () => {
    const store = createStore();

    store.insertAssessment(makeAssessment({ sellerId: "plasticov" }));
    store.insertAssessment(makeAssessment({ sellerId: "plasticov" }));
    store.insertAssessment(makeAssessment({ sellerId: "maustian" }));

    const plasticovList = store.listBySeller("plasticov");
    expect(plasticovList).toHaveLength(2);
    for (const a of plasticovList) {
      expect(a.sellerId).toBe("plasticov");
    }

    const maustianList = store.listBySeller("maustian");
    expect(maustianList).toHaveLength(1);
    expect(maustianList[0]!.sellerId).toBe("maustian");
  });

  // ── Limit enforcement ──────────────────────────────────────────────────

  it("listBySeller respects limit", () => {
    const store = createStore();

    for (let i = 0; i < 10; i++) {
      store.insertAssessment(makeAssessment({ sellerId: "plasticov" }));
    }

    const list = store.listBySeller("plasticov", { limit: 3 });
    expect(list).toHaveLength(3);
  });

  // ── listByOutcome ──────────────────────────────────────────────────────

  it("listByOutcome returns assessments containing that outcomeId", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({
        sellerId: "plasticov",
        outcomeIds: ["out-shared", "out-1"],
      }),
    );
    store.insertAssessment(
      makeAssessment({
        sellerId: "plasticov",
        outcomeIds: ["out-shared", "out-2"],
      }),
    );
    store.insertAssessment(
      makeAssessment({
        sellerId: "plasticov",
        outcomeIds: ["out-3"],
      }),
    );

    const list = store.listByOutcome("out-shared", "plasticov");
    expect(list).toHaveLength(2);
    for (const a of list) {
      expect(a.outcomeIds).toContain("out-shared");
    }
  });

  it("listByOutcome returns empty when no match", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", outcomeIds: ["out-1"] }),
    );

    const list = store.listByOutcome("nonexistent", "plasticov");
    expect(list).toEqual([]);
  });

  it("listByOutcome respects seller isolation", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", outcomeIds: ["out-shared"] }),
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "maustian", outcomeIds: ["out-shared"] }),
    );

    const plasticovList = store.listByOutcome("out-shared", "plasticov");
    expect(plasticovList).toHaveLength(1);
    expect(plasticovList[0]!.sellerId).toBe("plasticov");

    const maustianList = store.listByOutcome("out-shared", "maustian");
    expect(maustianList).toHaveLength(1);
    expect(maustianList[0]!.sellerId).toBe("maustian");
  });

  // ── listByProposal ─────────────────────────────────────────────────────

  it("listByProposal returns assessments for that proposal", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", assessmentId: "a1" }),
      { proposalId: "prop-1" },
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", assessmentId: "a2" }),
      { proposalId: "prop-1" },
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", assessmentId: "a3" }),
      { proposalId: "prop-2" },
    );

    const list = store.listByProposal("prop-1", "plasticov");
    expect(list).toHaveLength(2);
    for (const a of list) {
      expect(a.assessmentId).toMatch(/^a[12]$/);
    }
  });

  it("listByProposal respects seller isolation", () => {
    const store = createStore();

    store.insertAssessment(makeAssessment({ sellerId: "plasticov", assessmentId: "pa" }), {
      proposalId: "prop-1",
    });
    store.insertAssessment(makeAssessment({ sellerId: "maustian", assessmentId: "ma" }), {
      proposalId: "prop-1",
    });

    const plasticovList = store.listByProposal("prop-1", "plasticov");
    expect(plasticovList).toHaveLength(1);
    expect(plasticovList[0]!.sellerId).toBe("plasticov");

    const maustianList = store.listByProposal("prop-1", "maustian");
    expect(maustianList).toHaveLength(1);
    expect(maustianList[0]!.sellerId).toBe("maustian");
  });

  // ── listBySession ──────────────────────────────────────────────────────

  it("listBySession returns assessments for that work session", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", workSessionId: "ws-1" }),
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", workSessionId: "ws-1" }),
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", workSessionId: "ws-2" }),
    );

    const list = store.listBySession("ws-1", "plasticov");
    expect(list).toHaveLength(2);
    for (const a of list) {
      expect(a.workSessionId).toBe("ws-1");
    }
  });

  it("listBySession returns empty for unknown session", () => {
    const store = createStore();
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", workSessionId: "ws-1" }),
    );

    const list = store.listBySession("nonexistent", "plasticov");
    expect(list).toEqual([]);
  });

  // ── listByCorrelationId ────────────────────────────────────────────────

  it("listByCorrelationId returns assessments for that correlation", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", correlationId: "corr-a" }),
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", correlationId: "corr-a" }),
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", correlationId: "corr-b" }),
    );

    const list = store.listByCorrelationId("corr-a", "plasticov");
    expect(list).toHaveLength(2);
    for (const a of list) {
      expect(a.correlationId).toBe("corr-a");
    }
  });

  it("listByCorrelationId respects seller isolation", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", correlationId: "corr-shared" }),
    );
    store.insertAssessment(
      makeAssessment({ sellerId: "maustian", correlationId: "corr-shared" }),
    );

    const plasticovList = store.listByCorrelationId("corr-shared", "plasticov");
    expect(plasticovList).toHaveLength(1);
    expect(plasticovList[0]!.sellerId).toBe("plasticov");

    const maustianList = store.listByCorrelationId("corr-shared", "maustian");
    expect(maustianList).toHaveLength(1);
    expect(maustianList[0]!.sellerId).toBe("maustian");
  });

  // ── latestByType ───────────────────────────────────────────────────────

  it("latestByType returns most recent for that type", () => {
    const store = createStore();

    const older = makeAssessment({
      sellerId: "plasticov",
      assessmentType: "account-health",
      generatedAt: NOW - 20000,
    });
    const newer = makeAssessment({
      sellerId: "plasticov",
      assessmentType: "account-health",
      generatedAt: NOW - 10000,
    });

    store.insertAssessment(older);
    store.insertAssessment(newer);

    const latest = store.latestByType("plasticov", "account-health");
    expect(latest).not.toBeNull();
    expect(latest!.generatedAt).toBe(newer.generatedAt);
  });

  it("latestByType returns null when no assessments of that type", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", assessmentType: "order-profitability" }),
    );

    const result = store.latestByType("plasticov", "account-health");
    expect(result).toBeNull();
  });

  it("latestByType respects seller isolation", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({
        sellerId: "plasticov",
        assessmentType: "account-health",
        generatedAt: NOW,
      }),
    );
    store.insertAssessment(
      makeAssessment({
        sellerId: "maustian",
        assessmentType: "account-health",
        generatedAt: NOW + 1000,
      }),
    );

    const plasticovLatest = store.latestByType("plasticov", "account-health");
    expect(plasticovLatest!.sellerId).toBe("plasticov");

    const maustianLatest = store.latestByType("maustian", "account-health");
    expect(maustianLatest!.sellerId).toBe("maustian");
  });

  // ── Full roundtrip: complex assessment with all fields ─────────────

  it("full roundtrip — stores and retrieves complex assessment with all fields", () => {
    const store = createStore();
    const assessment = makeComplexAssessment({ sellerId: "plasticov" });

    store.insertAssessment(assessment);
    const retrieved = store.getAssessment("assess-complex-1", "plasticov");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.assessmentId).toBe("assess-complex-1");
    expect(retrieved!.sellerId).toBe("plasticov");
    expect(retrieved!.accountId).toBe("acc-123");
    expect(retrieved!.objective).toBe("Evaluate overall financial health for Q2 2026");
    expect(retrieved!.assessmentType).toBe("account-health");
    expect(retrieved!.generatedAt).toBe(NOW);
    expect(retrieved!.evidenceWindow).toEqual({ start: NOW - 30 * 86400000, end: NOW });
    expect(retrieved!.currencies).toEqual(["CLP", "USD"]);
    expect(retrieved!.evidenceIds).toEqual(["evid-1", "evid-2", "evid-3"]);
    expect(retrieved!.outcomeIds).toEqual(["out-1", "out-2"]);
    expect(retrieved!.snapshotIds).toEqual(["snap-1", "snap-2", "snap-3"]);
    expect(retrieved!.summary).toBe("The account shows strong revenue growth but rising costs in shipping and advertising.");
    expect(retrieved!.verifiedFacts).toHaveLength(2);
    expect(retrieved!.hypotheses).toHaveLength(1);
    expect(retrieved!.hypotheses[0]!.statement).toContain("Shipping costs");
    expect(retrieved!.risks).toHaveLength(2);
    expect(retrieved!.risks[0]!.severity).toBe("high");
    expect(retrieved!.opportunities).toHaveLength(1);
    expect(retrieved!.missingEvidence).toHaveLength(1);
    expect(retrieved!.missingEvidence[0]!.kind).toBe("advertising-attribution");
    expect(retrieved!.comparisons).toHaveLength(1);
    expect(retrieved!.comparisons![0]!.accountA).toBe("plasticov");
    expect(retrieved!.expectedImpact).toContain("shipping");
    expect(retrieved!.confidence).toBe(0.82);
    expect(retrieved!.uncertaintyReasons).toHaveLength(2);
    expect(retrieved!.recommendations).toHaveLength(2);
    expect(retrieved!.requestsForEvidence).toHaveLength(1);
    expect(retrieved!.requestsForEvidence[0]!.kind).toBe("advertising-attribution");
    expect(retrieved!.escalationRecommendation).toContain("shipping");
    expect(retrieved!.modelUsed).toBe("deepseek-v4-pro");
    expect(retrieved!.fallbackUsed).toBe(false);
    expect(retrieved!.promptBlockHashes.blockA).toBe("abc123");
    expect(retrieved!.workSessionId).toBe("ws-finance-001");
    expect(retrieved!.correlationId).toBe("corr-q2-review");
    expect(retrieved!.noMutationExecuted).toBe(true);
  });

  // ── Corrupt/invalid JSON handling ─────────────────────────────────

  it("handles assessments with empty arrays gracefully", () => {
    const store = createStore();
    const assessment = makeAssessment({
      sellerId: "plasticov",
      outcomeIds: [],
      evidenceIds: [],
      hypotheses: [],
      risks: [],
    });

    store.insertAssessment(assessment);
    const retrieved = store.getAssessment(assessment.assessmentId, "plasticov");

    expect(retrieved).not.toBeNull();
    expect(retrieved!.outcomeIds).toEqual([]);
    expect(retrieved!.evidenceIds).toEqual([]);
    expect(retrieved!.hypotheses).toEqual([]);
    expect(retrieved!.risks).toEqual([]);
  });

  it("listByOutcome returns empty for JSON array that does not contain the id", () => {
    const store = createStore();

    store.insertAssessment(
      makeAssessment({ sellerId: "plasticov", outcomeIds: ["out-a", "out-b"] }),
    );

    const list = store.listByOutcome("out-c", "plasticov");
    expect(list).toEqual([]);
  });
});
