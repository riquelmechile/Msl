#!/usr/bin/env node
/**
 * Start the MSL MCP server (stdio transport).
 * Configure in opencode.json or any MCP client.
 */
import { loadRepositoryEnvironment } from "../packages/mercadolibre/src/env.js";

loadRepositoryEnvironment();

const { startMcpServer } = await import("@msl/mcp");
await startMcpServer();
