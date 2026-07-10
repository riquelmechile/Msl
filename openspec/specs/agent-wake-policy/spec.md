# agent-wake-policy Specification

## Purpose

Signal detection and wake/skip decision for agent sessions. Prevents redundant LLM calls when signals are unchanged, while allowing manual override.

## Requirements

### Requirement: Signal Hashing

`hashAgentSignals(signals)` MUST produce a deterministic string from an array of signal descriptors. Same signals SHALL produce same hash. Different signals SHALL produce different hash.

#### Scenario: Same signals → same hash

- GIVEN `[{type:"unanswered_questions", count: 3}]`
- WHEN hash computed twice
- THEN both hashes equal

### Requirement: Wake Decision

`shouldAgentWakeUp(input)` MUST return `AgentWakeDecision` with `shouldWake: boolean` and `reason`. Rules: NO wake if same `signalsHash` + recent run + no new risks + equivalent pending proposal.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Same signal, recent session | `signalsHash` matches last session, ran < 1h ago | `shouldAgentWakeUp()` called | `shouldWake: false`, reason: "no new signals" |
| New ML question | Fresh unanswered question detected | Wake policy evaluated | `shouldWake: true`, reason: "new signal" |
| High risk despite cooldown | Risk severity `high` even within cooldown | Wake policy evaluated | `shouldWake: true`, cooldown overridden |
| Duplicate proposal | Equivalent proposal already pending in CEO inbox | Wake policy evaluated | `shouldWake: false`, reason: "pending equivalent" |
| Manual override | Input includes `manual: true` | Wake policy evaluated | `shouldWake: true` always |

### Requirement: Signal Delta

`computeSignalDelta(previous, current)` MUST compute `SignalDelta` with `added`, `removed`, `unchanged` signal lists. Used to determine what changed since last session.

#### Scenario: New risk signal added

- GIVEN previous: `[q_aging]`, current: `[q_aging, reputation_drop]`
- WHEN delta computed
- THEN `added = ["reputation_drop"]`, `unchanged = ["q_aging"]`

### Requirement: Seller Isolation

Seller A's signals MUST NOT affect seller B's wake decision. Each session evaluated per `sellerId` independently.

#### Scenario: Plasticov wakes, Maustian sleeps

- GIVEN Plasticov has new risk, Maustian has unchanged signals
- WHEN wake policy evaluated per seller
- THEN Plasticov's decision: `shouldWake: true`, Maustian's: `shouldWake: false`
