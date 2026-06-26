import { riskLevelForAction } from "@msl/domain";

import type { AgentProposal, DecoyProposal, Strategy } from "./types.js";

/** Result of a guardrail check. */
export type GuardResult = {
  passed: boolean;
  /** Present when `passed` is false — explains why the check failed. */
  reason?: string;
};

// ---------------------------------------------------------------------------
// Spanish input validator
// ---------------------------------------------------------------------------

/**
 * Heuristic Spanish-language detector.
 *
 * Counts occurrences of extremely common English function words.
 * If the count exceeds a threshold, the input is flagged as non-Spanish.
 * This is a lightweight proxy for a full language-detection model and
 * intentionally errs on the side of permissiveness.
 */
const ENGLISH_WORDS_RE =
  /\b(the|and|for|are|with|that|this|have|from|they|will|would|should|could|what|when|where|which|how|please|want|need|know|think|look|come|make|take|help|because|about|into|over|after|then|to|of|you|your|can|not|very|just|like|some|been|more|only|also|here|there|other)\b/gi;

/** Maximum tolerated English-function-word matches before the input is rejected. */
const ENGLISH_WORD_THRESHOLD = 3;

export function spanishValidator(input: string): GuardResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { passed: false, reason: "Entrada vacía" };
  }

  const matches = trimmed.match(ENGLISH_WORDS_RE);
  if (matches && matches.length > ENGLISH_WORD_THRESHOLD) {
    return { passed: false, reason: "Entrada detectada como inglés. Solo se acepta español." };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Harmful-content filter
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate prompt injection, jailbreak attempts, or
 * instructions that attempt to bypass the agent's guardrails.
 */
const HARMFUL_PATTERNS: ReadonlyArray<RegExp> = [
  // Prompt injection — English
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  // Prompt injection — Spanish
  /ignor[áa]\s+(todas\s+)?(las\s+)?instrucciones\s+(previas|anteriores)/i,
  // Safety bypass — English
  /(bypass|skip|disable)\s+(safety|security|guardrail)/i,
  // Safety bypass — Spanish
  /(saltar|evitar|desactivar)\s+(la\s+)?(seguridad|protecci[óo]n)/i,
  // Execute without approval
  /ejecut[áa]\s+sin\s+(aprobaci[óo]n|confirmaci[óo]n|permiso)/i,
  /execute\s+without\s+(approval|confirmation)/i,
  // System prompt extraction
  /(reveal|show|print|dump)\s+(your\s+)?(system\s+)?(prompt|instructions)/i,
  /revel[áa]\s+(tu\s+)?(system\s+)?prompt/i,
  /mostr[áa]\s+(tus\s+)?instrucciones/i,
  // Impersonation
  /act[uú][aá]\s+como\s+(otro|diferente|admin)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
];

export function harmfulContentFilter(input: string): GuardResult {
  const normalized = input.trim();

  for (const pattern of HARMFUL_PATTERNS) {
    if (pattern.test(normalized)) {
      return { passed: false, reason: "Contenido potencialmente dañino detectado" };
    }
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Action-safety validator
// ---------------------------------------------------------------------------

/**
 * Validates an AgentProposal against domain risk assessment rules.
 *
 * Reuses the deterministic agent's `detectSafetyConflict` pattern:
 * check the WriteActionKind against known risk levels, verify the
 * declared risk level matches the domain assessment, and enforce
 * rationale completeness.
 */
export function actionSafetyValidator(proposal: AgentProposal): GuardResult {
  const { action, riskLevel } = proposal;

  // Block any proposal declaring "critical" risk — the agent should
  // never suggest something that severe without deeper review.
  if (riskLevel === "critical") {
    return {
      passed: false,
      reason: `Acción con nivel de riesgo crítico bloqueada: ${action.kind}. Requiere revisión manual.`,
    };
  }

  // Delegate to domain's built-in risk classification.
  const domainRisk = riskLevelForAction(action.kind);

  // The proposal's declared risk level must match what the domain
  // says this WriteActionKind entails. A mismatch signals the agent
  // is understating or overstating risk.
  if (riskLevel !== domainRisk) {
    return {
      passed: false,
      reason: `El nivel de riesgo declarado (${riskLevel}) no coincide con la evaluación del dominio (${domainRisk}) para la acción ${action.kind}.`,
    };
  }

  // Every proposal must justify why the action is being suggested.
  if (!action.rationale || action.rationale.trim().length === 0) {
    return {
      passed: false,
      reason: "La acción propuesta no incluye justificación (rationale).",
    };
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Strategy validator
// ---------------------------------------------------------------------------

/**
 * Validates an AgentProposal against active CEO strategies.
 *
 * Simple keyword-based matching:
 * - **Margin strategies**: if the proposal lowers the price, it may violate a
 *   minimum-margin rule.
 * - **Category-exclusion strategies**: if the proposal text or rationale mentions
 *   a category the CEO marked as "evitar", the proposal is blocked.
 * - **Empty / no strategies**: always passes.
 *
 * Violations produce a Spanish explanation so the seller understands why the
 * proposal was blocked.
 */
export function strategyValidator(
  proposal: AgentProposal,
  strategies: Strategy[],
): GuardResult {
  if (!strategies || strategies.length === 0) {
    return { passed: true };
  }

  // Collect the full proposal text for keyword matching.
  const proposalText =
    `${proposal.naturalSummary} ${proposal.action.rationale ?? ""}`.toLowerCase();

  // Inspect price changes.
  const priceDown = proposal.action.exactChange.some(
    (ch) =>
      ch.field === "price" &&
      typeof ch.from === "number" &&
      typeof ch.to === "number" &&
      ch.to < ch.from,
  );

  for (const strategy of strategies) {
    const rule = strategy.parsedRule;

    // ── Margin validation ────────────────────────────────────────
    if (rule.ruleType === "margin" && priceDown) {
      // Extract the target percentage from the strategy value.
      const targetPct = parseFloat(rule.value);
      if (!isNaN(targetPct)) {
        return {
          passed: false,
          reason: `La propuesta contradice la estrategia del CEO: ${strategy.ruleText}`,
        };
      }
    }

    // ── Category exclusion validation ────────────────────────────
    if (rule.ruleType === "category" && rule.operator === "evitar") {
      const excludedCategory = rule.value.toLowerCase();
      if (
        excludedCategory &&
        proposalText.includes(excludedCategory)
      ) {
        return {
          passed: false,
          reason: `La propuesta contradice la estrategia del CEO: ${strategy.ruleText}`,
        };
      }
    }

    // ── Pricing cap validation ───────────────────────────────────
    if (rule.ruleType === "pricing" && rule.operator === "<=") {
      const cap = parseFloat(rule.value);
      if (!isNaN(cap)) {
        // If the proposal raises the price above the cap, block it.
        const priceUp = proposal.action.exactChange.some(
          (ch) =>
            ch.field === "price" &&
            typeof ch.to === "number" &&
            ch.to > cap,
        );
        if (priceUp) {
          return {
            passed: false,
            reason: `La propuesta contradice la estrategia del CEO: ${strategy.ruleText}`,
          };
        }
      }
    }
  }

  return { passed: true };
}

// ---------------------------------------------------------------------------
// Honey-pot validator
// ---------------------------------------------------------------------------

/**
 * Validates a {@link DecoyProposal} against active CEO probe strategies.
 *
 * Default-deny posture — blocks ALL honey-pot operations unless:
 * 1. At least one active CEO strategy has `ruleType: "probe"`, AND
 * 2. The proposal's description aligns with the probe strategy's scope
 *    (value or category mentioned in the strategy).
 *
 * Non-probe strategies are skipped.  When no probe strategy is active,
 * the validator returns a Spanish explanation telling the seller to define
 * one with "probá [categoría]" or "monitoreá [competidor]".
 *
 * @param proposal — The decoy proposal to validate.
 * @param strategies — The seller's currently active CEO strategies.
 * @returns A {@link GuardResult}; `passed: true` only when both conditions are met.
 */
export function honeyPotValidator(
  proposal: DecoyProposal,
  strategies: Strategy[],
): GuardResult {
  if (!strategies || strategies.length === 0) {
    return {
      passed: false,
      reason:
        "No tenés estrategias de contrainteligencia activas. " +
        "Definí una con 'probá [categoría]' o 'monitoreá [competidor]'.",
    };
  }

  // Filter to active probe strategies only.
  const probeStrategies = strategies.filter(
    (s) => s.ruleType === "probe" && s.status === "active",
  );

  if (probeStrategies.length === 0) {
    return {
      passed: false,
      reason:
        "No tenés estrategias de contrainteligencia activas. " +
        "Definí una con 'probá [categoría]' o 'monitoreá [competidor]'.",
    };
  }

  // Check if the proposal's description matches any probe strategy's scope.
  const proposalText = proposal.description.toLowerCase();
  const scopeMatch = probeStrategies.some((s) => {
    const value = s.parsedRule.value.toLowerCase();
    return proposalText.includes(value);
  });

  if (!scopeMatch) {
    const scopes = probeStrategies
      .map((s) => `"${s.parsedRule.value}"`)
      .join(", ");
    return {
      passed: false,
      reason:
        `La propuesta no coincide con el alcance de tus estrategias ` +
        `de contrainteligencia activas (${scopes}). ` +
        `Ajustá el objetivo del decoy o definí una nueva estrategia.`,
    };
  }

  return { passed: true };
}
