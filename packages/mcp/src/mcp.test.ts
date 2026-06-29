import { describe, it, expect, vi, beforeEach } from "vitest";
import { ACTION_TARGET_FIELD_BY_TYPE } from "@msl/domain";
import { PREPARED_WRITE_KINDS, type ApprovalQueueRepository } from "@msl/tools";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
const { createMcpRuntimeDependencies } = await import("../src/runtimeDependencies.js");

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

function makePrepareWritePayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "prepared-1",
    sellerId: "ML-target",
    kind: "price-change",
    target: { type: "listing", listingId: "MLC1001" },
    exactChange: [{ field: "price", from: 100, to: 110 }],
    rationale: "Seller requested pricing update.",
    expiresAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

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

function makeSourceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "MLC1001",
    title: "Source item",
    price: 10000,
    available_quantity: 10,
    category_id: "MLC1000",
    seller_id: 123,
    status: "active" as const,
    pictures: [{ url: "https://example.test/item.jpg" }],
    attributes: [{ id: "BRAND", value_name: "Generic" }],
    ...overrides,
  };
}

function syncProductConfig() {
  const { save, prepareWrite } = makeApprovalDependencies();

  return {
    save,
    config: {
      prepareWrite,
      accountRoles: {
        sourceSellerId: "plasticov-seller",
        targetSellerId: "maustian-seller",
        site: "MLC" as const,
      },
    },
  };
}

function prepareWriteInputSchema() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const calls = mockMcpServer.registerTool.mock.calls as any[][];
  const prepareWriteCall = calls.find((call) => call[0] === "prepare_mercadolibre_write");
  expect(prepareWriteCall).toBeDefined();
  return (prepareWriteCall![1] as { inputSchema: Record<string, z.ZodType> }).inputSchema;
}

async function withTempDbPath(run: (dbPath: string) => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "msl-mcp-approval-"));
  try {
    await run(join(dir, "approval-queue.sqlite"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "ML-test", site: "MLC" },
      data: { level: "gold", completedTransactions: 10 },
    });

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation,
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs: vi.fn(),
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
      siteSupport: "MLC-confirmed",
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
      data: [{ id: "MLC1001", title: "Test listing" }],
    });

    createMcpServer({
      mlcClient: {
        getListings,
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs: vi.fn(),
      },
    });

    expect(registeredTools.size).toBe(12);
    expect(registeredTools.has("read_mercadolibre_listings")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_orders")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_messages")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_reputation")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_category_attributes")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_category_technical_specs")).toBe(true);

    const cb = registeredTools.get("read_mercadolibre_listings");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test" })) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(getListings).toHaveBeenCalledWith("ML-test");
    expect(parsed.metadata).toMatchObject({ requiresApproval: false });
    expect(parsed.data).toMatchObject({ sellerId: "ML-test" });
  });

  it("registers only supported new MCP category safe reads and no mutation execution tools", () => {
    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs: vi.fn(),
      },
    });

    const toolNames = [...registeredTools.keys()];
    expect(toolNames).toContain("read_mercadolibre_category_attributes");
    expect(toolNames).toContain("read_mercadolibre_category_technical_specs");
    expect(toolNames).not.toContain("read_mercadolibre_questions");
    expect(toolNames).not.toContain("read_mercadolibre_shipping");
    expect(toolNames).not.toContain("read_mercadolibre_visits");
    expect(toolNames).not.toContain("read_mercadolibre_listing_quality");
    expect(toolNames).not.toContain("read_mercadolibre_pictures");
    expect(toolNames).not.toContain("execute_mercadolibre_write");
    expect(toolNames).not.toContain("answer_mercadolibre_question");
    expect(toolNames).not.toContain("reply_mercadolibre_message");
    expect(toolNames).not.toContain("mark_mercadolibre_message_read");
  });

  it("executes category attributes reads with seller scope and metadata", async () => {
    const getCategoryAttributes = vi.fn().mockResolvedValue({
      kind: "category-attributes",
      sellerId: "ML-test",
      source: "mercadolibre-api",
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
      completeness: "complete",
      confidence: "high",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "category-attributes",
        capturedAt: new Date("2026-01-01T00:00:00.000Z"),
        ageMs: 0,
        status: "fresh",
        risk: "medium",
      },
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "ML-test", site: "MLC" },
      data: { categoryId: "MLC123", attributes: [{ id: "BRAND", name: "Brand" }] },
    });

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes,
        getCategoryTechnicalSpecs: vi.fn(),
      },
    });

    const cb = registeredTools.get("read_mercadolibre_category_attributes");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test", categoryId: "MLC123" })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(getCategoryAttributes).toHaveBeenCalledWith("ML-test", "MLC123");
    expect(parsed.metadata).toMatchObject({
      source: "mercadolibre-api",
      confidence: "high",
      requiresApproval: false,
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "ML-test", site: "MLC" },
    });
    expect(parsed.data).toMatchObject({
      kind: "category-attributes",
      sellerId: "ML-test",
      data: { categoryId: "MLC123" },
    });
  });

  it("executes category technical specs reads with seller scope and metadata", async () => {
    const getCategoryTechnicalSpecs = vi.fn().mockResolvedValue({
      kind: "category-technical-specs",
      sellerId: "ML-test",
      source: "mercadolibre-api",
      capturedAt: new Date("2026-01-01T00:00:00.000Z"),
      completeness: "complete",
      confidence: "high",
      freshness: {
        source: "mercadolibre-api",
        signalKind: "category-technical-specs",
        capturedAt: new Date("2026-01-01T00:00:00.000Z"),
        ageMs: 0,
        status: "fresh",
        risk: "medium",
      },
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "ML-test", site: "MLC" },
      data: { domainId: "MLC-CELLPHONES", technicalSpecs: [{ id: "COLOR", name: "Color" }] },
    });

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs,
      },
    });

    const cb = registeredTools.get("read_mercadolibre_category_technical_specs");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test", domainId: "MLC-CELLPHONES" })) as {
      content: { text: string }[];
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(getCategoryTechnicalSpecs).toHaveBeenCalledWith("ML-test", "MLC-CELLPHONES");
    expect(parsed.metadata).toMatchObject({
      source: "mercadolibre-api",
      confidence: "high",
      requiresApproval: false,
      siteSupport: "MLC-confirmed",
      sellerScope: { sellerId: "ML-test", site: "MLC" },
    });
    expect(parsed.data).toMatchObject({
      kind: "category-technical-specs",
      sellerId: "ML-test",
      data: { domainId: "MLC-CELLPHONES" },
    });
  });

  it("applies MCP auth before calling injected category read dependencies", async () => {
    vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");
    const getCategoryAttributes = vi.fn();

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes,
        getCategoryTechnicalSpecs: vi.fn(),
      },
    });

    const cb = registeredTools.get("read_mercadolibre_category_attributes");
    expect(cb).toBeDefined();

    const result = (await cb!({
      sellerId: "ML-test",
      categoryId: "MLC123",
      msl_api_key: "wrong",
    })) as { content: { text: string }[]; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(getCategoryAttributes).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    expect(parsed).toMatchObject({ status: "blocked", reason: "unauthorized" });
  });

  it("returns controlled blocked category read responses", async () => {
    const getCategoryTechnicalSpecs = vi.fn().mockRejectedValue(
      Object.assign(new Error("Requested seller is not configured."), {
        reason: "seller-not-configured",
        sellerId: "unconfigured-seller",
      }),
    );

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs,
      },
    });

    const cb = registeredTools.get("read_mercadolibre_category_technical_specs");
    expect(cb).toBeDefined();

    const result = (await cb!({
      sellerId: "unconfigured-seller",
      domainId: "MLC-CELLPHONES",
    })) as { content: { text: string }[]; isError?: boolean };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(parsed.data).toMatchObject({
      status: "blocked",
      reason: "seller-not-configured",
      message: "Requested seller is not configured.",
    });
    expect(parsed.metadata).toMatchObject({ requiresApproval: false, confidence: "low" });
  });

  it("blocks malformed category identifiers at the MCP tool boundary", async () => {
    const getCategoryAttributes = vi.fn();

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes,
        getCategoryTechnicalSpecs: vi.fn(),
      },
    });

    const cb = registeredTools.get("read_mercadolibre_category_attributes");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test", categoryId: "MLA123/../../users/me" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(getCategoryAttributes).not.toHaveBeenCalled();
    expect(parsed.data).toMatchObject({
      status: "blocked",
      reason: "unsupported-category-id",
      siteSupport: "unknown",
    });
    expect(parsed.metadata).toMatchObject({
      requiresApproval: false,
      confidence: "low",
      siteSupport: "unknown",
      degradedReason: "unsupported-category-id",
    });
  });

  it("returns controlled degraded category read responses for runtime API failures", async () => {
    const getCategoryTechnicalSpecs = vi
      .fn()
      .mockRejectedValue(
        new Error("ML API GET /domains/MLC-CELLPHONES/technical_specs failed: 500"),
      );

    createMcpServer({
      mlcClient: {
        getListings: vi.fn(),
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs,
      },
    });

    const cb = registeredTools.get("read_mercadolibre_category_technical_specs");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "ML-test", domainId: "MLC-CELLPHONES" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(parsed.data).toMatchObject({
      status: "degraded",
      reason: "ml-api-read-failed",
      siteSupport: "unknown",
    });
    expect(parsed.metadata).toMatchObject({
      requiresApproval: false,
      confidence: "low",
      siteSupport: "unknown",
      degradedReason: "ml-api-read-failed",
    });
  });

  it("returns a controlled blocked response for unconfigured MercadoLibre read sellers", async () => {
    const getListings = vi.fn().mockRejectedValue(
      Object.assign(new Error("Requested seller is not configured."), {
        reason: "seller-not-configured",
        sellerId: "unconfigured-seller",
      }),
    );

    createMcpServer({
      mlcClient: {
        getListings,
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs: vi.fn(),
      },
    });

    const cb = registeredTools.get("read_mercadolibre_listings");
    expect(cb).toBeDefined();

    const result = (await cb!({ sellerId: "unconfigured-seller" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBeFalsy();
    expect(parsed.data).toMatchObject({
      status: "blocked",
      reason: "seller-not-configured",
      message: "Requested seller is not configured.",
    });
    expect(parsed.metadata).toMatchObject({ requiresApproval: false, confidence: "low" });
  });

  it("applies MCP auth before calling injected MercadoLibre read dependencies", async () => {
    vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");
    const getListings = vi.fn();

    createMcpServer({
      mlcClient: {
        getListings,
        getItem: vi.fn(),
        getOrders: vi.fn(),
        getMessages: vi.fn(),
        getReputation: vi.fn(),
        getCategoryAttributes: vi.fn(),
        getCategoryTechnicalSpecs: vi.fn(),
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
    expect(parsed).toMatchObject({ status: "blocked", reason: "unauthorized" });
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

  it.each([
    [
      "target database path",
      { target: { type: "listing", listingId: "/tmp/msl/approval.sqlite" } },
    ],
    [
      "exact change token field",
      { exactChange: [{ field: "access_token", from: null, to: "Bearer abcdefghijklmnop" }] },
    ],
    [
      "exact change secret field name",
      { exactChange: [{ field: "clientSecret", from: null, to: "redacted" }] },
    ],
    ["rationale client secret", { rationale: "client_secret=super-secret-value" }],
    ["rationale OAuth token", { rationale: "oauth_token=raw-token-value" }],
  ])(
    "rejects prepare-only write proposals with credential-like %s before saving",
    async (_name, overrides) => {
      const { save, prepareWrite } = makeApprovalDependencies();

      createMcpServer({ prepareWrite });

      const cb = registeredTools.get("prepare_mercadolibre_write");
      expect(cb).toBeDefined();

      const result = (await cb!(makePrepareWritePayload(overrides))) as {
        content: { text: string }[];
        isError?: boolean;
      };
      const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

      expect(result.isError).toBe(true);
      expect(save).not.toHaveBeenCalled();
      expect(parsed).toMatchObject({ status: "blocked", reason: "credential-like-payload" });
      expect(JSON.stringify(parsed)).not.toContain("super-secret-value");
      expect(JSON.stringify(parsed)).not.toContain("/tmp/msl/approval.sqlite");
    },
  );

  it("does not persist credential-like generic write payloads in configured SQLite storage", async () => {
    await withTempDbPath(async (dbPath) => {
      const runtime = createMcpRuntimeDependencies({
        NODE_ENV: "test",
        MSL_APPROVAL_QUEUE_DB_PATH: dbPath,
      });

      try {
        createMcpServer(runtime);
        const cb = registeredTools.get("prepare_mercadolibre_write");
        expect(cb).toBeDefined();

        const result = (await cb!(
          makePrepareWritePayload({
            id: "credential-payload",
            rationale: "Use access_token=raw-token-value for the update.",
          }),
        )) as { content: { text: string }[]; isError?: boolean };
        const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

        expect(result.isError).toBe(true);
        expect(parsed).toMatchObject({ status: "blocked", reason: "credential-like-payload" });
        await expect(
          runtime.prepareWrite!.repository.findAction("credential-payload"),
        ).resolves.toBe(null);
        expect(result.content[0]!.text).not.toContain("raw-token-value");
        expect(result.content[0]!.text).not.toContain(dbPath);
      } finally {
        runtime.close();
      }
    });
  });

  it("returns a redacted blocked response when generic prepare-write storage save fails", async () => {
    const save = vi
      .fn<ApprovalQueueRepository["save"]>()
      .mockRejectedValue(new Error("SQLITE_CANTOPEN /tmp/msl/secrets.sqlite"));
    const { prepareWrite } = makeApprovalDependencies(save);

    createMcpServer({ prepareWrite });

    const cb = registeredTools.get("prepare_mercadolibre_write");
    expect(cb).toBeDefined();

    const result = (await cb!(makePrepareWritePayload())) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(parsed).toMatchObject({ status: "blocked", reason: "prepare-write-failed" });
    expect(JSON.stringify(parsed)).not.toContain("SQLITE_CANTOPEN");
    expect(JSON.stringify(parsed)).not.toContain("/tmp/msl/secrets.sqlite");
  });

  it("sync_product creates a pending prepare-only proposal for configured Plasticov to Maustian direction", async () => {
    const { save, config } = syncProductConfig();

    createMcpServer(config);

    const cb = registeredTools.get("sync_product");
    expect(cb).toBeDefined();

    const result = (await cb!(makeSyncProductPayload())) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(parsed.reason).toBeUndefined();
    expect(save).toHaveBeenCalledTimes(1);
    const savedEntry = save.mock.calls[0]![0];
    expect(savedEntry.highlightedRisk).toBe("high");
    expect(savedEntry.status).toBe("pending");
    expect(savedEntry.action).toMatchObject({
      sellerId: "maustian-seller",
      kind: "listing-edit",
      target: { type: "listing", listingId: "MLC1001" },
      approvalStatus: "pending",
      riskLevel: "high",
    });
    expect(parsed.metadata).toMatchObject({
      source: "seller-input",
      requiresApproval: true,
      sourceSellerId: "plasticov-seller",
      targetSellerId: "maustian-seller",
      site: "MLC",
      risk: "high",
      noMutationExecuted: true,
    });
    expect(parsed.data).toMatchObject({
      status: "pending",
      action: { approvalStatus: "pending" },
    });
  });

  it("sync_product attaches safe available preview metadata and scalar exact changes", async () => {
    const { save, config } = syncProductConfig();
    const getSourceItem = vi.fn().mockResolvedValue(makeSourceItem({ price: 10000 }));
    const getStrategies = vi.fn().mockResolvedValue([{ type: "margin", percentage: 0.5 }]);

    createMcpServer({ ...config, syncPreview: { getSourceItem, getStrategies } });

    const cb = registeredTools.get("sync_product");
    expect(cb).toBeDefined();

    const result = (await cb!(makeSyncProductPayload())) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
    const savedEntry = save.mock.calls[0]![0];

    expect(getSourceItem).toHaveBeenCalledWith("plasticov-seller", "MLC1001");
    expect(parsed.metadata).toMatchObject({
      requiresApproval: true,
      noMutationExecuted: true,
      preview: {
        status: "available",
        evidenceSource: "read-only-item",
        fieldChanges: [{ field: "price", from: 10000, to: 15000 }],
      },
    });
    expect(savedEntry.action.exactChange).toEqual(
      expect.arrayContaining([
        { field: "preview.status", from: null, to: "available" },
        { field: "preview.price", from: 10000, to: 15000 },
      ]),
    );
  });

  it.each([
    ["missing dependency", undefined, "missing-preview-dependency"],
    [
      "failed source read",
      {
        getSourceItem: vi.fn().mockRejectedValue(new Error("ML API failed with token raw-secret")),
        getStrategies: vi.fn(),
      },
      "source-read-failed",
    ],
    [
      "absent strategy source",
      {
        getSourceItem: vi.fn().mockResolvedValue(makeSourceItem()),
        getStrategies: vi.fn().mockResolvedValue([]),
      },
      "strategy-unavailable",
    ],
    [
      "malformed strategy config",
      {
        getSourceItem: vi.fn().mockResolvedValue(makeSourceItem()),
        getStrategies: vi.fn().mockResolvedValue([{ type: "margin", percentage: Number.NaN }]),
      },
      "strategy-unavailable",
    ],
    [
      "incomplete source item",
      {
        getSourceItem: vi.fn().mockResolvedValue(makeSourceItem({ title: undefined })),
        getStrategies: vi.fn().mockResolvedValue([{ type: "margin", percentage: 0.5 }]),
      },
      "source-read-failed",
    ],
  ])(
    "sync_product returns degraded preview metadata for %s",
    async (_name, syncPreview, reason) => {
      const { save, config } = syncProductConfig();

      createMcpServer({ ...config, ...(syncPreview ? { syncPreview } : {}) });

      const cb = registeredTools.get("sync_product");
      expect(cb).toBeDefined();

      const result = (await cb!(makeSyncProductPayload())) as { content: { text: string }[] };
      const responseText = result.content[0]!.text;
      const parsed = JSON.parse(responseText) as Record<string, unknown>;
      const savedEntry = save.mock.calls[0]![0];

      expect(parsed.metadata).toMatchObject({
        noMutationExecuted: true,
        preview: { status: "unavailable", reason },
      });
      expect(savedEntry.action.exactChange).toEqual(
        expect.arrayContaining([
          { field: "preview.status", from: null, to: "unavailable" },
          { field: "preview.reason", from: null, to: reason },
        ]),
      );
      expect(responseText).not.toContain("raw-secret");
    },
  );

  it.each([
    ["invalid API key", { msl_api_key: "wrong" }, "unauthorized", true],
    [
      "reversed seller direction",
      { sourceSellerId: "maustian-seller", targetSellerId: "plasticov-seller" },
      "unsafe-direction",
      false,
    ],
    ["arbitrary seller direction", { sourceSellerId: "other-seller" }, "unsafe-direction", false],
    ["invalid expiry", { expiresAt: "2026-01-02" }, "invalid-expires-at", false],
    ["crafted itemId path", { itemId: "MLC1001/visits?include=orders" }, "invalid-target", false],
    ["missing rationale", { rationale: "   " }, "missing-rationale", false],
    ["missing approval metadata", { requiresApproval: false }, "approval-required", false],
    ["missing risk", { risk: undefined }, "invalid-risk", false],
    ["non-high risk", { risk: "medium" }, "invalid-risk", false],
    ["bulk sync intent", { syncAll: true }, "unsupported-sync-intent", false],
    [
      "multi-product sync intent",
      { itemIds: ["MLC1001", "MLC1002"] },
      "unsupported-sync-intent",
      false,
    ],
  ])(
    "sync_product blocks %s before repository save",
    async (_name, overrides, reason, setApiKey) => {
      if (setApiKey) {
        vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");
      }
      const { save, config } = syncProductConfig();

      createMcpServer(config);

      const cb = registeredTools.get("sync_product");
      expect(cb).toBeDefined();

      const result = (await cb!(makeSyncProductPayload(overrides))) as {
        content: { text: string }[];
        isError?: boolean;
      };
      const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

      expect(result.isError).toBe(true);
      expect(save).not.toHaveBeenCalled();
      expect(parsed).toMatchObject({ status: "blocked", reason });
    },
  );

  it("sync_product blocks when account roles are not configured", async () => {
    const { save, prepareWrite } = makeApprovalDependencies();

    createMcpServer({ prepareWrite });

    const cb = registeredTools.get("sync_product");
    expect(cb).toBeDefined();

    const result = (await cb!(makeSyncProductPayload())) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({ status: "blocked", reason: "missing-account-roles" });
  });

  it.each([
    ["non-MLC account roles", { site: "MLB" }, "unsupported-site"],
    ["missing account-role seller id", { sourceSellerId: "   " }, "missing-account-roles"],
  ])("sync_product blocks %s before repository save", async (_name, roleOverrides, reason) => {
    const { save, config } = syncProductConfig();
    config.accountRoles = {
      ...config.accountRoles,
      ...roleOverrides,
    } as typeof config.accountRoles;

    createMcpServer(config);

    const cb = registeredTools.get("sync_product");
    expect(cb).toBeDefined();

    const result = (await cb!(makeSyncProductPayload())) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).not.toHaveBeenCalled();
    expect(parsed).toMatchObject({ status: "blocked", reason });
  });

  it("sync_product returns a controlled blocked response when approval repository save fails", async () => {
    const save = vi.fn<ApprovalQueueRepository["save"]>().mockRejectedValue(new Error("db down"));
    const { prepareWrite } = makeApprovalDependencies(save);

    createMcpServer({
      prepareWrite,
      accountRoles: {
        sourceSellerId: "plasticov-seller",
        targetSellerId: "maustian-seller",
        site: "MLC",
      },
    });

    const cb = registeredTools.get("sync_product");
    expect(cb).toBeDefined();

    const result = (await cb!(makeSyncProductPayload())) as {
      content: { text: string }[];
      isError?: boolean;
    };
    const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(result.isError).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(parsed).toMatchObject({ status: "blocked", reason: "prepare-write-failed" });
    expect(JSON.stringify(parsed)).not.toContain("db down");
  });

  it("does not expose mutation execution tools or import ProductSyncEngine from the MCP package", () => {
    createMcpServer(syncProductConfig().config);

    const toolNames = [...registeredTools.keys()];
    expect(toolNames).not.toContain("sync_all");
    expect(toolNames).not.toContain("execute_mercadolibre_write");
    expect(toolNames).not.toContain("executePreparedAction");

    const mcpSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(mcpSource).not.toContain("ProductSyncEngine");
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
    expect(parsedNoKey).toMatchObject({ status: "blocked", reason: "unauthorized" });

    // Call WITH the wrong key — should be rejected.
    const resultWrongKey = (await cb!({ msl_api_key: "wrong" })) as {
      content: { text: string }[];
      isError?: boolean;
    };
    expect(resultWrongKey.isError).toBe(true);
    const parsedWrongKey = JSON.parse(resultWrongKey.content[0]!.text) as Record<string, unknown>;
    expect(parsedWrongKey).toMatchObject({ status: "blocked", reason: "unauthorized" });

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
    expect(parsed).toMatchObject({ status: "blocked", reason: "unauthorized" });

    vi.unstubAllEnvs();
  });

  it("builds prepare-only runtime dependencies when local MercadoLibre OAuth env is absent", () => {
    const runtime = createMcpRuntimeDependencies({ NODE_ENV: "test" });

    createMcpServer(runtime);

    expect(runtime.mlcClient).toBeUndefined();
    expect(runtime.approvalStorage).toBe("memory");
    expect(registeredTools.has("prepare_mercadolibre_write")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_listings")).toBe(false);
    expect(registeredTools.has("executePreparedAction")).toBe(false);
    runtime.close();
  });

  it("defaults blank approval queue DB paths to in-memory proposal storage", () => {
    const runtime = createMcpRuntimeDependencies({
      NODE_ENV: "test",
      MSL_APPROVAL_QUEUE_DB_PATH: "   ",
    });

    expect(runtime.approvalStorage).toBe("memory");
    runtime.close();
    expect(() => runtime.close()).not.toThrow();
  });

  it("uses configured SQLite proposal storage and closes it once", async () => {
    await withTempDbPath((dbPath) => {
      const runtime = createMcpRuntimeDependencies({
        NODE_ENV: "test",
        MSL_APPROVAL_QUEUE_DB_PATH: dbPath,
      });

      expect(runtime.approvalStorage).toBe("sqlite");
      expect(runtime.prepareWrite?.repository).toBeDefined();
      expect(() => runtime.close()).not.toThrow();
      expect(() => runtime.close()).not.toThrow();
    });
  });

  it("falls back to degraded in-memory proposal storage when configured SQLite startup fails", async () => {
    await withTempDbPath(async (dbPath) => {
      const unavailableDbPath = join(dbPath, "missing-parent", "approval.sqlite");
      const runtime = createMcpRuntimeDependencies({
        NODE_ENV: "test",
        MSL_APPROVAL_QUEUE_DB_PATH: unavailableDbPath,
        MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-seller",
        MERCADOLIBRE_TARGET_SELLER_ID: "maustian-seller",
      });

      try {
        expect(runtime.approvalStorage).toBe("sqlite-unavailable");
        createMcpServer(runtime);
        const cb = registeredTools.get("sync_product");
        expect(cb).toBeDefined();

        const result = (await cb!(
          makeSyncProductPayload({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() }),
        )) as {
          content: { text: string }[];
          isError?: boolean;
        };
        const responseText = result.content[0]!.text;
        const parsed = JSON.parse(responseText) as Record<string, unknown>;

        expect(result.isError).toBeFalsy();
        expect(parsed.metadata).toMatchObject({
          approvalPersistence: "sqlite-unavailable",
          persistentApprovalStorage: false,
          approvalStorageDegraded: true,
          noMutationExecuted: true,
        });
        expect(responseText).not.toContain(unavailableDbPath);
        expect(responseText).not.toContain("SQLITE_CANTOPEN");
      } finally {
        runtime.close();
      }
    });
  });

  it("builds prepare-only runtime dependencies with account roles without requiring OAuth env", () => {
    const runtime = createMcpRuntimeDependencies({
      NODE_ENV: "test",
      MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-seller",
      MERCADOLIBRE_TARGET_SELLER_ID: "maustian-seller",
    });

    createMcpServer(runtime);

    expect(runtime.accountRoles).toEqual({
      sourceSellerId: "plasticov-seller",
      targetSellerId: "maustian-seller",
      site: "MLC",
    });
    expect(runtime.mlcClient).toBeUndefined();
    expect(registeredTools.has("sync_product")).toBe(true);
    expect(registeredTools.has("prepare_mercadolibre_write")).toBe(true);
    runtime.close();
  });

  it("fails closed in production when required runtime auth and secret env is absent", () => {
    expect(() => createMcpRuntimeDependencies({ NODE_ENV: "production" })).toThrow(
      /MSL_MCP_API_KEY/,
    );
  });

  it("reports missing runtime config without leaking raw secret values", () => {
    const secretValue = "raw-client-secret-value";

    try {
      createMcpRuntimeDependencies({
        NODE_ENV: "development",
        MERCADOLIBRE_CLIENT_ID: "client-id-value",
        MERCADOLIBRE_CLIENT_SECRET: secretValue,
      });
      throw new Error("Expected runtime config construction to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Missing");
      expect((error as Error).message).not.toContain(secretValue);
      expect((error as Error).message).not.toContain("client-id-value");
    }
  });

  it("sync_product reports durable SQLite metadata without exposing secrets or DB paths", async () => {
    await withTempDbPath(async (dbPath) => {
      vi.stubEnv("MSL_MCP_API_KEY", "secret-key-42");
      const runtime = createMcpRuntimeDependencies({
        NODE_ENV: "test",
        MSL_APPROVAL_QUEUE_DB_PATH: dbPath,
        MERCADOLIBRE_SOURCE_SELLER_ID: "plasticov-seller",
        MERCADOLIBRE_TARGET_SELLER_ID: "maustian-seller",
      });

      try {
        createMcpServer(runtime);
        const cb = registeredTools.get("sync_product");
        expect(cb).toBeDefined();

        const result = (await cb!(
          makeSyncProductPayload({
            msl_api_key: "secret-key-42",
            expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
          }),
        )) as { content: { text: string }[]; isError?: boolean };
        const responseText = result.content[0]!.text;
        const parsed = JSON.parse(responseText) as Record<string, unknown>;

        expect(result.isError).toBeFalsy();
        expect(parsed.metadata).toMatchObject({
          approvalPersistence: "sqlite",
          persistentApprovalStorage: true,
          auditReplay: "not-available",
          noMutationExecuted: true,
        });
        const data = parsed.data as { action?: { id?: string } };
        expect(data.action?.id).toEqual(expect.any(String));
        await expect(
          runtime.prepareWrite!.repository.findAction(data.action!.id!),
        ).resolves.toEqual(expect.objectContaining({ status: "pending" }));
        expect(responseText).not.toContain(dbPath);
        expect(responseText).not.toContain("secret-key-42");
      } finally {
        runtime.close();
      }
    });
  });

  it("keeps durable sync_product storage inside the prepare-only no-mutation boundary", async () => {
    await withTempDbPath((dbPath) => {
      const runtime = createMcpRuntimeDependencies({
        NODE_ENV: "test",
        MSL_APPROVAL_QUEUE_DB_PATH: dbPath,
      });

      try {
        createMcpServer(runtime);
        const toolNames = [...registeredTools.keys()];
        expect(toolNames).toContain("sync_product");
        expect(toolNames).toContain("prepare_mercadolibre_write");
        expect(toolNames).not.toContain("sync_all");
        expect(toolNames).not.toContain("approve_prepared_action");
        expect(toolNames).not.toContain("execute_mercadolibre_write");
        expect(toolNames).not.toContain("executePreparedAction");
        expect(toolNames).not.toContain("preview_product_sync");

        const mcpSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
        expect(mcpSource).not.toContain("ProductSyncEngine");
        expect(mcpSource).not.toContain("preview_product_sync");
      } finally {
        runtime.close();
      }
    });
  });

  it("builds configured OAuth-backed read tools plus prepare-only proposals", () => {
    const runtime = createMcpRuntimeDependencies({
      NODE_ENV: "test",
      MSL_MCP_API_KEY: "mcp-key",
      MSL_ENCRYPTION_KEY: "encryption-key",
      MERCADOLIBRE_CLIENT_ID: "client-id",
      MERCADOLIBRE_CLIENT_SECRET: "client-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://example.test/oauth/callback",
      MSL_MERCADOLIBRE_OAUTH_DB_PATH: ":memory:",
      MERCADOLIBRE_SOURCE_SELLER_ID: "source-seller",
      MERCADOLIBRE_TARGET_SELLER_ID: "target-seller",
    });

    createMcpServer(runtime);

    expect(runtime.mlcClient).toBeDefined();
    expect(runtime.accountRoles).toEqual({
      sourceSellerId: "source-seller",
      targetSellerId: "target-seller",
      site: "MLC",
    });
    expect(registeredTools.has("read_mercadolibre_listings")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_orders")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_messages")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_reputation")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_category_attributes")).toBe(true);
    expect(registeredTools.has("read_mercadolibre_category_technical_specs")).toBe(true);
    expect(registeredTools.has("prepare_mercadolibre_write")).toBe(true);
    expect(registeredTools.has("execute_mercadolibre_write")).toBe(false);
    expect(registeredTools.has("executePreparedAction")).toBe(false);
    runtime.close();
  });

  it("keeps malformed runtime preview strategy config unavailable instead of casting it", async () => {
    const runtime = createMcpRuntimeDependencies({
      NODE_ENV: "test",
      MSL_MCP_API_KEY: "mcp-key",
      MSL_ENCRYPTION_KEY: "encryption-key",
      MERCADOLIBRE_CLIENT_ID: "client-id",
      MERCADOLIBRE_CLIENT_SECRET: "client-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://example.test/oauth/callback",
      MSL_MERCADOLIBRE_OAUTH_DB_PATH: ":memory:",
      MERCADOLIBRE_SOURCE_SELLER_ID: "source-seller",
      MERCADOLIBRE_TARGET_SELLER_ID: "target-seller",
      MSL_SYNC_PREVIEW_STRATEGIES_JSON: JSON.stringify([{ type: "margin", percentage: "NaN" }]),
    });

    try {
      expect(runtime.syncPreview).toBeDefined();
      await expect(runtime.syncPreview!.getStrategies()).rejects.toThrow(/Invalid sync preview/);
    } finally {
      runtime.close();
    }
  });

  it("rejects unconfigured runtime OAuth read sellers before token lookup", async () => {
    const runtime = createMcpRuntimeDependencies({
      NODE_ENV: "test",
      MSL_MCP_API_KEY: "mcp-key",
      MSL_ENCRYPTION_KEY: "encryption-key",
      MERCADOLIBRE_CLIENT_ID: "client-id",
      MERCADOLIBRE_CLIENT_SECRET: "client-secret",
      MERCADOLIBRE_REDIRECT_URI: "https://example.test/oauth/callback",
      MSL_MERCADOLIBRE_OAUTH_DB_PATH: ":memory:",
      MERCADOLIBRE_SOURCE_SELLER_ID: "source-seller",
      MERCADOLIBRE_TARGET_SELLER_ID: "target-seller",
    });

    try {
      await expect(runtime.mlcClient!.getListings("unconfigured-seller")).rejects.toMatchObject({
        reason: "seller-not-configured",
        sellerId: "unconfigured-seller",
      });
      await expect(runtime.mlcClient!.getListings("source-seller")).rejects.toThrow(
        /No stored token for seller source-seller/,
      );
    } finally {
      runtime.close();
    }
  });
});
