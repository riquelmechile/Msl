import {
  canExecutePreparedAction,
  createPreparedAction,
  type ApprovalRecord,
  type AuditRecord,
  type CacheFreshness,
  type ExactChange,
  type PreparedAction,
  type PreparedActionId,
  type RiskLevel,
  type SellerId,
} from "@msl/domain";
import type {
  MlcApiClient,
  MlcListingSummary,
  MlcMessageSummary,
  MlcOrderSummary,
  MlcReadSnapshot,
  MlcReputationSummary,
} from "@msl/mercadolibre";

export type ToolSource =
  | "local-cache"
  | "mercadolibre-api"
  | "seller-input"
  | "official-mercadolibre-mcp-docs";

export type ConfidenceLevel = "low" | "medium" | "high";

export type ToolResponseMetadata = {
  source: ToolSource;
  freshness: CacheFreshness | null;
  confidence: ConfidenceLevel;
  requiresApproval: boolean;
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
  | { status: "blocked"; reason: "seller-not-configured"; message: string };

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

export function createMlcReadTools(input: { client: MlcApiClient }): MlcReadTools {
  return {
    listings: createMlcReadTool({
      name: "read-mercadolibre-listings",
      description: "Reads authorized MercadoLibre listing snapshots for the connected seller.",
      read: (sellerId) => input.client.getListings(sellerId),
    }),
    orders: createMlcReadTool({
      name: "read-mercadolibre-orders",
      description: "Reads authorized MercadoLibre order snapshots for the connected seller.",
      read: (sellerId) => input.client.getOrders(sellerId),
    }),
    messages: createMlcReadTool({
      name: "read-mercadolibre-messages",
      description: "Reads authorized MercadoLibre message snapshots for the connected seller.",
      read: (sellerId) => input.client.getMessages(sellerId),
    }),
    reputation: createMlcReadTool({
      name: "read-mercadolibre-reputation",
      description: "Reads authorized MercadoLibre reputation snapshots for the connected seller.",
      read: (sellerId) => input.client.getReputation(sellerId),
    }),
  };
}

function createMlcReadTool<TData>(input: {
  name: string;
  description: string;
  read(sellerId: SellerId): Promise<MlcReadSnapshot<TData>>;
}): CustomBusinessTool<{ sellerId: SellerId }, MlcReadSnapshot<TData> | ReadToolBlocked> {
  return {
    name: input.name,
    description: input.description,
    execute: async (request) => {
      try {
        const snapshot = await input.read(request.sellerId);

        return {
          data: snapshot,
          metadata: {
            source: "mercadolibre-api",
            freshness: snapshot.freshness,
            confidence: snapshot.confidence,
            requiresApproval: false,
          },
        };
      } catch (error) {
        const blocked = toReadToolBlocked(error);

        if (blocked === undefined) {
          throw error;
        }

        return {
          data: blocked,
          metadata: {
            source: "mercadolibre-api",
            freshness: null,
            confidence: "low",
            requiresApproval: false,
          },
        };
      }
    },
  };
}

function toReadToolBlocked(error: unknown): ReadToolBlocked | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
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
