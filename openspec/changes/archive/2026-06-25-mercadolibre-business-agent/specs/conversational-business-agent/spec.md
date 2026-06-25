# Conversational Business Agent Specification

## Purpose

Define the Spanish-facing chat agent that learns the seller's business judgment for MercadoLibre Chile operations.

## Requirements

### Requirement: Spanish Business Conversation

The system MUST provide a Spanish conversational interface for questions, case review, and daily business reasoning.

#### Scenario: Seller asks for business advice

- GIVEN the seller asks in Spanish about a MercadoLibre business case
- WHEN the agent answers
- THEN it MUST respond in Spanish with a clear recommendation and rationale

#### Scenario: Missing operational context

- GIVEN the seller asks a question without enough context
- WHEN the agent cannot produce a reliable answer
- THEN it MUST ask for the missing context instead of guessing

### Requirement: Seller Judgment Learning

The system MUST learn seller preferences for margin, profit, customer treatment, claims, reputation risk, and daily priorities from corrections and real cases.

#### Scenario: Seller corrects agent judgment

- GIVEN the seller corrects a recommendation
- WHEN the correction is accepted
- THEN the agent MUST adapt future recommendations to that preference

#### Scenario: Preference conflicts with safety

- GIVEN a learned preference would increase reputation or compliance risk
- WHEN the agent applies the preference
- THEN it MUST explain the risk and require safer confirmation

### Requirement: Business Operating Model Learning

The system MUST learn the seller's business model, operating style, decision criteria, workflows, and repeated tasks before recommending structural automation or specialized agents.

#### Scenario: Seller repeats a workflow

- GIVEN the seller repeatedly performs or asks about the same workflow
- WHEN the agent updates business understanding
- THEN it MUST retain the workflow, decision criteria, and observed outcome as learning evidence

#### Scenario: Automation is premature

- GIVEN the agent lacks enough evidence about the workflow or decision criteria
- WHEN the seller asks for automation or delegation
- THEN it MUST ask for more context instead of proposing specialized agents
