import { describe, it, expect, vi, beforeEach } from "vitest";
import { ACTION_TARGET_FIELD_BY_TYPE } from "@msl/domain";
import { PREPARED_WRITE_KINDS, type ApprovalQueueRepository } from "@msl/tools";
import type { z } from "zod";

// ── Mock @modelcontextprotocol/sdk ──────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registeredTools = new Map<string, (args: Record<string, unknown>) => any>();

const mockMcpServer = {
  registerTool: vi.fn(
    (
      _name: string,
      _config: Record<string, unknown>,
      cb: (args: Record<string, unknown>) => unknown,
    ) => {
      registeredTools.set(_name, cb);
    },
  ),
  connect: vi.fn().mockResolvedValue(undefined),
};

const MockMcpServer = vi.fn().mockImplementation(() => mockMcpServer);
const MockStdioTransport = vi.fn().mockImplementation(() => ({}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: MockMcpServer,
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: MockStdioTransport,
}));

// ── Dynamically import after mocks are set ──────────────────────────
const { createMcpServer, startMcpServer } = await import("../src/index.js");

function makeApprovalDependencies() {
  const save = vi.fn<ApprovalQueueRepository["save"]>().mockResolvedValue(undefined);

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

function makePrepareWritePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "prepared-1",
    sellerId: "ML-target",
    kind: "price-change",
    target: { type: "listing", listingId: "MLC-1" },
    exactChange: [{ field: "price", from: 100, to: 110 }],
    rationale: "Seller requested pricing update.",
    expiresAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function prepareWriteInputSchema() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls = mockMcpServer.registerTool.mock.calls as any[][];
  const prepareWriteCall = calls.find((call) => call[0] === "prepare_mercadolibre_write");
  expect(prepareWriteCall).toBeDefined();
  return (prepareWriteCall![1] as { inputSchema: Record<string, z.ZodType> }).inputSchema;
}

describe("MCP Server", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    registeredTools.clear();
    MockMcpServer.mockClear();
    mockMcpServer.registerTool.mockClear();
    mockMcpServer.connect.mockClear();
    MockStdioTransport.mockClear();
  });

  it("creates a server named msl-mcp-server", () => {
    createMcpServer();
    expect(MockMcpServer).toHaveBeenCalledWith(
      { name: "msl-mcp-server", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );
  });

  it("registers exactly 6 tools", () => {
    createMcpServer();
    expect(mockMcpServer.registerTool).toHaveBeenCalledTimes(6);
    expect(registeredTools.size).toBe(6);

    // Verify tool names via the registerTool mock arguments.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockMcpServer.registerTool.mock.calls as any[][];
    const toolNames = calls.map((c) => c[0] as string);
    expect(toolNames).toContain("simulate_actor");
    expect(toolNames).toContain("detect_probes");
    expect(toolNames).toContain("sync_product");
    expect(toolNames).toContain("check_account");
    expect(toolNames).toContain("list_strategies");
    expect(toolNames).toContain("consult_cortex");
  });

  it("simulate_actor tool returns correct response", async () => {
    createMcpServer();

    const cb = registeredTools.get("simulate_actor");
    expect(cb).toBeDefined();

    const result = (await cb!({ actorType: "competidor" })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed.result).toBe("simulado");
    expect(parsed.actor).toBe("competidor");
  });

  it("simulate_actor registers with correct description", () => {
    createMcpServer();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const calls = mockMcpServer.registerTool.mock.calls as any[][];
    const simCall = calls.find((c) => c[0] === "simulate_actor")!;
    const config = simCall[1] as { description: string };
    expect(config.description).toContain("Simula comportamiento");
  });

  it("check_account tool returns correct account info", async () => {
    createMcpServer();

    const cb = registeredTools.get("check_account");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test" })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed.sellerId).toBe("ML-test");
    expect(parsed.level).toBe("platinum");
    expect(parsed.status).toBe("active");
  });

  it("check_account delegates to the injected MercadoLibre reputation read tool", async () => {
    const getReputation = vi.fn().mockResolvedValue({
      kind: "account-health",
      sellerId: "ML-test",
      source: "mercadolibre-api",
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
      completeness: "complete",
      confidence: "high",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "account-health",
        capturedAt: new Date("2026-01-01T00:00:00.000Z"),
        ageMs: 0,
        status: "fresh",
        risk: "medium",
      },
      data: { level: "gold", completedTransactions: 10 },
    });

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation,
      },
    });

    const cb = registeredTools.get("check_account");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test" })) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(getReputation).toHaveBeenCalledWith("ML-test");
    expect(parsed.metadata).toMatchObject({
      source: "mercadolibre-api",
      confidence: "high",
      requiresApproval: false,
    });
    expect(parsed.data).toMatchObject({
      sellerId: "ML-test",
      data: { level: "gold", completedTransactions: 10 },
    });
  });

  it("registers injected MercadoLibre read tools without replacing stub-only behavior", async () => {
    const getListings = vi.fn().mockResolvedValue({
      kind: "business-signal",
      sellerId: "ML-test",
      source: "mercadolibre-api",
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
      completeness: "complete",
      confidence: "high",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "business-signal",
        capturedAt: new Date("2026-01-01T00:00:00.000Z"),
        ageMs: 0,
        status: "fresh",
        risk: "medium",
      },
      data: [{ id: "MLC-1", title: "Test listing" }],
    });

    createMcpServer({
      mlcClient: {
        getListings,
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
      },
    });

    expect(registeredTools.size).toBe(10);
    expect(registeredTools.has("read_mercadolibre_listings")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_orders")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_messages")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_reputation")).toBe(true);

    const cb = registeredTools.get("read_mercadolibre_listings");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test" })) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(getListings).toHaveBeenCalledWith("ML-test");
    expect(parsed.metadata).toMatchObject({ requiresApproval: false });
    expect(parsed.data).toMatchObject({ sellerId: "ML-test" });
  });

  it("applies MCP auth before calling injected MercadoLibre read dependencies", async () => {
    vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");
    const getListings = vi.fn();

    createMcpServer({
      mlcClient: {
        getListings,
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
      },
    });

    const cb = registeredTools.get("read_mercadolibre_listings");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test", msl_api_key: "wrong" })) as {
      content: { text: string }[];
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    expect(getListings).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed.error).toContain("Unauthorized");
  });

  it("registers a prepare-only write proposal tool when approval dependencies are injected", async () => {
    const { save, prepareWrite } = makeApprovalDependencies();

    createMcpServer({ prepareWrite });

    expect(registeredTools.has("prepare_mercadolibre_write")).toBe(true);
    expect(registeredTools.has("executePreparedAction")).toBe(false);

    const cb = registeredTools.get("prepare_mercadolibre_write");
    expect(cb).toBeDefined();

    const result = (await cb!(makePrepareWritePayload())) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        highlightedRisk: "medium",
        status: "pending",
      }),
    );
    expect(parsed.metadata).toMatchObject({ requiresApproval: true });
    expect(parsed.data).toMatchObject({
      highlightedRisk: "medium",
      status: "pending",
      action: { id: "prepared-1", approvalStatus: "pending" },
    });
  });

  it("derives prepare-write kind schema from the tools prepared-write kinds", () => {
    const { prepareWrite } = makeApprovalDependencies();

    createMcpServer({ prepareWrite });

    const inputSchema = prepareWriteInputSchema();
    for (const kind of PREPARED_WRITE_KINDS) {
      expect(inputSchema.kind!.safeParse(kind).success).toBe(true);
    }
  });

  it("derives prepare-write target schema from the domain action target variants", () => {
    const { prepareWrite } = makeApprovalDependencies();

    createMcpServer({ prepareWrite });

    const inputSchema = prepareWriteInputSchema();
    for (const [type, idField] of Object.entries(ACTION_TARGET_FIELD_BY_TYPE)) {
      expect(inputSchema.target!.safeParse({ type, [idField]: "target-1" }).success).toBe(true);
    }
  });

  it("rejects prepare-only write proposals with invalid expiresAt without saving", async () => {
    const { save, prepareWrite } = makeApprovalDependencies();

    createMcpServer({ prepareWrite });

    const cb = registeredTools.get("prepare_mercadolibre_write");
    expect(cb).toBeDefined();

    const result = (await cb!(
      makePrepareWritePayload({ id: "prepared-invalid-date", expiresAt: "not-a-date" }),
    )) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed).toEqual({ error: "Invalid expiresAt — expected a valid ISO 8601 timestamp" });
  });

  it("rejects prepare-only write proposals with parseable non-ISO expiresAt without saving", async () => {
    const { save, prepareWrite } = makeApprovalDependencies();

    createMcpServer({ prepareWrite });

    const cb = registeredTools.get("prepare_mercadolibre_write");
    expect(cb).toBeDefined();

    const result = (await cb!(
      makePrepareWritePayload({ id: "prepared-date-only", expiresAt: "2026-01-02" }),
    )) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed).toEqual({ error: "Invalid expiresAt — expected a valid ISO 8601 timestamp" });
  });

  it("list_strategies tool returns empty strategies", async () => {
    createMcpServer();

    const cb = registeredTools.get("list_strategies");
    expect(cb).toBeDefined();

    const result = (await cb!({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed.strategies).toEqual([]);
    expect(parsed.count).toBe(0);
  });

  it("startMcpServer creates a server and connects with Stdio transport", async () => {
    await startMcpServer();

    expect(MockMcpServer).toHaveBeenCalled();
    expect(MockStdioTransport).toHaveBeenCalled();
    expect(mockMcpServer.connect).toHaveBeenCalled();
  });

  it("MCP auth rejects tool calls without a valid API key when MSL_MCP_API_KEY is set", async () => {
    // Set the API key env var to enable authentication.
    vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");

    // Re-create server with the env var set.
    createMcpServer();

    const cb = registeredTools.get("list_strategies");
    expect(cb).toBeDefined();

    // Call WITHOUT the msl_api_key — should be rejected.
    const resultNoKey = (await cb!({})) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(resultNoKey.isError).toBe(true);
    const parsedNoKey = JSON.parse(resultNoKey.content[0]!.text) as Record<string, unknown>;
    expect(parsedNoKey.error).toContain("Unauthorized");

    // Call WITH the wrong key — should be rejected.
    const resultWrongKey = (await cb!({ msl_api_key: "wrong" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(resultWrongKey.isError).toBe(true);
    const parsedWrongKey = JSON.parse(resultWrongKey.content[0]!.text) as Record<string, unknown>;
    expect(parsedWrongKey.error).toContain("Unauthorized");

    // Call WITH the correct key — should succeed.
    const resultOk = (await cb!({ msl_api_key: "secret-key-42" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(resultOk.isError).toBeFalsy();
    const parsedOk = JSON.parse(resultOk.content[0]!.text) as Record<string, unknown>;
    expect(parsedOk).toBeDefined();

    vi.unstubAllEnvs();
  });

  it("MCP auth fails closed when MSL_MCP_API_KEY is missing outside explicit local/demo mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MSL_MCP_API_KEY", "");
    vi.stubEnv("MSL_ALLOW_UNAUTHENTICATED_LOCAL", "");

    createMcpServer();

    const cb = registeredTools.get("list_strategies");
    expect(cb).toBeDefined();

    const result = (await cb!({})) as {
      content: { text: string }[];
      isError?: boolean;
    };

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed.error).toContain("Unauthorized");

    vi.unstubAllEnvs();
  });
});
