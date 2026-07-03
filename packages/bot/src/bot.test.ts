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
  const activeAgent = {
    id: "agent:pricing-analyst",
    source: "ceo-created" as const,
    status: "active" as const,
    durableReady: true as const,
    profile: {
      agentId: "agent:pricing-analyst",
      label: "Pricing Analyst",
      departmentId: "commercial" as const,
      stablePrefix: "Pricing Analyst",
      refreshableContextProvider: "pricing",
      inputs: [],
      outputs: [],
      requiredEvidenceKinds: [],
      boundaries: [],
      noMutationBoundary: true as const,
    },
  };
  const envFallbackAgent = {
    ...activeAgent,
    id: "agent:env-fallback",
    profile: {
      ...activeAgent.profile,
      agentId: "agent:env-fallback",
      label: "Env Fallback Agent",
      stablePrefix: "Env Fallback Agent",
    },
  };
  const archivedAgent = { ...activeAgent, id: "agent:archived", status: "archived" as const };
  const config = {
    token: "test-token-123",
    agentConfig: {
      systemPrompt: "Eres un asistente para vendedores de Mercado Libre.",
      mockClient: true,
      activeCompanyAgentId: "agent:env-fallback",
      companyAgentRegistry: {
        getCompanyAgent: vi.fn((id: string) =>
          id === envFallbackAgent.id ? envFallbackAgent : undefined,
        ),
        listCompanyAgents: vi.fn(() => [envFallbackAgent]),
      },
    },
  };

  function getCommandHandler(command: string) {
    return mocks.mockCommand.mock.calls.find(
      ([registeredCommand]) => registeredCommand === command,
    )?.[1] as
      | ((ctx: {
          message?: { text: string };
          chat: { id: number };
          from?: { id: number; first_name?: string };
          reply: (message: string, options?: unknown) => Promise<void>;
        }) => Promise<void>)
      | undefined;
  }

  function getTextHandler() {
    return mocks.mockOn.mock.calls.find(([event]) => event === "message:text")?.[1] as
      | ((ctx: {
          message: { text: string };
          chat: { id: number };
          from?: { id: number };
          replyWithChatAction: (action: string) => Promise<void>;
          reply: (message: string) => Promise<void>;
        }) => Promise<void>)
      | undefined;
  }

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

  it("registers /agent command", () => {
    createTelegramBot(config);
    expect(mocks.mockCommand).toHaveBeenCalledWith("agent", expect.any(Function));
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
  });

  it("registers text message handler", () => {
    createTelegramBot(config);
    expect(mocks.mockOn).toHaveBeenCalledWith("message:text", expect.any(Function));
  });

  it("registers commands in Telegram UI", () => {
    createTelegramBot(config);
    expect(mocks.mockSetMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ command: "start" }),
        expect.objectContaining({ command: "help" }),
        expect.objectContaining({ command: "agent" }),
      ]),
    );
  });

  it("rejects /agent use from non-admin chats", async () => {
    createTelegramBot({
      ...config,
      agentConfig: {
        ...config.agentConfig,
        companyAgentRegistry: {
          getCompanyAgent: vi.fn(),
          listCompanyAgents: vi.fn(() => [activeAgent]),
        },
      },
      adminAuthorization: { enabled: true, allowedChatIds: ["999"] },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      from: { id: 456 },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/Only an authorized Telegram admin/));
  });

  it("rejects /agent use when registry is missing, unknown, inactive, or archived", async () => {
    const adminAuthorization = { enabled: true, allowedChatIds: ["123"] };
    const missingRegistryReply = vi.fn().mockResolvedValue(undefined);
    createTelegramBot({
      token: "test-token-123",
      agentConfig: { mockClient: true },
      adminAuthorization,
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      reply: missingRegistryReply,
    });
    expect(missingRegistryReply).toHaveBeenCalledWith(expect.stringMatching(/No durable/));

    vi.clearAllMocks();
    const getCompanyAgent = vi.fn((id: string) =>
      id === "agent:archived" ? archivedAgent : undefined,
    );
    const reply = vi.fn().mockResolvedValue(undefined);
    createTelegramBot({
      ...config,
      agentConfig: {
        ...config.agentConfig,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization,
    });

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:unknown" },
      chat: { id: 123 },
      reply,
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:archived" },
      chat: { id: 123 },
      reply,
    });

    expect(reply).toHaveBeenCalledTimes(2);
    expect(reply).toHaveBeenCalledWith(expect.stringMatching(/Unknown or inactive/));
  });

  it("stores /agent use selection for an authorized chat", async () => {
    const getCompanyAgent = vi.fn(() => activeAgent);
    createTelegramBot({
      ...config,
      agentConfig: {
        ...config.agentConfig,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization: { enabled: true, allowedChatIds: ["123"] },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      reply,
    });

    expect(reply).toHaveBeenCalledWith(
      expect.stringMatching(/Selected active company agent: agent:pricing-analyst/),
    );
  });

  it("fails closed for normal text without a selected agent or env fallback", async () => {
    createTelegramBot({ token: "test-token-123", agentConfig: { mockClient: true } });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      from: { id: 456 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply,
    });

    expect(mocks.mockConverse).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringMatching(/No active company agent is selected/),
    );
  });

  it("routes normal text with the selected active agent id", async () => {
    const getCompanyAgent = vi.fn(() => activeAgent);
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization: { enabled: true, allowedUserIds: ["1"] },
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    });

    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      from: { id: 2 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    const selectedConfig = mocks.mockCreateAgentLoop.mock.calls.at(-1)?.[0] as {
      activeCompanyAgentId?: string;
    };
    expect(selectedConfig.activeCompanyAgentId).toBe("agent:pricing-analyst");
    expect(mocks.mockConverse).toHaveBeenCalledWith("hola", expect.any(Object));
  });

  it("lets /agent use override the process-level active company-agent fallback", async () => {
    const getCompanyAgent = vi.fn((id: string) =>
      id === activeAgent.id
        ? activeAgent
        : id === envFallbackAgent.id
          ? envFallbackAgent
          : undefined,
    );
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        activeCompanyAgentId: envFallbackAgent.id,
        companyAgentRegistry: {
          getCompanyAgent,
          listCompanyAgents: vi.fn(() => [envFallbackAgent, activeAgent]),
        },
      },
      adminAuthorization: { enabled: true, allowedChatIds: ["123"] },
    });

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    const selectedConfig = mocks.mockCreateAgentLoop.mock.calls.at(-1)?.[0] as {
      activeCompanyAgentId?: string;
    };
    expect(selectedConfig.activeCompanyAgentId).toBe(activeAgent.id);
    expect(selectedConfig.activeCompanyAgentId).not.toBe(envFallbackAgent.id);
  });

  it("falls back to a valid process-level active company-agent after /agent clear", async () => {
    const getCompanyAgent = vi.fn((id: string) =>
      id === activeAgent.id
        ? activeAgent
        : id === envFallbackAgent.id
          ? envFallbackAgent
          : undefined,
    );
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        activeCompanyAgentId: envFallbackAgent.id,
        companyAgentRegistry: {
          getCompanyAgent,
          listCompanyAgents: vi.fn(() => [envFallbackAgent, activeAgent]),
        },
      },
      adminAuthorization: { enabled: true, allowedUserIds: ["1"] },
    });

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent clear" },
      chat: { id: 123 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      from: { id: 2 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(mocks.mockConverse).toHaveBeenCalledWith("hola", expect.any(Object));
    const baseAgentConfig = mocks.mockCreateAgentLoop.mock.calls[0]?.[0] as {
      activeCompanyAgentId?: string;
    };
    expect(baseAgentConfig.activeCompanyAgentId).toBe(envFallbackAgent.id);
  });

  it("fails closed when the process-level active company-agent is missing or inactive", async () => {
    const getCompanyAgent = vi.fn((id: string) =>
      id === archivedAgent.id ? archivedAgent : undefined,
    );
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        activeCompanyAgentId: archivedAgent.id,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [archivedAgent]) },
      },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply,
    });

    expect(mocks.mockConverse).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.stringMatching(/No active company agent is selected/),
    );
  });

  it("isolates selected-agent loop cache by chat and keeps unselected chats fail-closed", async () => {
    const getCompanyAgent = vi.fn((id: string) =>
      id === activeAgent.id ? activeAgent : undefined,
    );
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization: { enabled: true, allowedUserIds: ["1"] },
    });

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    await getTextHandler()!({
      message: { text: "chat a" },
      chat: { id: 123 },
      from: { id: 2 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    const chatBReply = vi.fn().mockResolvedValue(undefined);
    await getTextHandler()!({
      message: { text: "chat b before selection" },
      chat: { id: 456 },
      from: { id: 2 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: chatBReply,
    });

    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 456 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    await getTextHandler()!({
      message: { text: "chat b after selection" },
      chat: { id: 456 },
      from: { id: 2 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(chatBReply).toHaveBeenCalledWith(
      expect.stringMatching(/No active company agent is selected/),
    );
    const selectedLoopCreations = mocks.mockCreateAgentLoop.mock.calls.filter(
      ([loopConfig]) =>
        (loopConfig as { activeCompanyAgentId?: string }).activeCompanyAgentId === activeAgent.id,
    );
    expect(selectedLoopCreations).toHaveLength(2);
    expect(mocks.mockConverse).toHaveBeenCalledWith("chat a", expect.any(Object));
    expect(mocks.mockConverse).toHaveBeenCalledWith("chat b after selection", expect.any(Object));
    expect(mocks.mockConverse).not.toHaveBeenCalledWith(
      "chat b before selection",
      expect.any(Object),
    );
  });

  it("does not grant admin tools to non-admin users with a selected identity", async () => {
    const getCompanyAgent = vi.fn(() => activeAgent);
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization: { enabled: true, allowedUserIds: ["1"] },
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      from: { id: 1 },
      reply: vi.fn().mockResolvedValue(undefined),
    });

    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      from: { id: 2 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    });

    expect(mocks.mockConverse).toHaveBeenCalledWith("hola", expect.any(Object));
    expect(mocks.mockAdminConverse).not.toHaveBeenCalled();
  });

  it("clears /agent selection and falls back to fail-closed normal text", async () => {
    const getCompanyAgent = vi.fn(() => activeAgent);
    createTelegramBot({
      token: "test-token-123",
      agentConfig: {
        mockClient: true,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization: { enabled: true, allowedChatIds: ["123"] },
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent clear" },
      chat: { id: 123 },
      reply: vi.fn().mockResolvedValue(undefined),
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getTextHandler()!({
      message: { text: "hola" },
      chat: { id: 123 },
      replyWithChatAction: vi.fn().mockResolvedValue(undefined),
      reply,
    });

    expect(reply).toHaveBeenCalledWith(
      expect.stringMatching(/No active company agent is selected/),
    );
  });

  it("reports /agent status as selected or none", async () => {
    const getCompanyAgent = vi.fn(() => activeAgent);
    createTelegramBot({
      ...config,
      agentConfig: {
        ...config.agentConfig,
        companyAgentRegistry: { getCompanyAgent, listCompanyAgents: vi.fn(() => [activeAgent]) },
      },
      adminAuthorization: { enabled: true, allowedChatIds: ["123"] },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getCommandHandler("agent")!({
      message: { text: "/agent status" },
      chat: { id: 123 },
      reply,
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent use agent:pricing-analyst" },
      chat: { id: 123 },
      reply,
    });
    await getCommandHandler("agent")!({
      message: { text: "/agent status" },
      chat: { id: 123 },
      reply,
    });

    expect(reply.mock.calls[0]?.[0]).toMatch(/No active company agent selected/);
    expect(reply.mock.calls[2]?.[0]).toMatch(
      /Selected active company agent: agent:pricing-analyst/,
    );
  });

  it("lists active durable registry agents only", async () => {
    createTelegramBot({
      ...config,
      agentConfig: {
        ...config.agentConfig,
        companyAgentRegistry: {
          getCompanyAgent: vi.fn(),
          listCompanyAgents: vi.fn(() => [activeAgent, archivedAgent]),
        },
      },
    });
    const reply = vi.fn().mockResolvedValue(undefined);

    await getCommandHandler("agent")!({
      message: { text: "/agent list" },
      chat: { id: 123 },
      reply,
    });

    expect(reply.mock.calls[0]?.[0]).toContain("agent:pricing-analyst");
    expect(reply.mock.calls[0]?.[0]).not.toContain("agent:archived");
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
});
