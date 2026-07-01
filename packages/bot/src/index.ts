import { Bot } from "grammy";
import type { ApiClientOptions } from "grammy";
import Database from "better-sqlite3";
import path from "node:path";
import {
  buildSystemPrompt,
  createAgentLoop,
  createAutonomyEngine,
  createSessionStore,
  createStrategyStore,
  EscribanoObserver,
  type AgentLoopConfig,
  type ConversationState,
  type SessionStore,
} from "@msl/agent";
import { createGraphEngine } from "@msl/memory";
import {
  createMlcApiClient,
  createMercadoLibreApiFetchTransport,
  type OAuthTokenState,
} from "@msl/mercadolibre";

export type BotConfig = {
  token: string;
  agentConfig: Omit<AgentLoopConfig, "systemPrompt"> & {
    systemPrompt?: string;
  };
  /** Optional durable per-chat session storage. Defaults to in-memory per message. */
  sessionStore?: SessionStore;
  /** Seller id stored in Telegram conversation metadata. */
  sellerId?: string;
  /** Agent context window for newly-created Telegram chat sessions. */
  contextWindowLimit?: number;
  /** Optional cleanup hook for env-backed resources. */
  cleanup?: () => void;
  /** Optional grammY client options (e.g. for test/stub mode). */
  client?: ApiClientOptions;
};

export type TelegramBot = {
  start(): Promise<void>;
  stop(): Promise<void>;
};

export type TelegramBotEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | "BOT_TOKEN"
    | "DEEPSEEK_API_KEY"
    | "MSL_TELEGRAM_SQLITE_PATH"
    | "MSL_TELEGRAM_CORTEX_SQLITE_PATH"
    | "MSL_CORTEX_SQLITE_PATH"
    | "MSL_CHAT_SELLER_ID"
    | "MSL_CHAT_SELLER_NAME"
    | "MERCADOLIBRE_TARGET_SELLER_ID"
    | "MERCADOLIBRE_ACCESS_TOKEN"
    | "MERCADOLIBRE_REFRESH_TOKEN"
    | "MERCADOLIBRE_SELLER_ID"
  >
>;

const DEFAULT_SYSTEM_PROMPT = "Eres un asistente para vendedores de Mercado Libre.";
const DEFAULT_CONTEXT_WINDOW_LIMIT = 20;

function createInitialState(
  sellerId: string,
  contextWindowLimit = DEFAULT_CONTEXT_WINDOW_LIMIT,
): ConversationState {
  const now = new Date();
  return {
    messages: [],
    contextWindowLimit,
    sessionMetadata: {
      sellerId,
      startedAt: now,
      lastActivityAt: now,
    },
  };
}

function createTelegramSessionId(sellerId: string, chatId: string): string {
  return `telegram:${sellerId}:${chatId}`;
}

function stateBelongsToSeller(state: ConversationState, sellerId: string): boolean {
  return state.sessionMetadata.sellerId === sellerId;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function createSellerScopedSqlitePath(sqlitePath: string, sellerId: string): string {
  if (sqlitePath === ":memory:") return sqlitePath;

  const parsed = path.parse(sqlitePath);
  return path.join(
    parsed.dir,
    `${parsed.name}.telegram-${sanitizePathSegment(sellerId)}${parsed.ext || ".sqlite"}`,
  );
}

/**
 * Creates the production-oriented Telegram runtime from environment variables.
 *
 * This helper intentionally reads only paths and API keys from env. It never
 * ships defaults for secret values: `BOT_TOKEN` is required, while SQLite paths
 * and DeepSeek/Cortex wiring are opt-in.
 */
export function createTelegramBotFromEnv(env: TelegramBotEnv = process.env): TelegramBot {
  const token = env.BOT_TOKEN?.trim();
  if (!token) {
    throw new Error("BOT_TOKEN is required to start the Telegram bot.");
  }

  const sellerId =
    env.MSL_CHAT_SELLER_ID?.trim() || env.MERCADOLIBRE_TARGET_SELLER_ID?.trim() || "telegram-demo";
  const sellerName = env.MSL_CHAT_SELLER_NAME?.trim() || "Plasticov";

  const sqlitePath = env.MSL_TELEGRAM_SQLITE_PATH?.trim();
  const db = sqlitePath ? new Database(sqlitePath) : null;
  const store = db ? createStrategyStore(db) : undefined;
  const sessionStore = db ? createSessionStore(db) : undefined;
  const autonomyEngine = db ? createAutonomyEngine(db) : undefined;

  const configuredCortexPath =
    env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() || env.MSL_CORTEX_SQLITE_PATH?.trim();
  const cortexPath = configuredCortexPath
    ? createSellerScopedSqlitePath(configuredCortexPath, sellerId)
    : undefined;
  const engine = cortexPath ? createGraphEngine(cortexPath) : undefined;
  const escribano = engine ? new EscribanoObserver({ engine }) : undefined;

  // ── MLC listing-fees client ───────────────────────────────
  const mlcAccessToken = env.MERCADOLIBRE_ACCESS_TOKEN?.trim();
  const mlcRefreshToken = env.MERCADOLIBRE_REFRESH_TOKEN?.trim();
  const mlcSellerId = env.MERCADOLIBRE_SELLER_ID?.trim();

  let mlcClient: ReturnType<typeof createMlcApiClient> | undefined;
  if (mlcAccessToken && mlcSellerId) {
    const tokenState: OAuthTokenState = {
      sellerId: mlcSellerId,
      site: "MLC",
      accessToken: mlcAccessToken,
      ...(mlcRefreshToken !== undefined && { refreshToken: mlcRefreshToken }),
      scopes: ["read", "write"],
      status: "connected",
      connectedAt: new Date(),
      expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000), // 180 days
    };
    mlcClient = createMlcApiClient({
      tokenState,
      transport: createMercadoLibreApiFetchTransport(),
      now: new Date(),
    });
  }

  const agentConfig: BotConfig["agentConfig"] = {
    systemPrompt: buildSystemPrompt(sellerName),
    mockClient: !env.DEEPSEEK_API_KEY?.trim(),
  };
  if (store) agentConfig.store = store;
  if (autonomyEngine) agentConfig.autonomyEngine = autonomyEngine;
  if (engine) agentConfig.engine = engine;
  if (escribano) agentConfig.escribano = escribano;
  if (mlcClient) agentConfig.mlcClient = mlcClient;

  const botConfig: BotConfig = {
    token,
    sellerId,
    agentConfig,
  };
  if (sessionStore) botConfig.sessionStore = sessionStore;
  if (db) botConfig.cleanup = () => db.close();

  return createTelegramBot(botConfig);
}

/**
 * Creates a real Telegram bot backed by grammY + the MSL agent loop.
 *
 * The bot uses long polling and connects every incoming
 * text message to `agent.converse()`.
 *
 * Required environment or config:
 * - `BOT_TOKEN` (or `config.token`) — from @BotFather
 *
 * Optional production persistence:
 * - pass `config.sessionStore`, or use `createTelegramBotFromEnv()` with
 *   `MSL_TELEGRAM_SQLITE_PATH`, to keep per-chat state across messages/restarts.
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
    systemPrompt: config.agentConfig.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
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
    const sellerId = config.sellerId ?? String(ctx.from?.id ?? chatId);
    const sessionId = createTelegramSessionId(sellerId, chatId);

    // Typing indicator
    await ctx.replyWithChatAction("typing");

    // Create agent with session-scoped metadata
    const agent = createAgentLoop(agentConfig);
    const loadedState = config.sessionStore?.load(sessionId);
    const state =
      loadedState && stateBelongsToSeller(loadedState, sellerId)
        ? loadedState
        : createInitialState(sellerId, config.contextWindowLimit ?? DEFAULT_CONTEXT_WINDOW_LIMIT);
    const result = await agent.converse(text, state);
    config.sessionStore?.save(sessionId, result.updatedState);

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
      config.cleanup?.();
      console.log("🛑 Bot detenido");
    },
  };
}
