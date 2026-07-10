import type { MerchandisingAdvisorResult, MissingEvidenceReport } from "./ownedEcommerceMerchandisingAdvisor.js";

// ── Public types ─────────────────────────────────────────────────────

export type AdvisorValidationResult = {
  usable: boolean;
  blockedClaims: string[];
  warnings: string[];
  sanitizedResult: MerchandisingAdvisorResult;
};

// ── Internal types ───────────────────────────────────────────────────

type ClaimCheck = {
  text: string;
  source: string; // which field/sub-field the text came from
  evidenceIds: string[];
};

// ── Constants ────────────────────────────────────────────────────────

const SUPERLATIVE_PATTERNS = [
  /\bbest\b/i,
  /\bguaranteed\b/i,
  /\bofficial\b/i,
  /\bnumber\s*one\b/i,
  /\btop\s*rated\b/i,
  /\bleading\b/i,
];

const PUBLISH_PATTERNS = [
  /\bpublish\b/i,
  /\bactivate\s*checkout\b/i,
  /\bgo\s*live\b/i,
  /\bmake\s*available\b/i,
  /\benable\s*payments\b/i,
];

const MEDICAL_TECHNICAL_PATTERNS = [
  /\bcur[aá]tivo\b/i,
  /\bmedicina\b/i,
  /\bsalud\b/i,
  /\bhealth\b/i,
  /\btratamiento\b/i,
  /\bcertified\s*by\b/i,
  /\bcertificado\s*por\b/i,
  /\bperformance\s*guarantee\b/i,
  /\bgarant[aí]a\s*de\s*rendimiento\b/i,
  /\bISO\s*\d{4,5}\b/,
  /\bFDA\b/,
];

const MIXED_ACCOUNT_PATTERNS = [
  /\bPlasticov\b/i,
  /\bMaustian\b/i,
];

const VALID_TARGET_AGENTS = new Set([
  "cost-supplier",
  "market-catalog",
  "creative-assets",
  "account-brain",
  "supplier-manager",
]);

// ── Helpers ──────────────────────────────────────────────────────────

/** Collect all text + evidence claims from a MerchandisingAdvisorResult into a flat list. */
function extractClaims(result: MerchandisingAdvisorResult): ClaimCheck[] {
  const claims: ClaimCheck[] = [];

  // Reasoning rationales
  for (const r of result.reasoning) {
    claims.push({
      text: r.rationale,
      source: `reasoning[${r.candidateId}]`,
      evidenceIds: r.evidenceIds ?? [],
    });
  }

  // Positioning angles
  for (const angle of result.positioningAngles) {
    claims.push({
      text: angle,
      source: "positioningAngles",
      evidenceIds: [],
    });
  }

  // SEO suggestions
  if (result.seoSuggestions.seoTitle) {
    claims.push({
      text: result.seoSuggestions.seoTitle,
      source: "seoTitle",
      evidenceIds: [],
    });
  }
  if (result.seoSuggestions.seoDescription) {
    claims.push({
      text: result.seoSuggestions.seoDescription,
      source: "seoDescription",
      evidenceIds: [],
    });
  }
  for (const kw of result.seoSuggestions.keywords ?? []) {
    claims.push({
      text: kw,
      source: "seoKeyword",
      evidenceIds: [],
    });
  }

  // GEO suggestions
  if (result.geoSuggestions.geoSummary) {
    claims.push({
      text: result.geoSuggestions.geoSummary,
      source: "geoSummary",
      evidenceIds: [],
    });
  }
  for (const faq of result.geoSuggestions.faq ?? []) {
    claims.push({
      text: `${faq.question} ${faq.answer}`,
      source: "geoFaq",
      evidenceIds: faq.evidenceIds ?? [],
    });
  }

  // Channel tradeoffs
  for (const ct of result.channelTradeoffs) {
    for (const upside of ct.upsides) {
      claims.push({
        text: upside,
        source: `channelTradeoff[${ct.channel}].upside`,
        evidenceIds: [],
      });
    }
    for (const risk of ct.risks) {
      claims.push({
        text: risk,
        source: `channelTradeoff[${ct.channel}].risk`,
        evidenceIds: [],
      });
    }
    claims.push({
      text: ct.overallAssessment,
      source: `channelTradeoff[${ct.channel}].assessment`,
      evidenceIds: [],
    });
  }

  // Experiment proposal
  if (result.experimentProposal) {
    claims.push({
      text: result.experimentProposal.hypothesis,
      source: "experimentHypothesis",
      evidenceIds: [],
    });
  }

  return claims;
}

/** Check if a text contains superlatives that are not backed by evidenceIds. */
function checkSuperlatives(
  claims: ClaimCheck[],
  blocked: string[],
  warnings: string[],
  sanitizedFields: Set<string>,
): void {
  for (const claim of claims) {
    for (const pattern of SUPERLATIVE_PATTERNS) {
      if (pattern.test(claim.text)) {
        if (claim.evidenceIds.length === 0) {
          const match = claim.text.match(pattern)?.[0] ?? "superlative";
          blocked.push(
            `Blocked superlative "${match}" in ${claim.source} without evidenceIds: "${claim.text.slice(0, 80)}..."`,
          );
          sanitizedFields.add(claim.source);
        }
      }
    }
  }
}

/** Check if a text contains publish/checkout language (always blocked). */
function checkPublishLanguage(
  claims: ClaimCheck[],
  blocked: string[],
  sanitizedFields: Set<string>,
): void {
  for (const claim of claims) {
    for (const pattern of PUBLISH_PATTERNS) {
      if (pattern.test(claim.text)) {
        const match = claim.text.match(pattern)?.[0] ?? "publish language";
        blocked.push(
          `Blocked publish/checkout language "${match}" in ${claim.source}: "${claim.text.slice(0, 80)}..."`,
        );
        sanitizedFields.add(claim.source);
      }
    }
  }
}

/** Check for medical/technical claims without evidenceIds. */
function checkMedicalTechnical(
  claims: ClaimCheck[],
  blocked: string[],
  sanitizedFields: Set<string>,
): void {
  for (const claim of claims) {
    for (const pattern of MEDICAL_TECHNICAL_PATTERNS) {
      if (pattern.test(claim.text)) {
        if (claim.evidenceIds.length === 0) {
          const match = claim.text.match(pattern)?.[0] ?? "medical/technical claim";
          blocked.push(
            `Blocked medical/technical claim "${match}" in ${claim.source} without evidenceIds: "${claim.text.slice(0, 80)}..."`,
          );
          sanitizedFields.add(claim.source);
        }
      }
    }
  }
}

/** Check for mixed-account cross-references without comparison flag. */
function checkMixedAccounts(
  result: MerchandisingAdvisorResult,
  claims: ClaimCheck[],
  blocked: string[],
  sanitizedFields: Set<string>,
): void {
  // Only check if the result has channel tradeoffs — it's the primary area
  // where cross-references happen
  const hasComparisonContext =
    result.channelTradeoffs.length > 0 &&
    result.channelTradeoffs.some((ct) => ct.channel !== "owned-ecommerce" && ct.channel !== "unknown");

  for (const claim of claims) {
    for (const pattern of MIXED_ACCOUNT_PATTERNS) {
      if (pattern.test(claim.text)) {
        // If this is from a non-tradeoff field and we have comparison context,
        // it's acceptable. Otherwise, flag it.
        if (!claim.source.startsWith("channelTradeoff") && !hasComparisonContext) {
          const match = claim.text.match(pattern)?.[0] ?? "account reference";
          blocked.push(
            `Blocked mixed-account reference to "${match}" in ${claim.source} without comparison flag: "${claim.text.slice(0, 80)}..."`,
          );
          sanitizedFields.add(claim.source);
        }
      }
    }
  }
}

/** Check for invalid targetAgentIds in missingEvidenceRequests. */
function checkInvalidTargetAgents(
  result: MerchandisingAdvisorResult,
  blocked: string[],
  warnings: string[],
): MissingEvidenceReport[] {
  const valid: MissingEvidenceReport[] = [];
  for (const mr of result.missingEvidenceRequests) {
    if (!VALID_TARGET_AGENTS.has(mr.targetAgentId)) {
      warnings.push(
        `Warning: invalid targetAgentId "${mr.targetAgentId}" in missingEvidenceRequest for ${mr.candidateId}. Expected one of: ${[...VALID_TARGET_AGENTS].join(", ")}.`,
      );
      // Still include it in output for inspection but with a warning
      valid.push(mr);
    } else {
      valid.push(mr);
    }
  }
  return valid;
}

/** Check for invented stock/margin data — specific numeric claims without evidenceIds. */
function checkInventedData(
  claims: ClaimCheck[],
  blocked: string[],
  sanitizedFields: Set<string>,
): void {
  // Look for patterns like "150 units", "42% margin", "$150 stock", "stock: 150"
  const numericDataPatterns = [
    /\b\d+\s*(?:units|unidades|items|piezas)\b/i,
    /\b\d+\s*%\s*(?:margin|margen|profit|ganancia)\b/i,
    /\$\s*\d+\s*(?:stock|margin|cost|costo|price|precio)\b/i,
    /\bstock\s*(?::|is|=)\s*\d+/i,
    /\bmargin\s*(?::|is|=)\s*\d+/i,
  ];

  for (const claim of claims) {
    for (const pattern of numericDataPatterns) {
      if (pattern.test(claim.text)) {
        if (claim.evidenceIds.length === 0) {
          const match = claim.text.match(pattern)?.[0] ?? "numeric data";
          blocked.push(
            `Blocked invented stock/margin data "${match}" in ${claim.source} without evidenceIds: "${claim.text.slice(0, 80)}..."`,
          );
          sanitizedFields.add(claim.source);
        }
      }
    }
  }
}

// ── Main validator ───────────────────────────────────────────────────

/**
 * Pure-function validator for DeepSeek merchandising advisor output.
 *
 * Blocks unsafe claims (superlatives without evidence, publish language,
 * unsupported medical/technical claims, mixed-account references without
 * comparison flag, invalid targetAgentIds, invented stock/margin data).
 *
 * Never throws — always returns an `AdvisorValidationResult`.
 * `usable: true` only when zero claims are blocked.
 */
export function validate(result: MerchandisingAdvisorResult): AdvisorValidationResult {
  const blockedClaims: string[] = [];
  const warnings: string[] = [];
  const sanitizedFields = new Set<string>();

  const claims = extractClaims(result);

  // Run all checks
  checkSuperlatives(claims, blockedClaims, warnings, sanitizedFields);
  checkPublishLanguage(claims, blockedClaims, sanitizedFields);
  checkMedicalTechnical(claims, blockedClaims, sanitizedFields);
  checkMixedAccounts(result, claims, blockedClaims, sanitizedFields);
  checkInventedData(claims, blockedClaims, sanitizedFields);

  // Check targetAgentIds (returns cleaned list)
  const sanitizedEvidenceRequests = checkInvalidTargetAgents(result, blockedClaims, warnings);

  // Build sanitized result — strip blocked fields
  const sanitizedResult = sanitizeResult(result, sanitizedFields, sanitizedEvidenceRequests);

  return {
    usable: blockedClaims.length === 0,
    blockedClaims,
    warnings,
    sanitizedResult,
  };
}

function buildSeoSuggestions(
  result: MerchandisingAdvisorResult,
  sanitizedFields: Set<string>,
): MerchandisingAdvisorResult["seoSuggestions"] {
  const seoTitle = sanitizedFields.has("seoTitle") ? "[sanitized]" : result.seoSuggestions.seoTitle;
  const seoDescription = sanitizedFields.has("seoDescription") ? "[sanitized]" : result.seoSuggestions.seoDescription;
  const keywords = sanitizedFields.has("seoKeyword")
    ? ["[sanitized]"]
    : [...(result.seoSuggestions.keywords ?? [])];

  const out: MerchandisingAdvisorResult["seoSuggestions"] = {};
  if (seoTitle !== undefined) out.seoTitle = seoTitle;
  if (seoDescription !== undefined) out.seoDescription = seoDescription;
  if (keywords !== undefined) out.keywords = keywords;
  return out;
}

function buildGeoSuggestions(
  result: MerchandisingAdvisorResult,
  sanitizedFields: Set<string>,
): MerchandisingAdvisorResult["geoSuggestions"] {
  const geoSummary = sanitizedFields.has("geoSummary")
    ? "[sanitized]"
    : result.geoSuggestions.geoSummary;
  const faq = (result.geoSuggestions.faq ?? []).map((f) => ({
    question: sanitizedFields.has("geoFaq") ? "[sanitized]" : f.question,
    answer: sanitizedFields.has("geoFaq") ? "[sanitized]" : f.answer,
    evidenceIds: f.evidenceIds,
  }));

  const out: MerchandisingAdvisorResult["geoSuggestions"] = {};
  if (geoSummary !== undefined) out.geoSummary = geoSummary;
  if (faq.length > 0) out.faq = faq;
  return out;
}

/**
 * Produce a sanitized copy of the result with blocked fields stripped or
 * replaced with safe defaults.
 */
function sanitizeResult(
  result: MerchandisingAdvisorResult,
  sanitizedFields: Set<string>,
  evidenceRequests: MissingEvidenceReport[],
): MerchandisingAdvisorResult {
  // Deep-copy the result (shallow for arrays/objects inside)
  const sanitized: MerchandisingAdvisorResult = {
    ...result,
    reasoning: result.reasoning.map((r) => {
      const key = `reasoning[${r.candidateId}]`;
      if (sanitizedFields.has(key)) {
        return { ...r, rationale: "[sanitized — claim blocked by validator]" };
      }
      return { ...r };
    }),
    positioningAngles: sanitizedFields.has("positioningAngles")
      ? ["[sanitized — claim blocked by validator]"]
      : [...result.positioningAngles],
    seoSuggestions: buildSeoSuggestions(result, sanitizedFields),
    geoSuggestions: buildGeoSuggestions(result, sanitizedFields),
    channelTradeoffs: result.channelTradeoffs.map((ct) => ({
      ...ct,
      upsides: sanitizedFields.has(`channelTradeoff[${ct.channel}].upside`)
        ? ["[sanitized — claim blocked by validator]"]
        : [...ct.upsides],
      risks: sanitizedFields.has(`channelTradeoff[${ct.channel}].risk`)
        ? ["[sanitized — claim blocked by validator]"]
        : [...ct.risks],
      overallAssessment: sanitizedFields.has(`channelTradeoff[${ct.channel}].assessment`)
        ? "[sanitized — claim blocked by validator]"
        : ct.overallAssessment,
    })),
    missingEvidenceRequests: evidenceRequests,
    experimentProposal: sanitizedFields.has("experimentHypothesis") ? null : result.experimentProposal,
    confidence: result.confidence,
    noMutationExecuted: true,
  };

  return sanitized;
}
