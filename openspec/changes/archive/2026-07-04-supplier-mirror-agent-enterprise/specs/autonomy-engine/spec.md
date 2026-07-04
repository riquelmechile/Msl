# Delta for Autonomy Engine

## ADDED Requirements

### Requirement: Progressive Supplier Mirror Autonomy

Supplier Mirror autonomy MUST start with manual CEO policy decisions, learn repeated pricing, targeting, stock, and notification decisions through Cortex, and later allow CEO-proposed deterministic policies before any broader auto-execution.

#### Scenario: Initial supplier policy missing
- GIVEN a supplier item requires pricing or target-account policy
- WHEN no learned or deterministic policy exists
- THEN the CEO MUST ask the user for a manual decision before action

#### Scenario: Deterministic policy proposed
- GIVEN repeated user answers form stable evidence for a supplier policy
- WHEN the CEO detects enough support
- THEN it MAY propose a deterministic policy for explicit approval

#### Scenario: Autonomy not ready
- GIVEN learning evidence is sparse or contradictory
- WHEN Supplier Mirror considers auto-execution
- THEN it MUST remain proposal-only except verified allowed emergency pauses
