import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@msl/domain": new URL("./packages/domain/src/index.ts", import.meta.url).pathname,
      "@msl/memory": new URL("./packages/memory/src/index.ts", import.meta.url).pathname,
      "@msl/mercadolibre": new URL("./packages/mercadolibre/src/index.ts", import.meta.url)
        .pathname,
      "@msl/tools": new URL("./packages/tools/src/index.ts", import.meta.url).pathname,
      "@msl/agent": new URL("./packages/agent/src/index.ts", import.meta.url).pathname,
      "@msl/bot": new URL("./packages/bot/src/index.ts", import.meta.url).pathname,
      "@msl/mcp": new URL("./packages/mcp/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    forbidOnly: Boolean(process.env.CI),
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts", "scripts/**/*.test.mjs"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
