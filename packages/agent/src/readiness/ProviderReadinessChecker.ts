import { createReadinessCheckResult } from "./types.js";
import type { ReadinessCheckResult } from "./types.js";
import type { ReadinessContext } from "./types.js";

const CHECK_PREFIX = "provider";

export function checkProviderReadiness(ctx: ReadinessContext): ReadinessCheckResult[] {
  const results: ReadinessCheckResult[] = [];
  const { env, features } = ctx;

  // ── DeepSeek ────────────────────────────────────────────────────
  const deepseekKey = env.DEEPSEEK_API_KEY;
  if (deepseekKey && deepseekKey.trim() !== "" && !/^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(deepseekKey.trim())) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-deepseek`,
        capability: "deepseek-reasoning",
        status: "ready",
        safeMessage: "DeepSeek API key is configured and valid.",
        remediation: "DeepSeek provider is ready.",
      }),
    );
  } else if (deepseekKey && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(deepseekKey.trim())) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-deepseek`,
        capability: "deepseek-reasoning",
        status: "blocked",
        safeMessage: "DeepSeek API key is a placeholder value.",
        remediation: "Set DEEPSEEK_API_KEY to a real API key from https://platform.deepseek.com",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-deepseek`,
        capability: "deepseek-reasoning",
        status: "blocked",
        safeMessage: "DeepSeek API key is not set.",
        remediation: "Set DEEPSEEK_API_KEY to enable DeepSeek LLM inference.",
      }),
    );
  }

  // ── MiniMax (conditional on Creative Studio) ────────────────────
  const minimaxKey = env.MINIMAX_API_KEY;
  if (features.creativeStudioEnabled) {
    if (minimaxKey && minimaxKey.trim() !== "" && !/^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(minimaxKey.trim())) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-minimax`,
          capability: "creative-studio",
          status: "ready",
          safeMessage: "MiniMax API key is configured for Creative Studio.",
          remediation: "MiniMax provider is ready.",
        }),
      );
    } else if (minimaxKey && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(minimaxKey.trim())) {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-minimax`,
          capability: "creative-studio",
          status: "blocked",
          safeMessage: "MiniMax API key is a placeholder value but Creative Studio is enabled.",
          remediation: "Set MINIMAX_API_KEY to a real API key from https://platform.minimax.io",
        }),
      );
    } else {
      results.push(
        createReadinessCheckResult({
          checkId: `${CHECK_PREFIX}-minimax`,
          capability: "creative-studio",
          status: "blocked",
          safeMessage: "Creative Studio is enabled but MINIMAX_API_KEY is not set.",
          remediation: "Set MINIMAX_API_KEY or disable Creative Studio (MSL_CREATIVE_STUDIO_ENABLED=false).",
        }),
      );
    }
  } else {
    // Creative Studio disabled — MiniMax is not required
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-minimax`,
        capability: "creative-studio",
        status: "not-applicable",
        safeMessage: "Creative Studio is disabled — MiniMax API key is not required.",
        remediation: "Enable MSL_CREATIVE_STUDIO_ENABLED if you want to use MiniMax for image/video generation.",
      }),
    );
  }

  // ── ML OAuth provider ──────────────────────────────────────────
  const oauthDbPath = env.MSL_MERCADOLIBRE_OAUTH_DB_PATH;
  if (oauthDbPath && oauthDbPath.trim() !== "") {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-ml-oauth`,
        capability: "mercadolibre-read-plasticov",
        status: "ready",
        safeMessage: "MercadoLibre OAuth token store path is configured.",
        remediation: "OAuth DB path is set.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-ml-oauth`,
        capability: "mercadolibre-read-plasticov",
        status: "degraded",
        safeMessage: "MSL_MERCADOLIBRE_OAUTH_DB_PATH is not set.",
        remediation: "Set MSL_MERCADOLIBRE_OAUTH_DB_PATH for durable OAuth token storage.",
      }),
    );
  }

  // ── Telegram Bot token ─────────────────────────────────────────
  const botToken = env.BOT_TOKEN;
  if (botToken && botToken.trim() !== "" && !/^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(botToken.trim())) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-bot-token`,
        capability: "telegram-ceo",
        status: "ready",
        safeMessage: "Telegram Bot token is configured.",
        remediation: "Bot token is ready.",
      }),
    );
  } else if (botToken && /^(test|example|changeme|your-|xxx|placeholder|dummy)/i.test(botToken.trim())) {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-bot-token`,
        capability: "telegram-ceo",
        status: "blocked",
        safeMessage: "Telegram Bot token is a placeholder value.",
        remediation: "Set BOT_TOKEN to a real token from @BotFather.",
      }),
    );
  } else {
    results.push(
      createReadinessCheckResult({
        checkId: `${CHECK_PREFIX}-bot-token`,
        capability: "telegram-ceo",
        status: "blocked",
        safeMessage: "Telegram Bot token is not set.",
        remediation: "Set BOT_TOKEN to enable the Telegram CEO bot.",
      }),
    );
  }

  return results;
}
