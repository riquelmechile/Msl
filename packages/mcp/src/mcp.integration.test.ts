import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { ApprovalQueueRepository } from "@msl/tools";
import { describe, expect, it, vi } from "vitest";
import { createMcpServer } from "./index.js";

function makeSyncProductPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceSellerId: "plasticov-seller",
    targetSellerId: "maustian-seller",
    itemId: "MLC-1",
    rationale: "Prepare a seller-approved Plasticov to Maustian product sync proposal.",
    expiresAt: "2026-01-02T00:00:00.000Z",
    requiresApproval: true,
    risk: "high",
    ...overrides,
  };
}

function makeApprovalDependencies(
  save = vi.fn<ApprovalQueueRepository["save"]>().mockResolvedValue(undefined),
) {
  return {
    save,
    prepareWrite: {
      repository: {
        save,
        findAction: vi.fn(),
        saveApproval: vi.fn(),
        findApproval: vi.fn(),
        saveAudit: vi.fn(),
        listAudits: vi.fn(),
      },
      clock: { now: () => new Date("2026-01-01T00:00:00.000Z") },
    },
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
  } = {},
) {
  const { save, prepareWrite } = makeApprovalDependencies(options.save);
  const server = createMcpServer({
    prepareWrite,
    ...(options.approvalStorage ? { approvalStorage: options.approvalStorage } : {}),
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

describe("MCP Server SDK integration", () => {
  it.each([
    ["missing approval metadata", { requiresApproval: undefined }, "approval-required"],
    ["invalid approval metadata", { requiresApproval: false }, "approval-required"],
    ["missing risk metadata", { risk: undefined }, "invalid-risk"],
    ["invalid risk metadata", { risk: "medium" }, "invalid-risk"],
    ["bulk sync intent", { syncAll: true }, "unsupported-sync-intent"],
    ["multi-product sync intent", { productIds: ["MLC-1", "MLC-2"] }, "unsupported-sync-intent"],
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
});
