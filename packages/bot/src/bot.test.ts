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
    evaluateDegradation: vi.fn(() => null),
    evaluatePromotion: vi.fn(() => ({ recommend: false, to: 1 })),
    canAutoApprove: vi.fn(() => false),
  }));
  const mockBuildSystemPrompt = vi.fn((sellerName: string) => `Prompt for ${sellerName}`);
  const mockEscribanoObserver = vi.fn();
  const mockCreateGraphEngine = vi.fn(() => ({ engine: true }));

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
  createSessionStore: mocks.mockCreateSessionStore,
  createAutonomyEngine: mocks.mockCreateAutonomyEngine,
  EscribanoObserver: mocks.mockEscribanoObserver,
  OperationalEvidenceProvider: vi.fn(),
  startBackgroundIngestion: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock("@msl/memory", () => ({
  createDatabase: vi.fn(),
  createGraphEngine: mocks.mockCreateGraphEngine,
  createSqliteOperationalReadModel: vi.fn(),
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
