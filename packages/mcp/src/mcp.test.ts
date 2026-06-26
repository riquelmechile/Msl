import { describe, it, expect, vi, beforeEach } from "vitest";

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

describe("MCP Server", () => {
  beforeEach(() => {
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
    const parsed = JSON.parse(result.content[0]!.text) as Record<
      string,
      unknown
    >;
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
    const parsed = JSON.parse(result.content[0]!.text) as Record<
      string,
      unknown
    >;
    expect(parsed.sellerId).toBe("ML-test");
    expect(parsed.level).toBe("platinum");
    expect(parsed.status).toBe("active");
  });

  it("list_strategies tool returns empty strategies", async () => {
    createMcpServer();

    const cb = registeredTools.get("list_strategies");
    expect(cb).toBeDefined();

    const result = (await cb!({})) as { content: { text: string }[] };
    const parsed = JSON.parse(result.content[0]!.text) as Record<
      string,
      unknown
    >;
    expect(parsed.strategies).toEqual([]);
    expect(parsed.count).toBe(0);
  });

  it("startMcpServer creates a server and connects with Stdio transport", async () => {
    await startMcpServer();

    expect(MockMcpServer).toHaveBeenCalled();
    expect(MockStdioTransport).toHaveBeenCalled();
    expect(mockMcpServer.connect).toHaveBeenCalled();
  });
});
