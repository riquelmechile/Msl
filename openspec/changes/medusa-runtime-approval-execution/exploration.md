## Exploration: Medusa Runtime Approval Execution

### Current State
MSL has a completed preview/preparation-first owned ecommerce lane. Domain types model storefront candidates, projections, readiness, owned ecommerce prepared actions, and a generic `ApprovalRecord`; the SQLite store persists candidates, projections, validation results, and approval audit records. The worker builds Medusa-oriented static projections from evidence, runs deterministic guardrails around freshness, stock, margin, secrets, publish, checkout/payment, price/stock, and unsupported claims, and stores only preview-ready artifacts. The Medusa package currently exposes a preview adapter and a fail-closed publish boundary: `publish()` rejects blocked readiness and rejects all public publishing unless a caller injects a write boundary. CEO-facing tools can review projections and prepare approval requests, but they deliberately ignore `approvalId`, do not call `recordApproval`, and always return `noMutationExecuted: true`.

The next change is therefore not “let the LLM execute.” The existing architecture already creates the right seam: LLM-facing tools remain preparation-only, while a new backend-only runtime execution boundary can validate an exact approved action, projection readiness, env-only Medusa credentials, publish/checkout gates, idempotency, audit, and rollback before invoking live Medusa behavior.

### Affected Areas
- `packages/domain/src/ownedEcommerce.ts` — Owns projection, adapter, guardrail, and prepared action contracts; likely needs runtime execution result, checkout/payment gate, rollback, stale-readiness, and audit types.
- `packages/domain/src/approval.ts` — Provides exact prepared-action approval matching; runtime execution should reuse or extend this instead of accepting LLM/tool-supplied approval claims.
- `packages/domain/src/preparedAction.ts` — Defines owned ecommerce write action kinds and target assertions; execution must bind approvals to these exact action IDs and targets.
- `packages/memory/src/ownedEcommerceStore.ts` — Persists projections, validation, and approval records; likely needs execution/audit/rollback/idempotency records and retrieval by projection/action.
- `packages/workers/src/ownedEcommerce/index.ts` — Produces readiness and guardrail outputs; runtime execution should revalidate freshness/staleness against `generatedAt` and readiness checks before any live action.
- `packages/ecommerce-medusa/src/index.ts` — Current adapter is preview-first with an injectable write boundary; best place to add an env-configured live Medusa boundary while preserving fail-closed defaults.
- `packages/agent/src/conversation/ownedEcommerceTools.ts` — Must remain preparation-only; may prepare richer approval payloads but must not execute or accept runtime credentials.
- `packages/agent/src/conversation/agentLoop.ts` — Registers CEO tools when the owned ecommerce store exists; should not register backend execution tools in the LLM tool map.
- `apps/web/app/storefront/[projectionId]/projectionLoader.ts` — Static preview validates projection shape and media safety; public publish should not weaken these preview invariants.
- `apps/web/app/storefront/[projectionId]/page.tsx` — Serves static preview/projection content; runtime publishing should stay outside request-time LLM or mutation paths.
- `packages/ecommerce-medusa/src/index.test.ts` — Already proves fail-closed publishing; should grow into live boundary tests for missing credentials, missing approval, blocked readiness, and boundary rejection.
- `packages/agent/src/agent.test.ts` — Already proves CEO tools prepare but do not execute; should add regression tests that LLM-facing tools cannot trigger backend runtime execution.
- `tests/storefront-projection-loader.test.ts` and `tests/storefront-import-guard.test.ts` — Protect static preview shape and import boundaries; should continue guarding against coupling public storefront pages to agents/workers/Medusa write code.

### Approaches
1. **Backend execution service behind existing Medusa write boundary** — Add a backend-only owned ecommerce runtime executor that loads env-only Medusa credentials, fetches stored projection/action/approval records, calls `canExecutePreparedAction`, revalidates readiness freshness, invokes an injected/live Medusa write boundary, records audit/rollback/idempotency, and returns a redacted execution result.
   - Pros: Preserves the current LLM preparation-only boundary; reuses existing adapter seam and approval model; fail-closed behavior remains the default; easiest to test with injected fake Medusa boundary.
   - Cons: Requires new durable execution/audit records and careful action reconstruction from prepared approval metadata; Medusa live API details must be abstracted until real credentials are present.
   - Effort: Medium

2. **Extend CEO tools to record approval and execute directly** — Add execution behavior to `prepare_owned_ecommerce_approval_request` when `exactCeoApproval` and credentials are present.
   - Pros: Fewer new modules; simple conversational path for demos.
   - Cons: Violates the explicit boundary that LLM-facing tools remain preparation-only; makes prompt/tool transcript bugs business-critical; risks credential leakage and accidental publish/checkout activation.
   - Effort: Low initially, High risk

3. **Full Medusa runtime integration first** — Build live product/category/channel/payment/checkout synchronization against Medusa before adding the approval runtime executor.
   - Pros: Moves closest to production storefront operation.
   - Cons: Too broad for the next safe slice; delays the most important safety boundary; high review-size risk under the 800-line budget.
   - Effort: High

### Recommendation
Use Approach 1: add a backend-only runtime execution service behind the existing Medusa write boundary. Keep `createOwnedEcommerceTools()` preparation-only and make runtime execution callable only from a backend-verified path that is not exposed to the LLM tool registry. The proposal should define exact gates: env-only credentials, exact approval binding, unexpired prepared action, ready and fresh projection, public publish gate, checkout/payment activation gate, idempotency key, redacted audit record, rollback plan, and fail-closed outcomes for every missing or stale prerequisite.

### Risks
- Approval records currently exist, but CEO tools intentionally do not persist them; the proposal must define which backend-verified channel records approval without letting LLM tool arguments become approval evidence.
- The current `ApprovalRecord` does not include an explicit approver channel or backend verification proof beyond `approvedBy: "seller"`; runtime execution may need stronger metadata.
- Projection freshness is represented by timestamps but there is no runtime staleness policy yet; the change must define max age and revalidation behavior.
- Checkout/payment activation is modeled as an action kind/readiness gate, but there is no live checkout/payment config contract yet; missing env/config must fail closed.
- Implementing real Medusa API calls could exceed the review budget if bundled with approval execution, audit, rollback, and tests; prefer fake/injected boundary first, then live API depth in a follow-up slice if needed.

### Ready for Proposal
Yes — tell the user the next proposal should focus on a narrow, backend-verified execution path for owned ecommerce publish/checkout activation, not on expanding LLM tools. The safest first implementation is an execution service plus Medusa boundary contract, env-only credential loading, durable audit/rollback/idempotency records, and fail-closed tests proving missing credentials, missing approval, stale readiness, unsafe claims, blocked projections, and LLM tool attempts cannot execute.
