# Delta for neural-graph-memory

## ADDED Requirements

### Requirement: Seller-Scoped Node Schema
`nodes` MUST gain `seller_id TEXT` via idempotent `ALTER TABLE ADD COLUMN`. NULL = global, non-NULL = account. Existing rows default to NULL.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Migration adds column | DB without `seller_id` | Migration runs | Column exists; existing rows NULL |
| Migration idempotent | Column already exists | Migration re-runs | No error |

### Requirement: Scoped Node Creation
`createNode(label, metadata?, sellerId?)` MUST accept optional `sellerId`. Omitted → NULL (global).

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Account-scoped | `createNode("asset", {}, "plasticov")` | Node queried | `seller_id = "plasticov"` |
| Global | `createNode("concept")` | Node queried | `seller_id IS NULL` |

### Requirement: Scoped Hebbian Learning
`reinforceEdge(src, tgt, sellerId?)` / `penalizeEdge(src, tgt, sellerId?)` MUST scope to edges where both endpoints match `sellerId` or are NULL.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Scoped reinforcement | Edges for Plasticov and Maustian share labels | `reinforceEdge(A,B,"plasticov")` | Only Plasticov's edge weight increases |

### Requirement: Scoped Spreading Activation
`spread(seeds, { sellerId? })` MUST only traverse edges where both nodes match `sellerId` or NULL. Global nodes visible to all scopes.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Isolated activation | Plasticov pattern A→B→C, Maustian D→E→F | `spread([A],{sellerId:"plasticov"})` | B,C activated; D,E,F not |
| Global reachable | Global node "margin" connected to both | `spread([A],{sellerId:"plasticov"})` | Global node activatable |

### Requirement: Scoped Darwinian Pruning
`prune(sellerId?)` MUST evaluate only edges where both nodes match. Omitting `sellerId` prunes global edges.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Scoped pruning | Both accounts have weak edges | `prune("plasticov")` | Only Plasticov's weak edges removed |

### Requirement: Seller-Scoped Query API
`queryByMetadata(key, val, sellerId?)` and `getNodesBySeller(sellerId)` MUST filter by `seller_id` matching or NULL.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Account query | Plasticov 3 nodes, Maustian 2 | `getNodesBySeller("plasticov")` | Returns Plasticov's 3 + global nodes |

## MODIFIED Requirements

### Requirement: Graph Schema
Nodes table now includes `seller_id TEXT` (default NULL = global). All other columns unchanged. Edges and darwinian_lessons tables unchanged.

(Previously: nodes table had no `seller_id`.)

### Requirement: Hebbian Learning
Weights: +0.1 reinforce, −0.15 penalize, clamped [0,1]. When `sellerId` provided, only edges whose both endpoints match are affected.

(Previously: Hebbian learning was global.)

### Requirement: Spreading Activation
Recursive CTE spread, depth 3, activation threshold. When `sellerId` in options, scoped to matching or NULL nodes.

(Previously: not seller-scoped.)

### Requirement: Darwinian Pruning
Edges < 0.05 archived. When `sellerId` provided, only scoped or global edges evaluated.

(Previously: not seller-scoped.)
