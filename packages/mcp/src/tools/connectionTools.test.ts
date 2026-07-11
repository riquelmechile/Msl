import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MercadoLibreAccountConnectionHealth } from "@msl/mercadolibre";

import { registerConnectionTools } from "./connectionTools.js";
import type { McpServerConfig } from "../index.js";

// ── Helpers ──────────────────────────────────────────────────────────

function setTestEnv() {
  process.env.MERCADOLIBRE_SOURCE_SELLER_ID = "111111111";
  process.env.MERCADOLIBRE_TARGET_SELLER_ID = "222222222";
}

function clearTestEnv() {
  delete process.env.MERCADOLIBRE_SOURCE_SELLER_ID;
  delete process.env.MERCADOLIBRE_TARGET_SELLER_ID;
}

function makeHealth(overrides: Partial<MercadoLibreAccountConnectionHealth> = {}): MercadoLibreAccountConnectionHealth {
  const base: MercadoLibreAccountConnectionHealth = {
    sellerId: "123456789",
    accountRole: "source",
    accountName: "Plasticov",
    status: "ready",
    tokenStatus: "valid",
    checkedAt: "2026-07-11T12:00:00.000Z",
    tokenExpiresAt: "2026-07-12T12:00:00.000Z",
    reasonCodes: [],
    readReady: true,
    writeReady: false,
    noExternalMutationExecuted: true,
  };
  return { ...base, ...overrides } as MercadoLibreAccountConnectionHealth;
}

function makeMockHealthService(overrides: Partial<{
  inspect: ReturnType<typeof vi.fn>;
  inspectAll: ReturnType<typeof vi.fn>;
  refreshIfNeeded: ReturnType<typeof vi.fn>;
  smokeRead: ReturnType<typeof vi.fn>;
  healthByMode: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    inspect: overrides.inspect ?? vi.fn().mockResolvedValue(makeHealth()),
    inspectAll: overrides.inspectAll ?? vi.fn().mockResolvedValue([makeHealth(), makeHealth({ sellerId: "987654321", accountRole: "target", accountName: "Maustian" })]),
    refreshIfNeeded: overrides.refreshIfNeeded ?? vi.fn().mockResolvedValue(makeHealth()),
    smokeRead: overrides.smokeRead ?? vi.fn().mockResolvedValue(makeHealth()),
    healthByMode: overrides.healthByMode ?? vi.fn().mockResolvedValue(makeHealth()),
  };
}

/**
 * Intercepts registerTool calls to capture handler functions.
 * Returns both the tools map and the spy for cleanup.
 */
function captureTools(server: McpServer) {
  const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  const serverAny = server as unknown as {
    registerTool: (name: string, schema: unknown, handler: (args: Record<string, unknown>) => Promise<unknown>) => void;
  };
  const spy = vi.spyOn(serverAny, "registerTool").mockImplementation(
    (name, _schema, handler) => {
      handlers[name] = handler;
    },
  );
  return { handlers, spy };
}

/**
 * Parses the text content from a tool result.
 */
function parseResult(result: unknown): unknown {
  const r = result as { content: { type: string; text: string }[] };
  return JSON.parse(r.content[0]!.text);
}

describe("connectionTools", () => {
  beforeEach(() => {
    setTestEnv();
  });

  afterEach(() => {
    clearTestEnv();
  });

  describe("sanitization and safety guarantees", () => {
    it("returns noExternalMutationExecuted: true in all tool responses", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService();
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      // Test inspect_mercadolibre_connections
      const allParsed = parseResult(await handlers["inspect_mercadolibre_connections"]!({}));
      expect((allParsed as Record<string, unknown>).noExternalMutationExecuted).toBe(true);

      // Test inspect_mercadolibre_account_health
      const inspectParsed = parseResult(await handlers["inspect_mercadolibre_account_health"]!({ sellerId: "source" }));
      expect((inspectParsed as Record<string, unknown>).noExternalMutationExecuted).toBe(true);

      // Test run_mercadolibre_read_smoke
      const smokeParsed = parseResult(await handlers["run_mercadolibre_read_smoke"]!({ sellerId: "source" }));
      expect((smokeParsed as Record<string, unknown>).noExternalMutationExecuted).toBe(true);

      spy.mockRestore();
    });

    it("does not leak tokens, secrets, or PII in any response", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService({
        inspect: vi.fn().mockResolvedValue(makeHealth({ reason: "some reason" })),
        inspectAll: vi.fn().mockResolvedValue([makeHealth()]),
        smokeRead: vi.fn().mockResolvedValue(makeHealth({ reason: "test" })),
      });
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      for (const [toolName, callArgs] of [
        ["inspect_mercadolibre_connections", {}],
        ["inspect_mercadolibre_account_health", { sellerId: "source" }],
        ["run_mercadolibre_read_smoke", { sellerId: "source" }],
      ] as const) {
        const result = await handlers[toolName]!(callArgs);
        const text = (result as { content: { text: string }[] }).content[0]!.text;

        expect(text).not.toMatch(/APP_USR-/);
        expect(text).not.toMatch(/TG-/);
        expect(text).not.toMatch(/access_token/);
        expect(text).not.toMatch(/refresh_token/);
        expect(text).not.toMatch(/client_secret/);
        expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/);
        expect(() => JSON.parse(text)).not.toThrow();
      }

      spy.mockRestore();
    });
  });

  describe("inspect_mercadolibre_connections", () => {
    it("returns sanitized health for all sellers", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService();
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["inspect_mercadolibre_connections"]!({})) as Record<string, unknown>;
      expect(parsed.connections).toBeInstanceOf(Array);
      const conns = parsed.connections as Record<string, unknown>[];
      expect(conns.length).toBe(2);
      expect(parsed.count).toBe(2);
      expect(conns[0]!.sellerId).toBe("123456789");
      expect(conns[0]!.accountRole).toBe("source");
      expect(conns[0]!.accountName).toBe("Plasticov");
      expect(conns[0]!).not.toHaveProperty("accessToken");
      expect(conns[0]!).not.toHaveProperty("refreshToken");

      spy.mockRestore();
    });

    it("returns blockedResult when health service is not available", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const config = {} as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["inspect_mercadolibre_connections"]!({})) as Record<string, unknown>;
      expect(parsed.status).toBe("blocked");
      expect(parsed.reason).toBe("missing-account-roles");

      spy.mockRestore();
    });

    it("handles health service errors gracefully", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService({
        inspectAll: vi.fn().mockRejectedValue(new Error("Network down")),
      });
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["inspect_mercadolibre_connections"]!({})) as Record<string, unknown>;
      expect(parsed.error).toBeDefined();
      expect(parsed.noExternalMutationExecuted).toBe(true);

      spy.mockRestore();
    });
  });

  describe("inspect_mercadolibre_account_health", () => {
    it("returns detailed health for a specific seller", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService();
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["inspect_mercadolibre_account_health"]!({ sellerId: "source" })) as Record<string, unknown>;
      expect(parsed.status).toBe("ready");
      expect(parsed.tokenStatus).toBe("valid");
      expect(parsed.readReady).toBe(true);
      expect(parsed.writeReady).toBe(false);
      expect(parsed.noExternalMutationExecuted).toBe(true);

      spy.mockRestore();
    });

    it("blocks for unauthorized API keys", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const config = {} as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => false, config });

      const parsed = parseResult(await handlers["inspect_mercadolibre_account_health"]!({ sellerId: "source", msl_api_key: "wrong" })) as Record<string, unknown>;
      expect(parsed.status).toBe("blocked");
      expect(parsed.reason).toBe("unauthorized");

      spy.mockRestore();
    });

    it("blocks when seller is not configured", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const config = {} as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["inspect_mercadolibre_account_health"]!({ sellerId: "nonexistent" })) as Record<string, unknown>;
      expect(parsed.status).toBe("blocked");
      expect(parsed.reason).toBe("missing-account-roles");

      spy.mockRestore();
    });
  });

  describe("run_mercadolibre_read_smoke", () => {
    it("runs smoke tests and returns sanitized results", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService({
        smokeRead: vi.fn().mockResolvedValue(makeHealth({ status: "ready", tokenStatus: "valid" })),
      });
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["run_mercadolibre_read_smoke"]!({ sellerId: "source" })) as Record<string, unknown>;
      expect(parsed.seller).toBeDefined();
      const seller = parsed.seller as Record<string, unknown>;
      expect(seller.sellerId).toBe("123456789");
      expect(parsed.status).toBe("ready");
      expect(parsed.noExternalMutationExecuted).toBe(true);
      expect(parsed.warning).toContain("DO NOT run automatically");

      spy.mockRestore();
    });

    it("contains CEO warning in response", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService();
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      const parsed = parseResult(await handlers["run_mercadolibre_read_smoke"]!({ sellerId: "source" })) as Record<string, unknown>;
      expect(parsed.warning).toMatch(/only when explicitly requested/i);

      spy.mockRestore();
    });
  });

  describe("tool descriptions", () => {
    it("all tool descriptions contain 'read-only' and 'zero mutations'", () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService();
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const toolSchemas: Record<string, { description: string }> = {};
      const serverAny = server as unknown as { registerTool: (name: string, schema: { description: string }) => void };
      const spy = vi.spyOn(serverAny, "registerTool").mockImplementation(
        (name: string, schema: { description: string }) => {
          toolSchemas[name] = schema;
        },
      );

      registerConnectionTools(server, { validateApiKey: () => true, config });

      expect(toolSchemas["inspect_mercadolibre_connections"]).toBeDefined();
      expect(toolSchemas["inspect_mercadolibre_connections"]!.description).toMatch(/read-only/i);
      expect(toolSchemas["inspect_mercadolibre_connections"]!.description).toMatch(/zero mutations/i);

      expect(toolSchemas["inspect_mercadolibre_account_health"]).toBeDefined();
      expect(toolSchemas["inspect_mercadolibre_account_health"]!.description).toMatch(/read-only/i);
      expect(toolSchemas["inspect_mercadolibre_account_health"]!.description).toMatch(/zero mutations/i);

      expect(toolSchemas["run_mercadolibre_read_smoke"]).toBeDefined();
      expect(toolSchemas["run_mercadolibre_read_smoke"]!.description).toMatch(/read-only/i);
      expect(toolSchemas["run_mercadolibre_read_smoke"]!.description).toMatch(/zero mutations/i);
      expect(toolSchemas["run_mercadolibre_read_smoke"]!.description).toMatch(/DO NOT run automatically/i);

      spy.mockRestore();
    });
  });

  describe("seller filter (source/target mapping)", () => {
    it("maps 'source' shorthand to MERCADOLIBRE_SOURCE_SELLER_ID", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService({
        inspect: vi.fn().mockResolvedValue(makeHealth({ sellerId: "111111111" })),
      });
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      await handlers["inspect_mercadolibre_account_health"]!({ sellerId: "source" });
      expect(healthService.inspect).toHaveBeenCalledWith("111111111");

      spy.mockRestore();
    });

    it("maps 'target' shorthand to MERCADOLIBRE_TARGET_SELLER_ID", async () => {
      const server = new McpServer({ name: "test", version: "0.1.0" }, { capabilities: { tools: {} } });
      const healthService = makeMockHealthService({
        inspect: vi.fn().mockResolvedValue(makeHealth({ sellerId: "222222222" })),
      });
      const config = { connectionHealthService: healthService } as unknown as McpServerConfig;

      const { handlers, spy } = captureTools(server);

      registerConnectionTools(server, { validateApiKey: () => true, config });

      await handlers["inspect_mercadolibre_account_health"]!({ sellerId: "target" });
      expect(healthService.inspect).toHaveBeenCalledWith("222222222");

      spy.mockRestore();
    });
  });
});
