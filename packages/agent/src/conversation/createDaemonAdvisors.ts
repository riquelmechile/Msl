import type { SupplierMirrorStore } from "@msl/memory";
import { getDeepSeekClient } from "./deepseekClient.js";
import { SupplierMirrorDeepSeekAdvisor } from "./supplierMirrorDeepSeekAdvisor.js";
import { OperationsDeepSeekAdvisor } from "./operationsDeepSeekAdvisor.js";
import { CatalogDeepSeekAdvisor } from "./catalogDeepSeekAdvisor.js";
import { CostSupplierDeepSeekAdvisor } from "./costSupplierDeepSeekAdvisor.js";
import { CreativeDeepSeekAdvisor } from "./creativeDeepSeekAdvisor.js";
import type { WorkforceCostCacheLedgerStore } from "./workforceCostCacheLedgerStore.js";

// ── Types ────────────────────────────────────────────────────────────

export type DaemonAdvisors = {
  /** SupplierMirrorDeepSeekAdvisor for stock-gap enrichment. */
  advisor?: SupplierMirrorDeepSeekAdvisor;
  /** OperationsDeepSeekAdvisor for claim/reputation enrichment. */
  operationsAdvisor?: OperationsDeepSeekAdvisor;
  /** CatalogDeepSeekAdvisor for market-catalog enrichment. */
  catalogAdvisor?: CatalogDeepSeekAdvisor;
  /** CostSupplierDeepSeekAdvisor for cost/margin enrichment. */
  costSupplierAdvisor?: CostSupplierDeepSeekAdvisor;
  /** CreativeDeepSeekAdvisor for creative asset enrichment. */
  creativeAdvisor?: CreativeDeepSeekAdvisor;
};

export type CreateDaemonAdvisorsExtra = {
  /** SupplierMirrorStore required for SupplierMirrorDeepSeekAdvisor. */
  supplierMirrorStore?: SupplierMirrorStore;
  /** Optional ledger for recording DeepSeek API costs. */
  ledger?: WorkforceCostCacheLedgerStore;
};

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Create DeepSeek advisor instances for daemon enrichment from env vars.
 *
 * Reads DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL, and seller IDs from env.
 * If DEEPSEEK_API_KEY is missing, returns an empty object (all undefined).
 * If seller IDs are missing, returns an empty object (all advisors need them).
 * For SupplierMirrorDeepSeekAdvisor, also requires `supplierMirrorStore` in extra.
 *
 * Each advisor is optional — missing deps result in undefined for that slot.
 * Callers should check for undefined before using.
 */
export function createDaemonAdvisorsFromEnv(
  env: Record<string, string | undefined>,
  extra: CreateDaemonAdvisorsExtra = {},
): DaemonAdvisors {
  const deepseekKey = env.DEEPSEEK_API_KEY?.trim();
  if (!deepseekKey) {
    console.warn("[createDaemonAdvisors] DEEPSEEK_API_KEY not set — all advisors disabled");
    return {};
  }

  const sourceSellerId = env.MERCADOLIBRE_SOURCE_SELLER_ID?.trim();
  const targetSellerId = env.MERCADOLIBRE_TARGET_SELLER_ID?.trim();
  const sellerIds = [sourceSellerId, targetSellerId].filter((id): id is string => !!id);

  if (sellerIds.length === 0) {
    console.warn(
      "[createDaemonAdvisors] No seller IDs configured (MERCADOLIBRE_SOURCE_SELLER_ID / MERCADOLIBRE_TARGET_SELLER_ID) — all advisors disabled",
    );
    return {};
  }

  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || undefined;
  const openai = getDeepSeekClient(deepseekKey, baseUrl);

  const result: DaemonAdvisors = {};

  // Build base params without ledger if undefined (exactOptionalPropertyTypes compat)
  const ledgerParam = extra.ledger ? { ledger: extra.ledger } : {};

  // ── SupplierMirrorDeepSeekAdvisor ────────────────────────────
  if (extra.supplierMirrorStore) {
    result.advisor = new SupplierMirrorDeepSeekAdvisor({
      store: extra.supplierMirrorStore,
      openai,
      sellerIds,
      ...ledgerParam,
    });
  }

  // ── OperationsDeepSeekAdvisor ────────────────────────────────
  try {
    result.operationsAdvisor = new OperationsDeepSeekAdvisor({
      openai,
      sellerIds,
      ...ledgerParam,
    });
  } catch {
    console.warn("[createDaemonAdvisors] Failed to create OperationsDeepSeekAdvisor");
  }

  // ── CatalogDeepSeekAdvisor ───────────────────────────────────
  try {
    result.catalogAdvisor = new CatalogDeepSeekAdvisor({
      openai,
      sellerIds,
      ...ledgerParam,
    });
  } catch {
    console.warn("[createDaemonAdvisors] Failed to create CatalogDeepSeekAdvisor");
  }

  // ── CostSupplierDeepSeekAdvisor ──────────────────────────────
  try {
    result.costSupplierAdvisor = new CostSupplierDeepSeekAdvisor({
      openai,
      sellerIds,
      ...ledgerParam,
    });
  } catch {
    console.warn("[createDaemonAdvisors] Failed to create CostSupplierDeepSeekAdvisor");
  }

  // ── CreativeDeepSeekAdvisor ──────────────────────────────────
  try {
    result.creativeAdvisor = new CreativeDeepSeekAdvisor({
      openai,
      sellerIds,
      ...ledgerParam,
    });
  } catch {
    console.warn("[createDaemonAdvisors] Failed to create CreativeDeepSeekAdvisor");
  }

  return result;
}
