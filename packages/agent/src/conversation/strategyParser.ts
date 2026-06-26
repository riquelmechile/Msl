import type { ParsedRule, ParseResult, RuleType } from "./types.js";

// ── Regex Patterns ──────────────────────────────────────────────────
//
// Each pattern captures Spanish CEO directives.  Patterns are applied
// independently so multi-rule text ("margen 50% y priorizar +10 stock")
// produces two ParsedRule entries with non-overlapping match ranges.

/** "margen [mínimo|máximo|objetivo] N%" or "margen del N%" or "margen a N%" */
const MARGIN_RE = /margen\s*(m[íi]nimo|m[áa]ximo|objetivo|del)?\s*(?:a\s+)?(\d+)\s*%/gi;

/** "N%+ margen" — reverse phrasing like "apunto a 50%+ margen" */
const MARGIN_REVERSE_RE = /(\d+)\s*%\s*\+\s*margen/gi;

/** "prioriz[o|á|ar] +N stock [en scope]" */
const STOCK_RE = /(prioriz(?:o|á|ar)?)\s*\+\s*(\d+)\s*(stock|unidades)(?:\s+en\s+([^,.\n]+))?/gi;

/** "no competir en X" — category exclusion */
const NO_COMPETIR_RE = /no\s+competir\s+en\s+([^,.\n]+)/gi;

/** "enfocarse|enfocate|enfocar en X" — category focus */
const ENFOCAR_RE = /(?:enfocarse|enfocate|enfocar)\s+en\s+([^,.\n]+)/gi;

/** "precio máximo|mínimo $N [en scope]" */
const PRICING_RE = /precio\s+(m[áa]ximo|m[íi]nimo)\s*\$?(\d+)(?:\s+en\s+([^,.\n]+))?/gi;

/** "responder|contestar en [<]N hora|minuto" — response-time pledge */
const CUSTOMER_RE = /(?:responder|contestar)\s+en\s*(?:[<>])?\s*(\d+)\s*(horas?|minutos?)/gi;

/** "igualar precio de X" — competitive price-matching */
const COMPETITIVE_RE = /igualar\s+precio\s+de\s+([^,.\n]+)/gi;

/** "probá|sondeá|monitoreá|investigá [categoría] X" — honey-pot probe on category */
const PROBE_CATEGORY_RE =
  /(probá|sondeá|monitoreá|investigá)\s+(?:categor(?:í|i)a\s+)?([^,.\n]+)/gi;

/** "vigilá|seguí|trackeá [a] X" — honey-pot monitor competitor */
const PROBE_COMPETITOR_RE = /(vigilá|seguí|trackeá)\s+(?:a\s+)?([^,.\n]+)/gi;

/** "creá|crea|publicá|publica listing|listado|publicación|publicacion señuelo en X" — deploy decoy */
const DEPLOY_DECOY_RE =
  /(creá|crea|publicá|publica)\s+(listing|listado|publicación|publicacion)\s+señuelo\s+en\s+(.+)/gi;

// ── Internal helpers ────────────────────────────────────────────────

type PatternMatch = {
  start: number;
  end: number;
  rule: ParsedRule;
};

/**
 * Return every regex match across `text` as a PatternMatch entry.
 * `extract` receives the match array and must return the ParsedRule
 * (or null to skip this match).
 */
function collectMatches(
  text: string,
  re: RegExp,
  extract: (m: RegExpMatchArray) => ParsedRule | null,
): PatternMatch[] {
  const results: PatternMatch[] = [];
  // Reset lastIndex in case the regex was used elsewhere.
  re.lastIndex = 0;

  for (const m of text.matchAll(re)) {
    const rule = extract(m);
    if (rule && m.index !== undefined) {
      results.push({ start: m.index, end: m.index + m[0].length, rule });
    }
  }
  return results;
}

/**
 * Build the base ParsedRule fields shared by every pattern.
 * `originalText` is always `m[0]` which is guaranteed by `matchAll`.
 */
function baseRule(
  ruleType: RuleType,
  target: string,
  operator: string,
  value: string,
  m: RegExpMatchArray,
): Omit<ParsedRule, "scope"> {
  return {
    ruleType,
    target,
    operator,
    value,
    priority: 5 as const,
    originalText: m[0],
  };
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Determine the `RuleType` for a partially-built rule.
 *
 * Inspects the `target` field (set by pattern matchers to the semantic
 * domain like "margen", "stock", etc.) and falls back to "margin" when
 * the target is unrecognised.
 */
export function classifyRuleType(parsed: Partial<ParsedRule>): RuleType {
  if (parsed.ruleType) return parsed.ruleType;

  const t = (parsed.target ?? "").toLowerCase();

  if (t.includes("margen")) return "margin";
  if (t.includes("stock") || t.includes("unidad")) return "stock";
  if (t.includes("categor") || t.includes("competir") || t.includes("enfocar")) return "category";
  if (t.includes("precio")) return "pricing";
  if (t.includes("responder") || t.includes("contestar") || t.includes("cliente"))
    return "customer";
  if (t.includes("igualar") || t.includes("competencia")) return "competitive";
  if (
    t.includes("probá") ||
    t.includes("sondeá") ||
    t.includes("monitoreá") ||
    t.includes("investigá") ||
    t.includes("vigilá") ||
    t.includes("seguí") ||
    t.includes("trackeá")
  )
    return "probe";

  return "margin";
}

/**
 * Parse CEO strategy text into structured rules.
 *
 * Applies regex patterns as the primary extraction path.  Text
 * fragments that do not match any pattern are collected in
 * `ParseResult.unparsed`.
 *
 * Pure function — no external dependencies, no LLM calls.
 */
export function parseStrategy(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return { rules: [], unparsed: [], confidence: 0 };
  }

  // ── 1. Run all pattern matchers ──────────────────────────────────

  const allMatches: PatternMatch[] = [];

  // Margin: "margen [mínimo|máximo] N%"
  allMatches.push(
    ...collectMatches(trimmed, MARGIN_RE, (m) => {
      const qualifier = (m[1] ?? "").toLowerCase();
      const isMax = qualifier.includes("áx") || qualifier.includes("ax");
      return {
        ...baseRule("margin", "margen", isMax ? "<=" : ">=", `${m[2]!}%`, m),
      };
    }),
  );

  // Margin reverse: "N%+ margen"
  allMatches.push(
    ...collectMatches(trimmed, MARGIN_REVERSE_RE, (m) => ({
      ...baseRule("margin", "margen", ">=", `${m[1]!}%`, m),
    })),
  );

  // Stock: "priorizo +10 stock [en scope]"
  allMatches.push(
    ...collectMatches(trimmed, STOCK_RE, (m) => {
      const scope = m[4]?.trim();
      return {
        ...baseRule("stock", "stock", "priorizar", `+${m[2]!}`, m),
        ...(scope ? { scope } : {}),
      };
    }),
  );

  // Category exclusion: "no competir en X"
  allMatches.push(
    ...collectMatches(trimmed, NO_COMPETIR_RE, (m) => ({
      ...baseRule("category", "categoría", "evitar", m[1]!.trim(), m),
    })),
  );

  // Category focus: "enfocate en X"
  allMatches.push(
    ...collectMatches(trimmed, ENFOCAR_RE, (m) => ({
      ...baseRule("category", "categoría", "enfocar", m[1]!.trim(), m),
    })),
  );

  // Pricing: "precio máximo|mínimo $N [en scope]"
  allMatches.push(
    ...collectMatches(trimmed, PRICING_RE, (m) => {
      const qualifier = (m[1] ?? "").toLowerCase();
      const isMin = qualifier.includes("ín") || qualifier.includes("in");
      const scope = m[3]?.trim();
      return {
        ...baseRule("pricing", "precio", isMin ? ">=" : "<=", m[2]!, m),
        ...(scope ? { scope } : {}),
      };
    }),
  );

  // Customer: "responder en <1 hora"
  allMatches.push(
    ...collectMatches(trimmed, CUSTOMER_RE, (m) => ({
      ...baseRule("customer", "cliente", "<=", `${m[1]!} ${m[2]!}`, m),
    })),
  );

  // Competitive: "igualar precio de X"
  allMatches.push(
    ...collectMatches(trimmed, COMPETITIVE_RE, (m) => ({
      ...baseRule("competitive", "competencia", "igualar", m[1]!.trim(), m),
    })),
  );

  // Probe category: "probá [categoría] X"
  allMatches.push(
    ...collectMatches(trimmed, PROBE_CATEGORY_RE, (m) => ({
      ...baseRule("probe", "categoría", m[1]!.toLowerCase(), m[2]!.trim(), m),
    })),
  );

  // Probe competitor: "vigilá [a] X"
  allMatches.push(
    ...collectMatches(trimmed, PROBE_COMPETITOR_RE, (m) => ({
      ...baseRule("probe", "competidor", m[1]!.toLowerCase(), m[2]!.trim(), m),
    })),
  );

  // Decoy deploy: "creá listing señuelo en X"
  allMatches.push(
    ...collectMatches(trimmed, DEPLOY_DECOY_RE, (m) => ({
      ...baseRule("probe", "decoy", "deploy", m[3]!.trim(), m),
    })),
  );

  // ── 2. Sort + merge overlapping match ranges ─────────────────────

  allMatches.sort((a, b) => a.start - b.start);

  const merged: PatternMatch[] = [];
  for (const match of allMatches) {
    const last = merged[merged.length - 1];
    if (!last || match.start > last.end) {
      merged.push(match);
    } else {
      // Overlap — keep the wider range but only the first rule.
      last.end = Math.max(last.end, match.end);
    }
  }

  // ── 3. Extract unparsed gaps ─────────────────────────────────────

  const unparsed: string[] = [];
  let pos = 0;
  for (const match of merged) {
    if (pos < match.start) {
      const gap = trimmed.slice(pos, match.start).trim();
      if (gap) unparsed.push(gap);
    }
    pos = match.end;
  }
  if (pos < trimmed.length) {
    const tail = trimmed.slice(pos).trim();
    if (tail) unparsed.push(tail);
  }

  // ── 4. Compute aggregate confidence ──────────────────────────────

  const rules = merged.map((m) => m.rule);
  const confidence =
    rules.length > 0 ? Number((rules.reduce((sum) => sum + 1.0, 0) / rules.length).toFixed(2)) : 0;

  return { rules, unparsed, confidence };
}
