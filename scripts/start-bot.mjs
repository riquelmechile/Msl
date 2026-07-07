#!/usr/bin/env node
/**
 * Start the Telegram bot with long polling.
 * Usage: node scripts/start-bot.mjs
 */
import { resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";

function loadEnvIfPresent(filePath) {
  if (!existsSync(filePath)) return false;

  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
  return true;
}

const envPath = resolve(import.meta.dirname, "..", ".env.local");
const loadedLocalEnv = loadEnvIfPresent(envPath);

if (!loadedLocalEnv && !process.env.BOT_TOKEN?.trim()) {
  console.error(
    "Cannot start Telegram bot: .env.local was not found and BOT_TOKEN is not set in the process environment.",
  );
  console.error(
    "Create .env.local from .env.example or configure BOT_TOKEN in your VPS/PM2 environment. Secret values are not printed.",
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
