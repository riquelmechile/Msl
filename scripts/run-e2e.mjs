import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

if (!hasE2eTests(e2eDir)) {
  console.log("Skipping E2E tests: no tests found in tests/e2e yet.");
  process.exit(0);
}

const result = spawnSync("npx", ["vitest", "run", "--config", "vitest.config.ts", "tests/e2e/"], {
  cwd: repoRoot,
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run E2E tests: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
