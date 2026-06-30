import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ApprovalQueueEntry, ApprovalQueueRepository } from "@msl/tools";
import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./index.js";

function makeSyncProductPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceSellerId: "plasticov-seller",
    targetSellerId: "maustian-seller",
    itemId: "MLC1001",
    rationale: "Prepare a seller-approved Plasticov to Maustian product sync proposal.",
    expiresAt: "2026-01-02T00:00:00.000Z",
    requiresApproval: true,
    risk: "high",
    ...overrides,
  };
}

function makeApprovalDependencies(
  save = vi.fn<ApprovalQueueRepository["save"]>().mockResolvedValue(undefined),
  findAction = vi.fn<ApprovalQueueRepository["findAction"]>().mockResolvedValue(null),
) {
  return {
    save,
    findAction,
    prepareWrite: {
      repository: {
        save,
        findAction,
        saveApproval: vi.fn(),
        findApproval: vi.fn(),
        saveAudit: vi.fn(),
        listAudits: vi.fn(),
      },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    },
  };
}

function makeSyncProductQueueEntry(
  overrides: Omit<Partial<ApprovalQueueEntry>, "action"> & {
    action?: Partial<ApprovalQueueEntry["action"]>;
  } = {},
): ApprovalQueueEntry {
  const { action: actionOverrides, ...entryOverrides } = overrides;
  const action = {
    id: "sync-product:MLC1001:2026-01-01T00:00:00.000Z",
    sellerId: "maustian-seller",
    kind: "listing-edit" as const,
    target: { type: "listing" as const, listingId: "MLC1001" },
    exactChange: [
      { field: "sourceSellerId", from: null, to: "plasticov-seller" },
      { field: "targetSellerId", from: null, to: "maustian-seller" },
      { field: "syncIntent", from: null, to: "prepare-only product sync proposal" },
      { field: "mutationExecuted", from: null, to: false },
      { field: "preview.status", from: null, to: "available" },
      { field: "preview.price", from: 10000, to: 15000 },
    ],
    rationale: "Prepare a seller-approved Plasticov to Maustian product sync proposal.",
    expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    approvalStatus: "pending" as const,
    riskLevel: "high" as const,
    ...actionOverrides,
  };

  return {
    action,
    requestedAt: new Date("2026-01-01T00:00:00.000Z"),
    highlightedRisk: action.riskLevel,
    status: action.approvalStatus,
    ...entryOverrides,
  };
}

async function withTimeout<T>(operation: Promise<T>, label: string, timeoutMs = 1_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function callSyncProductThroughSdk(
  arguments_: Record<string, unknown>,
  options: {
    accountRoles?: { sourceSellerId: string; targetSellerId: string; site: "MLC" };
    save?: ReturnType<typeof vi.fn<ApprovalQueueRepository["save"]>>;
    approvalStorage?: "memory" | "sqlite" | "sqlite-unavailable";
    syncPreview?: NonNullable<Parameters<typeof createMcpServer>[0]>["syncPreview"];
  } = {},
) {
  const { save, prepareWrite } = makeApprovalDependencies(options.save);
  const server = createMcpServer({
    prepareWrite,
    ...(options.approvalStorage ? { approvalStorage: options.approvalStorage } : {}),
    ...(options.syncPreview ? { syncPreview: options.syncPreview } : {}),
    accountRoles: options.accountRoles ?? {
      sourceSellerId: "plasticov-seller",
      targetSellerId: "maustian-seller",
      site: "MLC",
    },
  });
  const client = new Client({ name: "msl-mcp-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  let serverConnected = false;
  let clientConnected = false;

  try {
    await withTimeout(server.connect(serverTransport), "MCP server connect");
    serverConnected = true;
    await withTimeout(client.connect(clientTransport), "MCP client connect");
    clientConnected = true;

    const result = (await withTimeout(
      client.callTool(
        {
          name: "sync_product",
          arguments: arguments_,
        },
        undefined,
        { timeout: 1_000 },
      ),
      "sync_product SDK call",
    )) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

    return { result, save };
  } finally {
    if (clientConnected) {
      try {
        await withTimeout(client.close(), "MCP client close");
      } finally {
        if (serverConnected) {
          await withTimeout(server.close(), "MCP server close");
        }
      }
    } else if (serverConnected) {
      await withTimeout(server.close(), "MCP server close");
    }
  }
}

async function callReadSyncProductStatusThroughSdk(
  arguments_: Record<string, unknown>,
  options: {
    findAction?: ReturnType<typeof vi.fn<ApprovalQueueRepository["findAction"]>>;
    approvalStorage?: "memory" | "sqlite" | "sqlite-unavailable";
  } = {},
) {
  const { findAction, prepareWrite } = makeApprovalDependencies(undefined, options.findAction);
  const server = createMcpServer({
    prepareWrite,
    ...(options.approvalStorage ? { approvalStorage: options.approvalStorage } : {}),
  });
  const client = new Client({ name: "msl-mcp-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  let serverConnected = false;
  let clientConnected = false;

  try {
    await withTimeout(server.connect(serverTransport), "MCP server connect");
    serverConnected = true;
    await withTimeout(client.connect(clientTransport), "MCP client connect");
    clientConnected = true;

    const result = (await withTimeout(
      client.callTool(
        {
          name: "read_sync_product_status",
          arguments: arguments_,
        },
        undefined,
        { timeout: 1_000 },
      ),
      "read_sync_product_status SDK call",
    )) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

    return { result, findAction, prepareWrite };
  } finally {
    if (clientConnected) {
      try {
        await withTimeout(client.close(), "MCP client close");
      } finally {
        if (serverConnected) {
          await withTimeout(server.close(), "MCP server close");
        }
      }
    } else if (serverConnected) {
      await withTimeout(server.close(), "MCP server close");
    }
  }
}

async function callApproveSyncProductProposalThroughSdk(
  arguments_: Record<string, unknown>,
  options: {
    findAction?: ReturnType<typeof vi.fn<ApprovalQueueRepository["findAction"]>>;
    approvalStorage?: "memory" | "sqlite" | "sqlite-unavailable";
  } = {},
) {
  const { findAction, prepareWrite } = makeApprovalDependencies(undefined, options.findAction);
  const server = createMcpServer({
    prepareWrite,
    ...(options.approvalStorage ? { approvalStorage: options.approvalStorage } : {}),
  });
  const client = new Client({ name: "msl-mcp-test-client", version: "0.1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  let serverConnected = false;
  let clientConnected = false;

  try {
    await withTimeout(server.connect(serverTransport), "MCP server connect");
    serverConnected = true;
    await withTimeout(client.connect(clientTransport), "MCP client connect");
    clientConnected = true;

    const result = (await withTimeout(
      client.callTool(
        {
          name: "approve_sync_product_proposal",
          arguments: arguments_,
        },
        undefined,
        { timeout: 1_000 },
      ),
      "approve_sync_product_proposal SDK call",
    )) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

    return { result, findAction, prepareWrite };
  } finally {
    if (clientConnected) {
      try {
        await withTimeout(client.close(), "MCP client close");
      } finally {
        if (serverConnected) {
          await withTimeout(server.close(), "MCP server close");
        }
      }
    } else if (serverConnected) {
      await withTimeout(server.close(), "MCP server close");
    }
  }
}

function parseTextResult(result: { content: Array<{ type: string; text?: string }> }) {
  const content = result.content[0];
  if (!content || content.type !== "text" || content.text === undefined) {
    throw new Error("Expected MCP SDK call to return text content.");
  }

  return {
    text: content.text,
    parsed: JSON.parse(content.text) as Record<string, unknown>,
  };
}

describe("MCP Server SDK integration", () => {
  it("records sync_product approval through the MCP SDK without execution or audit replay", async () => {
    const entry = makeSyncProductQueueEntry();
    const findAction = vi.fn<ApprovalQueueRepository["findAction"]>().mockResolvedValue(entry);

    const { result, prepareWrite } = await callApproveSyncProductProposalThroughSdk(
      { actionId: "sync-product:MLC1001:2026-01-01T00:00:00.000Z" },
      { findAction, approvalStorage: "sqlite" },
    );
    const { text, parsed } = parseTextResult(result);

    expect(result.isError).toBeFalsy();
    expect(findAction).toHaveBeenCalledWith("sync-product:MLC1001:2026-01-01T00:00:00.000Z");
    expect(parsed).toEqual({
      status: "approved",
      actionId: "redacted",
      noMutationExecuted: true,
    });
    expect(prepareWrite.repository.save).toHaveBeenCalledWith({
      ...entry,
      status: "approved",
      action: { ...entry.action, approvalStatus: "approved" },
    });
    expect(prepareWrite.repository.saveApproval).toHaveBeenCalledWith({
      id: "approval:sync-product:MLC1001:2026-01-01T00:00:00.000Z:2026-01-01T00:00:00.000Z",
      actionId: "sync-product:MLC1001:2026-01-01T00:00:00.000Z",
      sellerId: "maustian-seller",
      approvedBy: "seller",
      approvedAt: new Date("2026-01-01T00:00:00.000Z"),
      exactChangeAccepted: entry.action.exactChange,
      riskAccepted: "high",
      executionStatus: "not-executed",
    });
    expect(prepareWrite.repository.saveAudit).not.toHaveBeenCalled();
    expect(prepareWrite.repository.listAudits).not.toHaveBeenCalled();
    expect(text).not.toContain("plasticov-seller");
    expect(text).not.toContain("maustian-seller");
    expect(text).not.toContain("ProductSyncEngine");
    expect(text).not.toContain("sync_all");
    expect(text).not.toContain("execute_mercadolibre_write");
  });

  it("reads a durable stored sync_product status through the MCP SDK without mutating approvals", async () => {
    const findAction = vi
      .fn<ApprovalQueueRepository["findAction"]>()
      .mockResolvedValue(makeSyncProductQueueEntry());

    const { result, prepareWrite } = await callReadSyncProductStatusThroughSdk(
      { actionId: "sync-product:MLC1001:2026-01-01T00:00:00.000Z" },
      { findAction, approvalStorage: "sqlite" },
    );
    const { text, parsed } = parseTextResult(result);

    expect(result.isError).toBeFalsy();
    expect(findAction).toHaveBeenCalledWith("sync-product:MLC1001:2026-01-01T00:00:00.000Z");
    expect(prepareWrite.repository.save).not.toHaveBeenCalled();
    expect(prepareWrite.repository.saveApproval).not.toHaveBeenCalled();
    expect(prepareWrite.repository.saveAudit).not.toHaveBeenCalled();
    expect(prepareWrite.repository.listAudits).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({
      status: "available",
      actionId: "redacted",
      effectiveStatus: "pending",
      expiresAt: "2026-01-02T00:00:00.000Z",
      risk: "high",
      target: { type: "listing", listingId: "MLC1001" },
      preview: { status: "available", summary: "Preview available for price." },
      metadata: {
        requiresApproval: true,
        noMutationExecuted: true,
        auditReplay: "not-available",
        approvalPersistence: "sqlite",
        persistentApprovalStorage: true,
      },
    });
    expect(text).not.toContain("plasticov-seller");
    expect(text).not.toContain("maustian-seller");
    expect(text).not.toContain("sqlite:");
    expect(text).not.toContain("ProductSyncEngine");
    expect(text).not.toContain("sync_all");
  });

  it("rejects unauthenticated status SDK calls before repository lookup", async () => {
    vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");
    const findAction = vi.fn<ApprovalQueueRepository["findAction"]>().mockResolvedValue(null);

    try {
      const { result } = await callReadSyncProductStatusThroughSdk(
        { actionId: "sync-product:MLC1001:2026-01-01T00:00:00.000Z", msl_api_key: "wrong" },
        { findAction },
      );
      const { parsed } = parseTextResult(result);

      expect(result.isError).toBe(true);
      expect(findAction).not.toHaveBeenCalled();
      expect(parsed).toMatchObject({ status: "blocked", reason: "unauthorized" });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    ["missing action", null],
    [
      "unsupported non-sync proposal",
      makeSyncProductQueueEntry({ action: { kind: "price-change" } }),
    ],
    [
      "malformed unsupported proposal",
      makeSyncProductQueueEntry({
        action: { exactChange: [{ field: "mutationExecuted", from: null, to: true }] },
      }),
    ],
  ])("returns a controlled redacted status SDK response for %s", async (_name, entry) => {
    const findAction = vi.fn<ApprovalQueueRepository["findAction"]>().mockResolvedValue(entry);

    const { result } = await callReadSyncProductStatusThroughSdk(
      { actionId: "candidate-id" },
      { findAction, approvalStorage: "sqlite-unavailable" },
    );
    const { text, parsed } = parseTextResult(result);

    expect(result.isError).toBeFalsy();
    expect(parsed).toEqual({
      status: "unavailable",
      reason: "not-found-or-unsupported",
      noMutationExecuted: true,
    });
    expect(text).not.toContain("plasticov-seller");
    expect(text).not.toContain("maustian-seller");
    expect(text).not.toContain("sqlite-unavailable");
  });

  it("redacts repository failures and derives expired status through SDK without saving", async () => {
    const expiredFindAction = vi.fn<ApprovalQueueRepository["findAction"]>().mockResolvedValue(
      makeSyncProductQueueEntry({
        action: { expiresAt: new Date("2025-12-31T23:59:59.000Z") },
      }),
    );
    const failingFindAction = vi
      .fn<ApprovalQueueRepository["findAction"]>()
      .mockRejectedValue(new Error("SQLITE_CANTOPEN /tmp/msl/approval.sqlite secret-key-42"));

    const expired = await callReadSyncProductStatusThroughSdk(
      { actionId: "sync-product:MLC1001:2026-01-01T00:00:00.000Z" },
      { findAction: expiredFindAction },
    );
    const unavailable = await callReadSyncProductStatusThroughSdk(
      { actionId: "sync-product:MLC1001:2026-01-01T00:00:00.000Z" },
      { findAction: failingFindAction },
    );

    expect(parseTextResult(expired.result).parsed).toMatchObject({
      status: "available",
      effectiveStatus: "expired",
    });
    expect(expired.prepareWrite.repository.save).not.toHaveBeenCalled();
    expect(expired.prepareWrite.repository.saveApproval).not.toHaveBeenCalled();
    expect(expired.prepareWrite.repository.saveAudit).not.toHaveBeenCalled();

    const { text, parsed } = parseTextResult(unavailable.result);
    expect(parsed).toEqual({
      status: "unavailable",
      reason: "not-found-or-unsupported",
      noMutationExecuted: true,
    });
    expect(text).not.toContain("SQLITE_CANTOPEN");
    expect(text).not.toContain("/tmp/msl/approval.sqlite");
    expect(text).not.toContain("secret-key-42");
  });

  it.each([
    ["missing approval metadata", { requiresApproval: undefined }, "approval-required"],
    ["invalid approval metadata", { requiresApproval: false }, "approval-required"],
    ["missing risk metadata", { risk: undefined }, "invalid-risk"],
    ["invalid risk metadata", { risk: "medium" }, "invalid-risk"],
    ["bulk sync intent", { syncAll: true }, "unsupported-sync-intent"],
    [
      "multi-product sync intent",
      { productIds: ["MLC1001", "MLC1002"] },
      "unsupported-sync-intent",
    ],
  ])("returns a controlled blocked response for %s", async (_name, overrides, reason) => {
    const { result, save } = await callSyncProductThroughSdk(makeSyncProductPayload(overrides));

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({ status: "blocked", reason });
    expect(parsed.message).toEqual(expect.any(String));
  });

  it("blocks injected non-MLC account roles before saving a proposal", async () => {
    const { result, save } = await callSyncProductThroughSdk(makeSyncProductPayload(), {
      accountRoles: {
        sourceSellerId: "plasticov-seller",
        targetSellerId: "maustian-seller",
        site: "MLB" as "MLC",
      },
    });

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({ status: "blocked", reason: "unsupported-site" });
  });

  it("returns a controlled blocked response when approval repository save fails", async () => {
    const failingSave = vi
      .fn<ApprovalQueueRepository["save"]>()
      .mockRejectedValue(new Error("database password leaked"));
    const { result, save } = await callSyncProductThroughSdk(makeSyncProductPayload(), {
      save: failingSave,
    });

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(parsed).toMatchObject({ status: "blocked", reason: "prepare-write-failed" });
    expect(JSON.stringify(parsed)).not.toContain("database password leaked");
  });

  it("discloses unavailable approval persistence and audit replay for prepared sync proposals", async () => {
    const { result, save } = await callSyncProductThroughSdk(makeSyncProductPayload());

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(save).toHaveBeenCalledTimes(1);
    expect(parsed.metadata).toMatchObject({
      requiresApproval: true,
      approvalPersistence: "in-memory-only",
      auditReplay: "not-available",
      persistentApprovalStorage: false,
      noMutationExecuted: true,
    });
    expect(parsed.data).toMatchObject({
      status: "pending",
      action: { approvalStatus: "pending" },
    });
  });

  it("reports durable approval storage metadata through the MCP SDK when configured", async () => {
    const { result, save } = await callSyncProductThroughSdk(makeSyncProductPayload(), {
      approvalStorage: "sqlite",
    });

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(save).toHaveBeenCalledTimes(1);
    expect(parsed.metadata).toMatchObject({
      approvalPersistence: "sqlite",
      persistentApprovalStorage: true,
      auditReplay: "not-available",
      noMutationExecuted: true,
    });
    expect(content.text).not.toContain("sqlite:");
    expect(content.text).not.toContain("clientSecret");
  });

  it("exposes inline preview metadata without changing the MCP tool surface", async () => {
    const getSourceItem = vi.fn().mockResolvedValue({
      id: "MLC1001",
      title: "Source item",
      price: 10000,
      available_quantity: 10,
      category_id: "MLC1000",
      seller_id: 123,
      status: "active",
      pictures: [{ url: "https://example.test/item.jpg" }],
      attributes: [{ id: "BRAND", value_name: "Generic" }],
    });
    const getStrategies = vi.fn().mockResolvedValue([{ type: "margin", percentage: 0.5 }]);
    const { result, save } = await callSyncProductThroughSdk(makeSyncProductPayload(), {
      syncPreview: { getSourceItem, getStrategies },
    });

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;
    const savedEntry = save.mock.calls[0]![0];

    expect(result.isError).toBeFalsy();
    expect(parsed.metadata).toMatchObject({
      requiresApproval: true,
      noMutationExecuted: true,
      preview: { status: "available", evidenceSource: "read-only-item" },
    });
    expect(savedEntry.action.exactChange).toEqual(
      expect.arrayContaining([{ field: "preview.price", from: 10000, to: 15000 }]),
    );
    expect(content.text).not.toContain("preview_product_sync");
    expect(content.text).not.toContain("execute_mercadolibre_write");
  });

  it("redacts degraded preview source errors in SDK responses", async () => {
    const { result } = await callSyncProductThroughSdk(makeSyncProductPayload(), {
      syncPreview: {
        getSourceItem: vi.fn().mockRejectedValue(new Error("Bearer raw-token database.sqlite")),
        getStrategies: vi.fn(),
      },
    });

    const content = result.content[0];
    if (!content || content.type !== "text" || content.text === undefined) {
      throw new Error("Expected sync_product to return text content.");
    }
    const parsed = JSON.parse(content.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(parsed.metadata).toMatchObject({
      preview: { status: "unavailable", reason: "source-read-failed" },
      noMutationExecuted: true,
    });
    expect(content.text).not.toContain("raw-token");
    expect(content.text).not.toContain("database.sqlite");
  });
});
