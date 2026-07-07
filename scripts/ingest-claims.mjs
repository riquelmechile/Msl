#!/usr/bin/env node
/**
 * Fetch ALL claims with pagination and save to Cortex.
 * Usage: node scripts/ingest-claims.mjs [sellerId]
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

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

const {
  createMultiAppOAuthManager,
  resolveOAuthConfigs,
} = await import("@msl/mercadolibre");

const { createGraphEngine } = await import("@msl/memory");

const sellerId = process.argv[2];
if (!sellerId) {
  console.error("Usage: node scripts/ingest-claims.mjs <sellerId>");
  process.exit(1);
}

const configs = resolveOAuthConfigs(process.env);
const oauthManager = createMultiAppOAuthManager(configs);

const PAGE_SIZE = 50;

console.log(`📋 Fetching claims for seller ${sellerId}...`);

let totalClaims = 0;
let offset = 0;
let page = 1;

while (offset < 10000) {
  try {
    const at = await oauthManager.ensureValidToken(sellerId);
    const qs = new URLSearchParams({
      "players.user_id": sellerId,
      "players.role": "respondent",
      type: "mediations",
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const res = await fetch(
      `https://api.mercadolibre.com/post-purchase/v1/claims/search?${qs}`,
      { headers: { Authorization: `Bearer ${at}` } },
    );
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`  ❌ HTTP ${res.status}: ${errBody.slice(0, 150)}`);
      break;
    }
    const body = await res.json();
    const claims = body.data || [];
    if (claims.length === 0) break;

    totalClaims += claims.length;
    const total = body.paging?.total ?? 0;
    const pct = total > 0 ? Math.round((totalClaims / total) * 100) : 0;

    const opened = claims.filter((c) => c.status === "opened").length;
    const closed = claims.filter((c) => c.status === "closed").length;
    console.log(
      `  Page ${page}: ${claims.length} claims (${totalClaims}/${total} = ${pct}%, opened: ${opened}, closed: ${closed})`,
    );

    // Save to Cortex
    const cortexPath =
      (process.env.MSL_TELEGRAM_CORTEX_SQLITE_PATH?.trim() ||
        process.env.MSL_CORTEX_SQLITE_PATH?.trim())
        ?.replace(/\.sqlite$/, `.telegram-${sellerId}.sqlite`);
    if (cortexPath) {
      const engine = createGraphEngine(cortexPath);
      for (const claim of claims) {
        const label = `claim_snapshot_${claim.id}`;
        engine.getOrCreateNode(label, {
          type: "claim_snapshot",
          claimId: claim.id,
          sellerId,
          status: claim.status ?? "",
          claimType: claim.type ?? "",
          resource: claim.resource ?? "",
          reasonId: claim.reason_id ?? "",
          stage: claim.stage ?? "",
          dateCreated: claim.date_created ?? "",
          capturedAt: new Date().toISOString(),
        });
      }
    }

    if (claims.length < PAGE_SIZE) break;
    if (totalClaims >= total && total > 0) break;

    offset += PAGE_SIZE;
    page++;
    await new Promise((r) => setTimeout(r, 300));
  } catch (err) {
    console.error(`  ❌ Failed at offset ${offset}: ${err.message}`);
    break;
  }
}

console.log(`\n✅ Done: ${totalClaims} claims processed`);
oauthManager.close();
