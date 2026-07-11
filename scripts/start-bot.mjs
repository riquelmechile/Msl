#!/usr/bin/env node
/**
 * Start the Telegram bot with long polling.
 * Usage: node scripts/start-bot.mjs
 */
import { loadRepositoryEnvironment } from "../packages/mercadolibre/src/env.js";

loadRepositoryEnvironment();

const loadedLocalEnv = process.env.BOT_TOKEN?.trim();
if (!loadedLocalEnv) {
  console.error(
    "Cannot start Telegram bot: BOT_TOKEN is not set in the process environment or .env/.env.local.",
  );
  console.error(
    "Create .env from .env.example or configure BOT_TOKEN in your VPS/PM2 environment. Secret values are not printed.",
  );
  process.exit(1);
}

const { createTelegramBotFromEnv } = await import("@msl/bot");

console.log("Starting Telegram bot...");

const bot = createTelegramBotFromEnv();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\nStopping Telegram bot...");
  await bot.stop();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\nStopping Telegram bot...");
  await bot.stop();
  process.exit(0);
});

await bot.start();
