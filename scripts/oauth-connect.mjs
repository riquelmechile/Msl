#!/usr/bin/env node
/**
 * Interactive OAuth flow for MercadoLibre dual-account setup.
 * Usage: node scripts/oauth-connect.mjs <source|target>
 *
 * Does NOT require a running server. The user manually copies the
 * authorization code from the browser URL bar after granting access.
 */
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

// Load .env.local manually — no extra deps needed
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

// Dynamic import since the mercadolibre package uses ESM
const { resolveOAuthConfigs, createMultiAppOAuthManager, generateState } =
  await import("@msl/mercadolibre");

const role = process.argv[2];
if (role !== "source" && role !== "target") {
  console.error("Usage: node scripts/oauth-connect.mjs <source|target>");
  console.error("  source = Plasticov");
  console.error("  target = Maustian");
  process.exit(1);
}

const sellerId =
  role === "source"
    ? process.env.MERCADOLIBRE_SOURCE_SELLER_ID
    : process.env.MERCADOLIBRE_TARGET_SELLER_ID;

if (!sellerId) {
  console.error(`❌ MERCADOLIBRE_${role.toUpperCase()}_SELLER_ID not set in .env.local`);
  process.exit(1);
}

const stateSecret = process.env.MSL_OAUTH_STATE_SECRET;
if (!stateSecret) {
  console.error("❌ MSL_OAUTH_STATE_SECRET not set in .env.local");
  process.exit(1);
}

// Build multi-app OAuth manager
const configs = resolveOAuthConfigs(process.env);
if (configs.size === 0) {
  console.error("❌ No OAuth configs resolved from environment. Check .env.local.");
  process.exit(1);
}
const manager = createMultiAppOAuthManager(configs);

// Generate signed state
const statePayload = {
  role,
  sellerId,
  nonce: randomUUID(),
  createdAt: Date.now(),
};
const state = generateState(statePayload, stateSecret);

// Build authorization URL
const authUrl = manager.getAuthorizationUrl(sellerId, state);

console.log("╔══════════════════════════════════════════════════╗");
console.log(`║  MercadoLibre OAuth — ${role === "source" ? "Plasticov" : "Maustian"}          ║`);
console.log("╠══════════════════════════════════════════════════╣");
console.log("║  1. Abrí esta URL en tu navegador:               ║");
console.log("╠══════════════════════════════════════════════════╣");
console.log("");
console.log(authUrl);
console.log("");
console.log("╠══════════════════════════════════════════════════╣");
console.log("║  2. Iniciá sesión y autorizá la aplicación.      ║");
console.log("║  3. ML te redirige al callback — va a dar error   ║");
console.log("║     porque no hay server, pero NO IMPORTA.        ║");
console.log("║  4. Copiá el CODE de la URL del navegador.        ║");
console.log("║     Vas a ver algo como:                          ║");
console.log("║     ?code=TG-abc123...                            ║");
console.log("║  5. Pegá ese código acá abajo.                    ║");
console.log("╚══════════════════════════════════════════════════╝");
console.log("");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const code = await new Promise((resolve) => {
  rl.question("CODE> ", (answer) => {
    rl.close();
    resolve(answer.trim());
  });
});

if (!code) {
  console.error("❌ No code provided.");
  process.exit(1);
}

console.log("\n⏳ Canjeando código por tokens...");

try {
  const tokens = await manager.exchangeCodeForToken(sellerId, code);
  console.log("\n✅ ¡Cuenta conectada correctamente!");
  console.log(`   Seller ID : ${sellerId}`);
  console.log(`   User ID   : ${tokens.user_id}`);
  console.log(`   Nickname  : ${tokens.nickname}`);
  console.log(`   Scope     : ${tokens.scope ?? "N/A"}`);
  console.log(`   Expira en : ${tokens.expires_in}s (~${Math.round(tokens.expires_in / 3600)}h)`);
  console.log(`\n   Tokens guardados en SQLite (encriptados).`);
  console.log(`   El refresh_token se renueva automáticamente.`);

  // Save to engram for cross-session awareness
  const { execSync } = await import("node:child_process");
  try {
    execSync(
      `engram mem_save --title "ML OAuth connected: ${role}" --type config --content "**What**: Connected ${role === "source" ? "Plasticov" : "Maustian"} MercadoLibre account via OAuth.\\n**Why**: Dual-account OAuth setup.\\n**Where**: SQLite at ${process.env.MSL_MERCADOLIBRE_OAUTH_DB_PATH}\\n**Learned**: seller_id=${sellerId}, user_id=${tokens.user_id}, nickname=${tokens.nickname}" --project msl`,
      { stdio: "ignore" },
    );
  } catch {
    // engram not available — not critical
  }
} catch (err) {
  console.error(`\n❌ Falló el canje: ${err.message}`);
  console.error("   Posibles causas:");
  console.error("   - El código expiró (dura ~10 min)");
  console.error("   - El redirect_uri no coincide con el configurado en la app");
  console.error("   - Client secret incorrecto");
  console.error("   - La app no tiene los scopes necesarios (offline_access, read, write)");
  process.exit(1);
}
