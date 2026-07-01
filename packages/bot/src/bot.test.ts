import { describe, expect, it, vi, beforeEach } from "vitest";

// We import grammy normally but vitest mocks it
import type { Api } from "grammy";

// Mock grammY
const mockCommand = vi.fn().mockReturnThis();
const mockOn = vi.fn().mockReturnThis();
const mockCatch = vi.fn().mockReturnThis();
const mockSetMyCommands = vi.fn().mockResolvedValue(undefined);
const mockStart = vi.fn().mockResolvedValue(undefined);
const mockStop = vi.fn().mockResolvedValue(undefined);

const mockApi: Partial<Api> = {
  setMyCommands: mockSetMyCommands,
  sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
};

const mockBotInstance = {
  command: mockCommand,
  on: mockOn,
  catch: mockCatch,
  api: mockApi,
  start: mockStart,
  stop: mockStop,
};

vi.mock("grammy", () => ({
  Bot: vi.fn(() => mockBotInstance),
}));

// Mock agent
vi.mock("@msl/agent", () => ({
  createAgentLoop: vi.fn(() => ({
    converse: vi.fn().mockResolvedValue({
      response: "Hola, tu margen actual es del 35%.",
    }),
  })),
}));

import { createTelegramBot } from "./index.js";
import { Bot } from "grammy";

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
    expect(mockCommand).toHaveBeenCalledWith("start", expect.any(Function));
  });

  it("registers /help command", () => {
    createTelegramBot(config);
    expect(mockCommand).toHaveBeenCalledWith("help", expect.any(Function));
  });

  it("registers text message handler", () => {
    createTelegramBot(config);
    expect(mockOn).toHaveBeenCalledWith("message:text", expect.any(Function));
  });

  it("registers commands in Telegram UI", () => {
    createTelegramBot(config);
    expect(mockSetMyCommands).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ command: "start" }),
        expect.objectContaining({ command: "help" }),
      ]),
    );
  });

  it("start calls bot.start", async () => {
    const bot = createTelegramBot(config);
    await bot.start();
    expect(mockStart).toHaveBeenCalled();
  });

  it("stop calls bot.stop", async () => {
    const bot = createTelegramBot(config);
    await bot.stop();
    expect(mockStop).toHaveBeenCalled();
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
});
