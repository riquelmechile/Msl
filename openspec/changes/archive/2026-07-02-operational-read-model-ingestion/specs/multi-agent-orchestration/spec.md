# Delta for multi-agent-orchestration

## ADDED Requirements

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

## MODIFIED Requirements

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
