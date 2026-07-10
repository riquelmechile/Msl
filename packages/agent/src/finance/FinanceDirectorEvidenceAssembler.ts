import type { EconomicOutcomeStore } from "@msl/memory";
import type { Currency, EconomicOutcome, UnitEconomicsSnapshot } from "@msl/domain";

export type FinanceDirectorEvidence = {
  snapshots: readonly UnitEconomicsSnapshot[];
  outcomes: readonly EconomicOutcome[];
  profitSummary: { totalRevenue: number; totalCosts: number; netProfit: number; netMargin: number; snapshotCount: number } | null;
  missingInputs: string[];
  sellerCurrency: Currency;
  evidenceTimestamp: number;
};

export class FinanceDirectorEvidenceAssembler {
  private store: EconomicOutcomeStore;

  constructor(store: EconomicOutcomeStore) {
    this.store = store;
  }

  assembleEvidence(opts: {
    sellerId: string;
    currency: Currency;
    snapshotIds?: string[];
    outcomeIds?: string[];
    question?: string;
    maxSnapshots?: number;
    maxOutcomes?: number;
    maxAge?: number;
  }): FinanceDirectorEvidence {
    const maxSnapshots = Math.min(opts.maxSnapshots ?? 20, 50);
    const maxOutcomes = Math.min(opts.maxOutcomes ?? 20, 50);

    // Get snapshots from store
    const allSnapshots = this.store.listUnitEconomicsSnapshots(opts.sellerId, { limit: maxSnapshots });

    // Filter by age if specified
    const now = Date.now();
    const maxAge = opts.maxAge;
    const filteredSnapshots =
      maxAge !== undefined
        ? allSnapshots.filter((s: UnitEconomicsSnapshot) => now - s.calculatedAt < maxAge)
        : allSnapshots;

    // Get outcomes
    const outcomes = this.store.listOutcomesBySeller(opts.sellerId, { limit: maxOutcomes });

    // Get profit summary
    const profitSummary = this.store.summarizeProfit(opts.sellerId, opts.currency);

    // Get missing inputs
    const missingInputsRaw = this.store.listMissingInputs(opts.sellerId);
    const allMissing = new Set<string>();
    for (const entry of missingInputsRaw) {
      for (const t of entry.missingTypes) allMissing.add(t);
    }

    return {
      snapshots: filteredSnapshots,
      outcomes,
      profitSummary: profitSummary
        ? {
            totalRevenue: profitSummary.totalRevenue,
            totalCosts: profitSummary.totalCosts,
            netProfit: profitSummary.netProfit,
            netMargin: profitSummary.netMargin,
            snapshotCount: profitSummary.snapshotCount,
          }
        : null,
      missingInputs: [...allMissing],
      sellerCurrency: opts.currency,
      evidenceTimestamp: now,
    };
  }
}
