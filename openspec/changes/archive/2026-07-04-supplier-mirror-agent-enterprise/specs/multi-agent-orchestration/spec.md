# Delta for Multi-Agent Orchestration

## ADDED Requirements

### Requirement: CEO-Only Supplier Mirror Coordination

The CEO lane MUST coordinate Supplier Mirror work while hiding internal supplier workers from Telegram UX. Supplier lanes MAY investigate, enrich, classify, and propose, but MUST return evidence-backed outputs to the CEO rather than messaging the user directly.

#### Scenario: Supplier lane completes analysis
- GIVEN a supplier worker analyzes stock, enrichment, or pricing evidence
- WHEN it finishes
- THEN it MUST return bounded evidence and recommendation to the CEO lane
- AND the user MUST receive only the CEO synthesis

#### Scenario: User requests worker selection
- GIVEN the user asks Telegram to choose a supplier worker directly
- WHEN orchestration resolves the request
- THEN the CEO MUST retain coordination and explain available business decision instead

### Requirement: Supplier DeepSeek Lane Cost Discipline

Supplier lanes MUST use stable cacheable prefixes and separate volatile supplier evidence into refreshable context. V4 Flash MUST be the default for extraction/classification; V4 Pro MAY be used only for hard policy reasoning with usage evidence.

#### Scenario: Routine supplier classification
- GIVEN a supplier item needs routine extraction or classification
- WHEN a supplier lane invokes DeepSeek
- THEN it MUST select V4 Flash and record cache/cost evidence

#### Scenario: Hard policy reasoning
- GIVEN conflicting pricing, targeting, or autonomy evidence requires deeper reasoning
- WHEN the CEO escalates model choice
- THEN V4 Pro MAY be used with a ledgered reason
