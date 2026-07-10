import Database from "better-sqlite3";

import type {
  AccountAsset,
  AccountCapability,
  AccountHealthSnapshot,
  AccountOpportunity,
  AccountRisk,
  AccountRiskLevel,
  AccountStrategy,
} from "@msl/domain";

// ── Public type ────────────────────────────────────────────────────────

export type AccountAssetStore = {
  /** Insert or update an account record (upsert by seller_id). */
  upsertAccountAsset(asset: AccountAsset): AccountAsset;
  /** Retrieve a single account by seller_id. */
  getAccountAsset(sellerId: string): AccountAsset | null;
  /** Return all accounts side-by-side for comparison. */
  compareAccounts(): AccountAsset[];
  /** Insert or update a capability for a seller. */
  upsertCapability(sellerId: string, capability: AccountCapability): AccountCapability;
  /** List all capabilities for a seller. */
  getCapabilities(sellerId: string): AccountCapability[];
  /** Record a point-in-time health snapshot. */
  recordHealthSnapshot(sellerId: string, snapshot: AccountHealthSnapshot): AccountHealthSnapshot;
  /** Return all health snapshots for a seller in chronological order. */
  getHealthHistory(sellerId: string): AccountHealthSnapshot[];
  /** Set or update the profit goal for a seller. */
  upsertProfitGoal(sellerId: string, profitGoal: number): void;
  /** Get the current profit goal for a seller. */
  getProfitGoal(sellerId: string): number | null;
  /** Add a strategy note for a seller (seller_id can be NULL for global). */
  addStrategyNote(sellerId: string | null, strategy: AccountStrategy): AccountStrategy;
  /** Get strategy notes, optionally scoped to a seller (includes global when scoped). */
  getStrategyNotes(sellerId?: string): (AccountStrategy & { sellerId?: string })[];
  /** Add a tracked risk for a seller. */
  addRisk(sellerId: string, risk: AccountRisk): AccountRisk;
  /** List all risks for a seller. */
  getRisks(sellerId: string): AccountRisk[];
  /** Add a tracked opportunity for a seller. */
  addOpportunity(sellerId: string, opportunity: AccountOpportunity): AccountOpportunity;
  /** List all opportunities for a seller. */
  getOpportunities(sellerId: string): AccountOpportunity[];
  /** Return a combined view of recent strategic memory for a seller. */
  getRecentMemory(sellerId: string): {
    asset: AccountAsset | null;
    capabilities: AccountCapability[];
    profitGoal: number | null;
    strategies: (AccountStrategy & { sellerId?: string })[];
    risks: AccountRisk[];
    opportunities: AccountOpportunity[];
  };
  /** Update the status of an account. */
  updateStatus(sellerId: string, status: AccountAsset["status"]): void;
  /** List all active accounts. */
  listActive(): AccountAsset[];
  /** Total account count (for tests). */
  count(): number;
};

// ── Schema ──────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS account_assets (
  seller_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  profit_goal REAL NOT NULL DEFAULT 0.0,
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK(risk_level IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','paused','archived','pending_configuration')),
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_assets_seller ON account_assets(seller_id);
CREATE INDEX IF NOT EXISTS idx_account_assets_status ON account_assets(status);

CREATE TABLE IF NOT EXISTS account_capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK(status IN ('active','degraded','missing')),
  health_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_capabilities_seller ON account_capabilities(seller_id);
CREATE INDEX IF NOT EXISTS idx_account_capabilities_kind ON account_capabilities(seller_id, kind);

CREATE TABLE IF NOT EXISTS account_health_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK(status IN ('healthy','degraded','at-risk','critical')),
  reputation TEXT,
  sales_velocity REAL,
  margin_profile REAL,
  risk_level TEXT
    CHECK(risk_level IS NULL OR risk_level IN ('low','medium','high','critical')),
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_snapshots_seller ON account_health_snapshots(seller_id);
CREATE INDEX IF NOT EXISTS idx_health_snapshots_recorded ON account_health_snapshots(seller_id, recorded_at);

CREATE TABLE IF NOT EXISTS account_profit_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL UNIQUE,
  target_value REAL NOT NULL,
  active_since TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_profit_goals_seller ON account_profit_goals(seller_id);

CREATE TABLE IF NOT EXISTS account_strategy_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT,
  goal TEXT NOT NULL,
  approach TEXT NOT NULL,
  constraints TEXT,
  active_since TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_strategy_notes_seller ON account_strategy_notes(seller_id);
CREATE INDEX IF NOT EXISTS idx_strategy_notes_created ON account_strategy_notes(created_at);

CREATE TABLE IF NOT EXISTS account_risks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL,
  risk TEXT NOT NULL,
  severity TEXT NOT NULL
    CHECK(severity IN ('low','medium','high','critical')),
  mitigation TEXT,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_risks_seller ON account_risks(seller_id);
CREATE INDEX IF NOT EXISTS idx_account_risks_detected ON account_risks(seller_id, detected_at);

CREATE TABLE IF NOT EXISTS account_opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id TEXT NOT NULL,
  opportunity TEXT NOT NULL,
  estimated_impact TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  detected_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_account_opps_seller ON account_opportunities(seller_id);
CREATE INDEX IF NOT EXISTS idx_account_opps_detected ON account_opportunities(seller_id, detected_at);
`;

// ── Row types ───────────────────────────────────────────────────────────

type AccountAssetRow = {
  seller_id: string;
  name: string;
  marketplace: string;
  profit_goal: number;
  risk_level: string;
  status: string;
  capabilities_json: string;
  created_at: string;
  updated_at: string;
};

type CapabilityRow = {
  id: number;
  seller_id: string;
  kind: string;
  status: string;
  health_json: string | null;
  created_at: string;
  updated_at: string;
};

type HealthRow = {
  id: number;
  seller_id: string;
  status: string;
  reputation: string | null;
  sales_velocity: number | null;
  margin_profile: number | null;
  risk_level: string | null;
  recorded_at: string;
  created_at: string;
};

type StrategyNoteRow = {
  id: number;
  seller_id: string | null;
  goal: string;
  approach: string;
  constraints: string | null;
  active_since: string;
  created_at: string;
};

type RiskRow = {
  id: number;
  seller_id: string;
  risk: string;
  severity: string;
  mitigation: string | null;
  detected_at: string;
  created_at: string;
};

type OpportunityRow = {
  id: number;
  seller_id: string;
  opportunity: string;
  estimated_impact: string;
  confidence: number | null;
  detected_at: string;
  created_at: string;
};

// ── Row mapping ────────────────────────────────────────────────────────

function parseCapabilitiesJson(json: string): AccountCapability[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((c: Record<string, unknown>) => ({
      kind: typeof c.kind === "string" ? c.kind : "",
      status: (c.status as AccountCapability["status"]) ?? "active",
      ...(c.health ? { health: c.health as AccountHealthSnapshot } : {}),
    }));
  } catch {
    return [];
  }
}

function parseHealthJson(json: string | null): AccountHealthSnapshot | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const snapshot: AccountHealthSnapshot = {
      status: (parsed.status as AccountHealthSnapshot["status"]) ?? "healthy",
      recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : "",
    };
    if (typeof parsed.reputation === "string") snapshot.reputation = parsed.reputation;
    if (parsed.salesVelocity != null) snapshot.salesVelocity = Number(parsed.salesVelocity);
    if (parsed.marginProfile != null) snapshot.marginProfile = Number(parsed.marginProfile);
    if (parsed.riskLevel) snapshot.riskLevel = parsed.riskLevel as AccountRiskLevel;
    return snapshot;
  } catch {
    return undefined;
  }
}

function rowToAccountAsset(row: AccountAssetRow): AccountAsset {
  return {
    sellerId: row.seller_id,
    name: row.name,
    marketplace: row.marketplace as AccountAsset["marketplace"],
    capabilities: parseCapabilitiesJson(row.capabilities_json),
    profitGoal: row.profit_goal,
    riskLevel: row.risk_level as AccountAsset["riskLevel"],
    status: row.status as AccountAsset["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToCapability(row: CapabilityRow): AccountCapability {
  const cap: AccountCapability = {
    kind: row.kind,
    status: row.status as AccountCapability["status"],
  };
  if (row.health_json) {
    const health = parseHealthJson(row.health_json);
    if (health) cap.health = health;
  }
  return cap;
}

function rowToHealth(row: HealthRow): AccountHealthSnapshot {
  const snapshot: AccountHealthSnapshot = {
    status: row.status as AccountHealthSnapshot["status"],
    recordedAt: row.recorded_at,
  };
  if (row.reputation) snapshot.reputation = row.reputation;
  if (row.sales_velocity != null) snapshot.salesVelocity = row.sales_velocity;
  if (row.margin_profile != null) snapshot.marginProfile = row.margin_profile;
  if (row.risk_level) snapshot.riskLevel = row.risk_level as AccountRiskLevel;
  return snapshot;
}

function rowToStrategy(row: StrategyNoteRow): AccountStrategy & { sellerId?: string } {
  return {
    goal: row.goal,
    approach: row.approach,
    ...(row.constraints ? { constraints: row.constraints } : {}),
    activeSince: row.active_since,
    ...(row.seller_id ? { sellerId: row.seller_id } : {}),
  };
}

function rowToRisk(row: RiskRow): AccountRisk {
  return {
    risk: row.risk,
    severity: row.severity as AccountRisk["severity"],
    ...(row.mitigation ? { mitigation: row.mitigation } : {}),
    detectedAt: row.detected_at,
  };
}

function rowToOpportunity(row: OpportunityRow): AccountOpportunity {
  return {
    opportunity: row.opportunity,
    estimatedImpact: row.estimated_impact,
    ...(row.confidence != null ? { confidence: row.confidence } : {}),
    detectedAt: row.detected_at,
  };
}

// ── Factory ────────────────────────────────────────────────────────────

/**
 * Create the account asset store backed by SQLite.
 *
 * Follows the same factory pattern as {@link StrategyStore}: the caller owns
 * the `Database` handle and the store only adds its own schema and prepared
 * statements.
 *
 * @param db An existing `better-sqlite3` Database connection.
 */
export function createAccountAssetStore(db: Database.Database): AccountAssetStore {
  // Apply schema idempotently.
  db.exec(SCHEMA_SQL);

  // ── Account Assets ────────────────────────────────────────────────

  const upsertAssetStmt = db.prepare(`
    INSERT INTO account_assets (
      seller_id, name, marketplace, profit_goal, risk_level, status, capabilities_json, updated_at
    ) VALUES (
      @sellerId, @name, @marketplace, @profitGoal, @riskLevel, @status,
      @capabilitiesJson, datetime('now')
    )
    ON CONFLICT(seller_id) DO UPDATE SET
      name = excluded.name,
      marketplace = excluded.marketplace,
      profit_goal = excluded.profit_goal,
      risk_level = excluded.risk_level,
      status = excluded.status,
      capabilities_json = excluded.capabilities_json,
      updated_at = datetime('now')
  `);

  const getAssetStmt = db.prepare(`
    SELECT * FROM account_assets WHERE seller_id = ?
  `);

  const listActiveStmt = db.prepare(`
    SELECT * FROM account_assets WHERE status = 'active' ORDER BY name
  `);

  const listAllStmt = db.prepare(`
    SELECT * FROM account_assets ORDER BY name
  `);

  const updateStatusStmt = db.prepare(`
    UPDATE account_assets SET status = ?, updated_at = datetime('now')
    WHERE seller_id = ?
  `);

  const countStmt = db.prepare(`
    SELECT COUNT(*) as count FROM account_assets
  `);

  // ── Capabilities ──────────────────────────────────────────────────

  const upsertCapStmt = db.prepare(`
    INSERT INTO account_capabilities (seller_id, kind, status, health_json, updated_at)
    VALUES (@sellerId, @kind, @status, @healthJson, datetime('now'))
    ON CONFLICT(id) DO NOTHING
  `);

  const getCapsStmt = db.prepare(`
    SELECT * FROM account_capabilities WHERE seller_id = ?
  `);

  const deleteCapsStmt = db.prepare(`
    DELETE FROM account_capabilities WHERE seller_id = ? AND kind = ?
  `);

  // ── Health Snapshots ──────────────────────────────────────────────

  const insertHealthStmt = db.prepare(`
    INSERT INTO account_health_snapshots (
      seller_id, status, reputation, sales_velocity, margin_profile, risk_level, recorded_at
    ) VALUES (
      @sellerId, @status, @reputation, @salesVelocity, @marginProfile, @riskLevel, @recordedAt
    )
  `);

  const getHealthStmt = db.prepare(`
    SELECT * FROM account_health_snapshots
    WHERE seller_id = ?
    ORDER BY recorded_at ASC
  `);

  // ── Profit Goals ──────────────────────────────────────────────────

  const upsertProfitStmt = db.prepare(`
    INSERT INTO account_profit_goals (seller_id, target_value, active_since)
    VALUES (@sellerId, @targetValue, datetime('now'))
    ON CONFLICT(seller_id) DO UPDATE SET
      target_value = excluded.target_value,
      active_since = datetime('now')
  `);

  const getProfitStmt = db.prepare(`
    SELECT target_value FROM account_profit_goals WHERE seller_id = ?
  `);

  // ── Strategy Notes ────────────────────────────────────────────────

  const insertStrategyStmt = db.prepare(`
    INSERT INTO account_strategy_notes (seller_id, goal, approach, constraints, active_since)
    VALUES (@sellerId, @goal, @approach, @constraints, @activeSince)
  `);

  const getStrategiesStmt = db.prepare(`
    SELECT * FROM account_strategy_notes
    WHERE (@sellerId IS NULL OR seller_id = @sellerId OR seller_id IS NULL)
    ORDER BY created_at DESC
  `);

  // ── Risks ────────────────────────────────────────────────────────

  const insertRiskStmt = db.prepare(`
    INSERT INTO account_risks (seller_id, risk, severity, mitigation, detected_at)
    VALUES (@sellerId, @risk, @severity, @mitigation, @detectedAt)
  `);

  const getRisksStmt = db.prepare(`
    SELECT * FROM account_risks
    WHERE seller_id = ?
    ORDER BY detected_at DESC
  `);

  // ── Opportunities ─────────────────────────────────────────────────

  const insertOppStmt = db.prepare(`
    INSERT INTO account_opportunities (seller_id, opportunity, estimated_impact, confidence, detected_at)
    VALUES (@sellerId, @opportunity, @estimatedImpact, @confidence, @detectedAt)
  `);

  const getOppsStmt = db.prepare(`
    SELECT * FROM account_opportunities
    WHERE seller_id = ?
    ORDER BY detected_at DESC
  `);

  // ── Public API ────────────────────────────────────────────────────

  const upsertAccountAsset = (asset: AccountAsset): AccountAsset => {
    const capabilitiesJson = JSON.stringify(asset.capabilities);
    upsertAssetStmt.run({
      sellerId: asset.sellerId,
      name: asset.name,
      marketplace: asset.marketplace,
      profitGoal: asset.profitGoal,
      riskLevel: asset.riskLevel,
      status: asset.status,
      capabilitiesJson,
    });
    // Refresh capabilities: delete existing, re-insert
    const existingCaps = getCapsStmt.all(asset.sellerId) as CapabilityRow[];
    for (const cap of existingCaps) {
      deleteCapsStmt.run(asset.sellerId, cap.kind);
    }
    for (const cap of asset.capabilities) {
      upsertCapStmt.run({
        sellerId: asset.sellerId,
        kind: cap.kind,
        status: cap.status,
        healthJson: cap.health ? JSON.stringify(cap.health) : null,
      });
    }
    return getAccountAsset(asset.sellerId)!;
  };

  const getAccountAsset = (sellerId: string): AccountAsset | null => {
    const row = getAssetStmt.get(sellerId) as AccountAssetRow | undefined;
    if (!row) return null;
    const asset = rowToAccountAsset(row);
    // Hydrate capabilities from the capabilities table for full fidelity
    const capRows = getCapsStmt.all(sellerId) as CapabilityRow[];
    asset.capabilities = capRows.map(rowToCapability);
    return asset;
  };

  const compareAccounts = (): AccountAsset[] => {
    const rows = listAllStmt.all() as AccountAssetRow[];
    return rows.map((row) => {
      const asset = rowToAccountAsset(row);
      const capRows = getCapsStmt.all(row.seller_id) as CapabilityRow[];
      asset.capabilities = capRows.map(rowToCapability);
      return asset;
    });
  };

  const upsertCapability = (sellerId: string, capability: AccountCapability): AccountCapability => {
    // Delete existing entry for this seller+kind, then insert fresh
    deleteCapsStmt.run(sellerId, capability.kind);
    upsertCapStmt.run({
      sellerId,
      kind: capability.kind,
      status: capability.status,
      healthJson: capability.health ? JSON.stringify(capability.health) : null,
    });
    return capability;
  };

  const getCapabilities = (sellerId: string): AccountCapability[] => {
    const rows = getCapsStmt.all(sellerId) as CapabilityRow[];
    return rows.map(rowToCapability);
  };

  const recordHealthSnapshot = (
    sellerId: string,
    snapshot: AccountHealthSnapshot,
  ): AccountHealthSnapshot => {
    insertHealthStmt.run({
      sellerId,
      status: snapshot.status,
      reputation: snapshot.reputation ?? null,
      salesVelocity: snapshot.salesVelocity ?? null,
      marginProfile: snapshot.marginProfile ?? null,
      riskLevel: snapshot.riskLevel ?? null,
      recordedAt: snapshot.recordedAt,
    });
    return snapshot;
  };

  const getHealthHistory = (sellerId: string): AccountHealthSnapshot[] => {
    const rows = getHealthStmt.all(sellerId) as HealthRow[];
    return rows.map(rowToHealth);
  };

  const upsertProfitGoal = (sellerId: string, profitGoal: number): void => {
    upsertProfitStmt.run({ sellerId, targetValue: profitGoal });
  };

  const getProfitGoal = (sellerId: string): number | null => {
    const row = getProfitStmt.get(sellerId) as { target_value: number } | undefined;
    return row ? row.target_value : null;
  };

  const addStrategyNote = (sellerId: string | null, strategy: AccountStrategy): AccountStrategy => {
    insertStrategyStmt.run({
      sellerId,
      goal: strategy.goal,
      approach: strategy.approach,
      constraints: strategy.constraints ?? null,
      activeSince: strategy.activeSince,
    });
    return strategy;
  };

  const getStrategyNotes = (sellerId?: string): (AccountStrategy & { sellerId?: string })[] => {
    const rows = getStrategiesStmt.all({
      sellerId: sellerId ?? null,
    }) as StrategyNoteRow[];
    return rows.map(rowToStrategy);
  };

  const addRisk = (sellerId: string, risk: AccountRisk): AccountRisk => {
    insertRiskStmt.run({
      sellerId,
      risk: risk.risk,
      severity: risk.severity,
      mitigation: risk.mitigation ?? null,
      detectedAt: risk.detectedAt,
    });
    return risk;
  };

  const getRisks = (sellerId: string): AccountRisk[] => {
    const rows = getRisksStmt.all(sellerId) as RiskRow[];
    return rows.map(rowToRisk);
  };

  const addOpportunity = (
    sellerId: string,
    opportunity: AccountOpportunity,
  ): AccountOpportunity => {
    insertOppStmt.run({
      sellerId,
      opportunity: opportunity.opportunity,
      estimatedImpact: opportunity.estimatedImpact,
      confidence: opportunity.confidence ?? null,
      detectedAt: opportunity.detectedAt,
    });
    return opportunity;
  };

  const getOpportunities = (sellerId: string): AccountOpportunity[] => {
    const rows = getOppsStmt.all(sellerId) as OpportunityRow[];
    return rows.map(rowToOpportunity);
  };

  const getRecentMemory = (sellerId: string) => {
    return {
      asset: getAccountAsset(sellerId),
      capabilities: getCapabilities(sellerId),
      profitGoal: getProfitGoal(sellerId),
      strategies: getStrategyNotes(sellerId),
      risks: getRisks(sellerId),
      opportunities: getOpportunities(sellerId),
    };
  };

  const updateStatus = (sellerId: string, status: AccountAsset["status"]): void => {
    updateStatusStmt.run(status, sellerId);
  };

  const listActive = (): AccountAsset[] => {
    const rows = listActiveStmt.all() as AccountAssetRow[];
    return rows.map((row) => {
      const asset = rowToAccountAsset(row);
      const capRows = getCapsStmt.all(row.seller_id) as CapabilityRow[];
      asset.capabilities = capRows.map(rowToCapability);
      return asset;
    });
  };

  const count = (): number => {
    const row = countStmt.get() as { count: number };
    return row.count;
  };

  return {
    upsertAccountAsset,
    getAccountAsset,
    compareAccounts,
    upsertCapability,
    getCapabilities,
    recordHealthSnapshot,
    getHealthHistory,
    upsertProfitGoal,
    getProfitGoal,
    addStrategyNote,
    getStrategyNotes,
    addRisk,
    getRisks,
    addOpportunity,
    getOpportunities,
    getRecentMemory,
    updateStatus,
    listActive,
    count,
  };
}
