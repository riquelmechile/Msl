# Design: Agent Company Kernel Extensions

## Technical Approach

Extend the Durable Company Kernel with three layers without modifying the `AgentLoopConfig` contract beyond new optional fields. New stores follow the established `companyAgentLearningStore.ts` pattern (SQLite + prepared statements + row parsing + validation sets). Context injection remains in Block C only via `buildBlockCContext`.

## Architecture Decisions

| Option | Tradeoffs | Decision |
|--------|-----------|----------|
| Rollups as separate table vs. materialized view | Separate table avoids SQLite view restrictions, enables upsert pattern | Separate table with `INSERT ... ON CONFLICT DO UPDATE` |
| `department_id` via ALTER vs. new column in CREATE TABLE | ALTER TABLE is idempotent-safe with IF NOT EXISTS wrapper | ALTER TABLE ADD COLUMN wrapped in try/catch |
| Skill proficiency as `REAL` vs `INTEGER` | Proposal says proficiency 0..1, learning store uses REAL for confidence/impact | `REAL NOT NULL` matching learning store pattern |
| Skill PK: auto-increment vs. skill_id string | All existing stores use explicit TEXT PRIMARY KEY | `skill_id TEXT PRIMARY KEY` |
| MCP admin gate: per-tool vs. config-level | Per-tool allows mixed read/mutation access | Per-tool: list tools open-read, mutation tools admin-gated |

## Schema Decisions

### 1. New table: `workforce_cost_cache_ledger_rollups`

```sql
CREATE TABLE IF NOT EXISTS workforce_cost_cache_ledger_rollups (
  day TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  department_id TEXT,
  model TEXT NOT NULL,
  input_tokens_agg INTEGER NOT NULL DEFAULT 0,
  output_tokens_agg INTEGER NOT NULL DEFAULT 0,
  cache_hit_tokens_agg INTEGER NOT NULL DEFAULT 0,
  cache_miss_tokens_agg INTEGER NOT NULL DEFAULT 0,
  estimated_cost_micros_agg INTEGER NOT NULL DEFAULT 0,
  entry_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(day, agent_id, model)
);
```

Upsert SQL:
```sql
INSERT INTO workforce_cost_cache_ledger_rollups
  (day, agent_id, department_id, model, input_tokens_agg, output_tokens_agg,
   cache_hit_tokens_agg, cache_miss_tokens_agg, estimated_cost_micros_agg, entry_count)
VALUES (@day, @agentId, @departmentId, @model, @inputTokens, @outputTokens,
        @cacheHitTokens, @cacheMissTokens, @costMicros, 1)
ON CONFLICT(day, agent_id, model) DO UPDATE SET
  input_tokens_agg = input_tokens_agg + @inputTokens,
  output_tokens_agg = output_tokens_agg + @outputTokens,
  cache_hit_tokens_agg = cache_hit_tokens_agg + @cacheHitTokens,
  cache_miss_tokens_agg = cache_miss_tokens_agg + @cacheMissTokens,
  estimated_cost_micros_agg = estimated_cost_micros_agg + @costMicros,
  entry_count = entry_count + 1,
  department_id = COALESCE(@departmentId, department_id);
```

### 2. Migration to raw table: `workforce_cost_cache_ledger_entries`

```sql
ALTER TABLE workforce_cost_cache_ledger_entries ADD COLUMN department_id TEXT;
```

Wrapped in `try { db.exec(...) } catch { /* column already exists */ }`.

### 3. Constant change

```typescript
// LEDGER_LIMITS.defaultMaxEntries: 1_000 → 5_000
defaultMaxEntries: 5_000,
```

### 4. New table: `agent_skills`

```sql
CREATE TABLE IF NOT EXISTS agent_skills (
  skill_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  label TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  proficiency REAL NOT NULL,
  declared_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(agent_id, label)
);
```

### 5. Modified table: `company_agents` (CHECK constraint)

```sql
-- Existing: status TEXT NOT NULL DEFAULT 'active' (implicit in schema)
-- No schema change needed; TypeScript row type gains "suspended"
```

## Store Interface Design

### `WorkforceCostCacheLedgerStore` changes

**Type changes:**

```typescript
// Add department_id to input
export type RecordWorkforceCostCacheLedgerEntryInput = {
  // ... existing fields ...
  departmentId?: string;  // NEW: optional
};

// Add from/to to filter
export type ListWorkforceCostCacheLedgerEntriesFilter = {
  agentId?: string;
  laneId?: LaneId;
  from?: string;  // NEW: ISO date
  to?: string;    // NEW: ISO date
  limit?: number;
};

// New aggregate type
export type WorkforceCostAggregate = {
  byAgent: Map<string, { inputTokens: number; outputTokens: number; costMicros: number; entries: number }>;
  byDepartment: Map<string, { inputTokens: number; outputTokens: number; costMicros: number }>;
  byPeriod: Array<{ day: string; inputTokens: number; outputTokens: number }>;
  cacheEfficiency: number; // 0..1
};
```

**Store interface additions:**

```typescript
export type WorkforceCostCacheLedgerStore = {
  // ... existing ...
  aggregateCosts(filter: { days?: number }): WorkforceCostAggregate;  // NEW
};
```

**Method implementation inside `createWorkforceCostCacheLedgerStore`:**

- New `upsertRollupStmt` prepared statement
- `insertEntry`: after raw insert + before prune, call `upsertRollupStmt.run({...})`
- `listEntries`: add `WHERE (@from IS NULL OR measured_at >= @from) AND (@to IS NULL OR measured_at <= @to)` to `listStmt`
- `aggregateCosts`: new method reading from rollup table for last N days

### `CompanyAgentSkillStore` (NEW file)

```typescript
export type AgentSkill = {
  skillId: string;
  agentId: CompanyAgentId;
  label: string;
  category: string;
  description: string;
  proficiency: number; // 0..1
  declaredAt: string;
  updatedAt: string;
};

export type InsertAgentSkillInput = {
  skillId: string;
  agentId: CompanyAgentId;
  label: string;
  category: string;
  description: string;
  proficiency: number;
};

export type CompanyAgentSkillStore = {
  insertAgentSkill(input: InsertAgentSkillInput): AgentSkill;
  listAgentSkills(agentId: CompanyAgentId): readonly AgentSkill[];
  updateAgentSkill(skillId: string, fields: Partial<Pick<AgentSkill, "proficiency" | "description">>): AgentSkill;
  count(): number;
};
```

Factory: `createCompanyAgentSkillStore(db: Database.Database): CompanyAgentSkillStore`

Follows `companyAgentLearningStore.ts` exact pattern:
- `SCHEMA_SQL` with `CREATE TABLE IF NOT EXISTS`
- `AgentSkillRow` matching snake_case columns
- `rowToAgentSkill` with validation (proficiency 0..1, non-empty fields)
- Prepared `insertStmt`, `listStmt`, `updateStmt`, `countStmt`
- Valid skill `category` set: `["technical", "domain", "analysis", "creative", "coordination"]`

### `CompanyAgentStore` changes

**Type change:**
```typescript
type CompanyAgentRow = {
  // ...
  status: "active" | "suspended" | "archived";  // was "active" | "archived"
};
```

**Store interface additions:**
```typescript
export type CompanyAgentStore = CompanyAgentRegistry & {
  // ... existing ...
  updateCompanyAgent(agentId: string, fields: Partial<{
    label: string;
    departmentId: CompanyDepartmentId;
    stablePrefix: string;
    status: CompanyAgent["status"];
  }>): CompanyAgent;  // NEW
};
```

**New prepared statement:**
```typescript
const updateStmt = db.prepare(`
  UPDATE company_agents
  SET label = COALESCE(@label, label),
      department_id = COALESCE(@departmentId, department_id),
      stable_prefix = COALESCE(@stablePrefix, stable_prefix),
      status = COALESCE(@status, status),
      updated_at = datetime('now')
  WHERE id = @agentId
`);
```

**`listCompanyAgents` filter change:**
The existing `listActiveStmt` already filters `WHERE status = 'active'` — this naturally excludes both `suspended` and `archived`.

## Agent Loop Integration

### New function: `buildWorkforceSkillContext`

```typescript
const WORKFORCE_SKILL_CONTEXT_LIMIT = 10;
const WORKFORCE_SKILL_CONTEXT_MAX_CHARS = 1_200;

export function buildWorkforceSkillContext(
  skillStore?: CompanyAgentSkillStore,
  activeCompanyAgentId?: CompanyAgentId,
): string
```

Pattern: reads `skillStore.listAgentSkills(activeAgentId)`, formats:
```
## Workforce Skills

- label (category, proficiency X.XX): description
- ...
```
Omits section if no skills or store unavailable. Max 10 skills, enforces 1,200 char limit.

### Modified: `buildWorkforceCostCacheContext`

New signature (add `rollupStore` param, keep backward compat):

```typescript
export function buildWorkforceCostCacheContext(
  ledgerStore?: WorkforceCostCacheLedgerStore,
): string
```

New body reads `aggregateCosts({ days: 7 })` from rollup table. Falls back to existing raw-entry loop if rollup table is empty (cold start). Produces:
```
## CEO Cost/Cache Operating Evidence

Rollup-backed summary from the durable workforce cost/cache ledger. Not billing truth.

- Period: YYYY-MM-DD to YYYY-MM-DD (7 days)
- Total input: X tokens; output: Y tokens; estimated cost: $Z.XXXX
- Cache efficiency: XX% (H hits / M total cache operations)
- Top department costs: operations $X.XX, commercial $Y.YY, executive $Z.ZZ
- Daily trend: Mon ▲20% higher, Tue ▼5% lower
```
If budgetWarning threshold exceeded: append `⚠ Budget alert: [agent|department] daily cost of $X.XX exceeds threshold $Y.YY. Advisory only.`

### Modified: `recordLlmUsage` (agentLoop.ts:819)

```typescript
// NEW: resolve departmentId from active agent
let departmentId: string | undefined;
if (config.activeCompanyAgentId && config.companyAgentRegistry) {
  const agent = config.companyAgentRegistry.getCompanyAgent(config.activeCompanyAgentId);
  departmentId = agent?.profile.departmentId;
}

config.workforceCostCacheLedgerStore.insertEntry({
  // ... existing fields ...
  departmentId,  // NEW
});
```

### Modified: `buildBlockCContext` (agentLoop.ts:517)

Insert skill context between cost context and lesson context:

```typescript
blockC = appendBlockCSection(
  blockC,
  buildWorkforceCostCacheContext(config.workforceCostCacheLedgerStore),
);
blockC = appendBlockCSection(  // NEW
  blockC,
  buildWorkforceSkillContext(config.companyAgentSkillStore, config.activeCompanyAgentId),
);
return appendBlockCSection(
  blockC,
  buildWorkforceLessonContext(
    config.companyAgentLearningStore,
    config.activeCompanyAgentId,
    config.companyAgentRegistry,
  ),
);
```

### New AgentLoopConfig field

```typescript
export type AgentLoopConfig = {
  // ... existing ...
  companyAgentSkillStore?: CompanyAgentSkillStore;  // NEW
};
```

### Budget warning constant

```typescript
const WORKFORCE_BUDGET_WARNING_THRESHOLD_MICROS = 500_000; // $0.50 USD default
```

## Tool Registration Design

### In `tools.ts`: new tool factories

```typescript
// Phase B: skill tools
export type SkillToolOptions = { authorized?: boolean };

export function createDeclareAgentSkillTool(
  skillStore: CompanyAgentSkillStore | undefined,
  options: SkillToolOptions,
): ToolDefinition;

export function createListAgentSkillsTool(
  skillStore: CompanyAgentSkillStore | undefined,
  options: SkillToolOptions,
): ToolDefinition;

export function createUpdateAgentSkillTool(
  skillStore: CompanyAgentSkillStore | undefined,
  options: SkillToolOptions,
): ToolDefinition;

// Phase C: agent lifecycle
export function createUpdateCompanyAgentTool(
  registry: CompanyAgentRegistry | undefined,
  options: { authorized?: boolean },
): ToolDefinition;
```

**Parameter schemas** follow existing JSON Schema pattern (not Zod):
```typescript
// declare_agent_skill
parameters: {
  type: "object",
  properties: {
    agentId: { type: "string" },
    label: { type: "string" },
    category: { type: "string", enum: ["technical","domain","analysis","creative","coordination"] },
    description: { type: "string" },
    proficiency: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["agentId", "label", "category", "description"],
}

// update_company_agent
parameters: {
  type: "object",
  properties: {
    agentId: { type: "string" },
    label: { type: "string" },
    departmentId: { type: "string", enum: ["executive","operations","commercial"] },
    stablePrefix: { type: "string" },
    status: { type: "string", enum: ["active","suspended","archived"] },
  },
  required: ["agentId"],
}
```

**Admin gating:** All mutation tools check `options.authorized` first, return `{ status: "blocked", error: "unauthorized" }` if false.

### In `agentLoop.ts`: register new tools

Add after line ~674 (existing `record_workforce_cost_cache_ledger_entry` block):

```typescript
// Phase B: skill tools (admin-gated)
if (config.companyAgentSkillStore && config.companyAgentAdminAuthorized === true) {
  if (!toolMap.has("declare_agent_skill")) {
    toolMap.set("declare_agent_skill", createDeclareAgentSkillTool(config.companyAgentSkillStore, { authorized: true }));
  }
  if (!toolMap.has("list_agent_skills")) {
    toolMap.set("list_agent_skills", createListAgentSkillsTool(config.companyAgentSkillStore, { authorized: true }));
  }
  if (!toolMap.has("update_agent_skill")) {
    toolMap.set("update_agent_skill", createUpdateAgentSkillTool(config.companyAgentSkillStore, { authorized: true }));
  }
}

// Phase C: agent lifecycle (admin-gated)
if (config.companyAgentRegistry && config.companyAgentAdminAuthorized === true) {
  if (!toolMap.has("update_company_agent")) {
    toolMap.set("update_company_agent", createUpdateCompanyAgentTool(config.companyAgentRegistry, { authorized: true }));
  }
}
```

### Existing tool modifications

- `record_agent_lesson`: block targeting `"suspended"` agents (line ~1015: change `targetAgent.status !== "active"` to `targetAgent.status !== "active"`)
- `request_agent_evidence`: block `"suspended"` agents (line ~1364: same status check already handles non-active)

## MCP Wiring

### New `McpServerConfig` fields

```typescript
export type McpServerConfig = {
  // ... existing ...
  workforceAdmin?: {
    companyAgentRegistry?: CompanyAgentRegistry;
    companyAgentSkillStore?: CompanyAgentSkillStore;
    workforceCostCacheLedgerStore?: WorkforceCostCacheLedgerStore;
    companyAgentLearningStore?: CompanyAgentLearningStore;
    companyAgentAdminAuthorized?: boolean;
  };
};
```

### New MCP tool registrations in `createMcpServer`

All follow the existing `server.registerTool()` pattern with zod schemas:

| Tool | Wraps | Admin Gate |
|------|-------|------------|
| `list_company_agents_mcp` | `registry.listCompanyAgents()` | API key only |
| `declare_skill_mcp` | `skillStore.insertAgentSkill()` | API key + admin |
| `list_agent_skills_mcp` | `skillStore.listAgentSkills()` | API key only |
| `list_workforce_ledger_mcp` | `ledgerStore.listEntries({ from, to })` | API key only |
| `list_agent_lessons_mcp` | `learningStore.listAgentLessons()` | API key only |
| `update_company_agent_mcp` | `agentStore.updateCompanyAgent()` | API key + admin |

Zod schema example for `list_workforce_ledger_mcp`:
```typescript
{
  agentId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().max(50).optional(),
  msl_api_key: z.string().optional(),
}
```

## Test Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit — ledger store | Rollup upsert, from/to filter, aggregateCosts, prune at 5K | In-memory SQLite, follow `workforceCostCacheLedgerStore.test.ts` pattern |
| Unit — skill store | Insert, list by agent, update, duplicate label rejection | In-memory SQLite, follow `companyAgentLearningStore` test pattern |
| Unit — context functions | `buildWorkforceSkillContext` empty/10-skill/overflow; new `buildWorkforceCostCacheContext` cold-start/with-rollups/budget-warning | Isolated unit: mock stores via vi.fn(), assert char limits |
| Unit — agentLoop | Skill context injected in Block C, recordLlmUsage passes departmentId | `agentLoop.test.ts` lines 680-818 pattern |
| Integration | Block C contains skills + rollups + lessons in correct order | `withInMemoryWorkforceLedger` pattern extended with skill store |
| Edge cases | Cold start (no rollups), duplicate skill label, suspended agent blocked from evidence/lessons, concurrent rollup upsert idempotency | Dedicated `it(...)` per edge case |

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `packages/agent/src/conversation/companyAgentSkillStore.ts` | **Create** | Skill registry store (SQLite + prepared statements) |
| `packages/agent/src/conversation/companyAgents.ts` | Modify | +`AgentSkill`, +`"suspended"` status in union |
| `packages/agent/src/conversation/workforceCostCacheLedgerStore.ts` | Modify | +rollup schema/upsert, +`department_id`, +`from`/`to`, +`aggregateCosts`, maxEntries 5K |
| `packages/agent/src/conversation/companyAgentStore.ts` | Modify | +`updateCompanyAgent`, +`"suspended"` in row type |
| `packages/agent/src/conversation/tools.ts` | Modify | +skill tools, +`update_company_agent`, suspended agent gating |
| `packages/agent/src/conversation/agentLoop.ts` | Modify | +`buildWorkforceSkillContext`, rollup-backed cost context, budget warnings, departmentId in recordLlmUsage, +`companyAgentSkillStore` config, tool registration |
| `packages/mcp/src/index.ts` | Modify | +workforceAdmin config, +6 MCP tool registrations |
| `packages/mcp/src/runtimeDependencies.ts` | Modify | Wire workforceAdmin if agent stores available |
