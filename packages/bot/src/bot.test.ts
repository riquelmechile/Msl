import { describe, expect, it } from "vitest";

import { createTelegramBot } from "./index.js";

describe("createTelegramBot", () => {
  const config = {
    token: "test-token-123",
    agentConfig: {
      systemPrompt: "Eres un asistente para vendedores de Mercado Libre.",
      mockClient: true,
    },
  };

  it("creates a bot with start and stop methods", () => {
    const bot = createTelegramBot(config);

    expect(bot).toHaveProperty("start");
    expect(bot).toHaveProperty("stop");
    expect(bot).toHaveProperty("handleMessage");

    expect(typeof bot.start).toBe("function");
    expect(typeof bot.stop).toBe("function");
    expect(typeof bot.handleMessage).toBe("function");
  });

  it("returns a bot object without throwing", () => {
    const bot = createTelegramBot(config);
    expect(bot).toBeDefined();
  });

  it("handleMessage returns a response with chatId and response text", async () => {
    const bot = createTelegramBot(config);
    const result = await bot.handleMessage("¿Cuál es mi margen actual?", "chat-42");

    expect(result).toHaveProperty("chatId", "chat-42");
    expect(result).toHaveProperty("response");
    expect(typeof result.response).toBe("string");
    expect(result.response.length).toBeGreaterThan(0);
  });
});
