import { createAgentLoop } from "@msl/agent";

export type BotConfig = {
  token: string; // Telegram bot token from @BotFather
  agentConfig: Parameters<typeof createAgentLoop>[0];
};

export function createTelegramBot(config: BotConfig) {
  // Stub implementation — ready for real token
  // Will connect to Telegram API, forward messages to agent, send responses back
  return {
    start: () => console.log("🤖 Bot iniciado (stub — necesita token real)"),
    stop: () => console.log("Bot detenido"),
    handleMessage: async (text: string, chatId: string) => {
      const agent = createAgentLoop(config.agentConfig);
      const result = await agent.converse(text, {
        messages: [],
        contextWindowLimit: 20,
        sessionMetadata: {
          sellerId: chatId,
          startedAt: new Date(),
          lastActivityAt: new Date(),
        },
      });
      return { chatId, response: result.response };
    },
  };
}
