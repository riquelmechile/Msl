import { Bot } from "grammy";
import type { ApiClientOptions } from "grammy";
import { createAgentLoop, type AgentLoopConfig } from "@msl/agent";

export type BotConfig = {
  token: string;
  agentConfig: Omit<AgentLoopConfig, "systemPrompt"> & {
    systemPrompt?: string;
  };
  /** Optional grammY client options (e.g. for test/stub mode). */
  client?: ApiClientOptions;
};

export type TelegramBot = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

/**
 * Creates a real Telegram bot backed by grammY + the MSL agent loop.
 *
 * The bot uses long polling and connects every incoming
 * text message to `agent.converse()`.
 *
 * Required environment or config:
 * - `BOT_TOKEN` (or `config.token`) — from @BotFather
 *
 * ## Commands
 *
 * | Command   | Behavior                           |
 * |-----------|------------------------------------|
 * | `/start`  | Greeting + agent identity          |
 * | `/help`   | Available topics                   |
 * | any text  | Routed through agentLoop.converse()|
 */
export function createTelegramBot(config: BotConfig): TelegramBot {
  const bot = new Bot(config.token, config.client ? { client: config.client } : undefined);

  const agentConfig: AgentLoopConfig = {
    systemPrompt:
      config.agentConfig.systemPrompt ?? "Eres un asistente para vendedores de Mercado Libre.",
    ...config.agentConfig,
  };

  // ── Commands ───────────────────────────────────────────

  bot.command("start", async (ctx) => {
    const name = ctx.from?.first_name ?? "vendedor";
    await ctx.reply(
      `¡Hola ${name}! Soy el asistente de MSL para Mercado Libre Chile 🇨🇱.\n\n` +
        `Puedo ayudarte con estrategias, precios, stock, análisis de catálogo y más.\n` +
        `Escribime lo que necesites o usá /help para ver qué puedo hacer.`,
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      `📋 *Temas en los que puedo ayudarte:*\n\n` +
        `• Estrategias de margen y precios\n` +
        `• Stock y control de inventario\n` +
        `• Análisis de catálogo\n` +
        `• Competidores y tendencias\n` +
        `• Historial de ventas\n\n` +
        `Simplemente escribime lo que necesitás, por ejemplo:\n` +
        `_"¿qué margen tengo en zapatillas?"_\n` +
        `_"analizá mi stock actual"_\n\n` +
        `Usá /start para volver al inicio.`,
      { parse_mode: "Markdown" },
    );
  });

  // ── Register commands in Telegram UI ────────────────────

  void bot.api.setMyCommands([
    { command: "start", description: "Iniciar el bot" },
    { command: "help", description: "Ver temas disponibles" },
  ]);

  // ── Message handler ─────────────────────────────────────

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const chatId = String(ctx.chat.id);
    const sellerId = String(ctx.from?.id ?? chatId);

    // Typing indicator
    await ctx.replyWithChatAction("typing");

    // Create agent with session-scoped metadata
    const agent = createAgentLoop(agentConfig);
    const result = await agent.converse(text, {
      messages: [],
      contextWindowLimit: 20,
      sessionMetadata: {
        sellerId,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      },
    });

    await ctx.reply(result.response);
  });

  // ── Error handler ───────────────────────────────────────

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    if (e instanceof Error) {
      console.error(e.message);
    }
  });

  // ── Lifecycle ───────────────────────────────────────────

  return {
    async start(): Promise<void> {
      // Set commands visible in Telegram UI
      await bot.api.setMyCommands([
        { command: "start", description: "Iniciar el bot" },
        { command: "help", description: "Ver temas disponibles" },
      ]);

      console.log("🤖 Bot iniciado (grammY long polling)");
      await bot.start({
        onStart: () => console.log("✅ Bot conectado a Telegram"),
      });
    },

    async stop(): Promise<void> {
      await bot.stop();
      console.log("🛑 Bot detenido");
    },
  };
}
