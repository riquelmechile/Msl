# Delta for strategy-parser

## ADDED Requirements

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
