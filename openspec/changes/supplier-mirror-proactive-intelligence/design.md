# Design: Proactive AI Enrichment for Stock-Gap Signals

## Technical Approach

Inject `SupplierMirrorDeepSeekAdvisor.analyze()` into the stock-gap signal block of `supplierManagerDaemon` — after idempotency check, before finding push. Advisor already gathers all evidence internally via `SupplierMirrorStore`, so the daemon only builds input and calls `analyze()`. Optional dependency: daemon degrades to rule-only when advisor absent.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Advisor wiring | Optional field on `DaemonHandler` input | Separate factory/side-channel | Simplest; daemon already has try/catch per signal; zero impact on other daemons |
| Evidence loading | Advisor loads internally via store | Daemon pre-loads and passes | Advisor already gathers 5 evidence sources; duplicating violates single-source |
| Deduplication scope | Reuse existing `buildIdempotencyKey` (`stock-gap_{supplier}_{item}_{hourKey}`) | New key format | Same key already prevents duplicate findings; extending it prevents duplicate API calls |
| Cost attribution | Advisor ledger via `ceoContext.workforceCostCacheLedgerStore` | New ledger path | Advisor already accepts ledger; daemon already receives `ceoContext` |

## Data Flow

```
supplierManagerDaemon (every 15 min)
  ├── Rule detection (unchanged)
  │   ├── Stock gap detection (critical)
  │   │   ├── idempotency check → skip if seen this hour
  │   │   ├── [NEW] If advisor present → advisor.analyze()
  │   │   │   ├── Input: supplierId, supplierName, stock-gap question
  │   │   │   ├── Advisor internally loads: items, stock obs, policies,
  │   │   │   │   mappings, notifications, fallbackPolicies
  │   │   │   └── On success → aiEnrichment payload
  │   │   │   └── On failure → skip enrichment, log
  │   │   ├── push finding (always, enriched or not)
  │   │   └── append ledger (unchanged)
  │   ├── Price change >5% (warning) — unchanged, no enrichment
  │   └── Unfilled mirror (warning) — unchanged, no enrichment
  │
  └── Enqueue CEO proposals (unchanged — payload may now carry aiEnrichment)
```

### aiEnrichment Payload

```typescript
aiEnrichment?: {
  findings: Array<{
    kind: string;                              // from advisor finding kind
    severity: "info" | "warning" | "critical";
    summary: string;
    detail: string;
    evidenceIds: string[];
  }>;
  summary: string;                             // advisor summary
  modelUsed: string;
  enrichedAt: string;                          // ISO timestamp
}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/workers/daemonTypes.ts` | Modify | Add `advisor?: SupplierMirrorDeepSeekAdvisor` to `DaemonHandler` input |
| `packages/agent/src/workers/daemonScheduler.ts` | Modify | Add `advisor?` to `DaemonSchedulerConfig`; pass to handler input |
| `packages/agent/src/workers/supplierManagerDaemon.ts` | Modify | Import advisor; inject `analyze()` call inside stock-gap signal block; enrich proposal payload |

No new files. No deleted files. No advisor-side changes.

## Code Integration — Daemon Handler Block

Insert after the `if (!existing)` check (line 176), before `findings.push()` (line 177):

```typescript
// ── [NEW] AI enrichment (stock-gap only, best-effort)
let aiEnrichment: { findings: Array<{...}>; summary: string; modelUsed: string; enrichedAt: string } | undefined;
if (advisor) {
  try {
    const analysis = await advisor.analyze({
      supplierId: supplier.id,
      supplierName: supplier.name,
      question: `Stock discrepancy detected: ${item.title} (${item.supplierItemId}). `
              + `In stock on: ${inStock.map(([s]) => s).join(", ")}. `
              + `Out of stock on: ${outOfStock.map(([s]) => s).join(", ")}. `
              + `Analyze the situation and provide actionable findings.`,
    });
    aiEnrichment = {
      findings: analysis.findings.map(f => ({
        kind: f.kind,
        severity: f.severity,
        summary: f.summary,
        detail: f.detail,
        evidenceIds: f.evidenceIds,
      })),
      summary: analysis.summary,
      modelUsed: analysis.modelUsed,
      enrichedAt: capturedAt,
    };
  } catch (err) {
    console.warn(`[supplier-manager] Advisor enrichment failed for ${supplier.id}/${item.supplierItemId}:`, err);
    // Fall through — enrichment is best-effort
  }
}
```

Then include `aiEnrichment` in the `findings.push()` payload and in the `bus.enqueue()` payload JSON.

## Interfaces / Contracts

### DaemonHandler input extension

```typescript
// daemonTypes.ts — add to input type
advisor?: SupplierMirrorDeepSeekAdvisor;
```

### DaemonSchedulerConfig extension

```typescript
// daemonScheduler.ts — add to config
advisor?: SupplierMirrorDeepSeekAdvisor;
```

### CEO proposal payload extension

The `payloadJson` in `bus.enqueue()` (line 345) acquires optional `aiEnrichment` alongside existing `findings`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Advisor available → enrichment appended | Mock advisor; assert `aiEnrichment` in payload |
| Unit | Advisor throws → rule-only proposal | Mock advisor throwing; assert no `aiEnrichment` |
| Unit | Advisor absent → rule-only proposal | Omit `advisor` from input; assert no enrichment |
| Unit | Idempotency → advisor not called twice | Mock ledger returning existing key; verify `analyze()` not called |
| Integration | Real daemon + real advisor (dry-run) | `proposalEnqueued: true`, `aiEnrichment` present on stock-gap payloads only |

## Rollout

No migration required. `aiEnrichment` is an optional field; absent means rule-only. Add advisor to daemon scheduler config in deployment. Rollback: remove advisor from config — daemon reverts to rule-only.

## Open Questions

- None. All dependencies available; contract is additive and optional.
