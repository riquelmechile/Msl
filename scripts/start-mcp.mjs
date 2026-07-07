#!/usr/bin/env node
/**
 * Start the MSL MCP server (stdio transport).
 * Configure in opencode.json or any MCP client.
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Load .env.local
function loadEnv(filePath) {
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
}
loadEnv(resolve(import.meta.dirname, "..", ".env.local"));

const { startMcpServer } = await import("@msl/mcp");
await startMcpServer();
