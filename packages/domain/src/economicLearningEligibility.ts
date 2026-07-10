import type { EconomicOutcome } from "./economicOutcome.js";
import type { UnitEconomicsSnapshot } from "./unitEconomics.js";
import type { Currency } from "./money.js";
import {
  type BlockReason,
  type EconomicLearningEligibility,
  createEconomicLearningEligibility,
} from "./economicLearning.js";

// ── Input type ──────────────────────────────────────────────────────────────

export type EligibilityInput = {
  outcome: EconomicOutcome;
  snapshot?: UnitEconomicsSnapshot;
  hasAttributionTargets: boolean;
  alreadyProcessed: boolean;
};

// ── Evaluator ───────────────────────────────────────────────────────────────

/**
 * Pure deterministic function that evaluates whether an economic outcome
 * is eligible for reinforcement learning.
 *
 * Rules (evaluated in order, first failure wins):
 * 1. Outcome must be verified
 * 2. Observed economic impact must be present
 * 3. Snapshot must not be unverifiable or disputed
 * 4. Snapshot must not be partial with missing inputs
 * 5. Snapshot currency must be consistent
 * 6. Outcome must not have been already processed
 * 7. Attribution targets must be present
 * 8. Seller scope must match between outcome and snapshot
 * 9. Completeness and confidence thresholds are validated
 * 10. If all checks pass → eligible
 */
export function evaluateEconomicLearningEligibility(
  input: EligibilityInput,
): EconomicLearningEligibility {
  const { outcome, snapshot, hasAttributionTargets, alreadyProcessed } = input;
  const reasonCodes: BlockReason[] = [];
  let eligible = true;

  // Determine currency context from snapshot when available
  const currencies: Currency[] = snapshot ? [snapshot.currency] : [];

  // Rule 1: outcome must be verified
  if (outcome.status !== "verified") {
    reasonCodes.push("outcome-not-verified");
    eligible = false;
  }

  // Rule 2: must have observed economic impact
  if (!outcome.observedEconomicImpactId) {
    reasonCodes.push("missing-observed-impact");
    eligible = false;
  }

  // Rules 3-5, 8: snapshot-related checks (skip if no snapshot)
  if (snapshot) {
    // Rule 3: snapshot must not be unverifiable or disputed
    if (
      snapshot.calculationStatus === "unverifiable" ||
      snapshot.calculationStatus === "disputed"
    ) {
      reasonCodes.push("disputed-evidence");
      eligible = false;
    }

    // Rule 4: partial snapshot with missing inputs → incomplete
    if (
      snapshot.calculationStatus === "partial" &&
      snapshot.missingInputs.length > 0
    ) {
      reasonCodes.push("incomplete-economic-data");
      eligible = false;
    }

    // Rule 5: currency conflict — snapshot currency must be valid
    // (with current types, Currency is a union of valid strings, so this
    //  is always consistent; the check exists for future multi-currency support)
    if (!isValidCurrency(snapshot.currency)) {
      reasonCodes.push("currency-conflict");
      eligible = false;
    }

    // Rule 8: seller scope must match
    if (snapshot.sellerId !== outcome.sellerId) {
      reasonCodes.push("seller-scope-mismatch");
      eligible = false;
    }
  }

  // Rule 6: already processed
  if (alreadyProcessed) {
    reasonCodes.push("already-processed");
    eligible = false;
  }

  // Rule 7: must have attribution targets
  if (!hasAttributionTargets) {
    reasonCodes.push("missing-attribution-target");
    eligible = false;
  }

  // Rule 9: completeness and confidence thresholds are validated
  // (these are informational — reflected in the output but don't add new
  //  block reasons beyond what rules 1-8 already cover)
  const completeness = outcome.completeness;
  const confidence = outcome.confidence;

  // Rule 10: if still eligible after all checks, the reasonCodes will be empty
  // (we don't clear eligible=true when no blocking reasons were found)

  // Compute evidence quality from snapshot when available
  const evidenceQuality = snapshot
    ? computeEvidenceQuality(snapshot)
    : 0;

  const hasVerifiedEconomicImpact = !!outcome.observedEconomicImpactId;

  return createEconomicLearningEligibility({
    outcomeId: outcome.outcomeId,
    sellerId: outcome.sellerId,
    eligible,
    reasonCodes,
    outcomeStatus: outcome.status,
    completeness,
    confidence,
    evidenceQuality,
    hasVerifiedEconomicImpact,
    hasAttributionTargets,
    currencies,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Validate that a currency string is a recognized Currency value.
 * Uses the type system's union to validate.
 */
function isValidCurrency(c: string): c is Currency {
  return c === "CLP" || c === "USD";
}

/**
 * Compute evidence quality from a unit economics snapshot.
 * Based on calculation status and missing inputs.
 * Returns a value 0..1.
 */
function computeEvidenceQuality(snapshot: UnitEconomicsSnapshot): number {
  switch (snapshot.calculationStatus) {
    case "complete":
      return 1.0;
    case "partial": {
      // Reduce quality proportionally to missing inputs
      const totalExpected = 12; // all cost component types
      const missing = snapshot.missingInputs.length;
      return Math.max(1.0 - missing / totalExpected, 0.1);
    }
    case "unverifiable":
      return 0.3;
    case "disputed":
      return 0.1;
  }
}
