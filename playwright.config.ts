import { defineConfig } from "@playwright/test";

export default defineConfig({
  webServer: {
    command: "npm run dev --workspace @msl/web",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: "http://127.0.0.1:3000",
  },
  testDir: "./tests/e2e",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
});
