import type { CreateMercadoLibreAccountRegistryInput, MlAccountEntry } from "./state.js";

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Derives the canonical MercadoLibre account registry from environment
 * variables, OAuth configuration, and the token store.
 *
 * ## Derivation Rules
 *
 * - `MERCADOLIBRE_SOURCE_SELLER_ID` → accountRole `"source"`, accountName `"Plasticov"`
 * - `MERCADOLIBRE_TARGET_SELLER_ID` → accountRole `"target"`, accountName `"Maustian"`
 * - Each seller is only included when its seller ID env var is set.
 * - `oauthAppBinding` is resolved from the `oauthConfigs` map keyed by seller ID.
 * - `tokenStoreBinding` is the seller ID (used as the key into `TokenStore`).
 * - `readCapability` and `writeCapability` are auto-derived from the role.
 * - `enabled` is `true` only when the seller ID is set, the oauth config exists,
 *   and the seller IDs are distinct.
 * - `connectionPolicy` is hardcoded to `"read-only"` in this PR.
 *
 * ## Cross-Binding Validation
 *
 * Source and target seller IDs MUST be distinct.  When they are the same,
 * both entries are disabled with a diagnostic reason.
 */
export function createMercadoLibreAccountRegistry(
  input: CreateMercadoLibreAccountRegistryInput,
): MlAccountEntry[] {
  const { env, oauthConfigs } = input;

  const sourceSellerId = nonEmpty(env.MERCADOLIBRE_SOURCE_SELLER_ID);
  const targetSellerId = nonEmpty(env.MERCADOLIBRE_TARGET_SELLER_ID);

  const entries: MlAccountEntry[] = [];
  const distinct = sourceSellerId && targetSellerId ? sourceSellerId !== targetSellerId : true;

  function buildEntry(sellerId: string, role: "source" | "target"): MlAccountEntry {
    const hasOAuth = oauthConfigs.has(sellerId);
    const accountName = role === "source" ? "Plasticov" : "Maustian";
    const enabled = hasOAuth && distinct;

    return {
      accountRole: role,
      accountName,
      sellerId,
      oauthAppBinding: sellerId,
      tokenStoreBinding: sellerId,
      operationalScope: "mlc",
      cortexScope: role === "source" ? "mlc-plasticov" : "mlc-maustian",
      readCapability:
        role === "source" ? "mercadolibre-read-plasticov" : "mercadolibre-read-maustian",
      writeCapability:
        role === "source" ? "mercadolibre-write-plasticov" : "mercadolibre-write-maustian",
      expectedIdentity: sellerId,
      enabled,
      connectionPolicy: "read-only",
    };
  }

  if (sourceSellerId) {
    entries.push(buildEntry(sourceSellerId, "source"));
  }

  if (targetSellerId) {
    entries.push(buildEntry(targetSellerId, "target"));
  }

  return entries;
}
