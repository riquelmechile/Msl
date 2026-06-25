import { describe, expect, it } from "vitest";

import {
  approvePreparedAction,
  createInMemoryApprovalQueueRepository,
  createMlcReadTools,
  createOfficialMercadoLibreDocsAdapter,
  createPreparedActionTool,
  executePreparedAction,
  type Clock,
  type DirectWriteExecutor,
  type IdGenerator,
  type PrepareWriteInput,
  type PreparedWriteKind,
} from "../../packages/tools/src/index.js";
import type {
  MlcApiClient,
  MlcListingSummary,
  MlcReadSnapshot,
} from "../../packages/mercadolibre/src/index.js";

const now = new Date("2026-06-25T12:00:00.000Z");
const clock: Clock = { now: () => now };
const idGenerator: IdGenerator = {
  nextId: (prefix) => `${prefix}-1`,
};

function writeInput(kind: PreparedWriteKind): PrepareWriteInput {
  return {
    id: `action-${kind}`,
    sellerId: "seller-1",
    kind,
    target: { type: "listing", listingId: "MLC123" },
    exactChange: [{ field: kind, from: "current", to: "proposed" }],
    rationale: "Seller-visible business change requires explicit approval.",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
  };
}

describe("official MercadoLibre MCP boundary", () => {
  it("is documentation-only and never exposes seller operation execution", async () => {
    const adapter = createOfficialMercadoLibreDocsAdapter({
      lookupDocumentation: (topic) => Promise.resolve(`Documentation for ${topic}`),
    });

    const response = await adapter.lookupDocumentation("listing price updates");

    expect(response).toMatchObject({
      data: { topic: "listing price updates" },
      metadata: {
        source: "official-mercadolibre-mcp-docs",
        freshness: null,
        confidence: "medium",
        requiresApproval: false,
      },
    });
    expect("execute" in adapter).toBe(false);
  });
});

describe("custom MercadoLibre read tools", () => {
  it("returns authorized read snapshots with metadata and no approval creation", async () => {
    const repository = createInMemoryApprovalQueueRepository();
    const tools = createMlcReadTools({ client: snapshotClient() });

    const response = await tools.listings.execute({ sellerId: "seller-1" });

    expect(response).toMatchObject({
      data: {
        sellerId: "seller-1",
        kind: "listing",
        source: "mercadolibre-api",
        completeness: "complete",
        confidence: "high",
        freshness: {
          source: "mercadolibre-api",
          signalKind: "listing",
          status: "fresh",
        },
      },
      metadata: {
        source: "mercadolibre-api",
        confidence: "high",
        requiresApproval: false,
      },
    });
    expect(response.metadata.freshness).toEqual(response.data.freshness);
    await expect(repository.findAction("action-read-listings")).resolves.toBeNull();
  });

  it("keeps official MercadoLibre MCP documentation-only during read execution", async () => {
    let documentationLookups = 0;
    const docs = createOfficialMercadoLibreDocsAdapter({
      lookupDocumentation: (topic) => {
        documentationLookups += 1;
        return Promise.resolve(`Documentation for ${topic}`);
      },
    });
    const client = snapshotClient();
    const tools = createMlcReadTools({ client });

    const response = await tools.reputation.execute({ sellerId: "seller-1" });

    expect(response.data).toMatchObject({ kind: "reputation", source: "mercadolibre-api" });
    expect(documentationLookups).toBe(0);
    expect("execute" in docs).toBe(false);
  });

  it("converts reconnect and seller mismatch failures into blocked read responses without seller data", async () => {
    const reconnectTools = createMlcReadTools({
      client: throwingReadClient("reconnect-required", "Reconnect MercadoLibre access."),
    });
    const mismatchTools = createMlcReadTools({
      client: throwingReadClient("seller-access-mismatch", "Connected seller does not match."),
    });

    await expect(reconnectTools.orders.execute({ sellerId: "seller-1" })).resolves.toMatchObject({
      data: {
        status: "blocked",
        reason: "reconnect-required",
        message: "Reconnect MercadoLibre access.",
      },
      metadata: { freshness: null, confidence: "low", requiresApproval: false },
    });
    await expect(mismatchTools.messages.execute({ sellerId: "seller-2" })).resolves.toMatchObject({
      data: {
        status: "blocked",
        reason: "seller-access-mismatch",
        message: "Connected seller does not match.",
      },
      metadata: { freshness: null, confidence: "low", requiresApproval: false },
    });
  });
});

describe("custom tool prepared actions and approval safety", () => {
  it.each<PreparedWriteKind>([
    "price-change",
    "stock-change",
    "customer-message",
    "cancellation",
    "refund",
    "listing-edit",
    "creative-publication",
  ])("prepares %s writes with required approval metadata", async (kind) => {
    const repository = createInMemoryApprovalQueueRepository();
    const tool = createPreparedActionTool({ repository, clock });

    const response = await tool.execute(writeInput(kind));

    expect(response.data.action.kind).toBe(kind);
    expect(response.data.status).toBe("pending");
    expect(response.metadata).toMatchObject({
      source: "seller-input",
      confidence: "high",
      requiresApproval: true,
    });
  });

  it("blocks execution before approval and records a blocked audit without calling direct APIs", async () => {
    const repository = createInMemoryApprovalQueueRepository();
    const tool = createPreparedActionTool({ repository, clock });
    const executor = countingExecutor();

    await tool.execute(writeInput("price-change"));
    const response = await executePreparedAction({
      repository,
      executor,
      clock,
      idGenerator,
      actionId: "action-price-change",
    });

    expect(executor.calls).toBe(0);
    expect(response.data.audit).toMatchObject({
      actionId: "action-price-change",
      status: "blocked",
      rationale: "Seller-visible business change requires explicit approval.",
      resultMessage: "Execution blocked: missing-approval.",
    });
    expect(response.metadata.requiresApproval).toBe(true);
  });

  it("executes through the project-owned direct API boundary only after valid approval and stores audit output", async () => {
    const repository = createInMemoryApprovalQueueRepository();
    const tool = createPreparedActionTool({ repository, clock });
    const executor = countingExecutor();

    await tool.execute(writeInput("stock-change"));
    await approvePreparedAction({
      repository,
      clock,
      idGenerator,
      request: { actionId: "action-stock-change", approvedBy: "seller" },
    });
    const response = await executePreparedAction({
      repository,
      executor,
      clock,
      idGenerator,
      actionId: "action-stock-change",
    });

    expect(executor.calls).toBe(1);
    expect(response.data.audit).toMatchObject({
      actionId: "action-stock-change",
      approvedBy: "seller",
      status: "executed",
      rationale: "Seller-visible business change requires explicit approval.",
      resultMessage: "Executed via direct MercadoLibre API boundary.",
    });
    expect(response.metadata).toMatchObject({
      source: "mercadolibre-api",
      confidence: "high",
      requiresApproval: false,
    });
  });

  it("blocks execution when stored approval no longer matches the prepared action binding", async () => {
    const repository = createInMemoryApprovalQueueRepository();
    const tool = createPreparedActionTool({ repository, clock });
    const executor = countingExecutor();

    await tool.execute(writeInput("listing-edit"));
    await approvePreparedAction({
      repository,
      clock,
      idGenerator,
      request: { actionId: "action-listing-edit", approvedBy: "seller" },
    });
    await repository.saveApproval({
      id: "approval-tampered",
      actionId: "action-listing-edit",
      sellerId: "seller-2",
      approvedBy: "seller",
      approvedAt: now,
      exactChangeAccepted: [{ field: "listing-edit", from: "current", to: "proposed" }],
      riskAccepted: "high",
    });

    const response = await executePreparedAction({
      repository,
      executor,
      clock,
      idGenerator,
      actionId: "action-listing-edit",
    });

    expect(executor.calls).toBe(0);
    expect(response.data.audit).toMatchObject({
      actionId: "action-listing-edit",
      status: "blocked",
      resultMessage: "Execution blocked: approval-mismatch.",
    });
    expect(response.metadata.requiresApproval).toBe(true);
  });

  it("records and returns failed audit evidence when the approved executor throws", async () => {
    const repository = createInMemoryApprovalQueueRepository();
    const tool = createPreparedActionTool({ repository, clock });

    await tool.execute(writeInput("creative-publication"));
    await approvePreparedAction({
      repository,
      clock,
      idGenerator,
      request: { actionId: "action-creative-publication", approvedBy: "seller" },
    });
    const response = await executePreparedAction({
      repository,
      executor: throwingExecutor("MercadoLibre API rejected the write"),
      clock,
      idGenerator,
      actionId: "action-creative-publication",
    });

    expect(response.data.audit).toMatchObject({
      actionId: "action-creative-publication",
      approvedBy: "seller",
      status: "failed",
      resultMessage: "Execution failed: MercadoLibre API rejected the write.",
    });
    await expect(repository.listAudits("action-creative-publication")).resolves.toEqual([
      response.data.audit,
    ]);
  });
});

function countingExecutor(): DirectWriteExecutor & { readonly calls: number } {
  let calls = 0;

  return {
    get calls() {
      return calls;
    },
    execute: () => {
      calls += 1;
      return Promise.resolve({
        status: "executed",
        resultMessage: "Executed via direct MercadoLibre API boundary.",
      });
    },
  };
}

function throwingExecutor(message: string): DirectWriteExecutor {
  return {
    execute: () => Promise.reject(new Error(message)),
  };
}

function listingSnapshot(): MlcReadSnapshot<MlcListingSummary> {
  return {
    sellerId: "seller-1",
    kind: "listing",
    source: "mercadolibre-api",
    data: [
      {
        id: "MLC123",
        title: "Listing title",
        status: "active",
        availableQuantity: 3,
        price: 100,
        currencyId: "CLP",
      },
    ],
    completeness: "complete",
    freshness: {
      source: "mercadolibre-api",
      signalKind: "listing",
      risk: "medium",
      capturedAt: now,
      maxAgeMs: 60 * 60 * 1000,
      status: "fresh",
    },
    confidence: "high",
  };
}

function snapshotClient(): MlcApiClient {
  const listing = listingSnapshot();

  return {
    getListings: () => Promise.resolve(listing),
    getOrders: () =>
      Promise.resolve({ ...listing, kind: "order", data: [{ id: "order-1", status: "paid" }] }),
    getMessages: () =>
      Promise.resolve({ ...listing, kind: "message", data: [{ id: "message-1", status: "read" }] }),
    getReputation: () =>
      Promise.resolve({ ...listing, kind: "reputation", data: { level: "green" } }),
  };
}

function throwingReadClient(
  reason: "reconnect-required" | "seller-access-mismatch",
  message: string,
): MlcApiClient {
  const read = () => Promise.reject(Object.assign(new Error(message), { reason }));

  return {
    getListings: read,
    getOrders: read,
    getMessages: read,
    getReputation: read,
  };
}
