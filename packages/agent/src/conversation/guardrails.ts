import { riskLevelForAction } from "@msl/domain";

import type { AgentProposal } from "./types.js";

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
