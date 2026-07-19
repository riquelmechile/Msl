```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d5861c020d9d017c7684b8958b69ee5581aad805be5f1ef09eeb839f4016ab1a
verdict: pass
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 0/0
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:9d0a95a122821972d03c453aad52cda0f9da35864b6e9790a473391fc4a6c4f0
build_command: npm run typecheck
build_exit_code: 0
build_output_hash: sha256:d7dd59d8d045636b10e4d420111e0231169414f694513a4490b0fcd8d1dc18f5
```

## Verification Report

**Change**: `add-deferred-message-bus-lifecycle`  
**Version**: OpenSpec delta  
**Mode**: Standard (`strict_tdd=false`)  
**Artifact store**: OpenSpec  
**Bound review lineage**: `review-deferred-bus-pr4-settle-query-20260719`  
**Authority revision**: `sha256:a2be6e7bb6542d7263d0ee4498980b9a697946503d48e16964bdf46ec4e6fd7f`  
**SDD review binding revision**: `sha256:a7c8e24436c2f1519a9541e31493c7c8240a58649640a8d144c6ffafb04d1e16`

### Completeness

| Metric | Value |
|---|---:|
| Requirements | 10 |
| Native heading-based scenario nodes (`#### Scenario:`) | 0 |
| Table-defined behavioral scenario rows | 42 |
| Tasks total | 12 |
| Tasks complete | 12 |
| Tasks incomplete | 0 |

The strict envelope's `scenarios: 0/0` is the native schema value: Gentle AI 2.1.6 counts only `#### Scenario:` heading nodes, and these specifications contain none. It does **not** claim that the specifications define zero behavior. The specifications define 42 Given/When/Then rows in scenario tables, and all 42 are mapped to passing runtime evidence below.

All proposal, specification, design, task, apply-progress, source, test, SDD review-binding, and bound review-authority artifacts were inspected. The SDD binding revision above binds this change to the exact approved compact authority revision and lineage. The compact review state binds the four PR4 paths, the corrected candidate tree, frozen findings, correction delta, and passing original-criteria and correction-regression evidence.

### Build, Tests, and Quality Execution

| Check | Exact command | Exit | Full output SHA-256 | Result |
|---|---|---:|---|---|
| Focused store and migration suite | `npx vitest run packages/agent/tests/conversation/agentMessageBusStore.test.ts` | 0 | `affe607defdb0feb447bfb03a9a2c658044cb5079c2aa7679ec72c5c8e962802` | ✅ 54/54 tests passed |
| Focused JCS/digest suite | `npx vitest run packages/agent/tests/conversation/jcsCanonicalize.test.ts` | 0 | `c3a148afd818bd0b060a8f7d6c8c272b47cfedb2b5cb6fb58a6cde069d4d7491` | ✅ 13/13 tests passed |
| Full regression | `npm test` | 0 | `9d0a95a122821972d03c453aad52cda0f9da35864b6e9790a473391fc4a6c4f0` | ✅ 218 files and 3,866 tests passed; 2 files and 7 tests skipped |
| Root lint | `npm run lint` | 0 | `d19ebaae69a201f38353c9041e0b5a05756afb819bfed123099380501b5dc3b9` | ✅ Passed |
| Root typecheck | `npm run typecheck` | 0 | `d7dd59d8d045636b10e4d420111e0231169414f694513a4490b0fcd8d1dc18f5` | ✅ Passed, including `@msl/web` |
| Root format check | `npm run format:check` | 0 | `fe1aefc4f71c382dddfde6b0328301756e0926e538687e67e3e6228b933802b2` | ✅ Passed |
| WAL crash, mixed timestamp, migration, drain, and restart harness | Exact command in the Runtime Harness appendix | 0 | `5ac82e8813f198d7315f5f8ae98fae93ae5a9b9a099b2d34acd65b204e536144` | ✅ Passed |
| Retained-terminal and fresh system-settle retry harness | Exact command in the Runtime Harness appendix | 0 | `c7bfbf5168966651aa56097db1497c890755aeb60a5dd5ed99d3d4a875be8969` | ✅ Passed |

**Coverage**: ➖ No coverage command or threshold is defined by the repository; runtime scenario compliance was established through focused tests, the full suite, and two direct SQLite harnesses.

One earlier verifier-authored harness invocation exited 1 with output hash `1f95b1be65c26f0215d9d2bf8f973893b6868b4658cc29d13bf026d7c9037342` because its ad hoc SQL used `status="deferred"`, which SQLite interpreted as an identifier. This was a harness quoting error, not an implementation failure. The corrected exact harness above exited 0 and is the authoritative runtime evidence.

### Spec Compliance Matrix

| Requirement | Scenario | Passing runtime evidence | Result |
|---|---|---|---|
| Message Lifecycle Transitions | Resolve | `agentMessageBusStore.test.ts > lifecycle > resolves a processing message` | ✅ COMPLIANT |
| Message Lifecycle Transitions | Cancel pending | `agentMessageBusStore.test.ts > lifecycle > cancels a pending message and writes cancel_reason` | ✅ COMPLIANT |
| Message Lifecycle Transitions | Cancelled not claimable | `agentMessageBusStore.test.ts > lifecycle > does not return cancelled messages from claimNext` | ✅ COMPLIANT |
| Message Lifecycle Transitions | Expired lock reclaim | `agentMessageBusStore.test.ts > claimNext > reclaims stale processing messages past the timeout` | ✅ COMPLIANT |
| Message Lifecycle Transitions | Deferred not claimable | `agentMessageBusStore.test.ts > defer and resumeDeferred > defers with exact fields, excludes claims, classifies retries, and resumes idempotently` | ✅ COMPLIANT |
| Message Lifecycle Transitions | Settle processing→failed | `agentMessageBusStore.test.ts > settle and getExpiredDeferrals > persists only the selected settlement outcome and fails closed on audit conflicts` | ✅ COMPLIANT |
| Message Lifecycle Transitions | Settle deferred→resolved | `agentMessageBusStore.test.ts > settle and getExpiredDeferrals > serializes resume versus settle and identical versus divergent settlements` | ✅ COMPLIANT |
| Outcome Persistence Columns | Migration on existing table | `agentMessageBusStore.test.ts > schema integrity > migrateBusSchema adds new columns to existing legacy table` | ✅ COMPLIANT |
| Outcome Persistence Columns | Idempotent migration | `agentMessageBusStore.test.ts > schema integrity > migration is idempotent` | ✅ COMPLIANT |
| Outcome Persistence Columns | New message stores outcome | `agentMessageBusStore.test.ts > lifecycle > resolves a processing message` | ✅ COMPLIANT |
| Schema Integrity | Idempotent migration | `agentMessageBusStore.test.ts > v3 schema migration > reruns idempotently with data preserved` | ✅ COMPLIANT |
| Schema Integrity | V3 adds deferral and audit | `agentMessageBusStore.test.ts > v3 schema migration > upgrades v2 through the registry and preserves legacy rows` | ✅ COMPLIANT |
| Schema Integrity | All columns present | `agentMessageBusStore.test.ts > v3 schema migration > creates the exact fresh v3 schema with migration flag true/false` | ✅ COMPLIANT |
| Schema Integrity | Legacy rows survive | `agentMessageBusStore.test.ts > v3 schema migration > upgrades v2 through the registry and preserves legacy rows` | ✅ COMPLIANT |
| Schema Integrity | Legacy NULL generation | Same v2→v3 migration test asserts `deferral_generation: null` | ✅ COMPLIANT |
| Schema Integrity | Audit table created | Exact fresh-v3 tests compare all 12 ordered PRAGMA tuples | ✅ COMPLIANT |
| Schema Integrity | Foreign version 3 | `agentMessageBusStore.test.ts > v3 schema migration > applies owned v3 when an unrelated version 3 is already recorded` | ✅ COMPLIANT |
| Defer with Generation CAS | First | `agentMessageBusStore.test.ts > defer and resumeDeferred > defers with exact fields...` | ✅ COMPLIANT |
| Defer with Generation CAS | Idempotent | Same focused test repeats the exact tuple and persisted digest | ✅ COMPLIANT |
| Defer with Generation CAS | Divergent | Same focused test changes the digest-bearing reason and asserts conflict | ✅ COMPLIANT |
| Defer with Generation CAS | Stale | `agentMessageBusStore.test.ts > defer and resumeDeferred > rejects stale defer generations and resume tokens` | ✅ COMPLIANT |
| Defer with Generation CAS | Retained | Focused test rejects retained pending tuple; supplemental harness rejects the exact retained tuple after terminal cancellation | ✅ COMPLIANT |
| Resume Deferred with Token CAS | Resume | `agentMessageBusStore.test.ts > defer and resumeDeferred > defers with exact fields... and resumes idempotently` | ✅ COMPLIANT |
| Resume Deferred with Token CAS | Idempotent | Same test repeats the exact pending token and receives the persisted row | ✅ COMPLIANT |
| Resume Deferred with Token CAS | Stale | `agentMessageBusStore.test.ts > defer and resumeDeferred > rejects stale defer generations and resume tokens` | ✅ COMPLIANT |
| Terminal Settlement | processing→failed | Selected-outcome focused test settles processing with `attempts=2` and preserves attempts | ✅ COMPLIANT |
| Terminal Settlement | deferred→resolved | Resume/settle race test settles a deferred row as resolved | ✅ COMPLIANT |
| Terminal Settlement | Triple match | Selected-outcome and race tests repeat identical settlement and receive the persisted row | ✅ COMPLIANT |
| Terminal Settlement | Status conflict | Race test attempts failed settlement after resolved settlement and asserts conflict | ✅ COMPLIANT |
| Keyset Expired Deferral Query | Indefinite excluded | Snapshot/keyset test inserts an indefinite deferral and excludes it | ✅ COMPLIANT |
| Keyset Expired Deferral Query | Keyset roundtrip | Snapshot/keyset test proves two equal-timestamp pages and an empty third page without skip/duplicate | ✅ COMPLIANT |
| Keyset Expired Deferral Query | Limit 0 | Pre-transaction validation test rejects limit 0 | ✅ COMPLIANT |
| Rollback and Crash Safety | Verify zero | File-backed drain test and direct harness abort before drain, settle through the API, and require zero deferred rows | ✅ COMPLIANT |
| Rollback and Crash Safety | Crash | Direct WAL harness closes and reopens while deferred, proves the row and attempts survive, then drains and restarts | ✅ COMPLIANT |
| Mutation Audit | Each mutation API | Defer/resume audit test plus settle audit test verify operation, message, scope fields, SQLite clock, and SQL NULL query columns | ✅ COMPLIANT |
| Mutation Audit | Seller | Defer/resume and settle focused tests prove seller mutations create zero audit rows | ✅ COMPLIANT |
| Mutation Audit | Fresh retry | Defer/resume focused test and supplemental settle harness use fresh operation IDs, preserve domain result/digest, and add one row each | ✅ COMPLIANT |
| Mutation Audit | Duplicate/failure | Duplicate-operation tests for defer, resume, and settle throw and prove domain rollback | ✅ COMPLIANT |
| Query Audit | System fields | Snapshot/keyset test verifies exact scope fields, NULL message, queryAsOf, limit, cursor/results/next JSON | ✅ COMPLIANT |
| Query Audit | Seller | Seller snapshot pages execute before system audit and produce zero audit rows | ✅ COMPLIANT |
| Query Audit | Fresh retry | Fixed-clock system retries reproduce the result and add distinct audit rows | ✅ COMPLIANT |
| Query Audit | Duplicate/failure | Reused query operation ID throws, rolls back, and leaves the audit count unchanged | ✅ COMPLIANT |

**Compliance summary**: 42/42 scenarios compliant through passing runtime evidence.

The six required race orderings are covered by the focused store suite: defer→fail, fail→defer, resume→settle, settle→resume, identical settle→settle, and divergent settle→settle. The corrected mixed timestamp behavior is covered twice: the focused keyset test includes same-day ISO `T`/`Z` and space-separated timestamps, while the direct WAL harness proves an ISO timestamp is expired against SQLite's space-separated `queryAsOf`. Source inspection confirms `datetime(...)` normalization is applied consistently to the expiry bound, cursor tuple, and ordering.

### Correctness (Static Evidence)

| Requirement | Status | Source evidence |
|---|---|---|
| Message Lifecycle Transitions | ✅ Implemented | Existing lifecycle remains intact; `deferred` is excluded from claims; settlement accepts only processing/deferred and preserves attempts. |
| Outcome Persistence Columns | ✅ Implemented | Unchanged v2 guarded ALTER logic remains, with existing outcome mappings preserved. |
| Schema Integrity | ✅ Implemented | V3 ownership checks exact ten bus additions and exact ordered 12-column audit schema before registry acceptance. |
| Defer with Generation CAS | ✅ Implemented | Scoped processing CAS, monotonic generation, bus-computed digest, and exact zero-change classification execute in one transaction. |
| Resume Deferred with Token CAS | ✅ Implemented | Exact-token deferred→pending CAS and pending same-cycle idempotency are transactionally classified. |
| Terminal Settlement | ✅ Implemented | Outcome-specific persistence, triple idempotency, conflicts, timestamps, lock clearing, and audit are atomic. |
| Keyset Expired Deferral Query | ✅ Implemented | One transaction captures queryAsOf, applies normalized strict tuple continuation, captures audit values, and returns the captured result. |
| Rollback and Crash Safety | ✅ Implemented | Additive schema remains; public settlement drain preserves attempts and WAL persistence. |
| Mutation Audit | ✅ Implemented | Shared audit insertion is inside every system mutation transaction; seller scope bypasses audit; PK failures roll back. |
| Query Audit | ✅ Implemented | Query, result capture, audit insertion, and return are one snapshot transaction; duplicate IDs fail closed. |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Extend the existing message-bus factory | ✅ Yes | No parallel store or consumer-specific implementation was introduced. |
| Preserve v2 unchanged and add owned v3 | ✅ Yes | V3 is registered after v2 and legacy initialization runs the same guarded helper. |
| Use in-repo RFC 8785 canonicalization and `node:crypto` | ✅ Yes | No dependency was added; vectors and lone-surrogate failures pass. |
| Keep audit in the bus database | ✅ Yes | Mutation and query audit writes share the same SQLite transactions as domain behavior. |
| Preserve exact public API and barrel exports | ✅ Yes | Types and four methods match the design and are exported from `packages/agent/src/index.ts`. |
| Preserve CAS, scope, races, keyset, and settlement mappings | ✅ Yes | Source and runtime evidence match all specified classifications and mappings. |
| Quiesce/drain/zero/restart rollback | ✅ Yes | File-backed and direct harnesses prove the boundary without DROP or direct transition SQL. |
| Four reviewable stacked slices | ✅ Yes | Apply evidence records each slice below 400 changed lines with focused commands and rollback boundaries. |

### Task Evidence

| Work unit | Tasks | Evidence | Result |
|---|---|---|---|
| Schema and API | 1.1–1.4 | Exact PRAGMA tests, v3 rollback/ownership cases, public types, row mappings, structural fixtures, typecheck | ✅ Complete |
| JCS and digests | 2.1–2.2 | 13 focused tests, pinned vectors, public digest exports, no new dependency | ✅ Complete |
| Defer and resume | 3.1–3.2 | CAS/classification, scope, audit, duplicate rollback, claim exclusion, and defer/fail race tests | ✅ Complete |
| Settle, query, rollback | 4.1–4.4 | Outcome persistence, six races, keyset/audit, mixed timestamp correction, WAL drain/restart, and full regression evidence | ✅ Complete |

### Canonical Verification Evidence Preimage

The following bytes, including the final newline, are the canonical evidence preimage for `evidence_revision`:

```text
schema: gentle-ai.verification-evidence/v1
change: add-deferred-message-bus-lifecycle
mode: standard
authority_lineage: review-deferred-bus-pr4-settle-query-20260719
authority_revision: sha256:a2be6e7bb6542d7263d0ee4498980b9a697946503d48e16964bdf46ec4e6fd7f
binding_revision: sha256:a7c8e24436c2f1519a9541e31493c7c8240a58649640a8d144c6ffafb04d1e16
requirements: 10/10
native_scenario_nodes: 0/0
table_defined_behavioral_scenarios: 42/42
tasks: 12/12
test_command: npm test
test_exit_code: 0
test_output_hash: sha256:9d0a95a122821972d03c453aad52cda0f9da35864b6e9790a473391fc4a6c4f0
build_command: npm run typecheck
build_exit_code: 0
build_output_hash: sha256:d7dd59d8d045636b10e4d420111e0231169414f694513a4490b0fcd8d1dc18f5
focused_store_exit_code: 0
focused_store_output_hash: sha256:affe607defdb0feb447bfb03a9a2c658044cb5079c2aa7679ec72c5c8e962802
focused_jcs_exit_code: 0
focused_jcs_output_hash: sha256:c3a148afd818bd0b060a8f7d6c8c272b47cfedb2b5cb6fb58a6cde069d4d7491
runtime_harness_exit_code: 0
runtime_harness_output_hash: sha256:5ac82e8813f198d7315f5f8ae98fae93ae5a9b9a099b2d34acd65b204e536144
scenario_harness_exit_code: 0
scenario_harness_output_hash: sha256:c7bfbf5168966651aa56097db1497c890755aeb60a5dd5ed99d3d4a875be8969
lint_exit_code: 0
lint_output_hash: sha256:d19ebaae69a201f38353c9041e0b5a05756afb819bfed123099380501b5dc3b9
format_exit_code: 0
format_output_hash: sha256:fe1aefc4f71c382dddfde6b0328301756e0926e538687e67e3e6228b933802b2
verdict: pass
```

### Runtime Harness Appendix

**WAL/migration/rollback harness exact command**:

```bash
npx tsx -e 'import Database from "better-sqlite3"; import { mkdtempSync, rmSync } from "node:fs"; import { tmpdir } from "node:os"; import { join } from "node:path"; import { createAgentMessageBusStore } from "./packages/agent/src/conversation/agentMessageBusStore.ts"; const directory=mkdtempSync(join(tmpdir(),"msl-final-bus-")); const path=join(directory,"bus.sqlite"); let db=new Database(path); db.pragma("journal_mode = WAL"); let store=createAgentMessageBusStore(db); const message=store.enqueue({senderAgentId:"sender",receiverAgentId:"worker",messageType:"test",payloadJson:"{}",sellerId:"seller-1"}); store.claimNext("worker"); db.prepare("UPDATE agent_message_bus SET attempts=2 WHERE message_id=?").run(message.messageId); store.defer(message.messageId,{deferralId:"crash-1",deferralGeneration:1,deferredUntil:"2020-01-01T00:00:00.000Z",reason:"rollback",scope:{kind:"seller",sellerId:"seller-1"}}); db.close(); db=new Database(path); store=createAgentMessageBusStore(db); const survived=db.prepare("SELECT status,attempts FROM agent_message_bus WHERE message_id=?").get(message.messageId) as {status:string;attempts:number}; if(survived.status!=="deferred"||survived.attempts!==2) throw new Error(`crash survival failed: ${JSON.stringify(survived)}`); const expired=store.getExpiredDeferrals({scope:{kind:"seller",sellerId:"seller-1"},limit:1}); if(expired.messages[0]?.messageId!==message.messageId) throw new Error("mixed timestamp expiry failed"); store.settle(message.messageId,"cancelled",{settlementId:"drain-1",reason:"rollback",scope:{kind:"system",operationId:"drain-op-1",reason:"rollback",evidenceRef:"verify://final"}}); const count=(db.prepare("SELECT COUNT(*) count FROM agent_message_bus WHERE status='deferred'").get() as {count:number}).count; if(count!==0) throw new Error(`drain failed: ${count}`); db.close(); db=new Database(path); createAgentMessageBusStore(db); const persisted=db.prepare("SELECT status,attempts FROM agent_message_bus WHERE message_id=?").get(message.messageId) as {status:string;attempts:number}; if(persisted.status!=="cancelled"||persisted.attempts!==2) throw new Error(`restart failed: ${JSON.stringify(persisted)}`); console.log(JSON.stringify({walCrashSurvival:true,mixedTimestampExpiry:true,deferredCount:count,status:persisted.status,attempts:persisted.attempts,schemaColumns:(db.pragma("table_info(agent_message_bus)") as unknown[]).length})); db.close(); rmSync(directory,{recursive:true,force:true});'
```

Exact output preimage:

```text
{"walCrashSurvival":true,"mixedTimestampExpiry":true,"deferredCount":0,"status":"cancelled","attempts":2,"schemaColumns":33}
```

**Supplemental scenario harness exact command**:

```bash
npx tsx -e 'import Database from "better-sqlite3"; import { createAgentMessageBusStore } from "./packages/agent/src/conversation/agentMessageBusStore.ts"; const db=new Database(":memory:"); const store=createAgentMessageBusStore(db); const seller={kind:"seller" as const,sellerId:"seller-1"}; const makeProcessing=()=>{const m=store.enqueue({senderAgentId:"s",receiverAgentId:crypto.randomUUID(),messageType:"t",payloadJson:"{}",sellerId:"seller-1"}); return store.claimNext(m.receiverAgentId)[0]!;}; const retained=makeProcessing(); const d=store.defer(retained.messageId,{deferralId:"d1",deferralGeneration:1,reason:"wait",scope:seller}); store.resumeDeferred(d.messageId,{deferralId:"d1",deferralGeneration:1,scope:seller}); store.cancel(d.messageId,"terminal"); let terminalRejected=false; try{store.defer(d.messageId,{deferralId:"d1",deferralGeneration:1,reason:"wait",scope:seller});}catch{terminalRejected=true;} if(!terminalRejected) throw new Error("terminal retained token accepted"); const target=makeProcessing(); const scope=(operationId:string)=>({kind:"system" as const,operationId,reason:"verify",evidenceRef:"verify://fresh"}); const first=store.settle(target.messageId,"failed",{settlementId:"set-1",error:{code:"fatal"},scope:scope("settle-op-1")}); const retry=store.settle(target.messageId,"failed",{settlementId:"set-1",error:{code:"fatal"},scope:scope("settle-op-2")}); if(first.settlementDigest!==retry.settlementDigest) throw new Error("fresh settle retry digest changed"); const audits=db.prepare("SELECT operationId,operation FROM agent_message_bus_operation_audit ORDER BY operationId").all(); if(audits.length!==2) throw new Error(`expected 2 audits, got ${audits.length}`); console.log(JSON.stringify({terminalRetainedDeferRejected:terminalRejected,freshSystemSettleRetry:true,audits})); db.close();'
```

Exact output preimage:

```text
{"terminalRetainedDeferRejected":true,"freshSystemSettleRetry":true,"audits":[{"operationId":"settle-op-1","operation":"settle"},{"operationId":"settle-op-2","operation":"settle"}]}
```

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:

1. A future pagination contract could carry the first page's `queryAsOf` in the cursor if consumers require a multi-call frozen snapshot. The current specification requires one snapshot per query call, so this is not a compliance defect.

### Verdict

**PASS**

All 10 requirements, all 42 scenarios, all 12 tasks, design decisions, the corrected mixed timestamp expiry behavior, migration ownership and rollback, six races, audit atomicity, WAL crash survival, and drain/restart behavior are supported by current source plus passing runtime evidence. Root regression, lint, typecheck, and formatting checks all pass.
