import type {
  SellerId,
  SupplierId,
  SupplierItemSnapshot,
  SupplierLearnedFallbackPolicy,
  SupplierMirrorLedgerRecord,
  SupplierMirrorNotificationEvent,
  SupplierNotificationPreference,
  SupplierRegistryEntry,
  SupplierStockObservation,
  SupplierTargetMapping,
  SupplierTargetPolicy,
  SupplierTargetPolicyScopeType,
} from "@msl/domain";
import Database from "better-sqlite3";

type SupplierRow = {
  id: string;
  name: string;
  enabled: number;
  primary_source: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type SupplierItemRow = {
  supplier_id: string;
  supplier_item_id: string;
  ml_item_id: string | null;
  title: string;
  sku: string | null;
  category_id: string | null;
  price: number | null;
  currency: string | null;
  snapshot_json: string;
  source: string;
  confidence: string;
  freshness: string;
  evidence_id: string;
  captured_at: string;
};

type StockObservationRow = {
  id: string;
  supplier_id: string;
  supplier_item_id: string;
  source: string;
  authority: string;
  quantity: number | null;
  status: string;
  confidence: string;
  evidence_id: string;
  captured_at: string;
};

type MappingRow = {
  supplier_id: string;
  supplier_item_id: string;
  target_seller_id: string;
  target_item_id: string;
  policy_scope_type: string;
  policy_scope_id: string;
  policy_supplier_id: string;
  state: string;
  approved_at: string | null;
  evidence_ids_json: string;
};

type PolicyRow = {
  scope_type: string;
  scope_id: string;
  supplier_id: string;
  target_seller_ids_json: string;
  low_stock_threshold: number;
  auto_pause_allowed: number;
  pricing_policy_json: string | null;
};

type LedgerRow = {
  id: string;
  action_type: string;
  idempotency_key: string;
  status: string;
  reason: string;
  supplier_id: string;
  supplier_item_id: string | null;
  target_seller_id: string | null;
  target_item_id: string | null;
  evidence_ids_json: string;
  before_json: string | null;
  after_json: string | null;
  created_at: string;
};

type PreferenceRow = {
  scope_type: string;
  scope_id: string;
  preference_json: string;
};

type NotificationEventRow = {
  id: string;
  type: string;
  status: string;
  supplier_id: string;
  supplier_item_id: string | null;
  target_seller_id: string | null;
  target_item_id: string | null;
  reason: string;
  evidence_ids_json: string;
  metadata_json: string;
  created_at: string;
};

type LearnedFallbackPolicyRow = {
  id: string;
  policy_type: string;
  scope_json: string;
  decision_json: string;
  confidence: string;
  evidence_ids_json: string;
  status: string;
};

export type SupplierMirrorStore = {
  upsertSupplier(supplier: SupplierRegistryEntry): Promise<void>;
  getSupplier(supplierId: SupplierId): Promise<SupplierRegistryEntry | null>;
  listEnabledSuppliers(): Promise<SupplierRegistryEntry[]>;
  upsertSupplierItemSnapshot(snapshot: SupplierItemSnapshot): Promise<void>;
  getSupplierItemSnapshot(
    supplierId: SupplierId,
    supplierItemId: string,
  ): Promise<SupplierItemSnapshot | null>;
  listSupplierItemSnapshots(supplierId: SupplierId): Promise<SupplierItemSnapshot[]>;
  listTargetPolicies(supplierId: SupplierId): Promise<SupplierTargetPolicy[]>;
  listApprovedItemMappings(supplierId: SupplierId): Promise<SupplierTargetMapping[]>;
  listLearnedFallbackPolicies(supplierId: SupplierId): Promise<SupplierLearnedFallbackPolicy[]>;
  recordStockObservation(observation: SupplierStockObservation): Promise<void>;
  listStockObservations(
    supplierId: SupplierId,
    supplierItemId: string,
  ): Promise<SupplierStockObservation[]>;
  upsertTargetMapping(mapping: SupplierTargetMapping): Promise<void>;
  listTargetMappings(
    supplierId: SupplierId,
    supplierItemId: string,
  ): Promise<SupplierTargetMapping[]>;
  upsertTargetPolicy(policy: SupplierTargetPolicy): Promise<void>;
  resolveTargetPolicy(input: {
    supplierId: SupplierId;
    supplierItemId: string;
    categoryId?: string;
  }): Promise<SupplierTargetPolicy | null>;
  appendLedger(record: SupplierMirrorLedgerRecord): Promise<SupplierMirrorLedgerRecord>;
  getLedgerByIdempotencyKey(idempotencyKey: string): Promise<SupplierMirrorLedgerRecord | null>;
  recordNotificationEvent(
    event: SupplierMirrorNotificationEvent,
  ): Promise<SupplierMirrorNotificationEvent>;
  getNotificationEvent(id: string): Promise<SupplierMirrorNotificationEvent | null>;
  listNotificationEvents(filter?: {
    supplierId?: SupplierId;
    limit?: number;
  }): Promise<SupplierMirrorNotificationEvent[]>;
  saveNotificationPreference(preference: SupplierNotificationPreference): Promise<void>;
  getNotificationPreference(
    scopeType: SupplierTargetPolicyScopeType,
    scopeId: string,
  ): Promise<SupplierNotificationPreference | null>;
  upsertLearnedFallbackPolicy(policy: SupplierLearnedFallbackPolicy): Promise<void>;
  getLearnedFallbackPolicy(id: string): Promise<SupplierLearnedFallbackPolicy | null>;
};

function parseJson<TValue>(raw: string | null): TValue | null {
  if (raw === null) return null;
  return JSON.parse(raw) as TValue;
}

function stringifyOptional(value: Readonly<Record<string, unknown>> | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

export function migrateSupplierMirrorStore(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      primary_source TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_items (
      supplier_id TEXT NOT NULL,
      supplier_item_id TEXT NOT NULL,
      ml_item_id TEXT,
      title TEXT NOT NULL,
      sku TEXT,
      category_id TEXT,
      price REAL,
      currency TEXT,
      snapshot_json TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence TEXT NOT NULL,
      freshness TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      PRIMARY KEY (supplier_id, supplier_item_id)
    );

    CREATE TABLE IF NOT EXISTS stock_observations (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      supplier_item_id TEXT NOT NULL,
      source TEXT NOT NULL,
      authority TEXT NOT NULL,
      quantity INTEGER,
      status TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      captured_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS item_mappings (
      supplier_id TEXT NOT NULL,
      supplier_item_id TEXT NOT NULL,
      target_seller_id TEXT NOT NULL,
      target_item_id TEXT NOT NULL,
      policy_scope_type TEXT NOT NULL,
      policy_scope_id TEXT NOT NULL,
      policy_supplier_id TEXT NOT NULL,
      state TEXT NOT NULL,
      approved_at TEXT,
      evidence_ids_json TEXT NOT NULL,
      PRIMARY KEY (supplier_id, supplier_item_id, target_seller_id, target_item_id)
    );

    CREATE TABLE IF NOT EXISTS target_policies (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      target_seller_ids_json TEXT NOT NULL,
      low_stock_threshold INTEGER NOT NULL,
      auto_pause_allowed INTEGER NOT NULL,
      pricing_policy_json TEXT,
      PRIMARY KEY (scope_type, scope_id, supplier_id)
    );

    CREATE TABLE IF NOT EXISTS sync_ledger (
      id TEXT PRIMARY KEY,
      action_type TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_item_id TEXT,
      target_seller_id TEXT,
      target_item_id TEXT,
      evidence_ids_json TEXT NOT NULL,
      before_json TEXT,
      after_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      preference_json TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id)
    );

    CREATE TABLE IF NOT EXISTS supplier_mirror_notification_events (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_item_id TEXT,
      target_seller_id TEXT,
      target_item_id TEXT,
      reason TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learned_fallback_policies (
      id TEXT PRIMARY KEY,
      policy_type TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      decision_json TEXT NOT NULL,
      confidence TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_supplier_items_supplier ON supplier_items(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_stock_observations_item ON stock_observations(supplier_id, supplier_item_id, captured_at DESC);
    CREATE INDEX IF NOT EXISTS idx_item_mappings_item ON item_mappings(supplier_id, supplier_item_id);
    CREATE INDEX IF NOT EXISTS idx_sync_ledger_supplier ON sync_ledger(supplier_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_supplier_mirror_notification_events_supplier ON supplier_mirror_notification_events(supplier_id, created_at DESC);
  `);

  const mappingColumns = db.prepare("PRAGMA table_info(item_mappings)").all() as Array<{
    name: string;
  }>;
  const mappingColumnNames = new Set(mappingColumns.map((column) => column.name));
  if (!mappingColumnNames.has("policy_scope_type")) {
    db.exec(
      "ALTER TABLE item_mappings ADD COLUMN policy_scope_type TEXT NOT NULL DEFAULT 'supplier'",
    );
  }
  if (!mappingColumnNames.has("policy_scope_id")) {
    db.exec("ALTER TABLE item_mappings ADD COLUMN policy_scope_id TEXT NOT NULL DEFAULT ''");
  }
  if (!mappingColumnNames.has("policy_supplier_id")) {
    db.exec("ALTER TABLE item_mappings ADD COLUMN policy_supplier_id TEXT NOT NULL DEFAULT ''");
  }
}

function supplierFromRow(row: SupplierRow): SupplierRegistryEntry {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled === 1,
    primarySource: row.primary_source as SupplierRegistryEntry["primarySource"],
    metadata: parseJson<Readonly<Record<string, unknown>>>(row.metadata_json) ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function itemFromRow(row: SupplierItemRow): SupplierItemSnapshot {
  return {
    supplierId: row.supplier_id,
    supplierItemId: row.supplier_item_id,
    ...(row.ml_item_id === null ? {} : { mlItemId: row.ml_item_id }),
    title: row.title,
    ...(row.sku === null ? {} : { sku: row.sku }),
    ...(row.category_id === null ? {} : { categoryId: row.category_id }),
    ...(row.price === null ? {} : { price: row.price }),
    ...(row.currency === null ? {} : { currency: row.currency }),
    snapshot: parseJson<Readonly<Record<string, unknown>>>(row.snapshot_json) ?? {},
    source: row.source as SupplierItemSnapshot["source"],
    confidence: row.confidence as SupplierItemSnapshot["confidence"],
    freshness: row.freshness as SupplierItemSnapshot["freshness"],
    evidenceId: row.evidence_id,
    capturedAt: row.captured_at,
  };
}

function observationFromRow(row: StockObservationRow): SupplierStockObservation {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierItemId: row.supplier_item_id,
    source: row.source as SupplierStockObservation["source"],
    authority: row.authority as SupplierStockObservation["authority"],
    quantity: row.quantity,
    status: row.status as SupplierStockObservation["status"],
    confidence: row.confidence as SupplierStockObservation["confidence"],
    evidenceId: row.evidence_id,
    capturedAt: row.captured_at,
  };
}

function mappingFromRow(row: MappingRow): SupplierTargetMapping {
  return {
    supplierId: row.supplier_id,
    supplierItemId: row.supplier_item_id,
    targetSellerId: row.target_seller_id,
    targetItemId: row.target_item_id,
    policyRef: {
      scopeType: row.policy_scope_type as SupplierTargetMapping["policyRef"]["scopeType"],
      scopeId: row.policy_scope_id,
      supplierId: row.policy_supplier_id,
    },
    state: row.state as SupplierTargetMapping["state"],
    ...(row.approved_at === null ? {} : { approvedAt: row.approved_at }),
    evidenceIds: parseJson<string[]>(row.evidence_ids_json) ?? [],
  };
}

function policyFromRow(row: PolicyRow): SupplierTargetPolicy {
  return {
    scopeType: row.scope_type as SupplierTargetPolicy["scopeType"],
    scopeId: row.scope_id,
    supplierId: row.supplier_id,
    targetSellerIds: parseJson<SellerId[]>(row.target_seller_ids_json) ?? [],
    lowStockThreshold: row.low_stock_threshold,
    autoPauseAllowed: row.auto_pause_allowed === 1,
    ...(row.pricing_policy_json === null
      ? {}
      : {
          pricingPolicy: parseJson<SupplierTargetPolicy["pricingPolicy"]>(row.pricing_policy_json)!,
        }),
  };
}

function ledgerFromRow(row: LedgerRow): SupplierMirrorLedgerRecord {
  return {
    id: row.id,
    actionType: row.action_type as SupplierMirrorLedgerRecord["actionType"],
    idempotencyKey: row.idempotency_key,
    status: row.status as SupplierMirrorLedgerRecord["status"],
    reason: row.reason,
    supplierId: row.supplier_id,
    ...(row.supplier_item_id === null ? {} : { supplierItemId: row.supplier_item_id }),
    ...(row.target_seller_id === null ? {} : { targetSellerId: row.target_seller_id }),
    ...(row.target_item_id === null ? {} : { targetItemId: row.target_item_id }),
    evidenceIds: parseJson<string[]>(row.evidence_ids_json) ?? [],
    before: parseJson<Readonly<Record<string, unknown>>>(row.before_json),
    after: parseJson<Readonly<Record<string, unknown>>>(row.after_json),
    createdAt: row.created_at,
  };
}

function preferenceFromRow(row: PreferenceRow): SupplierNotificationPreference {
  return {
    scopeType: row.scope_type as SupplierNotificationPreference["scopeType"],
    scopeId: row.scope_id,
    preference: parseJson<Readonly<Record<string, unknown>>>(row.preference_json) ?? {},
  };
}

function notificationEventFromRow(row: NotificationEventRow): SupplierMirrorNotificationEvent {
  return {
    id: row.id,
    type: row.type as SupplierMirrorNotificationEvent["type"],
    status: row.status as SupplierMirrorNotificationEvent["status"],
    supplierId: row.supplier_id,
    ...(row.supplier_item_id === null ? {} : { supplierItemId: row.supplier_item_id }),
    ...(row.target_seller_id === null ? {} : { targetSellerId: row.target_seller_id }),
    ...(row.target_item_id === null ? {} : { targetItemId: row.target_item_id }),
    reason: row.reason,
    evidenceIds: parseJson<string[]>(row.evidence_ids_json) ?? [],
    metadata: parseJson<Readonly<Record<string, unknown>>>(row.metadata_json) ?? {},
    createdAt: row.created_at,
  };
}

function learnedPolicyFromRow(row: LearnedFallbackPolicyRow): SupplierLearnedFallbackPolicy {
  return {
    id: row.id,
    policyType: row.policy_type as SupplierLearnedFallbackPolicy["policyType"],
    scope: parseJson<Readonly<Record<string, unknown>>>(row.scope_json) ?? {},
    decision: parseJson<Readonly<Record<string, unknown>>>(row.decision_json) ?? {},
    confidence: row.confidence as SupplierLearnedFallbackPolicy["confidence"],
    evidenceIds: parseJson<string[]>(row.evidence_ids_json) ?? [],
    status: row.status as SupplierLearnedFallbackPolicy["status"],
  };
}

export function createSqliteSupplierMirrorStore(db: Database.Database): SupplierMirrorStore {
  migrateSupplierMirrorStore(db);

  const upsertSupplierStmt = db.prepare(`
    INSERT INTO suppliers (id, name, enabled, primary_source, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      enabled = excluded.enabled,
      primary_source = excluded.primary_source,
      metadata_json = excluded.metadata_json,
      updated_at = excluded.updated_at
  `);
  const getSupplierStmt = db.prepare("SELECT * FROM suppliers WHERE id = ?");
  const listEnabledSuppliersStmt = db.prepare(
    "SELECT * FROM suppliers WHERE enabled = 1 ORDER BY name ASC",
  );
  const upsertItemStmt = db.prepare(`
    INSERT INTO supplier_items
      (supplier_id, supplier_item_id, ml_item_id, title, sku, category_id, price, currency,
       snapshot_json, source, confidence, freshness, evidence_id, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, supplier_item_id) DO UPDATE SET
      ml_item_id = excluded.ml_item_id,
      title = excluded.title,
      sku = excluded.sku,
      category_id = excluded.category_id,
      price = excluded.price,
      currency = excluded.currency,
      snapshot_json = excluded.snapshot_json,
      source = excluded.source,
      confidence = excluded.confidence,
      freshness = excluded.freshness,
      evidence_id = excluded.evidence_id,
      captured_at = excluded.captured_at
  `);
  const getItemStmt = db.prepare(
    "SELECT * FROM supplier_items WHERE supplier_id = ? AND supplier_item_id = ?",
  );
  const listItemsStmt = db.prepare(
    "SELECT * FROM supplier_items WHERE supplier_id = ? ORDER BY captured_at DESC",
  );
  const insertObservationStmt = db.prepare(`
    INSERT OR REPLACE INTO stock_observations
      (id, supplier_id, supplier_item_id, source, authority, quantity, status, confidence, evidence_id, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const listObservationsStmt = db.prepare(`
    SELECT * FROM stock_observations
    WHERE supplier_id = ? AND supplier_item_id = ?
    ORDER BY captured_at DESC
  `);
  const upsertMappingStmt = db.prepare(`
    INSERT INTO item_mappings
      (supplier_id, supplier_item_id, target_seller_id, target_item_id, policy_scope_type,
       policy_scope_id, policy_supplier_id, state, approved_at, evidence_ids_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supplier_id, supplier_item_id, target_seller_id, target_item_id) DO UPDATE SET
      policy_scope_type = excluded.policy_scope_type,
      policy_scope_id = excluded.policy_scope_id,
      policy_supplier_id = excluded.policy_supplier_id,
      state = excluded.state,
      approved_at = excluded.approved_at,
      evidence_ids_json = excluded.evidence_ids_json
  `);
  const listMappingsStmt = db.prepare(`
    SELECT * FROM item_mappings WHERE supplier_id = ? AND supplier_item_id = ? ORDER BY target_seller_id ASC
  `);
  const upsertPolicyStmt = db.prepare(`
    INSERT INTO target_policies
      (scope_type, scope_id, supplier_id, target_seller_ids_json, low_stock_threshold,
       auto_pause_allowed, pricing_policy_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_type, scope_id, supplier_id) DO UPDATE SET
      target_seller_ids_json = excluded.target_seller_ids_json,
      low_stock_threshold = excluded.low_stock_threshold,
      auto_pause_allowed = excluded.auto_pause_allowed,
      pricing_policy_json = excluded.pricing_policy_json
  `);
  const getPolicyStmt = db.prepare(
    "SELECT * FROM target_policies WHERE scope_type = ? AND scope_id = ? AND supplier_id = ?",
  );
  const insertLedgerStmt = db.prepare(`
    INSERT OR IGNORE INTO sync_ledger
      (id, action_type, idempotency_key, status, reason, supplier_id, supplier_item_id,
       target_seller_id, target_item_id, evidence_ids_json, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getLedgerByIdempotencyStmt = db.prepare(
    "SELECT * FROM sync_ledger WHERE idempotency_key = ?",
  );
  const getLedgerByIdStmt = db.prepare("SELECT * FROM sync_ledger WHERE id = ?");
  const upsertPreferenceStmt = db.prepare(`
    INSERT INTO notification_preferences (scope_type, scope_id, preference_json)
    VALUES (?, ?, ?)
    ON CONFLICT(scope_type, scope_id) DO UPDATE SET preference_json = excluded.preference_json
  `);
  const getPreferenceStmt = db.prepare(
    "SELECT * FROM notification_preferences WHERE scope_type = ? AND scope_id = ?",
  );
  const insertNotificationEventStmt = db.prepare(`
    INSERT OR REPLACE INTO supplier_mirror_notification_events
      (id, type, status, supplier_id, supplier_item_id, target_seller_id, target_item_id,
       reason, evidence_ids_json, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const getNotificationEventStmt = db.prepare(
    "SELECT * FROM supplier_mirror_notification_events WHERE id = ?",
  );
  const listNotificationEventsStmt = db.prepare(`
    SELECT * FROM supplier_mirror_notification_events
    WHERE (@supplierId IS NULL OR supplier_id = @supplierId)
    ORDER BY created_at DESC, id ASC
    LIMIT @limit
  `);
  const upsertLearnedPolicyStmt = db.prepare(`
    INSERT INTO learned_fallback_policies
      (id, policy_type, scope_json, decision_json, confidence, evidence_ids_json, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      policy_type = excluded.policy_type,
      scope_json = excluded.scope_json,
      decision_json = excluded.decision_json,
      confidence = excluded.confidence,
      evidence_ids_json = excluded.evidence_ids_json,
      status = excluded.status
  `);
  const getLearnedPolicyStmt = db.prepare("SELECT * FROM learned_fallback_policies WHERE id = ?");
  const listPoliciesStmt = db.prepare(
    "SELECT * FROM target_policies WHERE supplier_id = ? ORDER BY scope_type ASC, scope_id ASC",
  );
  const listApprovedMappingsStmt = db.prepare(`
    SELECT * FROM item_mappings WHERE supplier_id = ? AND state = 'approved' ORDER BY supplier_item_id ASC
  `);
  const listLearnedFallbackStmt = db.prepare(`
    SELECT * FROM learned_fallback_policies
    WHERE json_extract(scope_json, '$.supplierId') = ?
    ORDER BY policy_type ASC, id ASC
  `);

  /* eslint-disable @typescript-eslint/require-await */
  return {
    async upsertSupplier(supplier) {
      upsertSupplierStmt.run(
        supplier.id,
        supplier.name,
        supplier.enabled ? 1 : 0,
        supplier.primarySource,
        JSON.stringify(supplier.metadata),
        supplier.createdAt,
        supplier.updatedAt,
      );
    },
    async getSupplier(supplierId) {
      const row = getSupplierStmt.get(supplierId) as SupplierRow | undefined;
      return row ? supplierFromRow(row) : null;
    },
    async listEnabledSuppliers() {
      return (listEnabledSuppliersStmt.all() as SupplierRow[]).map(supplierFromRow);
    },
    async upsertSupplierItemSnapshot(snapshot) {
      upsertItemStmt.run(
        snapshot.supplierId,
        snapshot.supplierItemId,
        snapshot.mlItemId ?? null,
        snapshot.title,
        snapshot.sku ?? null,
        snapshot.categoryId ?? null,
        snapshot.price ?? null,
        snapshot.currency ?? null,
        JSON.stringify(snapshot.snapshot),
        snapshot.source,
        snapshot.confidence,
        snapshot.freshness,
        snapshot.evidenceId,
        snapshot.capturedAt,
      );
    },
    async getSupplierItemSnapshot(supplierId, supplierItemId) {
      const row = getItemStmt.get(supplierId, supplierItemId) as SupplierItemRow | undefined;
      return row ? itemFromRow(row) : null;
    },
    async listSupplierItemSnapshots(supplierId) {
      return (listItemsStmt.all(supplierId) as SupplierItemRow[]).map(itemFromRow);
    },
    async listTargetPolicies(supplierId) {
      return (listPoliciesStmt.all(supplierId) as PolicyRow[]).map(policyFromRow);
    },
    async listApprovedItemMappings(supplierId) {
      return (listApprovedMappingsStmt.all(supplierId) as MappingRow[]).map(mappingFromRow);
    },
    async listLearnedFallbackPolicies(supplierId) {
      return (listLearnedFallbackStmt.all(supplierId) as LearnedFallbackPolicyRow[]).map(
        learnedPolicyFromRow,
      );
    },
    async recordStockObservation(observation) {
      insertObservationStmt.run(
        observation.id,
        observation.supplierId,
        observation.supplierItemId,
        observation.source,
        observation.authority,
        observation.quantity,
        observation.status,
        observation.confidence,
        observation.evidenceId,
        observation.capturedAt,
      );
    },
    async listStockObservations(supplierId, supplierItemId) {
      return (listObservationsStmt.all(supplierId, supplierItemId) as StockObservationRow[]).map(
        observationFromRow,
      );
    },
    async upsertTargetMapping(mapping) {
      upsertMappingStmt.run(
        mapping.supplierId,
        mapping.supplierItemId,
        mapping.targetSellerId,
        mapping.targetItemId,
        mapping.policyRef.scopeType,
        mapping.policyRef.scopeId,
        mapping.policyRef.supplierId,
        mapping.state,
        mapping.approvedAt ?? null,
        JSON.stringify(mapping.evidenceIds),
      );
    },
    async listTargetMappings(supplierId, supplierItemId) {
      return (listMappingsStmt.all(supplierId, supplierItemId) as MappingRow[]).map(mappingFromRow);
    },
    async upsertTargetPolicy(policy) {
      upsertPolicyStmt.run(
        policy.scopeType,
        policy.scopeId,
        policy.supplierId,
        JSON.stringify(policy.targetSellerIds),
        policy.lowStockThreshold,
        policy.autoPauseAllowed ? 1 : 0,
        policy.pricingPolicy === undefined ? null : JSON.stringify(policy.pricingPolicy),
      );
    },
    async resolveTargetPolicy(input) {
      const candidates: Array<[SupplierTargetPolicyScopeType, string | undefined]> = [
        ["item", input.supplierItemId],
        ["category", input.categoryId],
        ["supplier", input.supplierId],
      ];

      for (const [scopeType, scopeId] of candidates) {
        if (scopeId === undefined) continue;
        const row = getPolicyStmt.get(scopeType, scopeId, input.supplierId) as
          PolicyRow | undefined;
        if (row) return policyFromRow(row);
      }

      return null;
    },
    async appendLedger(record) {
      const insertResult = insertLedgerStmt.run(
        record.id,
        record.actionType,
        record.idempotencyKey,
        record.status,
        record.reason,
        record.supplierId,
        record.supplierItemId ?? null,
        record.targetSellerId ?? null,
        record.targetItemId ?? null,
        JSON.stringify(record.evidenceIds),
        stringifyOptional(record.before),
        stringifyOptional(record.after),
        record.createdAt,
      );

      if (insertResult.changes > 0) return record;

      const existingByKey = getLedgerByIdempotencyStmt.get(record.idempotencyKey) as
        LedgerRow | undefined;
      if (existingByKey) return ledgerFromRow(existingByKey);

      const existingById = getLedgerByIdStmt.get(record.id) as LedgerRow | undefined;
      if (existingById) {
        throw new Error(
          `Supplier Mirror ledger id collision for ${record.id}: existing idempotency key ${existingById.idempotency_key} does not match ${record.idempotencyKey}`,
        );
      }

      throw new Error(
        `Supplier Mirror ledger insert was ignored for ${record.id} without a matching idempotency key`,
      );
    },
    async getLedgerByIdempotencyKey(idempotencyKey) {
      const row = getLedgerByIdempotencyStmt.get(idempotencyKey) as LedgerRow | undefined;
      return row ? ledgerFromRow(row) : null;
    },
    async recordNotificationEvent(event) {
      insertNotificationEventStmt.run(
        event.id,
        event.type,
        event.status,
        event.supplierId,
        event.supplierItemId ?? null,
        event.targetSellerId ?? null,
        event.targetItemId ?? null,
        event.reason,
        JSON.stringify(event.evidenceIds),
        JSON.stringify(event.metadata),
        event.createdAt,
      );
      return event;
    },
    async getNotificationEvent(id) {
      const row = getNotificationEventStmt.get(id) as NotificationEventRow | undefined;
      return row ? notificationEventFromRow(row) : null;
    },
    async listNotificationEvents(filter = {}) {
      const limit = Math.max(1, Math.min(filter.limit ?? 20, 50));
      return (
        listNotificationEventsStmt.all({
          supplierId: filter.supplierId ?? null,
          limit,
        }) as NotificationEventRow[]
      ).map(notificationEventFromRow);
    },
    async saveNotificationPreference(preference) {
      upsertPreferenceStmt.run(
        preference.scopeType,
        preference.scopeId,
        JSON.stringify(preference.preference),
      );
    },
    async getNotificationPreference(scopeType, scopeId) {
      const row = getPreferenceStmt.get(scopeType, scopeId) as PreferenceRow | undefined;
      return row ? preferenceFromRow(row) : null;
    },
    async upsertLearnedFallbackPolicy(policy) {
      upsertLearnedPolicyStmt.run(
        policy.id,
        policy.policyType,
        JSON.stringify(policy.scope),
        JSON.stringify(policy.decision),
        policy.confidence,
        JSON.stringify(policy.evidenceIds),
        policy.status,
      );
    },
    async getLearnedFallbackPolicy(id) {
      const row = getLearnedPolicyStmt.get(id) as LearnedFallbackPolicyRow | undefined;
      return row ? learnedPolicyFromRow(row) : null;
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}
