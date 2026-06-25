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

The system MUST treat multi-agent expansion as a future architectural extension, not a core MVP automation path.

#### Scenario: MVP detects a repeated task

- GIVEN the MVP observes a repeated task
- WHEN the principal agent reports it
- THEN it MAY record the task as a future specialization candidate without creating an agent

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
