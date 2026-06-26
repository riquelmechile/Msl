import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@msl/domain": new URL("./packages/domain/src/index.ts", import.meta.url).pathname,
      "@msl/memory": new URL("./packages/memory/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    forbidOnly: Boolean(process.env.CI),
    include: ["packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
