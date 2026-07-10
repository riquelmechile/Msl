import crypto from "node:crypto";

import type { AgentWakeDecision, SignalDelta } from "@msl/domain";
import type { AgentWorkSession } from "@msl/domain";

// ── Public types ────────────────────────────────────────────────────────────

export type SignalDescriptor = {
  /** Signal identifier (e.g. "unanswered_questions", "reputation_drop"). */
  type: string;
  /** Numeric count or count of items in this signal category. */
  count?: number;
  /** Optional risk severity override. */
  severity?: "info" | "warning" | "critical" | "high";
};

export type ShouldWakeInput = {
  sellerId: string;
  agentId: string;
  signals: SignalDescriptor[];
  /** The last session that ran for this agent+seller+signalsHash. */
  lastSession?: AgentWorkSession;
  /** Equivalent proposals already pending in CEO inbox. */
  pendingProposals?: string[];
  /** Manual override forces wake regardless of policy. */
  manual?: boolean;
};

// ── Constants ───────────────────────────────────────────────────────────────

/** Minimum cooldown in milliseconds — skip wake if last completed session is within this window. */
export const WAKE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

// ── Pure functions ──────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 hash from an array of signal descriptors.
 * Sorts signals by type before hashing to guarantee determinism.
 */
export function hashAgentSignals(signals: SignalDescriptor[]): string {
  const sorted = [...signals].sort((a, b) => a.type.localeCompare(b.type));
  const payload = JSON.stringify(sorted);
  return crypto.createHash("sha256").update(payload).digest("hex");
}

/**
 * Determine whether an agent should wake up and run a work session.
 *
 * Rules (ordered):
 * 1. Manual override → wake
 * 2. Any signal with severity "high" or "critical" → wake (override cooldown)
 * 3. Same signalsHash + completed < 1h ago → skip ("no new signals")
 * 4. Equivalent proposal already pending in CEO inbox → skip
 * 5. Signals differ from last session → wake ("new signal")
 * 6. Default → skip ("no signals")
 */
export function shouldAgentWakeUp(input: ShouldWakeInput): AgentWakeDecision {
  const signalsHash = hashAgentSignals(input.signals);

  // Rule 1: Manual override
  if (input.manual) {
    return { shouldWake: true, reason: "manual override", signalsHash };
  }

  // Rule 2: High/critical severity overrides everything
  const hasHighSeverity = input.signals.some(
    (s) =>
      s.severity === "high" ||
      s.severity === "critical" ||
      s.type.toLowerCase().includes("critical"),
  );
  if (hasHighSeverity) {
    return { shouldWake: true, reason: "high severity signal", signalsHash };
  }

  // Rule 3: Same signalsHash + recent completed session
  if (input.lastSession) {
    if (input.lastSession.signalsHash === signalsHash && input.lastSession.status === "completed") {
      const endedAt = input.lastSession.endedAt;
      if (endedAt) {
        const elapsed = Date.now() - new Date(endedAt).getTime();
        if (elapsed >= 0 && elapsed < WAKE_COOLDOWN_MS) {
          return { shouldWake: false, reason: "no new signals", signalsHash };
        }
      }
    }

    // Rule 4: Equivalent pending proposal
    if (input.pendingProposals && input.pendingProposals.length > 0) {
      return { shouldWake: false, reason: "pending equivalent proposal", signalsHash };
    }
  }

  // Rule 5: Signals present → wake (covers: new signals, cooldown expired, no last session)
  if (input.signals.length > 0) {
    return { shouldWake: true, reason: "new signal", signalsHash };
  }

  // Rule 6: Default — no signals to process
  return { shouldWake: false, reason: "no signals", signalsHash };
}

/**
 * Compute the delta between two sets of signal identifiers.
 * `previous` and `current` are string arrays of signal type identifiers.
 */
export function computeSignalDelta(previous: string[], current: string[]): SignalDelta {
  const prevSet = new Set(previous);
  const currSet = new Set(current);

  const added: string[] = [];
  const removed: string[] = [];
  const unchanged: string[] = [];

  for (const sig of currSet) {
    if (prevSet.has(sig)) {
      unchanged.push(sig);
    } else {
      added.push(sig);
    }
  }

  for (const sig of prevSet) {
    if (!currSet.has(sig)) {
      removed.push(sig);
    }
  }

  return {
    added: added.sort(),
    removed: removed.sort(),
    unchanged: unchanged.sort(),
  };
}
