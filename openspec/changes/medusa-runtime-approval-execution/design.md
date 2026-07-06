# Design: Medusa Runtime Approval Execution

## Technical Approach

Add a narrow backend runtime executor that loads stored projection/action/approval state, revalidates gates, reserves execution evidence, then calls an injected Medusa write boundary. CEO/LLM tools remain preparation-only: `createOwnedEcommerceTools()` keeps returning `noMutationExecuted: true` and never treats conversational approval claims or tool payload `approvalId` as execution proof.

This maps to `owned-ecommerce-agent` by adding backend-only execution semantics, and to `action-approval-safety` by enforcing exact approval binding, idempotency, durable audit, and rollback evidence before any write boundary call.

## Architecture Decisions

| Decision | Choice | Alternatives considered | Rationale |
|---|---|---|---|
| Runtime entry point | Create `packages/agent/src/runtime/ownedEcommerceExecutor.ts` as backend-only orchestration | Add execution to `ownedEcommerceTools.ts` | Keeps LLM-facing tools prepare-only and creates an injectable boundary for tests/review slices. |
| Medusa integration depth | Extend `MedusaWriteBoundary` with operation-specific methods and fake/live boundary factories | Implement full Medusa Admin API sync now | Protects the 800-line review budget while preserving the production seam and fail-closed behavior. |
| Projection revision source | Add `projectionVersion` as an immutable revision on `StorefrontProjection`, persisted in `owned_ecommerce_projections.projection_version`; create new revisions instead of overwriting approved/executable snapshots | Derive version from `generatedAt` or JSON hash only at execution time | Approval must bind to a stable stored revision. Runtime-derived values risk authorizing a different snapshot after projection updates. |
| Approval proof | Extend domain contracts with owned ecommerce execution binding that includes action, projection ID, `projectionVersion`, target, operation, approver, risk, rationale, and expiry | Reuse current `canExecutePreparedAction()` only | Existing approval matching lacks projection version/operation target specificity required by the spec. |
| Evidence durability | Add SQLite projection-version, execution, idempotency, audit, and rollback records to `OwnedEcommerceStore` | Keep in-memory executor state | Runtime safety requires restart-safe duplicate prevention and audit/rollback lookup. |

## Data Flow

```text
Backend runtime request
  -> OwnedEcommerceRuntimeExecutor
  -> OwnedEcommerceStore: projection(id, version) + prepared action + approval + idempotency
  -> Domain gates: exact binding, expiry, readiness, claims, rollback, credentials
  -> MedusaWriteBoundary: publish or checkout activation
  -> OwnedEcommerceStore: redacted execution audit + rollback reference + status
```

Fail-closed checks run before the write boundary. Duplicate idempotency returns existing safe status or a controlled duplicate block without a second mutation.

## File Changes

| File | Action | Description |
|---|---|---|
| `packages/domain/src/ownedEcommerce.ts` | Modify | Add `projectionVersion` to projection, execution request/result, gate reason, rollback reference, audit summary, and operation contracts. |
| `packages/domain/src/approval.ts` | Modify | Add exact owned ecommerce execution approval binding helper requiring projection ID/version while preserving generic prepared-action checks. |
| `packages/memory/src/ownedEcommerceStore.ts` | Modify | Add `projection_version` persistence plus execution, idempotency reservation, audit, and rollback methods/tables. |
| `packages/ecommerce-medusa/src/index.ts` | Modify | Extend `MedusaWriteBoundary` for publish/checkout operations and keep missing credentials/boundary disabled by default. |
| `packages/agent/src/runtime/ownedEcommerceExecutor.ts` | Create | Backend-only executor that coordinates store reads, domain gates, idempotency, audit, rollback, and write boundary calls. |
| `packages/agent/src/conversation/ownedEcommerceTools.ts` | Modify | Regression hardening only: keep prepare-only semantics and ignore execution approval claims. |
| `packages/domain/src/domain.test.ts` | Modify | Cover exact binding, mismatch, expiry, and gate reason contracts. |
| `packages/memory/src/memory.test.ts` | Modify | Cover durable idempotency/audit/rollback persistence and duplicate behavior. |
| `packages/ecommerce-medusa/src/index.test.ts` | Modify | Cover fail-closed boundary and operation-specific injected writes. |
| `packages/agent/src/agent.test.ts` | Modify | Cover executor happy path/blocked path and LLM tool non-execution regression. |

## Interfaces / Contracts

```ts
type OwnedEcommerceExecutionRequest = {
  operation: "publish" | "checkout-activation";
  projectionId: string;
  projectionVersion: string;
  actionId: string;
  approvalId: string;
  idempotencyKey: string;
};

type OwnedEcommerceExecutionApprovalBinding = {
  actionId: string;
  projectionId: string;
  projectionVersion: string;
  target: "storefront-projection" | "ecommerce-catalog-item";
  operation: OwnedEcommerceExecutionRequest["operation"];
  approver: "seller";
  risk: string;
  rationale: string;
  expiresAt: Date;
};

type ApprovedMedusaWriteInput = {
  projection: StorefrontProjection & { projectionVersion: string };
  approval: ApprovalRecord & { ownedEcommerceBinding: OwnedEcommerceExecutionApprovalBinding };
  auditId: string;
  rollbackRef: string;
};

type OwnedEcommerceExecutionResult =
  | { status: "executed"; auditId: string; rollbackRef: string; publicUrl?: string }
  | { status: "blocked" | "duplicate"; reasonCodes: string[]; auditId?: string };

type MedusaWriteBoundary = {
  publish(input: ApprovedMedusaWriteInput): Promise<MedusaWriteBoundaryDecision>;
  activateCheckout(input: ApprovedMedusaWriteInput): Promise<MedusaWriteBoundaryDecision>;
};
```

`projectionVersion` is required in runtime requests, approval bindings, idempotency keys, execution audits, and rollback records. The store must load the exact projection by `(projectionId, projectionVersion)` and block if absent or if approval was recorded for any other version. Credentials are never accepted from tool payloads. The live boundary reads env/config only; absent config returns a controlled block.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Exact binding, readiness freshness, blocked claims, rollback/idempotency gates | Vitest domain tests with fixed clocks and mismatch cases. |
| Integration | SQLite execution records, duplicate idempotency, redacted audit | `better-sqlite3` in-memory tests in `packages/memory/src/memory.test.ts`. |
| Boundary | Medusa write boundary fail-closed and injected success | Fake boundary tests in `packages/ecommerce-medusa/src/index.test.ts`; no live API dependency. |
| Regression | LLM tools remain preparation-only | Agent tests assert `noMutationExecuted: true`, ignored approval claims, and no credential echo. |

## Migration / Rollout

SQLite migration adds `projection_version TEXT NOT NULL` to `owned_ecommerce_projections` and `owned_ecommerce_approvals`, then creates execution/audit/idempotency/rollback tables carrying `projection_id` and `projection_version`. Existing preview rows receive a generated initial version during migration but remain non-executable until a new backend approval binds that exact version. Rollout is disabled unless backend runtime registration and env/config credentials exist.

## Implementation Guidance

- Checkout activation should use a separate approval/action from publish unless a future spec explicitly allows bundled approvals.
