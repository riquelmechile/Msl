# Proposal: Align Repository Documentation with Intelligent Agent Enterprise Vision

## Status
Proposed

## Problem Statement

The main repository documentation (README.md, ARCHITECTURE.md, ROADMAP.md, docs/agent-enterprise-vision.md) contains multiple contradictions with the actual code at HEAD (`413248c`). These documents reference outdated figures, misrepresent implementation status, and lack the canonical target organization that defines MSL as an Intelligent Agent Enterprise for Commerce.

### Contradictions Identified

| Document | Claim | Reality (HEAD `413248c`) |
|---|---|---|
| README.md | "1844 tests passing" | 2470 passing, 7 skipped |
| README.md | "12 autonomous specialist daemons" | 14 daemon handlers in `daemonHandlerMap` |
| README.md | "31 Business Tools" | To be verified against actual tool exports |
| README.md | "5 specialist lanes" (implied) | 15 lane contracts in `LANE_CONTRACTS` |
| ARCHITECTURE.md | "5 specialist lanes" | 15 lanes registered |
| ARCHITECTURE.md | "4 autonomous daemons on 15-min schedule" | 14 daemon handlers registered |
| ARCHITECTURE.md | "~98% cache discount" | Unverified; not supported by code evidence |
| ROADMAP.md | "4 cache-resident specialist lanes" | 15 lanes exist |
| ROADMAP.md | Outdated Phase descriptions | Multi-agent evidence responses, Work Sessions, Account Brain already implemented |
| agent-enterprise-vision.md | Missing target organization | Lacks canonical list of future agents, the intelligent core vs. deterministic safety shell framing, and the DeepSeek cache economics explanation |

### Root Cause

Documentation accumulated through many PRs without a dedicated alignment pass. Some files (README, ARCHITECTURE) were written at an earlier stage and were not regenerated from current code. Others (ROADMAP) include historical phase descriptions that were already implemented in subsequent PRs.

## Approach

1. **Inspect** the actual code at HEAD to derive all numbers, counts, and capabilities directly from source.
2. **Regenerate ARCHITECTURE.md** from code inspection — verify every claim against packages/agent/src/index.ts, daemonScheduler.ts, lanes.ts, companyAgents.ts, evidence/responders, MCP tool count.
3. **Rewrite agent-enterprise-vision.md** as the canonical stable constitution: define the intelligent-core-plus-deterministic-safety-shell architecture, DeepSeek cache economics, the difference between approval learning and economic outcome learning, and the full target organization of future agents (clearly marked as TARGET).
4. **Rewrite ROADMAP.md** as a forward-looking document starting from the verified current state, prioritizing P0-P6 vertical capabilities with business purpose, dependencies, and acceptance criteria — no arbitrary dates.
5. **Rewrite README.md** as an honest professional introduction: what MSL is, what works now, what doesn't, quick start, package map, but free of stale numbers and unverified claims.
6. **Create docs/README.md** as a documentation index classifying documents as canonical, architectural, operational, roadmap, or historical.
7. **Verify** all links, headers, terminology (agent vs. daemon vs. lane vs. handler), and consistent use of English for technical terms within Spanish prose.
8. **Archive** the change following existing OpenSpec conventions.

## Scope

### In Scope
- `README.md` — full rewrite from code-derived truth
- `ARCHITECTURE.md` — regenerate from HEAD code inspection
- `ROADMAP.md` — rewrite as forward-looking P0-P6 capability roadmap
- `docs/agent-enterprise-vision.md` — rewrite as canonical constitution with target organization
- `docs/README.md` — new documentation index (create if absent)
- All changed files: verify Markdown links, headings, terminology, spelling

### Out of Scope
- New agents, daemons, or handlers
- Production behavior changes
- Public API/contract modifications
- Application logic changes
- Deleting historical files
- Changing `openspec/specs/` delta specs
- Adding eslint-disable, ts-ignore, or other suppression mechanisms

## Constraints

- Documentation-only diff
- No test count badges (use CI badge only)
- No unverified capability claims
- Future agents must be marked TARGET — not presented as implemented
- English for technical artifacts (class names, package names, tool names) within Spanish prose
- "Agente" for intelligent entities, "daemon" for technical cycle processes
- Spanish neutral/professional for the README, technical terms in original language

## Verification Plan

1. `npm run format:check` — must pass
2. `npm run typecheck` — must pass (docs-only change shouldn't break it)
3. `npm run lint` — must pass
4. `npm test` — must pass
5. `git diff --check` — no whitespace issues
6. `npm run build` — must pass (docs-only change)
7. Manual: every claimed count/link verified against source code

## Rollback

Revert the commit. No application state is changed.

## Related

- `docs/architecture/multi-agent-evidence-responses.md` — evidence response design (already accurate)
- `docs/architecture/owned-ecommerce-deepseek-advisor.md` — merchandising advisor design
- `docs/architecture/owned-ecommerce-intelligence.md` — supplier-web-signal pipeline
