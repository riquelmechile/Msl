import { describe, expect, it, vi, beforeEach } from "vitest";

// We import grammy normally but vitest mocks it
import type { Api } from "grammy";

// Mock grammY and runtime dependencies.
const mocks = vi.hoisted(() => {
  const mockCommand = vi.fn().mockReturnThis();
  const mockOn = vi.fn().mockReturnThis();
  const mockCatch = vi.fn().mockReturnThis();
  const mockSetMyCommands = vi.fn().mockResolvedValue(undefined);
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockStop = vi.fn().mockResolvedValue(undefined);
  const mockConverse = vi.fn().mockResolvedValue({
    response: "Hola, tu margen actual es del 35%.",
    updatedState: {
      messages: [{ role: "assistant", content: "Hola", timestamp: new Date() }],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId: "seller-test",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    },
  });
  const mockAdminConverse = vi.fn().mockResolvedValue({
    response: "Admin learning tools enabled.",
    updatedState: {
      messages: [{ role: "assistant", content: "Admin", timestamp: new Date() }],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId: "seller-test",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    },
  });
  const mockCreateStrategyStore = vi.fn(() => ({ listActive: vi.fn(() => []) }));
  const mockCreateCompanyAgentStore = vi.fn(() => ({
    getCompanyAgent: vi.fn(),
    listCompanyAgents: vi.fn(() => []),
  }));
  const mockCreateCompanyAgentLearningStore = vi.fn(() => ({
    insertAgentLesson: vi.fn(),
    listAgentLessons: vi.fn(() => []),
    count: vi.fn(() => 0),
  }));
  const mockCreateWorkforceCostCacheLedgerStore = vi.fn(() => ({
    insertEntry: vi.fn(),
    listEntries: vi.fn(() => []),
    count: vi.fn(() => 0),
  }));
  const mockCreateAgentLoop = vi.fn((config?: { companyAgentAdminAuthorized?: boolean }) => ({
    converse: config?.companyAgentAdminAuthorized ? mockAdminConverse : mockConverse,
  }));
  const mockCreateSessionStore = vi.fn(() => ({
    load: vi.fn(() => null),
    save: vi.fn(),
    delete: vi.fn(),
    listActive: vi.fn(() => []),
  }));
  const mockCreateAutonomyEngine = vi.fn(() => ({
    getCurrentLevel: vi.fn(() => 1),
    setLevel: vi.fn(),
    recordKpi: vi.fn(),
    getKpiHistory: vi.fn(() => []),
    getDegradationEvents: vi.fn(() => []),
    evaluateDegradation: vi.fn(() => null),
    evaluatePromotion: vi.fn(() => ({ recommend: false, to: 1 })),
    canAutoApprove: vi.fn(() => false),
  }));
  const mockBuildSystemPrompt = vi.fn((sellerName: string) => `Prompt for ${sellerName}`);
  const mockEscribanoObserver = vi.fn();
  const mockCreateGraphEngine = vi.fn(() => ({ engine: true }));
  const mockCreateAgentConsensusStore = vi.fn(() => ({
    submitReview: vi.fn(),
    getConsensus: vi.fn(),
    requiresConsensus: vi.fn(() => false),
  }));

  return {
    mockCommand,
    mockOn,
    mockCatch,
    mockSetMyCommands,
    mockStart,
    mockStop,
    mockConverse,
    mockAdminConverse,
    mockCreateStrategyStore,
    mockCreateCompanyAgentStore,
    mockCreateCompanyAgentLearningStore,
    mockCreateWorkforceCostCacheLedgerStore,
    mockCreateSessionStore,
    mockCreateAutonomyEngine,
    mockBuildSystemPrompt,
    mockEscribanoObserver,
    mockCreateGraphEngine,
    mockCreateAgentLoop,
    mockCreateAgentConsensusStore,
  };
});

const mockApi: Partial<Api> = {
  setMyCommands: mocks.mockSetMyCommands,
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
};

const mockBotInstance = {
  command: mocks.mockCommand,
  on: mocks.mockOn,
  catch: mocks.mockCatch,
  api: mockApi,
  start: mocks.mockStart,
  stop: mocks.mockStop,
};

vi.mock("grammy", () => ({
  Bot: vi.fn(() => mockBotInstance),
}));

// Mock agent
vi.mock("@msl/agent", () => ({
  createAgentLoop: mocks.mockCreateAgentLoop,
  buildSystemPrompt: mocks.mockBuildSystemPrompt,
  createStrategyStore: mocks.mockCreateStrategyStore,
  createCompanyAgentStore: mocks.mockCreateCompanyAgentStore,
  createCompanyAgentLearningStore: mocks.mockCreateCompanyAgentLearningStore,
  createWorkforceCostCacheLedgerStore: mocks.mockCreateWorkforceCostCacheLedgerStore,
  createAgentConsensusStore: mocks.mockCreateAgentConsensusStore,
  createSessionStore: mocks.mockCreateSessionStore,
  createAutonomyEngine: mocks.mockCreateAutonomyEngine,
  createProductCatalogStore: vi.fn(() => ({})),
  createAgentMessageBusStore: vi.fn(() => ({})),
  resolveProductLaunchRuntimePath: (
    env: { MSL_PRODUCT_LAUNCH_SQLITE_PATH?: string },
    fallback?: string,
  ) => env.MSL_PRODUCT_LAUNCH_SQLITE_PATH?.trim() || fallback?.trim() || undefined,
  EscribanoObserver: mocks.mockEscribanoObserver,
  OperationalEvidenceProvider: vi.fn(),
  startBackgroundIngestion: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock("@msl/memory", () => ({
  createDatabase: vi.fn(),
  createGraphEngine: mocks.mockCreateGraphEngine,
  createSqliteOperationalReadModel: vi.fn(),
  getSupplierMirrorRuntimeFromEnv: vi.fn(() => null),
}));

// Node.js built-in mocks for photo handler
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("node:crypto", () => ({
  default: {
    randomUUID: vi.fn(() => "test-uuid-1234"),
  },
  randomUUID: vi.fn(() => "test-uuid-1234"),
}));

import { createTelegramBot, createTelegramBotFromEnv } from "./index.js";
import { Bot } from "grammy";
import type { ConversationState } from "@msl/agent";

describe("createTelegramBot (grammY)", () => {
  const config = {
    token: "test-token-123",
    agentConfig: {
      systemPrompt: "Eres un asistente para vendedores de Mercado Libre.",
      mockClient: true,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockConverse.mockClear();
    mocks.mockAdminConverse.mockClear();
  });

  it("creates a bot with start and stop methods", () => {
    const bot = createTelegramBot(config);

    expect(bot).toHaveProperty("start");
    expect(bot).toHaveProperty("stop");
    expect(typeof bot.start).toBe("function");
    expect(typeof bot.stop).toBe("function");
  });

  it("returns a bot object without throwing", () => {
    const bot = createTelegramBot(config);
    expect(bot).toBeDefined();
  });

  it("constructs Bot with token", () => {
    createTelegramBot(config);
    expect(Bot).toHaveBeenCalledWith("test-token-123", undefined);
  });

  it("registers /start command", () => {
    createTelegramBot(config);
    expect(mocks.mockCommand).toHaveBeenCalledWith("start", expect.any(Function));
  });

  it("registers /help command", () => {
    createTelegramBot(config);
    expect(mocks.mockCommand).toHaveBeenCalledWith("help", expect.any(Function));
  });

  it("explains that dale only approves bounded preparation in Phase 1 help copy", async () => {
    createTelegramBot(config);
    const handler = mocks.mockCommand.mock.calls.find(([command]) => command === "help")?.[1] as
      | ((ctx: { reply: (message: string, options?: unknown) => Promise<void> }) => Promise<void>)
      | undefined;
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler!({ reply });

    const message = reply.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/dale/i);
    expect(message).toMatch(/investigación|preparación/i);
    expect(message).toMatch(/no publico|no modifico Mercado Libre|no cobro/i);
    expect(message).toMatch(/lenguaje natural|no necesitás comandos|escribime lo que necesitás/i);
  });

  it("encourages natural conversation from /start instead of command-driven usage", async () => {
    createTelegramBot(config);
    const handler = mocks.mockCommand.mock.calls.find(([command]) => command === "start")?.[1] as
      | ((ctx: {
          from?: { first_name?: string };
          reply: (message: string, options?: unknown) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler!({ from: { first_name: "Sebastián" }, reply });

    const message = reply.mock.calls[0]?.[0] as string;
    expect(message).toMatch(/lenguaje natural/i);
    expect(message).toMatch(/\/help queda como atajo/i);
  });

  it("registers text message handler", () => {
    createTelegramBot(config);
    expect(mocks.mockOn).toHaveBeenCalledWith("message:text", expect.any(Function));
  });

  it("splits long agent responses into Telegram-safe chunks in order", async () => {
    const longResponse = "a".repeat(4100);
    mocks.mockConverse.mockResolvedValueOnce({
      response: longResponse,
      updatedState: {
        messages: [{ role: "assistant", content: longResponse, timestamp: new Date() }],
        contextWindowLimit: 20,
        sessionMetadata: {
          sellerId: "seller-test",
          startedAt: new Date(),
          lastActivityAt: new Date(),
        },
      },
    });
    createTelegramBot(config);
    const handler = mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler!({
      message: { text: "analizá todo" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply,
    });

    const chunks = reply.mock.calls.map(([message]) => message as string);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((chunk) => chunk.length <= 3900)).toBe(true);
    expect(chunks.join("")).toBe(longResponse);
  });

  it("replies with a friendly fallback when agent conversation handling fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.mockConverse.mockRejectedValueOnce(new Error("DeepSeek timeout"));
    createTelegramBot(config);
    const handler = mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler!({
      message: { text: "¿qué pasó con ventas?" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply,
    });

    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/perdón|problema|momento/i));
    spy.mockRestore();
  });

  it("replies with a friendly fallback when the agent returns an empty response", async () => {
    mocks.mockConverse.mockResolvedValueOnce({
      response: "   ",
      updatedState: {
        messages: [],
        contextWindowLimit: 20,
        sessionMetadata: {
          sellerId: "seller-test",
          startedAt: new Date(),
          lastActivityAt: new Date(),
        },
      },
    });
    createTelegramBot(config);
    const handler = mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    const reply = vi.fn().mockResolvedValue(undefined);

    await handler!({
      message: { text: "seguimos" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply,
    });

    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/perdón|problema|momento/i));
  });

  it("registers commands in Telegram UI", () => {
    createTelegramBot(config);
    expect(mocks.mockSetMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ command: "start" }),
        expect.objectContaining({ command: "help" }),
      ]),
    );
  });

  it("keeps Telegram command registration CEO-only without worker-selection commands", () => {
    createTelegramBot(config);

    const registeredCommands = (mocks.mockCommand.mock.calls as Array<[string, unknown]>).map(
      ([command]) => command,
    );
    const setMyCommandsCalls = mocks.mockSetMyCommands.mock.calls as Array<
      [Array<{ command: string }>]
    >;
    const uiCommands = setMyCommandsCalls.flatMap(([commands]) =>
      commands.map(({ command }) => command),
    );

    expect(registeredCommands).toEqual(["start", "help"]);
    expect(uiCommands).toEqual(["start", "help"]);
    expect([...registeredCommands, ...uiCommands]).not.toContain("agent");
    expect([...registeredCommands, ...uiCommands]).not.toContain("seller");
    expect([...registeredCommands, ...uiCommands]).not.toContain("settings");
  });

  it("start calls bot.start", async () => {
    const bot = createTelegramBot(config);
    await bot.start();
    expect(mocks.mockStart).toHaveBeenCalled();
  });

  it("stop calls bot.stop", async () => {
    const bot = createTelegramBot(config);
    await bot.stop();
    expect(mocks.mockStop).toHaveBeenCalled();
  });

  it("accepts optional grammY client options", () => {
    vi.clearAllMocks();
    createTelegramBot({
      ...config,
      client: { environment: "test" },
    });

    expect(Bot).toHaveBeenCalledWith(
      "test-token-123",
      expect.objectContaining({ client: { environment: "test" } }),
    );
  });

  it("loads and saves durable per-seller Telegram session state when a session store is provided", async () => {
    const savedState = {
      messages: [{ role: "user" as const, content: "hola", timestamp: new Date() }],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId: "seller-a",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    };
    const sessionStore = {
      load: vi.fn(() => savedState),
      save: vi.fn(),
      delete: vi.fn(),
      listActive: vi.fn(() => []),
    };
    createTelegramBot({ ...config, sellerId: "seller-a", sessionStore });

    const handler = mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    await handler!({
      message: { text: "¿qué margen tengo?" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(sessionStore.load).toHaveBeenCalledWith("telegram:seller-a:123");
    expect(mocks.mockConverse).toHaveBeenCalledWith("¿qué margen tengo?", savedState);
    const saveCalls = vi.mocked(sessionStore.save).mock.calls;
    const savedConversationState = saveCalls[0]?.[1] as ConversationState | undefined;
    expect(saveCalls[0]?.[0]).toBe("telegram:seller-a:123");
    expect(savedConversationState?.messages).toHaveLength(1);
  });

  it("does not load another seller's durable Telegram state for the same chat", async () => {
    const sellerAState = {
      messages: [{ role: "user" as const, content: "seller-a state", timestamp: new Date() }],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId: "seller-a",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    };
    const sessionStore = {
      load: vi.fn((sessionId: string) =>
        sessionId === "telegram:seller-a:123" ? sellerAState : null,
      ),
      save: vi.fn(),
      delete: vi.fn(),
      listActive: vi.fn(() => []),
    };
    createTelegramBot({ ...config, sellerId: "seller-b", sessionStore });

    const handler = mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    await handler!({
      message: { text: "¿qué margen tengo?" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(sessionStore.load).toHaveBeenCalledWith("telegram:seller-b:123");
    expect(mocks.mockConverse).not.toHaveBeenCalledWith("¿qué margen tengo?", sellerAState);
    const state = mocks.mockConverse.mock.calls[0]?.[1] as ConversationState | undefined;
    expect(state?.sessionMetadata.sellerId).toBe("seller-b");
    expect(state?.messages).toEqual([]);
    expect(sessionStore.save).toHaveBeenCalledWith("telegram:seller-b:123", expect.any(Object));
  });

  it("fails closed when a durable Telegram state has mismatched seller metadata", async () => {
    const mismatchedState = {
      messages: [{ role: "user" as const, content: "seller-a state", timestamp: new Date() }],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId: "seller-a",
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    };
    const sessionStore = {
      load: vi.fn(() => mismatchedState),
      save: vi.fn(),
      delete: vi.fn(),
      listActive: vi.fn(() => []),
    };
    createTelegramBot({ ...config, sellerId: "seller-b", sessionStore });

    const handler = mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    await handler!({
      message: { text: "¿qué margen tengo?" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    const state = mocks.mockConverse.mock.calls[0]?.[1] as ConversationState | undefined;
    expect(state).not.toBe(mismatchedState);
    expect(state?.sessionMetadata.sellerId).toBe("seller-b");
    expect(state?.messages).toEqual([]);
  });

  it("creates env-backed runtime wiring without inventing secrets", () => {
    const bot = createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      MSL_TELEGRAM_CORTEX_SQLITE_PATH: ":memory:",
      MSL_CHAT_SELLER_ID: "seller-a",
      MSL_CHAT_SELLER_NAME: "Maustian",
      DEEPSEEK_API_KEY: "",
    });

    expect(bot).toBeDefined();
    expect(Bot).toHaveBeenCalledWith("test-token-123", undefined);
    expect(mocks.mockCreateSessionStore).toHaveBeenCalled();
    expect(mocks.mockCreateStrategyStore).toHaveBeenCalled();
    expect(mocks.mockCreateCompanyAgentStore).toHaveBeenCalled();
    expect(mocks.mockCreateCompanyAgentLearningStore).toHaveBeenCalled();
    expect(mocks.mockCreateAutonomyEngine).toHaveBeenCalled();
    expect(mocks.mockCreateGraphEngine).toHaveBeenCalledWith(":memory:");
    expect(mocks.mockBuildSystemPrompt).toHaveBeenCalledWith("Maustian");
    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const agentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      companyAgentRegistry?: {
        getCompanyAgent?: unknown;
        listCompanyAgents?: unknown;
      };
      companyAgentAdminAuthorized?: boolean;
      companyAgentLearningStore?: {
        listAgentLessons?: unknown;
      };
    };
    expect(typeof agentConfig.companyAgentRegistry?.getCompanyAgent).toBe("function");
    expect(typeof agentConfig.companyAgentRegistry?.listCompanyAgents).toBe("function");
    expect(typeof agentConfig.companyAgentLearningStore?.listAgentLessons).toBe("function");
    expect(agentConfig.companyAgentAdminAuthorized).toBe(false);
  });

  it("passes company-agent admin authorization only when env enables it with an allowlist", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      MSL_COMPANY_AGENT_ADMIN_ENABLED: "true",
      MSL_TELEGRAM_ADMIN_CHAT_IDS: "123",
      DEEPSEEK_API_KEY: "",
    });

    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const baseAgentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      companyAgentAdminAuthorized?: boolean;
    };
    const adminAgentConfig = createAgentLoopMock.mock.calls[1]?.[0] as {
      companyAgentAdminAuthorized?: boolean;
    };
    expect(baseAgentConfig.companyAgentAdminAuthorized).toBe(false);
    expect(adminAgentConfig.companyAgentAdminAuthorized).toBe(true);
  });

  it("passes configured active company-agent id from env to the agent loop", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID: " agent:pricing-analyst ",
      DEEPSEEK_API_KEY: "",
    });

    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const agentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      activeCompanyAgentId?: string;
      companyAgentAdminAuthorized?: boolean;
    };
    expect(agentConfig.activeCompanyAgentId).toBe("agent:pricing-analyst");
    expect(agentConfig.companyAgentAdminAuthorized).toBe(false);
  });

  it("passes SQLite-backed workforce cost/cache ledger store to the agent loop", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      DEEPSEEK_API_KEY: "",
    });

    expect(mocks.mockCreateWorkforceCostCacheLedgerStore).toHaveBeenCalledTimes(1);
    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const agentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      workforceCostCacheLedgerStore?: unknown;
      companyAgentAdminAuthorized?: boolean;
    };
    expect(agentConfig.workforceCostCacheLedgerStore).toBeDefined();
    expect(agentConfig.companyAgentAdminAuthorized).toBe(false);
  });

  it("does not pass active company-agent id when env is missing", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      DEEPSEEK_API_KEY: "",
    });

    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const agentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      activeCompanyAgentId?: string;
      companyAgentAdminAuthorized?: boolean;
    };
    expect(agentConfig).not.toHaveProperty("activeCompanyAgentId");
    expect(agentConfig.companyAgentAdminAuthorized).toBe(false);
  });

  it("does not pass active company-agent id when env is whitespace only", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID: "   \t\n  ",
      DEEPSEEK_API_KEY: "",
    });

    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const agentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      activeCompanyAgentId?: string;
      companyAgentAdminAuthorized?: boolean;
    };
    expect(agentConfig).not.toHaveProperty("activeCompanyAgentId");
    expect(agentConfig.companyAgentAdminAuthorized).toBe(false);
  });

  it("keeps active company-agent identity separate from Telegram admin authorization", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_SQLITE_PATH: ":memory:",
      MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID: "agent:pricing-analyst",
      MSL_COMPANY_AGENT_ADMIN_ENABLED: "true",
      MSL_TELEGRAM_ADMIN_CHAT_IDS: "123",
      DEEPSEEK_API_KEY: "",
    });

    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const baseAgentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      activeCompanyAgentId?: string;
      companyAgentAdminAuthorized?: boolean;
    };
    const adminAgentConfig = createAgentLoopMock.mock.calls[1]?.[0] as {
      activeCompanyAgentId?: string;
      companyAgentAdminAuthorized?: boolean;
    };
    expect(baseAgentConfig.activeCompanyAgentId).toBe("agent:pricing-analyst");
    expect(baseAgentConfig.companyAgentAdminAuthorized).toBe(false);
    expect(adminAgentConfig.activeCompanyAgentId).toBe("agent:pricing-analyst");
    expect(adminAgentConfig.companyAgentAdminAuthorized).toBe(true);
  });

  it("routes non-admin Telegram messages through the non-admin agent loop", async () => {
    createTelegramBot({
      ...config,
      adminAuthorization: {
        enabled: true,
        allowedChatIds: ["999"],
        allowedUserIds: ["888"],
      },
    });

    const handler = mocks.mockOn.mock.calls.find((call) => call[0] === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from?: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    await handler!({
      message: { text: "registrá esta lección" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(mocks.mockConverse).toHaveBeenCalledWith("registrá esta lección", expect.any(Object));
    expect(mocks.mockAdminConverse).not.toHaveBeenCalled();
  });

  it("routes allowed Telegram admin chats through the admin agent loop", async () => {
    createTelegramBot({
      ...config,
      adminAuthorization: {
        enabled: true,
        allowedChatIds: ["123"],
      },
    });

    const handler = mocks.mockOn.mock.calls.find((call) => call[0] === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from?: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;

    await handler!({
      message: { text: "registrá esta lección" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(mocks.mockAdminConverse).toHaveBeenCalledWith(
      "registrá esta lección",
      expect.any(Object),
    );
  });

  it("derives a seller-scoped Telegram Cortex path by default", () => {
    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_TELEGRAM_CORTEX_SQLITE_PATH: "/tmp/msl/cortex.sqlite",
      MSL_CHAT_SELLER_ID: "seller:a",
      DEEPSEEK_API_KEY: "",
    });

    expect(mocks.mockCreateGraphEngine).toHaveBeenCalledWith(
      "/tmp/msl/cortex.telegram-seller_a.sqlite",
    );
  });

  it("fails closed when env runtime has no Telegram token", () => {
    expect(() => createTelegramBotFromEnv({ BOT_TOKEN: "" })).toThrow(
      "BOT_TOKEN is required to start the Telegram bot.",
    );
  });

  it("warns when legacy MERCADOLIBRE_ACCESS_TOKEN is set without OAuth DB path", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

    createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MERCADOLIBRE_ACCESS_TOKEN: "APP_USR-12345-old-token",
      MSL_MERCADOLIBRE_OAUTH_DB_PATH: "",
      DEEPSEEK_API_KEY: "",
    });

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Legacy MERCADOLIBRE_ACCESS_TOKEN is set but MSL_MERCADOLIBRE_OAUTH_DB_PATH is not",
      ),
    );

    spy.mockRestore();
  });

  it("creates demo/mock bot when OAuth is not configured", () => {
    vi.clearAllMocks();
    const bot = createTelegramBotFromEnv({
      BOT_TOKEN: "test-token-123",
      MSL_MERCADOLIBRE_OAUTH_DB_PATH: "",
      DEEPSEEK_API_KEY: "",
    });

    expect(bot).toBeDefined();
    expect(Bot).toHaveBeenCalledWith("test-token-123", undefined);

    // Verifies no OAuth client was created (mockClient stays true)
    const createAgentLoopMock = mocks.mockCreateAgentLoop as unknown as {
      mock: { calls: Array<[unknown]> };
    };
    const agentConfig = createAgentLoopMock.mock.calls[0]?.[0] as {
      mockClient?: boolean;
    };
    expect(agentConfig.mockClient).toBe(true);

    // Verifies the system prompt falls back to base (no multi-seller block)
    expect(mocks.mockBuildSystemPrompt).toHaveBeenCalledWith("Plasticov");
  });
});

// ── Photo Handler (Product Launch) ───────────────────────────────

describe("message:photo handler (product launch)", () => {
  const mockUpsertProduct = vi.fn();
  const mockCreateLaunch = vi.fn();
  const mockBusEnqueue = vi.fn().mockReturnValue({ messageId: "bus-msg-1" });
  const mockGetFile = vi.fn();
  const mockReply = vi.fn().mockResolvedValue(undefined);

  const productCatalogStore = {
    upsertProduct: mockUpsertProduct,
    createLaunch: mockCreateLaunch,
    getProduct: vi.fn(),
    upsertImage: vi.fn(),
    getImages: vi.fn(),
    getLaunch: vi.fn(),
    updateLaunchStatus: vi.fn(),
    getLaunchesByProduct: vi.fn(),
    getLaunchForSeller: vi.fn(),
    transitionLaunchStatus: vi.fn(),
    updateLaunchDetails: vi.fn(),
    recordLaunchCost: vi.fn().mockReturnValue({ recorded: true, totalUsd: 0 }),
    getPendingLaunchByChatId: vi.fn().mockReturnValue(undefined),
  };

  const messageBus = {
    enqueue: mockBusEnqueue,
    claimNext: vi.fn().mockReturnValue([]),
    resolve: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    lookupRecentByDedupePrefix: vi.fn().mockReturnValue([]),
    getFailedMessages: vi.fn().mockReturnValue([]),
    reenqueueFailed: vi.fn(),
    getProcessingStuck: vi.fn().mockReturnValue([]),
    getPendingCount: vi.fn().mockReturnValue(0),
    getMessagesByCorrelationId: vi.fn().mockReturnValue([]),
    getLearningHistory: vi.fn().mockReturnValue([]),
    recordOutcome: vi.fn(),
    getUnscoredMessages: vi.fn().mockReturnValue([]),
    defer: vi.fn().mockReturnValue({}),
    resumeDeferred: vi.fn().mockReturnValue({}),
    settle: vi.fn().mockReturnValue({}),
    getExpiredDeferrals: vi.fn().mockReturnValue({ messages: [], queryAsOf: "", nextCursor: null }),
  };

  const photoConfig = {
    token: "test-token-photo",
    agentConfig: {
      systemPrompt: "test",
      mockClient: true,
    },
    productLaunchEnabled: true,
    sellerId: "seller-target",
    adminAuthorization: { enabled: true, allowedChatIds: ["123456"] },
    productCatalogStore,
    messageBus,
  };

  function getPhotoHandler() {
    const calls = mocks.mockOn.mock.calls as Array<[string, (...args: unknown[]) => unknown]>;
    const photoCall = calls.find(([event]) => event === "message:photo");
    return photoCall?.[1];
  }

  function makePhotoCtx(overrides: Record<string, unknown> = {}) {
    const base = {
      message: {
        photo: [
          { file_id: "small-photo-id", width: 100, height: 100 },
          { file_id: "large-photo-id", width: 800, height: 600 },
        ],
        caption: undefined as string | undefined,
      },
      chat: { id: 123456 },
      api: { getFile: mockGetFile },
      reply: mockReply,
    };

    // Deep-merge overrides into base
    const merged = { ...base, ...overrides };
    if (overrides.message) {
      merged.message = { ...base.message, ...(overrides.message as Record<string, unknown>) };
    }
    if (overrides.chat) {
      merged.chat = { ...base.chat, ...(overrides.chat as Record<string, unknown>) };
    }
    if (overrides.api) {
      merged.api = { ...base.api, ...(overrides.api as Record<string, unknown>) };
    }
    return merged;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFile.mockResolvedValue({ file_path: "photos/file_1.jpg" });
    const mockResponse = {
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));
    mockBusEnqueue.mockReturnValue({ messageId: "bus-msg-1" });
    productCatalogStore.getPendingLaunchByChatId.mockReturnValue(undefined);
  });

  it("registers a message:photo handler when product launch is enabled", () => {
    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();
    expect(handler).toBeDefined();
    expect(typeof handler).toBe("function");
  });

  it("rejects a photo from a requester outside the admin allowlist", async () => {
    createTelegramBot({
      ...photoConfig,
      adminAuthorization: { enabled: true, allowedChatIds: ["999999"] },
    });

    await getPhotoHandler()!(makePhotoCtx());

    expect(mockGetFile).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockUpsertProduct).not.toHaveBeenCalled();
    expect(mockCreateLaunch).not.toHaveBeenCalled();
    expect(mockBusEnqueue).not.toHaveBeenCalled();
  });

  it("rejects a photo when admin authorization is not configured", async () => {
    const { adminAuthorization: _authorization, ...unconfigured } = photoConfig;
    createTelegramBot(unconfigured);

    await getPhotoHandler()!(makePhotoCtx());

    expect(mockGetFile).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockUpsertProduct).not.toHaveBeenCalled();
    expect(mockCreateLaunch).not.toHaveBeenCalled();
    expect(mockBusEnqueue).not.toHaveBeenCalled();
  });

  it("downloads photo, saves, creates launch, and enqueues on the bus", async () => {
    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();
    const ctx = makePhotoCtx();

    await handler!(ctx);

    // Verify Telegram getFile was called with the largest photo
    expect(mockGetFile).toHaveBeenCalledWith("large-photo-id");

    // Verify fetch was called with the bot token URL
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/file/bottest-token-photo/photos/file_1.jpg"),
    );

    // Verify catalog store calls
    expect(mockUpsertProduct).toHaveBeenCalledWith({ productId: "test-uuid-1234" });
    expect(mockCreateLaunch).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "photo_received",
        productId: "test-uuid-1234",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        sellerId: expect.any(String),
      }),
    );

    // Verify message bus enqueue
    expect(mockBusEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        senderAgentId: "telegram-bot",
        receiverAgentId: "product-launch",
        messageType: "launch_request",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        correlationId: expect.any(String),
      }),
    );

    // Verify reply to CEO
    expect(mockReply).toHaveBeenCalledWith(expect.stringContaining("📸"));
  });

  it("uses caption as title hint when present", async () => {
    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();
    const ctx = makePhotoCtx({ message: { caption: "Zapatillas Nike Air Max" } });

    await handler!(ctx);

    // Verify createLaunch includes the caption as title
    expect(mockCreateLaunch).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Zapatillas Nike Air Max" }),
    );
  });

  it("attaches a follow-up photo to the pending launch for the same seller", async () => {
    productCatalogStore.getPendingLaunchByChatId.mockReturnValue({
      launchId: "pending-launch",
      productId: "pending-product",
      sellerId: "seller-target",
      status: "recognizing",
      createdAt: new Date().toISOString(),
    });
    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();

    await handler!(makePhotoCtx());

    expect(productCatalogStore.getPendingLaunchByChatId).toHaveBeenCalledWith(
      "123456",
      "seller-target",
    );
    expect(productCatalogStore.upsertImage).toHaveBeenCalledWith(
      expect.objectContaining({ productId: "pending-product", source: "ceo_telegram" }),
    );
    expect(mockBusEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: "additional_photo",
        sellerId: "seller-target",
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        payloadJson: expect.stringContaining('"imageUrls"'),
      }),
    );
    expect(mockCreateLaunch).not.toHaveBeenCalled();
  });

  it("works without caption (omits title field)", async () => {
    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();
    const ctx = makePhotoCtx();

    await handler!(ctx);

    // Verify createLaunch was called
    expect(mockCreateLaunch).toHaveBeenCalledTimes(1);
    // Verify it does NOT include a title field
    const createCall = mockCreateLaunch.mock.calls[0]![0] as Record<string, unknown>;
    expect(createCall).toBeDefined();
    expect(createCall).not.toHaveProperty("title");
  });

  it("replies with error when photo download fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failedResponse = {
      ok: false,
      status: 404,
      arrayBuffer: vi.fn(),
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(failedResponse));

    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();
    const ctx = makePhotoCtx();

    await handler!(ctx);

    expect(mockReply).toHaveBeenCalledWith(expect.stringContaining("❌"));
    expect(mockBusEnqueue).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("replies with error when getFile returns no file_path", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetFile.mockResolvedValue({ file_path: undefined });

    createTelegramBot(photoConfig);
    const handler = getPhotoHandler();
    const ctx = makePhotoCtx();

    await handler!(ctx);

    expect(mockReply).toHaveBeenCalledWith(expect.stringContaining("❌"));
    expect(mockBusEnqueue).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("does nothing when productLaunchEnabled is false", () => {
    createTelegramBot({ ...photoConfig, productLaunchEnabled: false });
    const handler = getPhotoHandler();

    // Handler should be registered but should return early without doing anything
    expect(handler).toBeDefined();
  });

  it("does nothing when productLaunchEnabled is unset (default false)", () => {
    const defaultConfig = {
      token: "test-token-no-launch",
      agentConfig: { systemPrompt: "test", mockClient: true },
    };
    createTelegramBot(defaultConfig);
    const handler = getPhotoHandler();

    // Handler registered (bot.on always runs) but will return early
    expect(handler).toBeDefined();
  });
});
