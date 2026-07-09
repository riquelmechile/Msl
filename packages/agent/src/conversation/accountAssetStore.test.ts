import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createAccountAssetStore } from "./accountAssetStore.js";
import type { AccountAsset, AccountHealthSnapshot } from "@msl/domain";

// ── Helpers ──────────────────────────────────────────────────────────

const plasticovAccount: Omit<AccountAsset, "createdAt" | "updatedAt"> = {
  sellerId: "plasticov-mlc",
  name: "Plasticov",
  marketplace: "MLC",
  profitGoal: 40,
  riskLevel: "low",
  status: "active",
  capabilities: [
    { kind: "publish", status: "active" },
    { kind: "pricing", status: "active" },
    { kind: "claims", status: "active" },
  ],
};

const maustianAccount: Omit<AccountAsset, "createdAt" | "updatedAt"> = {
  sellerId: "maustian-mlc",
  name: "Maustian",
  marketplace: "MLC",
  profitGoal: 50,
  riskLevel: "medium",
  status: "active",
  capabilities: [
    { kind: "publish", status: "active" },
    { kind: "pricing", status: "active" },
    { kind: "claims", status: "active" },
  ],
};

function createTestAsset(
  overrides: Partial<Omit<AccountAsset, "createdAt" | "updatedAt">> = {},
): AccountAsset {
  const now = new Date().toISOString();
  return {
    ...plasticovAccount,
    sellerId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    ...overrides,
    createdAt: now,
    updatedAt: now,
  };
}

// ── Schema ────────────────────────────────────────────────────────────

describe("AccountAssetStore — schema", () => {
  it("creates all 7 tables on empty database", () => {
    const db = new Database(":memory:");
    createAccountAssetStore(db);

    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'account_%' ORDER BY name`,
      )
      .all() as { name: string }[];

    expect(tables.map((t) => t.name)).toEqual([
      "account_assets",
      "account_capabilities",
      "account_health_snapshots",
      "account_opportunities",
      "account_profit_goals",
      "account_risks",
      "account_strategy_notes",
    ]);

    db.close();
  });

  it("is idempotent — no error on repeated calls", () => {
    const db = new Database(":memory:");
    createAccountAssetStore(db);
    // Second call must not throw
    expect(() => createAccountAssetStore(db)).not.toThrow();
    db.close();
  });

  it("preserves rows across repeated factory calls", () => {
    const db = new Database(":memory:");
    const store1 = createAccountAssetStore(db);
    const asset = createTestAsset({ sellerId: "keep-me" });
    store1.upsertAccountAsset(asset);

    // Create store again — data must survive
    const store2 = createAccountAssetStore(db);
    const found = store2.getAccountAsset("keep-me");
    expect(found).not.toBeNull();
    expect(found!.name).toBe(asset.name);
    db.close();
  });
});

// ── CRUD — AccountAsset ──────────────────────────────────────────────

describe("AccountAssetStore — CRUD", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAccountAssetStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAccountAssetStore(db);
  });

  it("upserts and retrieves an account (scenario: Plasticov and Maustian have separate records)", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.upsertAccountAsset({
      ...maustianAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(store.getAccountAsset("plasticov-mlc")!.sellerId).toBe("plasticov-mlc");
    expect(store.getAccountAsset("maustian-mlc")!.sellerId).toBe("maustian-mlc");
    expect(store.count()).toBe(2);
  });

  it("does not leak Plasticov data into Maustian queries (scenario: Plasticov memory does not leak)", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.upsertAccountAsset({
      ...maustianAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Add Plasticov-specific risk and opportunity
    store.addRisk("plasticov-mlc", {
      risk: "Plasticov-only risk",
      severity: "low",
      detectedAt: new Date().toISOString(),
    });
    store.addOpportunity("plasticov-mlc", {
      opportunity: "Plasticov-only opp",
      estimatedImpact: "high",
      detectedAt: new Date().toISOString(),
    });

    // Maustian queries must be empty
    const maustianRisks = store.getRisks("maustian-mlc");
    const maustianOpps = store.getOpportunities("maustian-mlc");
    expect(maustianRisks).toHaveLength(0);
    expect(maustianOpps).toHaveLength(0);

    // Plasticov still has its own data
    expect(store.getRisks("plasticov-mlc")).toHaveLength(1);
    expect(store.getOpportunities("plasticov-mlc")).toHaveLength(1);
  });

  it("supports global strategy notes visible to both accounts (scenario: Global strategy visible to both)", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.upsertAccountAsset({
      ...maustianAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Add a global strategy (seller_id = NULL)
    store.addStrategyNote(null, {
      goal: "Global margin strategy",
      approach: "Apply 45% margin across all accounts",
      activeSince: new Date().toISOString(),
    });

    // Add a Plasticov-scoped strategy
    store.addStrategyNote("plasticov-mlc", {
      goal: "Plasticov-only pricing",
      approach: "Aggressive pricing on electronics",
      activeSince: new Date().toISOString(),
    });

    // Both accounts see global
    const pvNotes = store.getStrategyNotes("plasticov-mlc");
    const mtNotes = store.getStrategyNotes("maustian-mlc");

    expect(pvNotes.some((s: { goal: string }) => s.goal === "Global margin strategy")).toBe(true);
    expect(mtNotes.some((s: { goal: string }) => s.goal === "Global margin strategy")).toBe(true);

    // But Plasticov-only is NOT visible to Maustian
    expect(mtNotes.some((s: { goal: string }) => s.goal === "Plasticov-only pricing")).toBe(false);
    expect(pvNotes.some((s: { goal: string }) => s.goal === "Plasticov-only pricing")).toBe(true);
  });

  it("compares accounts side-by-side (scenario: CEO compares two accounts)", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.upsertAccountAsset({
      ...maustianAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const result = store.compareAccounts();
    expect(result).toHaveLength(2);

    const pv = result.find((a: AccountAsset) => a.sellerId === "plasticov-mlc")!;
    const mt = result.find((a: AccountAsset) => a.sellerId === "maustian-mlc")!;

    expect(pv.profitGoal).toBe(40);
    expect(mt.profitGoal).toBe(50);
    expect(pv.riskLevel).toBe("low");
    expect(mt.riskLevel).toBe("medium");
  });

  it("updates account status", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.updateStatus("plasticov-mlc", "paused");

    const updated = store.getAccountAsset("plasticov-mlc")!;
    expect(updated.status).toBe("paused");
  });

  it("listActive returns only active accounts", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.upsertAccountAsset({
      ...maustianAccount,
      status: "archived",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const active = store.listActive();
    expect(active).toHaveLength(1);
    expect(active[0]!.sellerId).toBe("plasticov-mlc");
  });
});

// ── Health Snapshots ─────────────────────────────────────────────────

describe("AccountAssetStore — health snapshots", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAccountAssetStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAccountAssetStore(db);
  });

  it("records and retrieves health snapshots in chronological order (scenario: Health degrades over time)", () => {
    const snap1: AccountHealthSnapshot = {
      status: "healthy",
      reputation: "green",
      recordedAt: "2026-07-01T00:00:00.000Z",
    };
    const snap2: AccountHealthSnapshot = {
      status: "degraded",
      reputation: "yellow",
      salesVelocity: 0.8,
      recordedAt: "2026-07-05T00:00:00.000Z",
    };
    const snap3: AccountHealthSnapshot = {
      status: "at-risk",
      reputation: "orange",
      salesVelocity: 0.6,
      riskLevel: "medium",
      recordedAt: "2026-07-09T00:00:00.000Z",
    };

    store.recordHealthSnapshot("plasticov-mlc", snap1);
    store.recordHealthSnapshot("plasticov-mlc", snap2);
    store.recordHealthSnapshot("plasticov-mlc", snap3);

    const history = store.getHealthHistory("plasticov-mlc");
    expect(history).toHaveLength(3);
    expect(history[0]!.status).toBe("healthy");
    expect(history[1]!.status).toBe("degraded");
    expect(history[2]!.status).toBe("at-risk");
  });

  it("scopes health to specific seller", () => {
    store.recordHealthSnapshot("plasticov-mlc", {
      status: "healthy",
      recordedAt: new Date().toISOString(),
    });

    const maustianHistory = store.getHealthHistory("maustian-mlc");
    expect(maustianHistory).toHaveLength(0);
  });
});

// ── Risks & Opportunities ────────────────────────────────────────────

describe("AccountAssetStore — risks and opportunities", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAccountAssetStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAccountAssetStore(db);
  });

  it("adds and retrieves risks", () => {
    store.addRisk("plasticov-mlc", {
      risk: "Margin compression in electronics",
      severity: "high",
      mitigation: "Raise prices 5%",
      detectedAt: new Date().toISOString(),
    });

    const risks = store.getRisks("plasticov-mlc");
    expect(risks).toHaveLength(1);
    expect(risks[0]!.risk).toBe("Margin compression in electronics");
    expect(risks[0]!.severity).toBe("high");
  });

  it("adds and retrieves opportunities", () => {
    store.addOpportunity("plasticov-mlc", {
      opportunity: "Expand into home & garden category",
      estimatedImpact: "$2,000/month",
      confidence: 0.85,
      detectedAt: new Date().toISOString(),
    });

    const opps = store.getOpportunities("plasticov-mlc");
    expect(opps).toHaveLength(1);
    expect(opps[0]!.opportunity).toBe("Expand into home & garden category");
    expect(opps[0]!.confidence).toBe(0.85);
  });
});

// ── Profit Goals ──────────────────────────────────────────────────────

describe("AccountAssetStore — profit goals", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAccountAssetStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAccountAssetStore(db);
  });

  it("upserts and retrieves profit goal", () => {
    store.upsertProfitGoal("plasticov-mlc", 40);
    expect(store.getProfitGoal("plasticov-mlc")).toBe(40);

    // Update
    store.upsertProfitGoal("plasticov-mlc", 45);
    expect(store.getProfitGoal("plasticov-mlc")).toBe(45);
  });

  it("returns null for unknown seller", () => {
    expect(store.getProfitGoal("nonexistent")).toBeNull();
  });
});

// ── getRecentMemory ──────────────────────────────────────────────────

describe("AccountAssetStore — getRecentMemory", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAccountAssetStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAccountAssetStore(db);
  });

  it("returns a combined view of strategic memory", () => {
    store.upsertAccountAsset({
      ...plasticovAccount,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    store.upsertProfitGoal("plasticov-mlc", 40);
    store.addRisk("plasticov-mlc", {
      risk: "Low inventory on SKU-42",
      severity: "medium",
      detectedAt: new Date().toISOString(),
    });
    store.addOpportunity("plasticov-mlc", {
      opportunity: "Q4 seasonal demand spike",
      estimatedImpact: "$5,000",
      confidence: 0.9,
      detectedAt: new Date().toISOString(),
    });

    const memory = store.getRecentMemory("plasticov-mlc");
    expect(memory.asset).not.toBeNull();
    expect(memory.asset!.sellerId).toBe("plasticov-mlc");
    expect(memory.profitGoal).toBe(40);
    expect(memory.risks).toHaveLength(1);
    expect(memory.opportunities).toHaveLength(1);
    expect(memory.capabilities).toHaveLength(3);
  });
});

// ── Capabilities ──────────────────────────────────────────────────────

describe("AccountAssetStore — capabilities", () => {
  let db: Database.Database;
  let store: ReturnType<typeof createAccountAssetStore>;

  beforeEach(() => {
    db = new Database(":memory:");
    store = createAccountAssetStore(db);
  });

  it("upserts and retrieves capabilities", () => {
    store.upsertCapability("plasticov-mlc", { kind: "publish", status: "active" });
    store.upsertCapability("plasticov-mlc", { kind: "pricing", status: "degraded" });

    const caps = store.getCapabilities("plasticov-mlc");
    expect(caps).toHaveLength(2);
    expect(caps.find((c: { kind: string }) => c.kind === "publish")!.status).toBe("active");
    expect(caps.find((c: { kind: string }) => c.kind === "pricing")!.status).toBe("degraded");
  });

  it("updates an existing capability instead of duplicating", () => {
    store.upsertCapability("plasticov-mlc", { kind: "publish", status: "active" });
    store.upsertCapability("plasticov-mlc", { kind: "publish", status: "degraded" });

    const caps = store.getCapabilities("plasticov-mlc");
    expect(caps).toHaveLength(1);
    expect(caps[0]!.status).toBe("degraded");
  });
});

describe("AccountAssetStore — edge cases", () => {
  it("getAccountAsset returns null for unknown seller", () => {
    const db = new Database(":memory:");
    const store = createAccountAssetStore(db);
    expect(store.getAccountAsset("nobody")).toBeNull();
    db.close();
  });

  it("compareAccounts returns empty array when no accounts exist", () => {
    const db = new Database(":memory:");
    const store = createAccountAssetStore(db);
    expect(store.compareAccounts()).toHaveLength(0);
    db.close();
  });
});
