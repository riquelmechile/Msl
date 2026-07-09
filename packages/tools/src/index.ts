import Database from "better-sqlite3";
import {
  canExecutePreparedAction,
  createPreparedAction,
  isMlcCategoryId,
  isMlcDomainId,
  type ApprovalRecord,
  type AuditRecord,
  type CacheFreshness,
  type ExactChange,
  type MlCapabilitySiteSupport,
  type PreparedAction,
  type PreparedActionId,
  type ReadSnapshotSellerScope,
  type RiskLevel,
  type SellerId,
} from "@msl/domain";
import type {
  MlcApiClient,
  MlcCategoryAttributeSummary,
  MlcCategoryTechnicalSpecSummary,
  MlcListingPricesInput,
  MlcListingPriceSummary,
  MlcListingSummary,
  MlcMessageSummary,
  MlcOrderSummary,
  MlcProductAdsInsights,
  MlcReadSnapshot,
  MlcReputationSummary,
} from "@msl/mercadolibre";

export type ToolSource =
  "local-cache" | "mercadolibre-api" | "seller-input" | "official-mercadolibre-mcp-docs";

export type ConfidenceLevel = "low" | "medium" | "high";

export type ToolResponseMetadata = {
  source: ToolSource;
  freshness: CacheFreshness | null;
  confidence: ConfidenceLevel;
  requiresApproval: boolean;
  siteSupport?: MlCapabilitySiteSupport;
  sellerScope?: ReadSnapshotSellerScope;
  degradedReason?: string;
};

export type BusinessToolResponse<TData> = {
  data: TData;
  metadata: ToolResponseMetadata;
};

export type CustomBusinessTool<TInput, TOutput> = {
  name: string;
  description: string;
  execute(input: TInput): Promise<BusinessToolResponse<TOutput>>;
};

export type OfficialMercadoLibreDocsAdapter = {
  source: "official-mercadolibre-mcp-docs";
  lookupDocumentation(
    topic: string,
  ): Promise<BusinessToolResponse<{ topic: string; content: string }>>;
};

export type ReadToolBlocked =
  | { status: "blocked"; reason: "reconnect-required"; message: string }
  | { status: "blocked"; reason: "seller-access-mismatch"; message: string }
  | { status: "blocked"; reason: "seller-not-configured"; message: string }
  | {
      status: "blocked";
      reason: "unsupported-category-id";
      message: string;
      siteSupport: "unknown";
    }
  | { status: "blocked"; reason: "unsupported-domain-id"; message: string; siteSupport: "unknown" }
  | { status: "blocked"; reason: "product-ads-unavailable"; message: string }
  | { status: "degraded"; reason: "ml-api-read-failed"; message: string; siteSupport: "unknown" };

export type MlcReadTools = {
  listings: CustomBusinessTool<
    { sellerId: SellerId },
    MlcReadSnapshot<MlcListingSummary> | ReadToolBlocked
  >;
  orders: CustomBusinessTool<
    { sellerId: SellerId },
    MlcReadSnapshot<MlcOrderSummary> | ReadToolBlocked
  >;
  messages: CustomBusinessTool<
    { sellerId: SellerId },
    MlcReadSnapshot<MlcMessageSummary> | ReadToolBlocked
  >;
  reputation: CustomBusinessTool<
    { sellerId: SellerId },
    MlcReadSnapshot<MlcReputationSummary> | ReadToolBlocked
  >;
  productAdsInsights: CustomBusinessTool<
    {
      sellerId: SellerId;
      dateFrom?: string;
      dateTo?: string;
      limit?: number;
      offset?: number;
      itemId?: string;
      campaignId?: string;
      status?: string;
    },
    MlcReadSnapshot<MlcProductAdsInsights> | ReadToolBlocked
  >;
  listingPrices: CustomBusinessTool<
    { sellerId: SellerId } & MlcListingPricesInput,
    MlcReadSnapshot<MlcListingPriceSummary> | ReadToolBlocked
  >;
};

export type MlcCategoryReadTools = {
  categoryAttributes: CustomBusinessTool<
    { sellerId: SellerId; categoryId: string },
    MlcReadSnapshot<MlcCategoryAttributeSummary> | ReadToolBlocked
  >;
  categoryTechnicalSpecs: CustomBusinessTool<
    { sellerId: SellerId; domainId: string },
    MlcReadSnapshot<MlcCategoryTechnicalSpecSummary> | ReadToolBlocked
  >;
};

export function createOfficialMercadoLibreDocsAdapter(input: {
  lookupDocumentation(topic: string): Promise<string>;
}): OfficialMercadoLibreDocsAdapter {
  return {
    source: "official-mercadolibre-mcp-docs",
    lookupDocumentation: async (topic) => ({
      data: { topic, content: await input.lookupDocumentation(topic) },
      metadata: {
        source: "official-mercadolibre-mcp-docs",
        freshness: null,
        confidence: "medium",
        requiresApproval: false,
      },
    }),
  };
}

export function createMlcReadTools(input: {
  client: MlcApiClient;
}): MlcReadTools & MlcCategoryReadTools {
  return {
    listings: createMlcReadTool({
      name: "read-mercadolibre-listings",
      description: "Reads authorized MercadoLibre listing snapshots for the connected seller.",
      read: ({ sellerId }) => input.client.getListings(sellerId),
    }),
    orders: createMlcReadTool({
      name: "read-mercadolibre-orders",
      description: "Reads authorized MercadoLibre order snapshots for the connected seller.",
      read: ({ sellerId }) => input.client.getOrders(sellerId),
    }),
    messages: createMlcReadTool({
      name: "read-mercadolibre-messages",
      description: "Reads authorized MercadoLibre message snapshots for the connected seller.",
      read: ({ sellerId }) => input.client.getMessages(sellerId),
    }),
    reputation: createMlcReadTool({
      name: "read-mercadolibre-reputation",
      description: "Reads authorized MercadoLibre reputation snapshots for the connected seller.",
      read: ({ sellerId }) => input.client.getReputation(sellerId),
    }),
    productAdsInsights: createMlcReadTool({
      name: "read-mercadolibre-product-ads-insights",
      description:
        "Reads authorized Product Ads advertiser, campaign, ad, and metrics insights for the connected seller without mutating campaigns or ads.",
      catchUnexpectedErrors: true,
      read: ({ sellerId, ...options }) => {
        if (!input.client.getProductAdsInsights) {
          throw new Error("Product Ads advertiser is not available for this seller.");
        }
        return input.client.getProductAdsInsights(sellerId, options);
      },
    }),
    listingPrices: createMlcReadTool({
      name: "read-mercadolibre-listing-prices",
      description:
        "Reads MercadoLibre listing_prices sale-fee calculations for Premium, Classic, or all listing types without mutating listings.",
      catchUnexpectedErrors: true,
      read: ({ sellerId, ...listingPricesInput }) => {
        if (!input.client.getListingPrices) {
          throw new Error("Listing prices are not available for this MercadoLibre client.");
        }
        return input.client.getListingPrices(sellerId, listingPricesInput);
      },
    }),
    categoryAttributes: createMlcReadTool({
      name: "read-mercadolibre-category-attributes",
      description:
        "Reads authorized MLC-confirmed MercadoLibre category attribute snapshots for the connected seller.",
      validate: ({ categoryId }) =>
        isMlcCategoryId(categoryId)
          ? undefined
          : {
              status: "blocked",
              reason: "unsupported-category-id",
              message:
                "Only MLC-confirmed category IDs are supported for category attribute reads.",
              siteSupport: "unknown",
            },
      catchUnexpectedErrors: true,
      read: ({ sellerId, categoryId }) => input.client.getCategoryAttributes(sellerId, categoryId),
    }),
    categoryTechnicalSpecs: createMlcReadTool({
      name: "read-mercadolibre-category-technical-specs",
      description:
        "Reads authorized MLC-confirmed MercadoLibre category technical specification snapshots for the connected seller.",
      validate: ({ domainId }) =>
        isMlcDomainId(domainId)
          ? undefined
          : {
              status: "blocked",
              reason: "unsupported-domain-id",
              message:
                "Only MLC-confirmed domain IDs are supported for category technical spec reads.",
              siteSupport: "unknown",
            },
      catchUnexpectedErrors: true,
      read: ({ sellerId, domainId }) => input.client.getCategoryTechnicalSpecs(sellerId, domainId),
    }),
  };
}

function createMlcReadTool<TInput extends { sellerId: SellerId }, TData>(input: {
  name: string;
  description: string;
  validate?(request: TInput): ReadToolBlocked | undefined;
  catchUnexpectedErrors?: boolean;
  read(request: TInput): Promise<MlcReadSnapshot<TData>>;
}): CustomBusinessTool<TInput, MlcReadSnapshot<TData> | ReadToolBlocked> {
  return {
    name: input.name,
    description: input.description,
    execute: async (request) => {
      const validationBlocked = input.validate?.(request);
      if (validationBlocked !== undefined) {
        return blockedReadResponse(validationBlocked);
      }

      try {
        const snapshot = await input.read(request);

        return {
          data: snapshot,
          metadata: readMetadata(snapshot),
        };
      } catch (error) {
        const blocked = toReadToolBlocked(error, input.catchUnexpectedErrors ?? false);

        if (blocked === undefined) {
          throw error;
        }

        return blockedReadResponse(blocked);
      }
    },
  };
}

function blockedReadResponse(blocked: ReadToolBlocked): BusinessToolResponse<ReadToolBlocked> {
  return {
    data: blocked,
    metadata: {
      source: "mercadolibre-api",
      freshness: null,
      confidence: "low",
      requiresApproval: false,
      degradedReason: blocked.reason,
      ...("siteSupport" in blocked ? { siteSupport: blocked.siteSupport } : {}),
    },
  };
}

function readMetadata<TData>(snapshot: MlcReadSnapshot<TData>): ToolResponseMetadata {
  return {
    source: "mercadolibre-api",
    freshness: snapshot.freshness,
    confidence: snapshot.confidence,
    requiresApproval: false,
    ...(snapshot.siteSupport !== undefined ? { siteSupport: snapshot.siteSupport } : {}),
    ...(snapshot.sellerScope !== undefined ? { sellerScope: snapshot.sellerScope } : {}),
  };
}

function toReadToolBlocked(
  error: unknown,
  catchUnexpectedErrors: boolean,
): ReadToolBlocked | undefined {
  if (typeof error !== "object" || error === null) {
    return catchUnexpectedErrors
      ? {
          status: "degraded",
          reason: "ml-api-read-failed",
          message: "MercadoLibre read failed before reliable data could be returned.",
          siteSupport: "unknown",
        }
      : undefined;
  }

  const candidate = error as { reason?: unknown; message?: unknown };
  const message =
    typeof candidate.message === "string" && candidate.message.length > 0
      ? candidate.message
      : "MercadoLibre read is blocked.";

  if (candidate.reason === "reconnect-required") {
    return { status: "blocked", reason: "reconnect-required", message };
  }

  if (candidate.reason === "seller-access-mismatch") {
    return { status: "blocked", reason: "seller-access-mismatch", message };
  }

  if (candidate.reason === "seller-not-configured") {
    return { status: "blocked", reason: "seller-not-configured", message };
  }

  if (candidate.reason === "unsupported-category-id") {
    return {
      status: "blocked",
      reason: "unsupported-category-id",
      message,
      siteSupport: "unknown",
    };
  }

  if (candidate.reason === "unsupported-domain-id") {
    return { status: "blocked", reason: "unsupported-domain-id", message, siteSupport: "unknown" };
  }

  if (/Product Ads advertiser is not available/i.test(message)) {
    return {
      status: "blocked",
      reason: "product-ads-unavailable",
      message: "Product Ads is not available for this seller or token scope.",
    };
  }

  if (catchUnexpectedErrors) {
    return {
      status: "degraded",
      reason: "ml-api-read-failed",
      message: "MercadoLibre read failed before reliable data could be returned.",
      siteSupport: "unknown",
    };
  }

  return undefined;
}

export const PREPARED_WRITE_KINDS = [
  "price-change",
  "stock-change",
  "customer-message",
  "cancellation",
  "refund",
  "listing-edit",
  "creative-publication",
] as const;

export type PreparedWriteKind = (typeof PREPARED_WRITE_KINDS)[number];

export type PrepareWriteInput = {
  id: PreparedActionId;
  sellerId: SellerId;
  kind: PreparedWriteKind;
  target: PreparedAction["target"];
  exactChange: ExactChange[];
  rationale: string;
  expiresAt: Date;
};

export type ApprovalQueueEntry = {
  action: PreparedAction;
  requestedAt: Date;
  highlightedRisk: RiskLevel;
  status: PreparedAction["approvalStatus"];
};

export type ApprovalQueueRepository = {
  save(entry: ApprovalQueueEntry): Promise<void>;
  findAction(actionId: PreparedActionId): Promise<ApprovalQueueEntry | null>;
  saveApproval(approval: ApprovalRecord): Promise<void>;
  findApproval(actionId: PreparedActionId): Promise<ApprovalRecord | null>;
  saveAudit(audit: AuditRecord): Promise<void>;
  listAudits(actionId: PreparedActionId): Promise<ReadonlyArray<AuditRecord>>;
};

export type CloseableApprovalQueueRepository = ApprovalQueueRepository & { close(): void };

export type DirectWriteExecutor = {
  execute(action: PreparedAction): Promise<{ status: "executed"; resultMessage: string }>;
};

export type Clock = {
  now(): Date;
};

export type IdGenerator = {
  nextId(prefix: string): string;
};

export function createInMemoryApprovalQueueRepository(): ApprovalQueueRepository {
  const entries = new Map<PreparedActionId, ApprovalQueueEntry>();
  const approvals = new Map<PreparedActionId, ApprovalRecord>();
  const audits = new Map<PreparedActionId, AuditRecord[]>();

  return {
    save: (entry) => {
      entries.set(entry.action.id, entry);
      return Promise.resolve();
    },
    findAction: (actionId) => Promise.resolve(entries.get(actionId) ?? null),
    saveApproval: (approval) => {
      approvals.set(approval.actionId, approval);
      return Promise.resolve();
    },
    findApproval: (actionId) => Promise.resolve(approvals.get(actionId) ?? null),
    saveAudit: (audit) => {
      const existing = audits.get(audit.actionId) ?? [];
      audits.set(audit.actionId, [...existing, audit]);
      return Promise.resolve();
    },
    listAudits: (actionId) => Promise.resolve(audits.get(actionId) ?? []),
  };
}

const APPROVAL_QUEUE_SCHEMA = `
CREATE TABLE IF NOT EXISTS approval_queue_entries (
  action_id TEXT PRIMARY KEY,
  action_json TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  highlighted_risk TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_records (
  action_id TEXT PRIMARY KEY,
  approval_json TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_records (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL,
  audit_json TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
`;

type QueueEntryRow = {
  action_json: string;
  requested_at: string;
  highlighted_risk: RiskLevel;
  status: ApprovalQueueEntry["status"];
};

type ApprovalRow = { approval_json: string };
type AuditRow = { audit_json: string };

export function createSqliteApprovalQueueRepository(
  dbPath = ":memory:",
): CloseableApprovalQueueRepository {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(APPROVAL_QUEUE_SCHEMA);

  const saveEntry = db.prepare(`
    INSERT OR REPLACE INTO approval_queue_entries
      (action_id, action_json, requested_at, highlighted_risk, status, updated_at)
    VALUES
      (@action_id, @action_json, @requested_at, @highlighted_risk, @status, datetime('now'))
  `);
  const findEntry = db.prepare("SELECT * FROM approval_queue_entries WHERE action_id = ?");
  const saveApproval = db.prepare(`
    INSERT OR REPLACE INTO approval_records
      (action_id, approval_json, approved_at, updated_at)
    VALUES
      (@action_id, @approval_json, @approved_at, datetime('now'))
  `);
  const findApproval = db.prepare("SELECT approval_json FROM approval_records WHERE action_id = ?");
  const saveAudit = db.prepare(`
    INSERT OR REPLACE INTO audit_records (id, action_id, audit_json, recorded_at)
    VALUES (@id, @action_id, @audit_json, @recorded_at)
  `);
  const listAudits = db.prepare(
    "SELECT audit_json FROM audit_records WHERE action_id = ? ORDER BY recorded_at ASC, id ASC",
  );

  return {
    save: (entry) => {
      saveEntry.run({
        action_id: entry.action.id,
        action_json: JSON.stringify(serializePreparedAction(entry.action)),
        requested_at: entry.requestedAt.toISOString(),
        highlighted_risk: entry.highlightedRisk,
        status: entry.status,
      });
      return Promise.resolve();
    },
    findAction: (actionId) => {
      const row = findEntry.get(actionId) as QueueEntryRow | undefined;
      if (row === undefined) return Promise.resolve(null);

      return Promise.resolve({
        action: deserializePreparedAction(JSON.parse(row.action_json) as PreparedAction),
        requestedAt: new Date(row.requested_at),
        highlightedRisk: row.highlighted_risk,
        status: row.status,
      });
    },
    saveApproval: (approval) => {
      saveApproval.run({
        action_id: approval.actionId,
        approval_json: JSON.stringify(serializeApprovalRecord(approval)),
        approved_at: approval.approvedAt.toISOString(),
      });
      return Promise.resolve();
    },
    findApproval: (actionId) => {
      const row = findApproval.get(actionId) as ApprovalRow | undefined;
      return Promise.resolve(
        row === undefined
          ? null
          : deserializeApprovalRecord(JSON.parse(row.approval_json) as ApprovalRecord),
      );
    },
    saveAudit: (audit) => {
      saveAudit.run({
        id: audit.id,
        action_id: audit.actionId,
        audit_json: JSON.stringify(serializeAuditRecord(audit)),
        recorded_at: audit.recordedAt.toISOString(),
      });
      return Promise.resolve();
    },
    listAudits: (actionId) => {
      const rows = listAudits.all(actionId) as AuditRow[];
      return Promise.resolve(
        rows.map((row) => deserializeAuditRecord(JSON.parse(row.audit_json) as AuditRecord)),
      );
    },
    close: () => db.close(),
  };
}

function serializePreparedAction(action: PreparedAction): Omit<PreparedAction, "expiresAt"> & {
  expiresAt: string;
} {
  return { ...action, expiresAt: action.expiresAt.toISOString() };
}

function deserializePreparedAction(action: PreparedAction): PreparedAction {
  return { ...action, expiresAt: new Date(action.expiresAt) };
}

function serializeApprovalRecord(approval: ApprovalRecord): Omit<ApprovalRecord, "approvedAt"> & {
  approvedAt: string;
} {
  return { ...approval, approvedAt: approval.approvedAt.toISOString() };
}

function deserializeApprovalRecord(approval: ApprovalRecord): ApprovalRecord {
  return { ...approval, approvedAt: new Date(approval.approvedAt) };
}

function serializeAuditRecord(audit: AuditRecord): Omit<AuditRecord, "recordedAt"> & {
  recordedAt: string;
} {
  return { ...audit, recordedAt: audit.recordedAt.toISOString() };
}

function deserializeAuditRecord(audit: AuditRecord): AuditRecord {
  return { ...audit, recordedAt: new Date(audit.recordedAt) };
}

export function createPreparedActionTool(input: {
  repository: ApprovalQueueRepository;
  clock: Clock;
}): CustomBusinessTool<PrepareWriteInput, ApprovalQueueEntry> {
  return {
    name: "prepare-mercadolibre-write",
    description:
      "Prepares price, stock, message, cancellation, refund, listing, and publication writes for seller approval.",
    execute: async (request) => {
      const action = createPreparedAction({
        id: request.id,
        sellerId: request.sellerId,
        kind: request.kind,
        target: request.target,
        exactChange: request.exactChange,
        rationale: request.rationale,
        expiresAt: request.expiresAt,
      });
      const entry: ApprovalQueueEntry = {
        action,
        requestedAt: input.clock.now(),
        highlightedRisk: action.riskLevel,
        status: "pending",
      };

      await input.repository.save(entry);

      return {
        data: entry,
        metadata: {
          source: "seller-input",
          freshness: null,
          confidence: "high",
          requiresApproval: true,
        },
      };
    },
  };
}

export type ApprovePreparedActionInput = {
  actionId: PreparedActionId;
  approvedBy: "seller";
};

export async function approvePreparedAction(input: {
  repository: ApprovalQueueRepository;
  clock: Clock;
  idGenerator: IdGenerator;
  request: ApprovePreparedActionInput;
}): Promise<BusinessToolResponse<ApprovalRecord>> {
  const entry = await input.repository.findAction(input.request.actionId);

  if (!entry) {
    throw new Error(`Prepared action ${input.request.actionId} was not found.`);
  }

  if (entry.action.expiresAt <= input.clock.now()) {
    const expiredEntry: ApprovalQueueEntry = {
      ...entry,
      action: { ...entry.action, approvalStatus: "expired" },
      status: "expired",
    };
    await input.repository.save(expiredEntry);
    throw new Error(`Prepared action ${input.request.actionId} is expired.`);
  }

  const approvedAction: PreparedAction = { ...entry.action, approvalStatus: "approved" };
  const approval: ApprovalRecord = {
    id: input.idGenerator.nextId("approval"),
    actionId: approvedAction.id,
    sellerId: approvedAction.sellerId,
    approvedBy: input.request.approvedBy,
    approvedAt: input.clock.now(),
    exactChangeAccepted: approvedAction.exactChange,
    riskAccepted: approvedAction.riskLevel,
    executionStatus: "not-executed",
  };

  await input.repository.save({ ...entry, action: approvedAction, status: "approved" });
  await input.repository.saveApproval(approval);

  return {
    data: approval,
    metadata: {
      source: "seller-input",
      freshness: null,
      confidence: "high",
      requiresApproval: false,
    },
  };
}

export type ExecutePreparedActionResult = {
  action: PreparedAction;
  audit: AuditRecord;
};

export async function executePreparedAction(input: {
  repository: ApprovalQueueRepository;
  executor: DirectWriteExecutor;
  clock: Clock;
  idGenerator: IdGenerator;
  actionId: PreparedActionId;
}): Promise<BusinessToolResponse<ExecutePreparedActionResult>> {
  const entry = await input.repository.findAction(input.actionId);

  if (!entry) {
    throw new Error(`Prepared action ${input.actionId} was not found.`);
  }

  const approval = await input.repository.findApproval(input.actionId);
  const decision = canExecutePreparedAction(entry.action, input.clock.now(), approval ?? undefined);

  if (!decision.allowed) {
    const audit = createAuditRecord({
      id: input.idGenerator.nextId("audit"),
      action: entry.action,
      status: "blocked",
      recordedAt: input.clock.now(),
      resultMessage: `Execution blocked: ${decision.reason}.`,
    });
    await input.repository.saveAudit(audit);

    return {
      data: { action: entry.action, audit },
      metadata: {
        source: "mercadolibre-api",
        freshness: null,
        confidence: "high",
        requiresApproval: true,
      },
    };
  }

  const validApproval = approval;

  if (!validApproval) {
    throw new Error(`Prepared action ${input.actionId} has no valid approval.`);
  }

  let audit: AuditRecord;

  try {
    const execution = await input.executor.execute(entry.action);
    audit = createAuditRecord({
      id: input.idGenerator.nextId("audit"),
      action: entry.action,
      approval: validApproval,
      status: execution.status,
      recordedAt: input.clock.now(),
      resultMessage: execution.resultMessage,
    });
  } catch (error) {
    audit = createAuditRecord({
      id: input.idGenerator.nextId("audit"),
      action: entry.action,
      approval: validApproval,
      status: "failed",
      recordedAt: input.clock.now(),
      resultMessage: `Execution failed: ${error instanceof Error ? error.message : "Unknown error"}.`,
    });
  }

  await input.repository.saveAudit(audit);

  return {
    data: { action: { ...entry.action, auditId: audit.id }, audit },
    metadata: {
      source: "mercadolibre-api",
      freshness: null,
      confidence: "high",
      requiresApproval: false,
    },
  };
}

function createAuditRecord(input: {
  id: string;
  action: PreparedAction;
  approval?: ApprovalRecord;
  status: AuditRecord["status"];
  recordedAt: Date;
  resultMessage: string;
}): AuditRecord {
  const base = {
    id: input.id,
    sellerId: input.action.sellerId,
    actionId: input.action.id,
    exactChange: input.action.exactChange,
    rationale: input.action.rationale,
    riskLevel: input.action.riskLevel,
    status: input.status,
    recordedAt: input.recordedAt,
    resultMessage: input.resultMessage,
  } satisfies Omit<AuditRecord, "approvedBy">;

  if (input.approval) {
    return { ...base, approvedBy: input.approval.approvedBy };
  }

  return base;
}
