# V3 Review Framework Incident — Freeze-Findings Zero State

## Decision

V3 is permanently non-authoritative for PASS evidence. Create a new v4 lineage only after the documentary corrections are reviewed; do not repair, edit, or reinterpret v3.

## Incident record

| Field | Value |
|---|---|
| Timestamp | 2026-07-12 (audit) |
| Gentle AI version | 1.49.0 |
| Lineage | `finalize-economic-run-consistency-fetch-remediation-design-v3` |
| Native snapshot | `sha256:8211ecb0c9ed7154c7204e535b923b8c9d2c99add79d92d1652752e05dfcb280` |
| Candidate tree | `c2800eb03bb5b82359006f6f6e40390ca04f4558` |
| Accidental action | schema probe invoked native `freeze-findings` with an empty ledger |
| Final native state | `findings_frozen`, zero findings, `refuter_batches=0` |

The native event store, candidate, and application code were unchanged by the audit. No manual event, ledger, mirror, candidate, or code edit was made to recover the lineage. Repository transaction JSON is a stale informational mirror, not authoritative; the native store is authoritative. The audit found no supported Gentle AI 1.49.0 administrative recovery command.

## Consequences

- V3 MUST NOT be used as PASS, four-lens, finding, classification, or refuter evidence.
- Existing review mirrors and event stores are preserved unchanged.
- The incident does not erase the independently documented v3 design findings; those are resolved only as planned R1–R8 work.

## V4 review policy decision

V4 MUST execute the four native lenses and persist one consolidated native ledger with each finding labelled by lens. Gentle AI 1.49.0 cannot persist separate lens-execution identities, so no artifact may claim that capability. The canonical review policy does **not** require manufactured inferential findings: classify genuine severe evidence, and run exactly one native refuter batch only when pending inferential severe candidates exist.

The canonical contract permits batches only for genuine inferential severe candidates; it does not demand an empty or fabricated batch. The complete v4 lineage has one genuine native batch, so any historical positive-counter requirement is satisfied by that evidence, not elevated into a universal rule. This correction does not grant PASS evidence: R1–R8 remain unchecked.
