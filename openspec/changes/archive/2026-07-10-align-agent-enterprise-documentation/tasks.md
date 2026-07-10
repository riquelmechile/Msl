# Tasks: Align Repository Documentation

## Review Workload Forecast

- **Estimated changed lines**: ~500-800 (full document rewrites)
- **400-line budget risk**: High
- **Chained PRs recommended**: No (single cohesive documentation change)
- **Decision needed before apply**: No — documentation-only, no production risk
- **Files affected**: 5 (README.md, ARCHITECTURE.md, ROADMAP.md, docs/agent-enterprise-vision.md, docs/README.md)

## Phase 1: Inspection & Source Derivation

- [ ] T1.1: Verify actual test count from `npm test` run
- [ ] T1.2: Count daemon handlers from `packages/agent/src/workers/daemonScheduler.ts` `daemonHandlerMap`
- [ ] T1.3: Count lane contracts from `packages/agent/src/conversation/lanes.ts` `LANE_CONTRACTS`
- [ ] T1.4: Count MCP tools from `packages/mcp/src/index.ts` or equivalent
- [ ] T1.5: Count agent tools from `packages/agent/src/conversation/tools.js`
- [ ] T1.6: Count evidence responders from `packages/agent/src/evidence/responders/`
- [ ] T1.7: Verify company agents from `packages/agent/src/conversation/companyAgents.ts`
- [ ] T1.8: Map implemented vs. mock/fake transports in mercadolibre, ecommerce-medusa, creative-studio
- [ ] T1.9: Verify .env.example coverage of all real env vars used at runtime
- [ ] T1.10: Inspect .github/workflows for CI badges and status

## Phase 2: agent-enterprise-vision.md — Canonical Constitution

- [ ] T2.1: Rewrite with intelligent-core + deterministic-safety-shell framing
- [ ] T2.2: Add DeepSeek cache economics section (stable prefixes, block strategy, cost-aware routing)
- [ ] T2.3: Add approval-vs-outcome learning distinction
- [ ] T2.4: Add complete TARGET organization of 20 future agents, clearly marked as not implemented
- [ ] T2.5: Remove PR-specific, temporally-bound details (merged/in-progress status)
- [ ] T2.6: Define current implementation boundary honestly
- [ ] T2.7: Preserve links to other docs, verify they resolve

## Phase 3: ARCHITECTURE.md — Code-Derived Architecture

- [ ] T3.1: Regenerate daemon count, lane count, MCP tool count from code
- [ ] T3.2: Add evidence response router, responders, EvidenceRequestStore
- [ ] T3.3: Add OwnedEcommerceEvidenceAggregator, EcommerceEvidenceRequestPlanner
- [ ] T3.4: Add Work Sessions and session-cooldown mechanics
- [ ] T3.5: Add Account Assets and Account Brain services
- [ ] T3.6: Add implementation status table (implemented/feature-gated/fake-mock/preparation-only/pending-production)
- [ ] T3.7: Fix "5 specialist lanes" → actual lane count
- [ ] T3.8: Fix "4 autonomous daemons" → actual daemon handler count
- [ ] T3.9: Remove ~98% cache discount claim or verify with code evidence
- [ ] T3.10: Update directory tree to reflect current file structure
- [ ] T3.11: Verify all package descriptions match current package.json files

## Phase 4: ROADMAP.md — Forward-Looking Capability Roadmap

- [ ] T4.1: Add review date, verified commit hash, and state definitions header
- [ ] T4.2: Summarize what's already implemented (verified against code)
- [ ] T4.3: Reorganize as P0-P6 vertical capability phases with business purpose, dependencies, acceptance criteria, and learning outcomes
- [ ] T4.4: Remove historical phase descriptions (Phase 0-19) that are already complete
- [ ] T4.5: No arbitrary dates or unfunded promises
- [ ] T4.6: P0: Operational truth & production (credentials, OAuth, real transport, backups, CI)
- [ ] T4.7: P1: Financial truth & economic outcomes (EconomicOutcome, landed cost, cash flow)
- [ ] T4.8: P2: Full product launch cycle
- [ ] T4.9: P3: Social Growth
- [ ] T4.10: P4: Portfolio, pricing, inventory & purchasing
- [ ] T4.11: P5: Experimentation & organizational intelligence
- [ ] T4.12: P6: Multichannel expansion

## Phase 5: README.md — Professional Introduction

- [ ] T5.1: Remove "1844 tests" badge and text references
- [ ] T5.2: Remove "12 daemons" claim — replace with code-derived count
- [ ] T5.3: Remove "31 Business Tools" — replace with verified count
- [ ] T5.4: Remove "~98% cache discount" badge or verify with evidence
- [ ] T5.5: Add honest "What works now" / "What's not yet in production" sections
- [ ] T5.6: Add agent enterprise model summary
- [ ] T5.7: Add decision flow diagram (text)
- [ ] T5.8: Add security/approval ("dale") explanation
- [ ] T5.9: Add production status table
- [ ] T5.10: Add documentation index linking to all docs
- [ ] T5.11: Use Spanish neutral/professional prose, English for class/package/tool names
- [ ] T5.12: Keep CI badge, TypeScript badge, Node badge — remove manual stale badges

## Phase 6: docs/README.md — Documentation Index

- [ ] T6.1: Create if absent, or update if exists
- [ ] T6.2: Classify all docs: Canonical, Architecture, Operations, Specialized Design, Roadmap, Historical
- [ ] T6.3: Explicitly label agent-enterprise-vision.md as canonical stable vision
- [ ] T6.4: Explicitly label ARCHITECTURE.md as current implementation
- [ ] T6.5: Explicitly label openspec/specs as active contracts
- [ ] T6.6: Explicitly label openspec/changes/archive as historical evidence (not current state)
- [ ] T6.7: Explicitly label docs/propuesta-ceo-socio.md as historical/superseded
- [ ] T6.8: Do not delete any historical files

## Phase 7: Consistency & Verification

- [ ] T7.1: Check all Markdown links resolve correctly
- [ ] T7.2: Verify terminology consistency: agente, daemon, lane, handler, responder, tool, worker, service, provider, process
- [ ] T7.3: Check Spanish/English consistency (Spanish prose, English class/package/tool names)
- [ ] T7.4: Check spelling across all changed files
- [ ] T7.5: Verify no stale numbers remain in any changed file
- [ ] T7.6: Run `git diff --check`
- [ ] T7.7: Run `npm run format:check`
- [ ] T7.8: Run `npm run typecheck`
- [ ] T7.9: Run `npm run lint`
- [ ] T7.10: Run `npm test`
- [ ] T7.11: Run `npm run build`

## Phase 8: Archive

- [ ] T8.1: Create archive report
- [ ] T8.2: Move change to archive following OpenSpec conventions
