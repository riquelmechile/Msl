import { Bot } from "grammy";
import type { ApiClientOptions } from "grammy";
import Database from "better-sqlite3";
import path from "node:path";
import {
  buildSystemPrompt,
  createAgentConsensusStore,
  createAgentLoop,
  createAutonomyEngine,
  createCompanyAgentLearningStore,
  createCompanyAgentStore,
  createSessionStore,
  createStrategyStore,
  createWorkforceCostCacheLedgerStore,
  EscribanoObserver,
  OperationalEvidenceProvider,
  type AgentLoopConfig,
  type ConversationState,
  type SessionStore,
} from "@msl/agent";
import { createDatabase, createGraphEngine, createSqliteOperationalReadModel } from "@msl/memory";
import {
  createMercadoLibreApiFetchTransport,
  createMlClient,
  createMultiAppOAuthManager,
  createOAuthMlcApiClient,
  getMlAccountRoleConfig,
  resolveOAuthConfigs,
  type OAuthManager,
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
  /** Request-scoped Telegram admin allowlist for CEO/admin-only tools. */
  adminAuthorization?: TelegramAdminAuthorization;
};

export type TelegramAdminAuthorization = {
  enabled: boolean;
  allowedChatIds?: string[];
  allowedUserIds?: string[];
};

/**
 * Handle to a running Telegram bot instance.
 *
 * Provides lifecycle control plus proactive messaging for background workers
 * (ingestion, anomaly alerts) to reach Telegram chats without waiting for
 * user input.
 */
export type TelegramBotHandle = {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Send a proactive message to a Telegram chat without waiting for user input. */
  sendProactiveMessage(chatId: number, text: string): Promise<void>;
  /** List active chat IDs from the session store. */
  listActiveChats(): Promise<number[]>;
};

/** @deprecated Use {@link TelegramBotHandle} instead. */
export type TelegramBot = TelegramBotHandle;

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
    | "MERCADOLIBRE_SOURCE_SELLER_ID"
    | "MERCADOLIBRE_TARGET_SELLER_ID"
    | "MERCADOLIBRE_SOURCE_SELLER_NAME"
    | "MERCADOLIBRE_TARGET_SELLER_NAME"
    | "MERCADOLIBRE_ACCESS_TOKEN"
    | "MERCADOLIBRE_REFRESH_TOKEN"
    | "MERCADOLIBRE_SELLER_ID"
    | "MSL_MERCADOLIBRE_OAUTH_DB_PATH"
    | "MERCADOLIBRE_CLIENT_ID"
    | "MERCADOLIBRE_CLIENT_SECRET"
    | "MERCADOLIBRE_REDIRECT_URI"
    | "MERCADOLIBRE_SOURCE_CLIENT_ID"
    | "MERCADOLIBRE_SOURCE_CLIENT_SECRET"
    | "MERCADOLIBRE_SOURCE_REDIRECT_URI"
    | "MERCADOLIBRE_TARGET_CLIENT_ID"
    | "MERCADOLIBRE_TARGET_CLIENT_SECRET"
    | "MERCADOLIBRE_TARGET_REDIRECT_URI"
    | "MSL_ENCRYPTION_KEY"
    | "MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID"
    | "MSL_COMPANY_AGENT_ADMIN_ENABLED"
    | "MSL_TELEGRAM_ADMIN_CHAT_IDS"
    | "MSL_TELEGRAM_ADMIN_USER_IDS"
  >
>;

const DEFAULT_SYSTEM_PROMPT = "Eres un asistente para vendedores de Mercado Libre.";
const DEFAULT_CONTEXT_WINDOW_LIMIT = 20;
const TELEGRAM_SAFE_TEXT_CHUNK_LENGTH = 3900;
const CONVERSATION_FALLBACK_RESPONSE =
  "Perdón, tuve un problema procesando eso. Escribime de nuevo en un momento y lo reviso.";

type TelegramReplyContext = {
  reply(message: string): Promise<unknown>;
};

function splitTelegramText(text: string, maxLength = TELEGRAM_SAFE_TEXT_CHUNK_LENGTH): string[] {
  const normalizedText = text.trim();
  if (normalizedText.length === 0) return [CONVERSATION_FALLBACK_RESPONSE];
  if (normalizedText.length <= maxLength) return [normalizedText];

  const chunks: string[] = [];
  let remaining = normalizedText;

  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength);
    const paragraphBreak = slice.lastIndexOf("\n\n");
    const lineBreak = slice.lastIndexOf("\n");
    const wordBreak = slice.lastIndexOf(" ");
    const minimumUsefulBreak = Math.floor(maxLength * 0.6);
    const splitAt = [paragraphBreak, lineBreak, wordBreak].find(
      (candidate) => candidate >= minimumUsefulBreak,
    );
    const chunkEnd = splitAt && splitAt > 0 ? splitAt : maxLength;

    chunks.push(remaining.slice(0, chunkEnd).trimEnd());
    remaining = remaining.slice(chunkEnd).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function replyWithTelegramSafeText(ctx: TelegramReplyContext, text: string): Promise<void> {
  for (const chunk of splitTelegramText(text)) {
    await ctx.reply(chunk);
  }
}

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

function parseTelegramIdAllowlist(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

function isTelegramAdminAuthorized(
  authorization: TelegramAdminAuthorization | undefined,
  chatId: string,
  userId: string | undefined,
): boolean {
  if (!authorization?.enabled) return false;

  const allowedChatIds = new Set(authorization.allowedChatIds ?? []);
  const allowedUserIds = new Set(authorization.allowedUserIds ?? []);
  if (allowedChatIds.size === 0 && allowedUserIds.size === 0) return false;

  return allowedChatIds.has(chatId) || (userId ? allowedUserIds.has(userId) : false);
}

/**
 * Creates the production-oriented Telegram runtime from environment variables.
 *
 * This helper intentionally reads only paths and API keys from env. It never
 * ships defaults for secret values: `BOT_TOKEN` is required, while SQLite paths
 * and DeepSeek/Cortex wiring are opt-in.
 */
export function createTelegramBotFromEnv(env: TelegramBotEnv = process.env): TelegramBotHandle {
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
  const consensusStore = db ? createAgentConsensusStore(db) : undefined;
  const sessionStore = db ? createSessionStore(db) : undefined;
  const autonomyEngine = db ? createAutonomyEngine(db) : undefined;
  const companyAgentRegistry = db ? createCompanyAgentStore(db) : undefined;
  const companyAgentLearningStore = db ? createCompanyAgentLearningStore(db) : undefined;
  const workforceCostCacheLedgerStore = db ? createWorkforceCostCacheLedgerStore(db) : undefined;

  const configuredCortexPath =
    env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() || env.MSL_CORTEX_SQLITE_PATH?.trim();
  const cortexPath = configuredCortexPath
    ? createSellerScopedSqlitePath(configuredCortexPath, sellerId)
    : undefined;
  const engine = cortexPath ? createGraphEngine(cortexPath) : undefined;
  const escribano = engine ? new EscribanoObserver({ engine }) : undefined;

  // ── Operational read model + evidence provider ─────────────
  // Bridges Cortex (neural graph) and the operational read model
  // (SQLite snapshots) so the agent can query business evidence
  // through both paths: Cortex for learned patterns, operational
  // model for fresh ML API snapshots.
  const operationalDb = cortexPath ? createDatabase(cortexPath) : undefined;
  const operationalReadModel = operationalDb
    ? createSqliteOperationalReadModel(operationalDb)
    : undefined;
  const evidenceProvider = operationalReadModel
    ? new OperationalEvidenceProvider(operationalReadModel)
    : undefined;

  // ── Multi-seller OAuth clients (reads + writes) ──────
  // Uses the same MultiAppOAuthManager pattern as the MCP
  // runtime to serve Plasticov and Maustian from SQLite tokens.
  const oauthDbPath = env.MSL_MERCADOLIBRE_OAUTH_DB_PATH?.trim();
  const hasLegacyToken = !!env.MERCADOLIBRE_ACCESS_TOKEN?.trim();

  let oauthManager: OAuthManager | undefined;
  let mlcClient: ReturnType<typeof createOAuthMlcApiClient> | undefined;
  let mlClient: ReturnType<typeof createMlClient> | undefined;

  // Migration warning: legacy token present but OAuth not configured
  if (hasLegacyToken && !oauthDbPath) {
    console.warn(
      "⚠️  Legacy MERCADOLIBRE_ACCESS_TOKEN is set but MSL_MERCADOLIBRE_OAUTH_DB_PATH is not.\n" +
        "   The bot now uses multi-seller OAuth. Configure MSL_MERCADOLIBRE_OAUTH_DB_PATH,\n" +
        "   MERCADOLIBRE_CLIENT_ID, MERCADOLIBRE_CLIENT_SECRET, MERCADOLIBRE_REDIRECT_URI,\n" +
        "   and MSL_ENCRYPTION_KEY to enable multi-seller OAuth.",
    );
  }

  if (oauthDbPath) {
    const roleConfig = getMlAccountRoleConfig(env);
    const configs = resolveOAuthConfigs(env);
    if (configs.size > 0) {
      oauthManager = createMultiAppOAuthManager(configs);
      const now = () => new Date();
      mlcClient = createOAuthMlcApiClient({
        oauthManager,
        transport: createMercadoLibreApiFetchTransport(),
        now,
        allowedSellerIds: [roleConfig.sourceSellerId, roleConfig.targetSellerId],
      });
      mlClient = createMlClient({ oauthManager, now: new Date() });
    }
  }

  const systemPrompt = (() => {
    const base = buildSystemPrompt(sellerName);
    const roleConfig = oauthManager ? getMlAccountRoleConfig(env) : undefined;
    if (!roleConfig) return base;

    const sourceName = env.MERCADOLIBRE_SOURCE_SELLER_NAME?.trim() || "Plasticov";
    const targetName = env.MERCADOLIBRE_TARGET_SELLER_NAME?.trim() || "Maustian";

    return (
      base +
      `\n\n## Multi-seller context — NUNCA inventes un sellerId. Usá solo estos:\n` +
      `- ${sourceName}: sellerId = "${roleConfig.sourceSellerId}"\n` +
      `- ${targetName}: sellerId = "${roleConfig.targetSellerId}"`
    );
  })();

  const agentConfig: BotConfig["agentConfig"] = {
    systemPrompt,
    mockClient: !env.DEEPSEEK_API_KEY?.trim(),
    sellerId,
  };
  // Compatibility env from PR #71: this selects internal CEO workforce context
  // for lessons/delegation. It is not a Telegram user-facing worker switch.
  const activeCompanyAgentId = env.MSL_TELEGRAM_ACTIVE_COMPANY_AGENT_ID?.trim();
  if (activeCompanyAgentId) agentConfig.activeCompanyAgentId = activeCompanyAgentId;
  if (store) agentConfig.store = store;
  if (consensusStore) agentConfig.consensusStore = consensusStore;
  if (companyAgentRegistry) agentConfig.companyAgentRegistry = companyAgentRegistry;
  if (companyAgentLearningStore) agentConfig.companyAgentLearningStore = companyAgentLearningStore;
  if (workforceCostCacheLedgerStore)
    agentConfig.workforceCostCacheLedgerStore = workforceCostCacheLedgerStore;
  if (autonomyEngine) agentConfig.autonomyEngine = autonomyEngine;
  if (engine) agentConfig.engine = engine;
  if (escribano) agentConfig.escribano = escribano;
  if (mlcClient) agentConfig.mlcClient = mlcClient;
  if (mlClient) agentConfig.mlClient = mlClient;
  if (operationalReadModel) agentConfig.operationalReader = operationalReadModel;
  if (evidenceProvider) {
    agentConfig.evidenceProvider = evidenceProvider;
    agentConfig.laneId = "ceo";
  }

  const botConfig: BotConfig = {
    token,
    sellerId,
    agentConfig,
  };
  if (env.MSL_COMPANY_AGENT_ADMIN_ENABLED?.trim() === "true") {
    botConfig.adminAuthorization = {
      enabled: true,
      allowedChatIds: parseTelegramIdAllowlist(env.MSL_TELEGRAM_ADMIN_CHAT_IDS),
      allowedUserIds: parseTelegramIdAllowlist(env.MSL_TELEGRAM_ADMIN_USER_IDS),
    };
  }
  if (sessionStore) botConfig.sessionStore = sessionStore;
  if (db)
    botConfig.cleanup = () => {
      db.close();
      operationalDb?.close();
      oauthManager?.close();
    };
  else if (oauthManager)
    botConfig.cleanup = () => {
      oauthManager.close();
    };

  const botHandle = createTelegramBot(botConfig);

  // NOTE: Background ingestion now runs as a standalone PM2 process
  // (msl-worker-ingestion) via scripts/start-worker-ingestion.mjs.
  // This keeps the bot process focused on the Telegram interface only.

  return {
    start: () => botHandle.start(),
    stop: async () => {
      await botHandle.stop();
      oauthManager?.close(); // idempotent guard — cleanup also calls it via botConfig.cleanup
      console.log("🛑 Bot detenido");
    },
    sendProactiveMessage: (chatId, text) => botHandle.sendProactiveMessage(chatId, text),
    listActiveChats: () => botHandle.listActiveChats(),
  };
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
 * | `/start`  | Greeting + CEO assistant identity  |
 * | `/help`   | CEO-facing topics                  |
 * | any text  | Routed through agentLoop.converse()|
 *
 * Workforce/department routing stays behind the CEO agent loop. Telegram does
 * not expose worker-selection commands such as `/agent`.
 */
export function createTelegramBot(config: BotConfig): TelegramBotHandle {
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
        `Escribime en lenguaje natural lo que necesitás. /help queda como atajo por si querés una guía rápida.`,
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
        `Cuando digas "dale", en esta fase solo apruebo investigación o preparación acotada: no publico, no modifico Mercado Libre, no cobro pagos y no mando mensajes a clientes.\n\n` +
        `No necesitás comandos para trabajar conmigo: escribime lo que necesitás, por ejemplo:\n` +
        `_"¿qué margen tengo en zapatillas?"_\n` +
        `_"analizá mi stock actual"_\n\n` +
        `/start y /help son solo atajos globales de Telegram.`,
      { parse_mode: "Markdown" },
    );
  });

  // ── Register commands in Telegram UI ────────────────────

  void bot.api.setMyCommands([
    { command: "start", description: "Iniciar el bot" },
    { command: "help", description: "Ver temas disponibles" },
  ]);

  // ── Message handler ─────────────────────────────────────

  // Reuse a single AgentLoop instance across all messages so that
  // EscribanoObserver accumulates turnCount for Darwinian pruning
  // and conceptCache stays warm, avoiding redundant DB lookups.
  const agent = createAgentLoop({ ...agentConfig, companyAgentAdminAuthorized: false });
  const adminAgent = config.adminAuthorization?.enabled
    ? createAgentLoop({ ...agentConfig, companyAgentAdminAuthorized: true })
    : undefined;

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    const chatId = String(ctx.chat.id);
    const userId = ctx.from?.id !== undefined ? String(ctx.from.id) : undefined;
    const sellerId = config.sellerId ?? String(userId ?? chatId);
    const sessionId = createTelegramSessionId(sellerId, chatId);
    const requestAgent = isTelegramAdminAuthorized(config.adminAuthorization, chatId, userId)
      ? (adminAgent ?? agent)
      : agent;

    // Typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      const loadedState = config.sessionStore?.load(sessionId);
      const state =
        loadedState && stateBelongsToSeller(loadedState, sellerId)
          ? loadedState
          : createInitialState(sellerId, config.contextWindowLimit ?? DEFAULT_CONTEXT_WINDOW_LIMIT);
      const result = await requestAgent.converse(text, state);
      config.sessionStore?.save(sessionId, result.updatedState);

      await replyWithTelegramSafeText(ctx, result.response);
    } catch (error) {
      console.error("Telegram conversation handling failed:", error);
      await ctx.reply(CONVERSATION_FALLBACK_RESPONSE);
    }
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

  const sessionStore = config.sessionStore;

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

    async sendProactiveMessage(chatId: number, text: string): Promise<void> {
      await bot.api.sendMessage(chatId, text, { parse_mode: "HTML" });
    },

    listActiveChats(): Promise<number[]> {
      if (!sessionStore) return Promise.resolve([]);
      const sessions = sessionStore.listActive();
      return Promise.resolve(
        sessions
          .map((s) => {
            const match = /^telegram:[^:]+:(\d+)$/.exec(s.id);
            return match ? parseInt(match[1]!, 10) : null;
          })
          .filter((id): id is number => id !== null),
      );
    },
  };
}
