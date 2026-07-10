// ── Status enumeration ─────────────────────────────────────────────────────

export const ECONOMIC_OUTCOME_STATUSES = [
  "pending",
  "observing",
  "observed",
  "verified",
  "disputed",
  "invalidated",
] as const;

export type EconomicOutcomeStatus = (typeof ECONOMIC_OUTCOME_STATUSES)[number];

// ── Transition table ───────────────────────────────────────────────────────

export const VALID_OUTCOME_TRANSITIONS: Record<
  EconomicOutcomeStatus,
  readonly EconomicOutcomeStatus[]
> = {
  pending: ["observing"],
  observing: ["observed"],
  observed: ["verified", "disputed", "invalidated"],
  verified: [], // terminal
  disputed: [], // terminal
  invalidated: [], // terminal
};

// ── Outcome type ───────────────────────────────────────────────────────────

export type EconomicOutcome = {
  readonly outcomeId: string;
  readonly sellerId: string;
  readonly accountId?: string;
  readonly channel?: string;
  readonly proposalId?: string;
  readonly preparedActionId?: string;
  readonly executionId?: string;
  readonly correlationId?: string;
  readonly workSessionId?: string;
  readonly originatingAgentId?: string;
  readonly orderId?: string;
  readonly itemId?: string;
  readonly sku?: string;
  readonly expectedEconomicImpact?: string;
  readonly observedEconomicImpactId?: string;
  readonly observationWindow?: { readonly start: number; readonly end: number };
  readonly baselineReference?: string;
  status: EconomicOutcomeStatus;
  confidence: number;
  completeness: number;
  evidenceIds: readonly string[];
  readonly createdAt: number;
  observedAt?: number;
  verifiedAt?: number;
  disputedAt?: number;
  invalidatedAt?: number;
  verificationReason?: string;
};

export type EconomicOutcomeInput = Omit<
  EconomicOutcome,
  "outcomeId" | "status" | "confidence" | "completeness" | "evidenceIds" | "createdAt"
>;

// ── Errors ─────────────────────────────────────────────────────────────────

export class EconomicOutcomeStateError extends Error {
  constructor(from: EconomicOutcomeStatus, to: EconomicOutcomeStatus) {
    super(`Invalid state transition: "${from}" → "${to}" is not allowed.`);
    this.name = "EconomicOutcomeStateError";
  }
}

// ── Transition logic ───────────────────────────────────────────────────────

export function transitionOutcome(
  outcome: EconomicOutcome,
  to: EconomicOutcomeStatus,
): EconomicOutcome {
  const allowed = VALID_OUTCOME_TRANSITIONS[outcome.status];
  if (!(allowed as readonly string[]).includes(to)) {
    throw new EconomicOutcomeStateError(outcome.status, to);
  }

  const now = Date.now();
  const update: Partial<EconomicOutcome> = { status: to };

  // Set timestamp for the target state
  switch (to) {
    case "observed":
      update.observedAt = now;
      break;
    case "verified":
      update.verifiedAt = now;
      break;
    case "disputed":
      update.disputedAt = now;
      break;
    case "invalidated":
      update.invalidatedAt = now;
      break;
  }

  return { ...outcome, ...update };
}

// ── Factory ────────────────────────────────────────────────────────────────

let outcomeCounter = 0;

export function createEconomicOutcome(input: EconomicOutcomeInput): EconomicOutcome {
  outcomeCounter++;
  const now = Date.now();

  return {
    ...input,
    outcomeId: `outcome-${outcomeCounter}`,
    status: "pending",
    confidence: 0,
    completeness: 0,
    evidenceIds: [],
    createdAt: now,
  };
}
