/**
 * Seed script: loads account-assets from config/account-assets.seed.json
 * and upserts them into the AccountAssetStore.
 *
 * Usage:
 *   node scripts/seed-account-assets.mjs            # upsert accounts
 *   node scripts/seed-account-assets.mjs --dry-run  # validate only
 */

import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Env var resolution ─────────────────────────────────────────────────

function resolveEnv(value) {
  const match = /^\$\{(\w+)(?::-([^}]*))?\}$/.exec(value);
  if (!match) return value;
  const envName = match[1];
  return process.env[envName] ?? match[2] ?? "";
}

// ── Dynamic import for TS packages ────────────────────────────────────

async function loadStore() {
  // npx tsx handles .ts imports transparently, but for .mjs we use the
  // compiled JS path. The tsconfig alias @msl/domain is resolved by vitest
  // but not by Node. We import the source files directly via tsx's loader.
  const { createAccountAssetStore } =
    await import("../packages/agent/src/conversation/accountAssetStore.ts");
  return { createAccountAssetStore };
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  const seedPath = resolve(__dirname, "..", "config", "account-assets.seed.json");
  const raw = readFileSync(seedPath, "utf-8");
  const config = JSON.parse(raw);

  console.log(`📋 Account Assets Seed — ${dryRun ? "DRY RUN" : "UPSERT MODE"}`);
  console.log(`   Config: ${seedPath}`);
  console.log(`   Accounts in seed: ${config.accounts.length}`);

  const sqlitePath = process.env["MSL_TELEGRAM_SQLITE_PATH"] ?? ":memory:";
  const db = new Database(sqlitePath);
  const { createAccountAssetStore } = await loadStore();
  const store = createAccountAssetStore(db);

  for (const rawAccount of config.accounts) {
    const sellerId = resolveEnv(rawAccount.sellerId);

    if (!sellerId) {
      console.log(
        `⚠️  ${rawAccount.name}: env var missing for sellerId — placing in ${config.fallbackMode}`,
      );
      if (dryRun) continue;

      const asset = {
        sellerId: `pending-${rawAccount.name.toLowerCase()}`,
        name: rawAccount.name,
        marketplace: "MLC",
        profitGoal: rawAccount.profitGoal,
        riskLevel: rawAccount.riskLevel,
        status: "pending_configuration",
        capabilities: rawAccount.capabilities.map((c) => ({
          kind: c.kind,
          status: c.status,
          ...(c.health ? { health: c.health } : {}),
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.upsertAccountAsset(asset);
      console.log(`   ✅ ${rawAccount.name} → pending_configuration (${asset.sellerId})`);
      continue;
    }

    if (dryRun) {
      console.log(
        `   🔍 ${rawAccount.name}: sellerId = "${sellerId}", goal = ${rawAccount.profitGoal}%`,
      );
      continue;
    }

    const asset = {
      sellerId,
      name: rawAccount.name,
      marketplace: "MLC",
      profitGoal: rawAccount.profitGoal,
      riskLevel: rawAccount.riskLevel,
      status: rawAccount.status ?? "active",
      capabilities: rawAccount.capabilities.map((c) => ({
        kind: c.kind,
        status: c.status,
        ...(c.health ? { health: c.health } : {}),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    store.upsertAccountAsset(asset);
    console.log(`   ✅ ${rawAccount.name} → upserted (sellerId: "${sellerId}")`);
  }

  if (!dryRun) {
    const count = store.count();
    console.log(`\n📊 Total accounts in store: ${count}`);

    const accounts = store.compareAccounts();
    for (const a of accounts) {
      console.log(
        `   ${a.name}: ${a.status} | ${a.riskLevel} risk | ${a.profitGoal}% profit | ${a.capabilities.length} capabilities`,
      );
    }
  }

  db.close();
  console.log("\n✅ Seed complete.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
