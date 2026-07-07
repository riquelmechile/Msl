# Multi-Agent Orchestration Specification

## Purpose

Define the long-term path for the principal business agent to coordinate specialized agents after it has learned enough seller-specific business context.

## Requirements

### Requirement: Learning Before Delegation

The system MUST keep the principal agent responsible for learning the seller's business model, operating style, decision criteria, workflows, and repeated tasks before proposing any specialized agent.

#### Scenario: Sufficient evidence exists

- GIVEN repeated seller workflows, corrections, outcomes, and decision patterns are available
- WHEN the principal agent identifies a specialization candidate
- THEN it MUST explain the evidence, proposed scope, expected value, and safety boundaries

#### Scenario: Evidence is insufficient

- GIVEN the agent has limited examples or unclear decision criteria
- WHEN specialized-agent creation is considered
- THEN the system MUST continue learning and MUST NOT propose creation as ready

### Requirement: Extension Path, Not MVP Automation

The system MUST treat multi-agent expansion as an evidence-governed extension path. It MAY create a specialized agent when an approved SDD change defines scope, boundaries, and safety controls; otherwise repeated tasks remain future candidates.
(Previously: Multi-agent expansion was future-only and not a core MVP automation path.)

#### Scenario: Approved change defines a specialist

- GIVEN an approved SDD change defines specialist scope and safety boundaries
- WHEN the principal agent activates the specialization
- THEN it MAY create or enable the specialist within those boundaries.

#### Scenario: User requests immediate sub-agent creation

- GIVEN learning evidence and safe boundaries are incomplete
- WHEN the seller requests a specialized agent
- THEN the system MUST explain the missing prerequisites and require more context first

### Requirement: Governed Specialized Agents

Specialized agents MUST inherit approval, audit, scope, and safety boundaries from the principal agent and MUST be created from evidence, not novelty.

#### Scenario: Specialized agent is proposed

- GIVEN a specialization candidate has sufficient evidence
- WHEN the proposal is presented
- THEN it MUST include scope, allowed actions, approval rules, audit requirements, and rollback expectations

#### Scenario: Novelty-driven suggestion appears

- GIVEN a new AI trend or tool seems interesting but lacks business evidence
- WHEN evaluating specialization
- THEN the system SHOULD reject or defer it with rationale

### Requirement: Cache-Resident Specialist Lanes

The system MUST define CEO, Cost/Supplier, Market/Catalog, and Creative/Commercial lanes with stable lane prefixes, bounded responsibilities, and proposal-only outputs. The Market/Catalog lane MUST read from the operational read model scoped to its seller partition (Plasticov or Maustian).

(Previously: Lanes were defined without seller partition scoping or operational read model integration.)

#### Scenario: CEO coordinates lanes

- GIVEN the seller approves bounded investigation
- WHEN specialist lanes complete their analysis
- THEN the CEO lane MUST synthesize one recommendation with risks, missing inputs, and evidence IDs

#### Scenario: Lane boundary exceeded

- GIVEN a lane needs an action outside its responsibility
- WHEN it prepares output
- THEN it MUST return a boundary warning instead of executing or expanding scope

### Requirement: DeepSeek Lane Cache Measurement

The system MUST measure `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens` per lane and MUST NOT hardcode whether provider cache isolation is API-key, account, or user scoped.

#### Scenario: Isolation strategy benchmarked

- GIVEN lane cache measurements are collected
- WHEN cache isolation differs by provider account, user, or API key
- THEN the system MUST compare lane hit rates without assuming the isolation mechanism

#### Scenario: Prefix proves unstable

- GIVEN a lane prefix causes repeated cache misses
- WHEN telemetry is evaluated
- THEN the system SHOULD revise prefix composition without changing durable memory semantics

### Requirement: Immutable Prefix Hygiene

Stable lane prefixes MUST contain durable role policy and boundaries only; volatile evidence, catalog snapshots, costs, and outcomes MUST remain outside immutable prefixes.

#### Scenario: Evidence is volatile

- GIVEN stock, cost, or market evidence changes frequently
- WHEN lane prompts are assembled
- THEN that evidence MUST be placed in refreshable context, not immutable prefix text

#### Scenario: Policy changes

- GIVEN safety policy or lane responsibility changes
- WHEN stable prefixes are regenerated
- THEN the system MUST accept the cache miss and preserve correctness

### Requirement: Forced Delegation Tool-Call Smoke

The system MUST validate provider support for proposal-only specialist delegation by forcing the named `delegate_to_subagent` tool in the optional DeepSeek live smoke. The smoke MUST validate only the returned tool-call contract and MUST NOT execute the returned delegation tool call or perform any business mutation.

#### Scenario: Named delegation tool is forced

- GIVEN the optional live DeepSeek smoke is enabled
- WHEN the provider request is created
- THEN `tool_choice` MUST force the named `delegate_to_subagent` function
- AND the available tool list MUST contain only the delegation schema needed for this smoke

#### Scenario: Delegation tool call is returned

- GIVEN DeepSeek returns a tool-call response
- WHEN the smoke validates the first tool call
- THEN the tool name MUST equal `delegate_to_subagent`
- AND the function arguments MUST be valid JSON for a bounded proposal-only delegation request

#### Scenario: Returned tool call is not executed

- GIVEN a valid `delegate_to_subagent` tool call is returned by DeepSeek
- WHEN smoke validation completes
- THEN the system MUST treat it as provider-contract evidence only
- AND it MUST NOT invoke the local delegation executor or mutate external systems

#### Scenario: Invalid tool contract fails safely

- GIVEN DeepSeek returns a non-tool finish reason, a different tool name, or malformed JSON arguments
- WHEN the smoke validates the response
- THEN the smoke MUST fail with a redacted diagnostic
- AND it MUST NOT retry with broader tools or execute any returned content

### Requirement: Seller-Lane Partitioning

The system MUST maintain three seller-lane partitions: Plasticov (own listings/evidence), Maustian (own listings/evidence), and CEO (aggregate orchestration view). Each seller lane MUST scope reads to its own `seller_id` and MUST NOT access another seller-lane's operational data.

#### Scenario: CEO reads from both lanes
- GIVEN Plasticov and Maustian lanes have independent operational snapshots
- WHEN the CEO lane gathers evidence
- THEN it MUST read from both lanes with per-lane seller scoping
- AND it MUST cite which lane each evidence ID belongs to

#### Scenario: Lane isolation enforced
- GIVEN the Plasticov lane is processing listing evidence
- WHEN it queries the operational read model
- THEN it MUST filter by Plasticov's seller_id only
- AND MUST NOT return Maustian's listing data

### Requirement: Lane Isolation Provenance

Each lane's output MUST include a source lane identifier and its associated seller account so the CEO can distinguish evidence provenance without leaking between partitions.

#### Scenario: CEO distinguishes lane evidence
- GIVEN the CEO receives outputs from Plasticov and Maustian lanes
- WHEN synthesizing a proposal
- THEN each evidence fragment MUST include source lane and seller account metadata
- AND the CEO MUST preserve per-lane freshness signals

### Requirement: CEO-Only Supplier Mirror Coordination

The CEO lane MUST coordinate Supplier Mirror and Owned Ecommerce work while hiding internal supplier/ecommerce workers from Telegram UX. Supplier and ecommerce lanes MAY investigate, enrich, classify, rank, and propose, but MUST return evidence-backed outputs to the CEO rather than messaging the user directly.
(Previously: The CEO lane coordinated Supplier Mirror work only.)

#### Scenario: Supplier lane completes analysis
- GIVEN a supplier worker analyzes stock, enrichment, or pricing evidence
- WHEN it finishes
- THEN it MUST return bounded evidence and recommendation to the CEO lane
- AND the user MUST receive only the CEO synthesis

#### Scenario: User requests worker selection
- GIVEN the user asks Telegram to choose a supplier or ecommerce worker directly
- WHEN orchestration resolves the request
- THEN the CEO MUST retain coordination and explain available business decision instead.

### Requirement: Owned Ecommerce Specialist Lane

The system MUST add an Owned Ecommerce Specialist under CEO orchestration to prepare Medusa-first storefront candidates, projections, SEO/GEO positioning, and readiness evidence as proposal-only outputs.

#### Scenario: Specialist prepares owned ecommerce proposal

- GIVEN the CEO lane requests owned ecommerce work
- WHEN the specialist evaluates catalog and supplier evidence
- THEN it MUST return ranked storefront recommendations with evidence, risks, and approval needs.

#### Scenario: Specialist attempts direct user interaction

- GIVEN the specialist needs a business decision
- WHEN the decision is outside available evidence
- THEN it MUST ask the CEO lane to question the human CEO through Telegram.

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

---

## ADDED: Agent Company Kernel Extensions (2026-07-07)

### Requirement: Suspended Agent Lifecycle State
The system SHALL support a `"suspended"` agent status between `"active"` and `"archived"` in the `company_agents` table CHECK constraint. Suspended agents SHALL NOT receive evidence requests, be targeted for lessons, or participate in workforce orchestration.

#### Scenario: Agent is suspended
- GIVEN an agent with status `"suspended"`
- WHEN the workforce orchestration evaluates active agents
- THEN the suspended agent SHALL be excluded from lane assignments and evidence requests

#### Scenario: Suspended agent can be reactivated
- GIVEN an agent with status `"suspended"`
- WHEN `updateCompanyAgent` sets status to `"active"`
- THEN the agent SHALL resume receiving assignments and context

#### Scenario: Suspended agent cannot be targeted for lessons
- GIVEN an agent with status `"suspended"`
- WHEN a lesson is recorded for the workforce
- THEN the suspended agent SHALL NOT be a lesson target

### Requirement: Update Company Agent
The system SHALL provide `updateCompanyAgent` in `CompanyAgentStore` with a corresponding tool `update_company_agent` gated behind admin authorization. Updatable fields SHALL include profile fields and status.

#### Scenario: Admin updates agent status
- GIVEN admin authorization is valid
- WHEN `update_company_agent` is called with `{ agent_id, status: "suspended" }`
- THEN the agent's status SHALL be updated in the store

#### Scenario: Unauthorized update blocked
- GIVEN the caller lacks admin authorization
- WHEN `update_company_agent` is called
- THEN the system SHALL reject with an authorization error

#### Scenario: Update non-existent agent
- GIVEN no agent exists with the given `agent_id`
- WHEN `update_company_agent` is called
- THEN the system SHALL return a controlled error

### Requirement: Skill-Aware Context in Orchestration
The system SHALL include agent skill summaries in Block C context during workforce orchestration. Skills SHALL be read from `agent_skills` for the active agent and injected alongside existing lesson and cost context.

#### Scenario: Active agent has skills during orchestration
- GIVEN the CEO or specialist lane is being assembled
- WHEN `buildBlockCContext` builds workforce context
- THEN the active agent's declared skills SHALL appear alongside lesson and cost summaries

#### Scenario: Agent has no skills
- GIVEN the active agent has zero registered skills
- WHEN workforce context is assembled
- THEN the skill section SHALL be omitted without error
