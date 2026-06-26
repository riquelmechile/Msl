import type { AgentProposal, Strategy } from "./types.js";
import { strategyValidator, actionSafetyValidator } from "./guardrails.js";

/**
 * Result of the calibrated-distrust self-verification pass.
 *
 * Runs multiple checks against a proposal before it is presented to the
 * seller.  Each check produces a {@link VerificationCheck} with a severity
 * level that determines whether the proposal is blocked, flagged for
 * human review, or passed cleanly.
 */
export type VerificationResult = {
  /** Overall pass status — `true` when no blocking checks failed. */
  passed: boolean;
  /** Ordered list of individual checks executed. */
  checks: VerificationCheck[];
  /** Whether any check recommends human review (blocking or warning severity). */
  requiresHumanReview: boolean;
};

/** A single self-verification check executed during the distrust pass. */
export type VerificationCheck = {
  /** Short label identifying the check, e.g. "Estrategia CEO". */
  name: string;
  /** Whether this specific check passed. */
  passed: boolean;
  /** Spanish explanation of the result. */
  detail: string;
  /** Severity — "blocking" prevents the proposal, "warning" flags it. */
  severity: "info" | "warning" | "blocking";
};

/**
 * Self-verify a proposal before presenting it to the seller.
 *
 * The calibrated-distrust pass runs four checks:
 *
 * 1. **Strategy compliance** — re-runs the strategy guardrail.
 * 2. **Safety validation** — re-runs the action-safety guardrail.
 * 3. **Autonomy-level appropriateness** — checks whether the proposal's
 *    risk level is appropriate for the current autonomy tier.
 * 4. **Consistency** — scans for internal contradictions in the proposal text.
 *
 * @param proposal   The agent's proposed action.
 * @param strategies Currently active CEO strategies.
 * @param context    Seller identity and current autonomy level string.
 * @returns A structured {@link VerificationResult} with per-check detail.
 */
export function selfVerify(
  proposal: AgentProposal,
  strategies: Strategy[],
  context: { sellerId: string; currentLevel: string },
): VerificationResult {
  const checks: VerificationCheck[] = [];

  // ── Check 1: Strategy compliance ─────────────────────────────────
  const strategyCheck = strategyValidator(proposal, strategies);
  checks.push({
    name: "Estrategia CEO",
    passed: strategyCheck.passed,
    detail: strategyCheck.passed
      ? "Cumple con estrategias activas"
      : (strategyCheck.reason ?? "Violación de estrategia"),
    severity: strategyCheck.passed ? "info" : "blocking",
  });

  // ── Check 2: Safety validation ────────────────────────────────────
  const safetyCheck = actionSafetyValidator(proposal);
  checks.push({
    name: "Seguridad",
    passed: safetyCheck.passed,
    detail: safetyCheck.passed ? "Acción segura" : (safetyCheck.reason ?? "Riesgo detectado"),
    severity: safetyCheck.passed ? "info" : "blocking",
  });

  // ── Check 3: Risk appropriateness for autonomy level ──────────────
  const riskAppropriate = isRiskAppropriateForLevel(proposal.riskLevel, context.currentLevel);
  checks.push({
    name: "Nivel de autonomía",
    passed: riskAppropriate,
    detail: riskAppropriate
      ? `Apropiado para nivel ${context.currentLevel}`
      : `Requiere revisión humana (nivel ${context.currentLevel})`,
    severity: riskAppropriate ? "info" : "warning",
  });

  // ── Check 4: Consistency (no internal contradictions) ─────────────
  const consistent = checkConsistency(proposal);
  checks.push({
    name: "Consistencia",
    passed: consistent,
    detail: consistent ? "Sin contradicciones detectadas" : "Posible contradicción en la propuesta",
    severity: consistent ? "info" : "warning",
  });

  return {
    passed: checks.every((c) => c.severity !== "blocking"),
    checks,
    requiresHumanReview: checks.some((c) => c.severity === "blocking" || c.severity === "warning"),
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Maps autonomy-level string names to numeric tiers for comparison. */
const AUTONOMY_TIER: Record<string, number> = {
  CONSULTA: 0,
  SUGIERE: 1,
  PREPARA: 2,
  BAJO_RIESGO: 3,
  MEDIO_RIESGO: 4,
  FULL: 5,
};

/** Maps risk-level strings to minimum required autonomy tier. */
const RISK_TIER: Record<string, number> = {
  low: 3,
  medium: 4,
  high: 5,
  critical: 6,
};

/**
 * Determines whether a proposal's risk level is appropriate for the
 * seller's current autonomy tier.
 *
 * @param riskLevel    The proposal's declared risk level.
 * @param currentLevel The current autonomy level as a string name.
 * @returns `true` when the autonomy level is high enough for this risk.
 */
function isRiskAppropriateForLevel(riskLevel: string, currentLevel: string): boolean {
  const autonomyTier = AUTONOMY_TIER[currentLevel] ?? 1;
  const riskTier = RISK_TIER[riskLevel] ?? 5;
  return autonomyTier >= riskTier;
}

/**
 * Scans the proposal's natural-language summary for potential internal
 * contradictions (e.g., "subir" + "bajar" in the same sentence).
 *
 * This is a heuristic check — it flags obvious antonym pairs but may
 * produce false positives for complex sentences.  The severity is
 * always "warning", never "blocking".
 */
function checkConsistency(proposal: AgentProposal): boolean {
  const text = proposal.naturalSummary.toLowerCase();

  const contradictions: Array<{ a: string; b: string }> = [
    { a: "subir", b: "bajar" },
    { a: "aumentar", b: "reducir" },
    { a: "más", b: "menos" },
  ];

  return !contradictions.some((c) => text.includes(c.a) && text.includes(c.b));
}
