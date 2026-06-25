/* global console, process */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const supportedPlaywrightPlatforms = new Set(["darwin", "linux", "win32"]);
const testFilePattern = /\.(spec|test)\.(cjs|cts|js|jsx|mjs|mts|ts|tsx)$/u;

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const e2eDir = join(repoRoot, "tests", "e2e");

function hasE2eTests(directory) {
  if (!existsSync(directory)) {
    return false;
  }

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = statSync(path);

    if (stats.isDirectory() && hasE2eTests(path)) {
      return true;
    }

    if (stats.isFile() && testFilePattern.test(entry)) {
      return true;
    }
  }

  return false;
}

if (!supportedPlaywrightPlatforms.has(process.platform)) {
  console.log(
    `Skipping Playwright E2E tests: platform "${process.platform}" is not supported by Playwright in this runtime.`,
  );
  process.exit(0);
}

if (!hasE2eTests(e2eDir)) {
  console.log("Skipping Playwright E2E tests: no tests found in tests/e2e yet.");
  process.exit(0);
}

const playwrightBin = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "playwright.cmd" : "playwright",
);
const result = spawnSync(playwrightBin, ["test"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run Playwright E2E tests: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
