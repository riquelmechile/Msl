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

The system MUST classify extracted rules into exactly one of these types: margin, stock_priority, category_focus, category_exclusion, pricing_cap, pricing_floor, competitive, customer_priority, risk_appetite.

#### Scenario: Stock priority rule

- GIVEN the CEO types "priorizá stock de +10 en productos estrella"
- WHEN the parser extracts the rule
- THEN it MUST classify as `stock_priority` with `threshold: 10, product_filter: 'star'`

#### Scenario: Category exclusion rule

- GIVEN the CEO types "no compitas en juguetes"
- WHEN the parser extracts the rule
- THEN it MUST classify as `category_exclusion` with `categories: ['juguetes']`

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
- THEN it MUST extract both a margin rule and a stock_priority rule from the single input

#### Scenario: Grammatical variation

- GIVEN the CEO writes "quiero un margen del 50 por ciento para electrónica"
- WHEN the parser runs
- THEN it MUST correctly extract the margin rule regardless of wording variation

### Requirement: Strategy Persistence and Lifecycle

The system MUST persist strategies in a `business_strategies` table with active/inactive lifecycle and supersede tracking via `replaced_by`.

#### Scenario: New strategy persisted

- GIVEN the parser extracts a valid strategy rule
- WHEN the strategy is saved
- THEN it MUST be stored with `active=1` and `created_at` timestamp

#### Scenario: Strategy updated via supersede

- GIVEN an active margin strategy exists for "electrónica"
- WHEN the CEO changes the margin for "electrónica"
- THEN the old strategy MUST be set `active=0` with `replaced_by` pointing to the new strategy ID

#### Scenario: Active strategies queried

- GIVEN multiple strategies exist with mixed active/inactive states
- WHEN active strategies are loaded for prompt injection
- THEN only `active=1` rows MUST be returned
