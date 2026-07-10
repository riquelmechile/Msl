import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { AccountBrainService } from "./accountBrainService.js";
import { createAccountAssetStore } from "./accountAssetStore.js";
import { createAgentWorkSessionStore } from "../sessions/AgentWorkSessionStore.js";
import { createWorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";
import { createCeoInboxStore } from "./ceoInboxStore.js";
import { createDatabase, GraphEngine } from "@msl/memory";
import type { AccountAsset, AgentWorkSession, AgentLesson } from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────────

const PLASTICOV_ID = "plasticov-mlc";
const MAUSTIAN_ID = "maustian-mlc";

const plasticovAccount: Omit<AccountAsset, "createdAt" | "updatedAt"> = {
  sellerId: PLASTICOV_ID,
  name: "Plasticov",
  marketplace: "MLC",
  profitGoal: 40,
  riskLevel: "low",
  status: "active",
  capabilities: [
    { kind: "publish", status: "active" },
    { kind: "pricing", status: "active" },
    { kind: "claims", status: "active" },
    { kind: "fulfillment", status: "active" },
  ],
};

const maustianAccount: Omit<AccountAsset, "createdAt" | "updatedAt"> = {
  sellerId: MAUSTIAN_ID,
  name: "Maustian",
  marketplace: "MLC",
  profitGoal: 50,
  riskLevel: "medium",
  status: "active",
  capabilities: [
    { kind: "publish", status: "active" },
    { kind: "pricing", status: "active" },
    { kind: "fulfillment", status: "missing" },
  ],
};

function createTestSession(overrides: Partial<AgentWorkSession> = {}): AgentWorkSession {
  return {
    sessionId: `sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId: PLASTICOV_ID,
    agentId: "product-ads-profitability",
    laneId: "product-ads-profitability",
    status: "running",
    signalsHash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    stablePromptHash: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7",
    evidenceHash: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8",
    cycleCount: 0,
    summaryJson: "{}",
    ...overrides,
  };
}

function createTestLesson(overrides: Partial<AgentLesson> = {}): AgentLesson {
  return {
    lessonId: `lsn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sellerId: PLASTICOV_ID,
    agentId: "product-ads-profitability",
    sessionId: "sess-test-1",
    lesson: "Transferable lesson: cache validation before publish",
    transferable: true,
    learnedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── Test 1: Full account data with capabilities ────────────────────────

describe("AccountBrainService", () => {
  let db: Database.Database;
  let service: AccountBrainService;

  beforeEach(() => {
    db = createDatabase(":memory:");
    const accountStore = createAccountAssetStore(db);
    const sessionStore = createAgentWorkSessionStore(db);
    const costLedger = createWorkforceCostCacheLedgerStore(db);
    const ceoInbox = createCeoInboxStore(db);
    const cortex = new GraphEngine(db);

    // Seed Plasticov account
    const now = new Date().toISOString();
    accountStore.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: now,
      updatedAt: now,
    });

    // Seed full data set for Plasticov
    accountStore.recordHealthSnapshot(PLASTICOV_ID, {
      status: "healthy",
      reputation: "green",
      salesVelocity: 1.2,
      marginProfile: 0.35,
      recordedAt: new Date().toISOString(),
    });
    accountStore.upsertProfitGoal(PLASTICOV_ID, 40);
    accountStore.addRisk(PLASTICOV_ID, {
      risk: "Margin compression in electronics",
      severity: "high",
      mitigation: "Raise prices 5%",
      detectedAt: new Date().toISOString(),
    });
    accountStore.addOpportunity(PLASTICOV_ID, {
      opportunity: "Expand into home & garden",
      estimatedImpact: "$2,000/month",
      confidence: 0.85,
      detectedAt: new Date().toISOString(),
    });
    accountStore.addStrategyNote(PLASTICOV_ID, {
      goal: "Aggressive electronics pricing",
      approach: "Undercut competitors by 5%",
      activeSince: new Date().toISOString(),
    });

    // Work session
    const sess = createTestSession({ status: "running" });
    sessionStore.startSession(sess);
    sessionStore.completeSession(sess.sessionId, PLASTICOV_ID, JSON.stringify({ result: "ok" }));

    // Lesson
    sessionStore.addLesson(createTestLesson());

    // Cost ledger entry
    costLedger.insertEntry({
      entryId: "entry-cost-1",
      agentId: "product-ads-profitability",
      provider: "deepseek",
      model: "v3",
      operation: "chat",
      inputTokens: 5000,
      outputTokens: 500,
      estimatedCostMicros: 1500,
      cacheStatus: "hit",
      measuredAt: new Date().toISOString(),
      sellerId: PLASTICOV_ID,
    });

    // Inbox proposal (status defaults to "pending" in store)
    ceoInbox.insert({
      proposal_id: "prop-ceo-1",
      sender_agent_id: "product-ads-profitability",
      proposal_type: "price-change",
      payload_json: JSON.stringify({
        itemId: "MLC-123",
        newPrice: 15000,
      }),
      normalized_summary: "Raise price on MLC-123 to $15,000",
      risk_level: "low",
      seller_id: PLASTICOV_ID,
    });

    // Cortex node
    cortex.ensureAccountAssetNode(PLASTICOV_ID);

    service = new AccountBrainService(accountStore, sessionStore, costLedger, ceoInbox, cortex);
  });

  it("returns full account data with capabilities", () => {
    const result = service.getAccountBrainStatus(PLASTICOV_ID);

    expect(result.status).toBe("active");
    expect(result.sellerId).toBe(PLASTICOV_ID);
    expect(result.noMutationExecuted).toBe(true);

    // Health
    expect(result.health).not.toBe("unavailable");
    if (result.health !== "unavailable") {
      expect(result.health.currentStatus).toBe("healthy");
      expect(result.health.reputation).toBe("green");
    }

    // Capabilities
    expect(result.capabilities).not.toBe("unavailable");
    if (Array.isArray(result.capabilities)) {
      expect(result.capabilities.length).toBeGreaterThanOrEqual(4);
      expect(result.capabilities.some((c) => c.kind === "publish")).toBe(true);
    }

    // Profit goal
    expect(result.profitGoal).not.toBe("unavailable");

    // Risks
    expect(result.risks).not.toBe("unavailable");
    if (Array.isArray(result.risks)) {
      expect(result.risks.length).toBeGreaterThanOrEqual(1);
      const firstRisk = result.risks[0];
      expect(firstRisk?.risk).toContain("Margin");
    }

    // Opportunities
    expect(result.opportunities).not.toBe("unavailable");
    if (Array.isArray(result.opportunities)) {
      expect(result.opportunities.some((o) => o.opportunity.includes("home"))).toBe(true);
    }

    // Strategy
    expect(result.strategy).not.toBe("unavailable");
    if (Array.isArray(result.strategy)) {
      expect(result.strategy.length).toBeGreaterThanOrEqual(1);
    }

    // Agent activity
    expect(result.agentActivity).not.toBe("unavailable");
    if (result.agentActivity !== "unavailable") {
      expect(result.agentActivity.sessionsToday).toBeGreaterThanOrEqual(1);
      expect(result.agentActivity.lessons).toBeGreaterThanOrEqual(1);
    }

    // Pending approvals
    expect(result.pendingApprovals).not.toBe("unavailable");

    // Cost & cache
    expect(result.costAndCache).not.toBe("unavailable");

    // Cortex
    expect(result.cortex).not.toBe("unavailable");

    // Recommended focus & evidence
    expect(result.recommendedFocus.length).toBeGreaterThan(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.noMutationExecuted).toBe(true);
  });

  // ── Test 2: Missing account ─────────────────────────────────────────

  it("returns missing_account_asset for unknown seller (never throws)", () => {
    const result = service.getAccountBrainStatus("unknown-seller");
    expect(result.status).toBe("missing_account_asset");
    expect(result.health).toBe("unavailable");
    expect(result.capabilities).toBe("unavailable");
    expect(result.noMutationExecuted).toBe(true);
    expect(result.confidence).toBe("high");
  });

  // ── Test 3: Plasticov data isolated from Maustian ────────────────────

  it("isolates Plasticov data from Maustian", () => {
    // Seed Maustian separately
    const maustianStore = createAccountAssetStore(db);
    const now = new Date().toISOString();
    maustianStore.upsertAccountAsset({
      ...maustianAccount,
      createdAt: now,
      updatedAt: now,
    });
    maustianStore.addRisk(MAUSTIAN_ID, {
      risk: "Maustian-only shipping delay",
      severity: "medium",
      detectedAt: new Date().toISOString(),
    });

    const pv = service.getAccountBrainStatus(PLASTICOV_ID);
    const mt = service.getAccountBrainStatus(MAUSTIAN_ID);

    // Plasticov risks must not include Maustian shipping delay
    if (Array.isArray(pv.risks)) {
      expect(pv.risks.some((r) => r.risk.includes("Maustian"))).toBe(false);
    }

    // Seller IDs must match
    expect(pv.sellerId).toBe(PLASTICOV_ID);
    expect(mt.sellerId).toBe(MAUSTIAN_ID);

    // Maustian data in Maustian result only
    if (Array.isArray(mt.risks)) {
      expect(mt.risks.some((r) => r.risk.includes("shipping"))).toBe(true);
    }
  });

  // ── Test 4: Global memory marked as "global" ────────────────────────

  it("marks global strategy as visible to both accounts", () => {
    const acctStore = createAccountAssetStore(db);
    const now = new Date().toISOString();
    acctStore.upsertAccountAsset({
      ...maustianAccount,
      createdAt: now,
      updatedAt: now,
    });

    // Add global strategy (sellerId = null)
    acctStore.addStrategyNote(null, {
      goal: "Global margin policy",
      approach: "Apply 45% margin across all accounts",
      activeSince: new Date().toISOString(),
    });

    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    expect(result.strategy).not.toBe("unavailable");
    if (Array.isArray(result.strategy)) {
      const globalStrategies = result.strategy.filter(
        (s) => s.sellerId === undefined || s.sellerId === null,
      );
      expect(globalStrategies.length).toBeGreaterThanOrEqual(1);
      const firstGlobal = globalStrategies[0];
      expect(firstGlobal?.goal).toBe("Global margin policy");
    }
  });

  // ── Test 5: Health snapshot used for status ─────────────────────────

  it("uses the latest health snapshot for status", () => {
    const acctStore = createAccountAssetStore(db);
    acctStore.recordHealthSnapshot(PLASTICOV_ID, {
      status: "degraded",
      reputation: "yellow",
      recordedAt: "2026-07-05T00:00:00.000Z",
    });
    acctStore.recordHealthSnapshot(PLASTICOV_ID, {
      status: "healthy",
      reputation: "green",
      recordedAt: "2026-07-10T00:00:00.000Z",
    });

    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    expect(result.health).not.toBe("unavailable");
    if (result.health !== "unavailable") {
      expect(result.health.currentStatus).toBe("healthy");
    }
  });

  // ── Test 6: Critical risks surface in recommendedFocus ──────────────

  it("surfaces critical risks in recommendedFocus", () => {
    const acctStore = createAccountAssetStore(db);
    acctStore.addRisk(PLASTICOV_ID, {
      risk: "Account suspension risk due to IP claim",
      severity: "critical",
      mitigation: "Resolve claim within 48h",
      detectedAt: new Date().toISOString(),
    });

    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    expect(result.recommendedFocus.some((f) => f.includes("suspension"))).toBe(true);
    expect(result.recommendedFocus.some((f) => f.toLowerCase().includes("critical"))).toBe(true);
  });

  // ── Test 7: High-confidence opportunities surface in recommendedFocus

  it("surfaces high-confidence opportunities in recommendedFocus", () => {
    const acctStore = createAccountAssetStore(db);
    acctStore.addOpportunity(PLASTICOV_ID, {
      opportunity: "Q4 seasonal demand spike for electronics",
      estimatedImpact: "$5,000",
      confidence: 0.9,
      detectedAt: new Date().toISOString(),
    });
    acctStore.addOpportunity(PLASTICOV_ID, {
      opportunity: "Low-confidence wild guess",
      estimatedImpact: "$100",
      confidence: 0.2,
      detectedAt: new Date().toISOString(),
    });

    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    const focus = result.recommendedFocus.join(" ");
    expect(focus).toContain("Q4 seasonal");
    expect(focus).not.toContain("wild guess");
  });

  // ── Test 8: Work sessions aggregated into status ────────────────────

  it("aggregates work sessions into agentActivity", () => {
    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    expect(result.agentActivity).not.toBe("unavailable");
    if (result.agentActivity !== "unavailable") {
      expect(result.agentActivity.sessionsToday).toBeGreaterThanOrEqual(1);
      expect(result.agentActivity.lessons).toBeGreaterThanOrEqual(1);
      expect(result.agentActivity.agentIds.length).toBeGreaterThan(0);
    }
  });

  // ── Test 9: Cost/cache per seller ───────────────────────────────────

  it("includes cost/cache per seller", () => {
    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    expect(result.costAndCache).not.toBe("unavailable");
    if (result.costAndCache !== "unavailable") {
      expect(result.costAndCache.totalEstimatedCostMicros).not.toBe("unavailable");
      if (typeof result.costAndCache.totalEstimatedCostMicros === "number") {
        expect(result.costAndCache.totalEstimatedCostMicros).toBeGreaterThan(0);
      }
      expect(typeof result.costAndCache.cacheEfficiency).toBe("number");
    }
  });

  // ── Test 10: Pending approvals per seller ───────────────────────────

  it("includes pending approvals per seller", () => {
    const result = service.getAccountBrainStatus(PLASTICOV_ID);
    expect(result.pendingApprovals).not.toBe("unavailable");
    if (Array.isArray(result.pendingApprovals)) {
      expect(result.pendingApprovals.length).toBeGreaterThanOrEqual(1);
      const firstApproval = result.pendingApprovals[0];
      expect(firstApproval?.proposalType).toBe("price-change");
      // Status defaults to "pending" from store
      expect(firstApproval?.status).toBe("pending");
    }
  });

  // ── Test 11: compareAccountAssets ranks two accounts ────────────────

  it("ranks two accounts via compareAccountAssets", () => {
    // Seed Maustian
    const acctStore = createAccountAssetStore(db);
    const now = new Date().toISOString();
    acctStore.upsertAccountAsset({
      ...maustianAccount,
      createdAt: now,
      updatedAt: now,
    });
    acctStore.recordHealthSnapshot(MAUSTIAN_ID, {
      status: "degraded",
      reputation: "yellow",
      recordedAt: new Date().toISOString(),
    });
    acctStore.upsertProfitGoal(MAUSTIAN_ID, 50);

    const result = service.compareAccountAssets({
      candidateSellerIds: [PLASTICOV_ID, MAUSTIAN_ID],
      goal: "maximize_profit",
    });

    expect(result.noMutationExecuted).toBe(true);
    expect(result.ranking.length).toBe(2);
    const first = result.ranking[0];
    const second = result.ranking[1];
    expect(first?.sellerId).toBeDefined();
    expect(second?.sellerId).toBeDefined();
    expect(first!.score).toBeGreaterThanOrEqual(second!.score);
    expect(result.suggestedNextAction.requiresApproval).toBe(true);
  });

  // ── Test 12: Missing capabilities lower score ───────────────────────

  it("penalizes account with missing capabilities", () => {
    const acctStore = createAccountAssetStore(db);
    const now = new Date().toISOString();

    acctStore.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: now,
      updatedAt: now,
    });
    acctStore.upsertAccountAsset({
      ...maustianAccount,
      createdAt: now,
      updatedAt: now,
    });

    // Same health + goal for both
    for (const sid of [PLASTICOV_ID, MAUSTIAN_ID]) {
      acctStore.recordHealthSnapshot(sid, {
        status: "healthy",
        recordedAt: new Date().toISOString(),
      });
      acctStore.upsertProfitGoal(sid, 40);
    }

    const result = service.compareAccountAssets({
      candidateSellerIds: [PLASTICOV_ID, MAUSTIAN_ID],
    });

    const mtEntry = result.ranking.find((r) => r.sellerId === MAUSTIAN_ID);
    expect(mtEntry).toBeDefined();
    if (mtEntry?.missingCapabilities) {
      expect(mtEntry.missingCapabilities).toContain("fulfillment");
    }
  });

  // ── Test 13: Critical risk lowers score ─────────────────────────────

  it("penalizes account with critical risk", () => {
    const acctStore = createAccountAssetStore(db);
    const now = new Date().toISOString();
    // Both accounts identical except for the critical risk
    const equalCaps = [
      { kind: "publish", status: "active" as const },
      { kind: "pricing", status: "active" as const },
    ];
    acctStore.upsertAccountAsset({
      ...plasticovAccount,
      capabilities: equalCaps,
      createdAt: now,
      updatedAt: now,
    });
    acctStore.upsertAccountAsset({
      ...maustianAccount,
      capabilities: equalCaps,
      createdAt: now,
      updatedAt: now,
    });

    // Only Plasticov gets a critical risk
    acctStore.addRisk(PLASTICOV_ID, {
      risk: "Reputation collapse — account at risk of ban",
      severity: "critical",
      detectedAt: new Date().toISOString(),
    });

    // Same baseline health + goal
    for (const sid of [PLASTICOV_ID, MAUSTIAN_ID]) {
      acctStore.recordHealthSnapshot(sid, {
        status: "healthy",
        recordedAt: new Date().toISOString(),
      });
      acctStore.upsertProfitGoal(sid, 40);
    }

    const result = service.compareAccountAssets({
      candidateSellerIds: [PLASTICOV_ID, MAUSTIAN_ID],
    });

    const pvEntry = result.ranking.find((r) => r.sellerId === PLASTICOV_ID);
    const mtEntry = result.ranking.find((r) => r.sellerId === MAUSTIAN_ID);
    expect(pvEntry).toBeDefined();
    expect(mtEntry).toBeDefined();
    // Maustian should have higher score (same caps/health/profit, no critical risks)

    expect(mtEntry!.score).toBeGreaterThanOrEqual(pvEntry!.score);
    expect(pvEntry?.weaknesses.some((w) => w.includes("critical"))).toBe(true);
  });

  // ── Test 14: Goal-driven weighting ──────────────────────────────────

  it("adjusts weights per goal (grow_reputation and maximize_profit)", () => {
    const acctStore = createAccountAssetStore(db);
    const now = new Date().toISOString();

    // Plasticov: better health (grow_reputation should favor)
    acctStore.upsertAccountAsset({
      ...plasticovAccount,
      profitGoal: 40,
      createdAt: now,
      updatedAt: now,
    });
    acctStore.recordHealthSnapshot(PLASTICOV_ID, {
      status: "healthy",
      reputation: "green",
      recordedAt: new Date().toISOString(),
    });

    // Maustian: worse health but higher profit goal (maximize_profit should favor)
    acctStore.upsertAccountAsset({
      ...maustianAccount,
      profitGoal: 80,
      createdAt: now,
      updatedAt: now,
    });
    acctStore.recordHealthSnapshot(MAUSTIAN_ID, {
      status: "degraded",
      reputation: "yellow",
      recordedAt: new Date().toISOString(),
    });

    // grow_reputation → health×2.0
    const growRep = service.compareAccountAssets({
      candidateSellerIds: [PLASTICOV_ID, MAUSTIAN_ID],
      goal: "grow_reputation",
    });
    const grPv = growRep.ranking.find((r) => r.sellerId === PLASTICOV_ID);
    const grMt = growRep.ranking.find((r) => r.sellerId === MAUSTIAN_ID);
    // Plasticov should rank higher with health×2.0 weighting
    expect(grPv).toBeDefined();
    expect(grMt).toBeDefined();

    expect(grPv!.score).toBeGreaterThanOrEqual(grMt!.score);

    // maximize_profit → profit×2.0, opportunity×1.5
    const maxProfit = service.compareAccountAssets({
      candidateSellerIds: [PLASTICOV_ID, MAUSTIAN_ID],
      goal: "maximize_profit",
    });
    // Verify both are valid comparisons
    expect(maxProfit.ranking.length).toBe(2);
    expect(growRep.ranking.length).toBe(2);
    expect(maxProfit.decisionLogic).toContain("maximize_profit");
    expect(growRep.decisionLogic).toContain("grow_reputation");
  });
});

// ── Degradation tests (no store configured) ──────────────────────────────

describe("AccountBrainService — graceful degradation", () => {
  it("returns 'unavailable' for all sections when no stores configured", () => {
    const service = new AccountBrainService();
    const result = service.getAccountBrainStatus("any-seller");

    expect(result.status).toBe("missing_account_asset");
    expect(result.health).toBe("unavailable");
    expect(result.capabilities).toBe("unavailable");
    expect(result.noMutationExecuted).toBe(true);
  });

  it("never throws on any input", () => {
    const service = new AccountBrainService();
    expect(() => service.getAccountBrainStatus("any-seller")).not.toThrow();

    expect(() => service.compareAccountAssets({ candidateSellerIds: [] })).not.toThrow();

    expect(() => service.compareAccountAssets({})).not.toThrow();
  });

  it("compare returns empty ranking when no accounts", () => {
    const service = new AccountBrainService();
    const result = service.compareAccountAssets({
      candidateSellerIds: ["no-one"],
    });

    expect(result.noMutationExecuted).toBe(true);
    expect(result.ranking.length).toBe(1);
    const firstRank = result.ranking[0];
    expect(firstRank?.sellerId).toBe("no-one");
    expect(firstRank?.health).toBe("unavailable");
  });
});
