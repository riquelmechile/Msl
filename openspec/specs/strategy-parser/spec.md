# Strategy Parser Specification

## Purpose

Extract structured business rules from natural Spanish CEO strategy text using hybrid pattern+LLM parsing, and persist them with full lifecycle management in SQLite.

## Requirements

### Requirement: Hybrid Strategy Parsing

The system MUST parse CEO strategy text using regex patterns as primary path with LLM fallback for ambiguous or unmatched input.

#### Scenario: Simple margin rule matched by pattern

- GIVEN the CEO types "margen 50% en electrónica"
- WHEN the parser runs
- THEN it MUST extract `{ type: 'margin', target: 50, category: 'electrónica' }` via pattern matching
- AND set `source: 'pattern'`

#### Scenario: Complex phrasing falls back to LLM

- GIVEN the CEO types a strategy with ambiguous Spanish that patterns cannot fully match
- WHEN the pattern pass returns low confidence or unmatched snippets
- THEN the system MUST invoke the LLM fallback for structured extraction
- AND set `source: 'llm'` or `'hybrid'`

#### Scenario: No API key available

- GIVEN `DEEPSEEK_API_KEY` is not set
- WHEN the pattern pass cannot fully parse the input
- THEN the system MUST return partial results with a warning log
- AND MUST NOT fail or throw

### Requirement: Rule Type Classification

The system MUST classify extracted rules into exactly one of these types: margin, stock, category, pricing, customer, competitive, priority, timing, competitor.

#### Scenario: Stock priority rule

- GIVEN the CEO types "priorizá stock de +10 en productos estrella"
- WHEN the parser extracts the rule
- THEN it MUST classify as `stock` with `threshold: 10, product_filter: 'star'`

#### Scenario: Category exclusion rule

- GIVEN the CEO types "no compitas en juguetes"
- WHEN the parser extracts the rule
- THEN it MUST classify as `category` with `categories: ['juguetes']`

### Requirement: Confidence Scoring

The system MUST assign a confidence score (0.0–1.0) to each extracted rule and SHOULD reject rules below a configurable threshold (default: 0.5).

#### Scenario: High-confidence pattern match

- GIVEN a rule is extracted via regex with exact match
- WHEN confidence is computed
- THEN it MUST be >= 0.8

#### Scenario: Low-confidence extraction rejected

- GIVEN the parser extracts a rule with confidence < 0.5
- WHEN the result is validated
- THEN the system SHOULD discard the rule and report it to the CEO

### Requirement: Spanish Natural Language Input

The system MUST accept strategy text exclusively in Spanish and MUST NOT require structured formats or commands.

#### Scenario: Multi-rule single message

- GIVEN the CEO types "margen 50% en electrónica, priorizá stock +10"
- WHEN the parser runs
- THEN it MUST extract both a margin rule and a stock rule from the single input

#### Scenario: Grammatical variation

- GIVEN the CEO writes "quiero un margen del 50 por ciento para electrónica"
- WHEN the parser runs
- THEN it MUST correctly extract the margin rule regardless of wording variation

### Requirement: Strategy Persistence and Lifecycle

The system MUST persist strategies in a `ceo_strategies` table with active/inactive lifecycle and supersede tracking via `replaced_by`.

#### Scenario: New strategy persisted

- GIVEN the parser extracts a valid strategy rule
- WHEN the strategy is saved
- THEN it MUST be stored with `status=active` and `created_at` timestamp

#### Scenario: Strategy updated via supersede

- GIVEN an active margin strategy exists for "electrónica"
- WHEN the CEO changes the margin for "electrónica"
- THEN the old strategy MUST be set `status=superseded` with `replaced_by` pointing to the new strategy ID

#### Scenario: Active strategies queried

- GIVEN multiple strategies exist with mixed active/inactive states
- WHEN active strategies are loaded for prompt injection
- THEN only `status='active'` rows MUST be returned

---

### Requirement: Probe Strategy Parsing

The system MUST parse CEO honey-pot directives into structured probe strategies using regex patterns with LLM fallback. Recognized patterns: `"probá competidores en {cat}"`, `"creá listing señuelo en {cat}"`, `"monitoreá reacciones de {competidor}"`. Extracted rules MUST classify as type `probe` with subtype: `probe_category`, `deploy_decoy`, or `monitor_competitor`.

#### Scenario: Probe category directive matched by pattern

- GIVEN the CEO types "probá competidores en electrónica"
- WHEN the parser runs
- THEN it MUST extract `{ type: 'probe', subtype: 'probe_category', category: 'electrónica' }` via pattern matching

#### Scenario: Decoy deployment directive

- GIVEN the CEO types "creá listing señuelo en juguetes"
- WHEN the parser runs
- THEN it MUST extract `{ type: 'probe', subtype: 'deploy_decoy', category: 'juguetes' }`

#### Scenario: Monitor competitor directive

- GIVEN the CEO types "monitoreá reacciones de CompetidorX"
- WHEN the parser runs
- THEN it MUST extract `{ type: 'probe', subtype: 'monitor_competitor', target: 'CompetidorX' }`

#### Scenario: Probe directive ambiguity falls back to LLM

- GIVEN the CEO types an ambiguous honey-pot directive patterns cannot fully match
- WHEN the pattern pass returns low confidence
- THEN the system MUST invoke LLM fallback and set `source: 'llm'`

#### Scenario: Probe strategy persisted to ceo_strategies

- GIVEN a probe directive is extracted
- WHEN the strategy is saved
- THEN it MUST be stored in `ceo_strategies` with `type='probe'` and `status='active'`
