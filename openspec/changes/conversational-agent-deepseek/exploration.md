## Exploration: Conversational Agent with DeepSeek for Phase 2

### Current State

The system has a **deterministic agent** (`@msl/agent`, 209 lines) — a pure function `answerBusinessQuestion()` that matches `AgentTopic` enums (margin, profit, customer-treatment, claims, reputation, daily-priorities, automation) to template-based Spanish responses. It handles:

- Missing context detection (asks questions instead of guessing)
- Safety conflict detection (blocks risky preference application)
- Learned preference application (seller corrections → future recommendations)
- Specialization readiness evaluation (evidence-driven, not automatic)

The agent is used in `apps/web/app/demo.ts` to build a demo view model. It's imported by the Next.js web app as `@msl/agent`.

**Cortex** (`@msl/memory`) is fully built with `GraphEngine` providing:
- `spreadActivation()` — recursive CTE-based spreading activation from seed nodes
- `reinforceEdge()` / `penalizeEdge()` — Hebbian learning (+0.1/-0.15)
- `prune()` — Darwinian pruning (edges < 0.05 weight archived as lessons)
- `detectConvergence()` — cosine similarity convergence detection
- `traverse()` — returns `TraversalResult` with `context: Record<string, unknown>` **explicitly designed for LLM prompt injection**

**Domain types** (`@msl/domain`) are rich and ready: `SellerId`, `RiskLevel`, `SpecializationEvidence`, `PreparedAction`, `ApprovalRecord`, `AuditRecord`, `WriteActionKind`, etc. — all pure, framework-free.

**No LLM integration exists yet** — zero `openai` npm, zero `deepseek` references in any source file. The ROADMAP specifies DeepSeek via `openai` npm + `baseURL`.

### Affected Areas

| Area | Why affected |
|------|-------------|
| `@msl/agent` package | Core change — deterministic agent evolves into conversational agent. New entry points for LLM conversation alongside or replacing `answerBusinessQuestion()`. |
| `packages/agent/src/index.ts` | Will gain new exports: conversation loop, system prompt builder, message types. May keep `answerBusinessQuestion()` as safety fallback. |
| `@msl/memory` package | Integration target — `GraphEngine.traverse().context` feeds Block C of the cache strategy. Learning loop wires conversation outcomes to Hebbian updates. |
| `@msl/domain` package | Reused as-is — `PreparedAction`, `ApprovalRecord`, `AuditRecord` are exactly what "agente propone → usuario dice dale → ejecutar + auditar" needs. |
| `apps/web/app/demo.ts` | Demo entry point — will need to demonstrate conversational flow instead of deterministic topic-based query. |
| `package.json` (root) | New dependency: `openai` npm (for DeepSeek API calls). Optional: `@openai/agents` if using the SDK. |
| New: `packages/agent/src/conversation/` | Likely new directory for conversation loop, system prompt, cache strategy, Cortex integration. |
| `openspec/specs/conversational-business-agent/spec.md` | Existing spec already defines requirements for Spanish conversation, seller judgment learning, and business model learning — will be the target spec for Phase 2 implementation. |
| `openspec/specs/action-approval-safety/spec.md` | Safety gates spec — conversational mode maps agent proposals to `PreparedAction` with `approvalStatus: "pending"` → seller confirms → executes with audit trail. |

### Approaches

#### 1. Raw DeepSeek + `openai` npm (No Agent Framework)

Build the entire conversational agent from scratch using only the `openai` npm package pointed at DeepSeek's API (`baseURL: "https://api.deepseek.com"`).

**Implementation:**
- New `@msl/agent/src/conversation/` directory with: `systemPrompt.ts` (3-block builder), `conversationLoop.ts` (message history, streaming), `cortexInjection.ts` (Block C wiring), `safetyGates.ts` (post-processing LLM output into `PreparedAction`).
- Message types: `ConversationMessage`, `AgentProposal`, `UserConfirmation`.
- Conversation loop: accumulate messages in-memory or persist to SQLite, manage context window manually.

```typescript
// Core integration — minimal:
import OpenAI from "openai";

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});

const response = await deepseek.chat.completions.create({
  model: "deepseek-v4-flash",
  messages: buildMessages(blockA, blockB, blockC), // 3-block strategy
  stream: true,
});
```

**Pros:**
- Maximum control — every token of the prompt is ours. 3-block cache strategy directly implemented.
- Zero framework overhead — one `openai` npm dependency (already listed in ROADMAP).
- Aligns with ROADMAP philosophy: "Start with ONE agent, ONE memory system, ONE LLM."
- Conversation loop stays simple (single-agent, no handoffs needed).
- Direct mapping from LLM output → `PreparedAction` → approval workflow.

**Cons:**
- Build tool calling, streaming response handling, retry logic, and error handling from scratch.
- No built-in guardrails — must implement input/output validation ourselves.
- Need to design our own conversation state machine (though it's simple for Phase 2).
- No tracing/observability out of the box (can add later with OpenTelemetry).

**Effort:** Medium. Most complexity is in prompt engineering and safety integration, not infrastructure.

---

#### 2. OpenAI Agents SDK JS (v0.12.0)

Use `@openai/agents` as the agent loop framework, pointed at DeepSeek via custom `OpenAIProvider` with `baseURL`.

**Implementation:**
```typescript
import { Agent, Runner, OpenAIProvider, setDefaultOpenAIClient, setOpenAIAPI } from "@openai/agents";
import OpenAI from "openai";

const openaiClient = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});
setDefaultOpenAIClient(openaiClient);
setOpenAIAPI("chat_completions"); // DeepSeek uses chat/completions, not responses API

const agent = new Agent({
  name: "Plasticov",
  instructions: systemPrompt, // Block A + B + C combined
  model: "deepseek-v4-flash",
  tools: [cortexLookupTool, prepareActionTool, getDailySummaryTool],
});
```

**Pros:**
- TypeScript-native, lightweight (~few KB), minimal abstractions — just `Agent`, `Runner`, `tool()`, guardrails.
- Built-in guardrails (input/output validation) map to our safety gates.
- Tool calling works out of the box with DeepSeek (function calling compatible).
- Handoff support for future multi-agent phases (Phase 3-7 in ROADMAP).
- MCP support aligns with ROADMAP's MCP for tool exposure.
- `setOpenAIAPI('chat_completions')` makes it compatible with non-OpenAI providers.
- Streaming handled by the SDK.

**Cons:**
- Framework adds abstraction layer — 3-block cache strategy must fit into SDK's instruction model.
- `@openai/agents` dependency adds to bundle size (though minimal for server-side).
- SDK is opinionated about agent loop — less control over exact prompt assembly.
- Block C (Cortex injection) requires tool-based approach or manual context injection per turn.
- Still in early JS version (v0.12.0) — API may be unstable.

**Effort:** Low-Medium. SDK handles infrastructure; focus on prompt design, Cortex integration, and safety mapping.

---

#### 3. Mastra Framework

Use Mastra as the full agent framework with built-in workflows, evals, RAG, and observability.

**Pros:**
- Full-featured: workflows, evals, RAG, memory, model routing, observability.
- Built-in evaluation framework for agent quality.
- Strong TypeScript support.
- Can use `@ai-sdk/deepseek` or custom provider for DeepSeek.

**Cons:**
- **Heavy dependency footprint** — significantly more code than OpenAI Agents SDK.
- Opinionated structure conflicts with our hexagonal architecture and existing domain layer.
- Overkill for Phase 2 — we don't need RAG, evals, or multi-model routing yet.
- ROADMAP explicitly says "evaluate after Cortex is built" — Cortex is done, and Mastra adds ceremony the current architecture doesn't need.
- Learning curve and framework lock-in risk.
- Abstracts the LLM call in ways that may complicate 3-block cache strategy.

**Effort:** High. Framework onboarding + integration complexity outweighs benefits for current scope.

---

#### 4. Hybrid: OpenAI Agents SDK for Loop/Routing + Custom Cache Injection

Use the SDK's `Agent` and `Runner` for conversation loop, tool calling, and guardrails, but intercept the prompt assembly to inject our 3-block cache strategy directly.

```typescript
const agent = new Agent({
  name: "Plasticov",
  instructions: dynamicInstructions, // Rebuilt per-turn with Block A + B + C
  model: "deepseek-v4-flash",
  tools: [getContextTool, prepareActionTool],
  inputGuardrails: [spanishOnlyGuard, safetyConflictGuard],
  outputGuardrails: [actionValidationGuard],
});

// Block C injection happens via a tool that reads Cortex:
const getContextTool = tool({
  name: "get_business_context",
  description: "Get relevant business context from neural memory for the current question",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    const seedNodes = classifyIntent(query); // map to Cortex nodes
    const activation = engine.spreadActivation(seedNodes);
    return engine.traverse().context;
  },
});
```

**Pros:**
- SDK handles conversation loop, streaming, retries, tool routing — we focus on business logic.
- Guardrails map cleanly to our existing safety model (`inputGuardrails` = validation, `outputGuardrails` = action safety).
- Block C injection via tool calls keeps Cortex integration testable in isolation.
- MCP support for future tool exposure (Phase 7: ML API).
- Handoffs support for future Actor Models (Phase 4).

**Cons:**
- Still adds `@openai/agents` dependency.
- Two integration surfaces to maintain (SDK internals + our cache layer).
- SDK guardrails run as JS code (not in system prompt) — must ensure Spanish natural language passes input guardrails.

**Effort:** Medium. Clean separation of concerns; most work in prompt design and tool implementation.

---

### Recommendation

**Approach 4 (Hybrid — OpenAI Agents SDK + Custom Cache Injection)** with a fallback path to Approach 1 (Raw DeepSeek) if the SDK proves problematic.

**Justification:**

1. **Cortex is the differentiator** — the SDK's value is infrastructure (loop, tools, guardrails, streaming, MCP), not replacing our business logic. Approach 4 lets us use SDK infrastructure while keeping our 3-block cache strategy and Cortex integration first-class.

2. **Future-proofing** — the ROADMAP has Phase 4 (Actor Models with shadow agents) and Phase 7 (ML API tool exposure). The SDK's handoff and MCP primitives map directly to these future phases. Starting with the SDK now means we won't need to refactor later.

3. **Risk mitigation** — if the SDK's abstraction layer creates friction with our cache strategy or guardrail behavior, we can fall back to Approach 1 (raw `openai` npm) in hours, not days. The SDK's `OpenAIProvider` with custom `baseURL` is the same `openai` client we'd use anyway.

4. **Guardrails alignment** — `inputGuardrails` and `outputGuardrails` in the SDK map naturally to our safety requirements: input validation (Spanish only, no harmful instructions), output validation (actions must be safe, must require approval). The SDK raises guardrail failures as structured errors, which we can route to our existing `PreparedAction` → `ApprovalRecord` → `AuditRecord` pipeline.

5. **Cortex integration** — `traverse().context` was built for LLM injection. A tool-based approach (`get_business_context`) keeps Cortex as a tested, isolated subsystem that the agent calls on demand. This is cleaner than manually building Block C into every system prompt.

### Risk Assessment

- **DeepSeek cache unpredictability**: DeepSeek's disk cache is automatic and opaque — we can't programmatically verify cache hits. Mitigation: structure prompts so Block A + B are identical across requests (same tokens, same order). Block C varies but is at the end, preserving A+B cache hits.
- **SDK v0.x API instability**: `@openai/agents` is pre-1.0. Mitigation: pin exact version in `package.json`, verify on each upgrade. Fallback path to raw `openai` npm exists.
- **Spanish guardrail compatibility**: SDK guardrails default to English patterns — must verify Spanish prompt validation doesn't trigger false positives. Mitigation: implement custom guardrails, not SDK defaults.
- **Prompt size and cost**: 3-block strategy totals ~20-22K tokens, with ~20K cacheable (A+B). At DeepSeek v4-flash pricing ($0.0028/M cached input, $0.28/M output), each conversation turn costs ~$0.00006 (cached) + ~$0.00014 (output average 500 tokens) = ~$0.0002 per message. Acceptable.
- **Deterministic agent obsolescence**: Replacing `answerBusinessQuestion()` completely may break the demo. Mitigation: coexist during Phase 2; conversational path handles natural language, deterministic path remains as structured fallback. Archive deterministic path in Phase 3-4.

### Ready for Proposal

**Yes.** The architecture is clear, the framework decision is evaluated, the integration points are identified. Proceed to `sdd-propose` to define scope, approach, and rollback plan.

### Key Artifacts to Produce

| Phase | Artifact | Content |
|-------|----------|---------|
| sdd-propose | `proposal.md` | Scope, approach (Hybrid SDK), rollback plan |
| sdd-spec | `specs/conversational-business-agent/spec.md` | Delta specs for conversational requirements |
| sdd-design | `design.md` | System prompt architecture, 3-block cache, Cortex injection, safety mapping |
| sdd-tasks | `tasks.md` | Implementation tasks grouped by layer |

### Non-Obvious Discoveries

1. **DeepSeek cache is prefix-only, token 0-anchored**: Block A must start at token 0 of the messages array. Block B appends after A. Block C appends last. This means Block A and B form a ~20K token prefix that's 100% cacheable across all conversations. The natural structure: `[system (Block A + B), ...conversation history..., user (Block C-injected question)]`. **This is ideal** — the dynamic part (conversation history + user message with Cortex) is always at the end.

2. **`getResponse` vs `getStreamedResponse`**: The OpenAI Agents SDK's `ModelProvider` interface requires BOTH sync and stream implementations. When using `OpenAIProvider` with DeepSeek, streaming is supported via the `openai` client's built-in stream handling — no extra work needed.

3. **Existing `AgentResponse.safetyConflict` pattern is reusable**: The deterministic agent's safety conflict detection (`riskyTopics.has(topic) || highRiskLevels.has(risk)`) becomes an output guardrail in the conversational agent. The SDK's guardrail system can call the same pure functions.

4. **`apps/web/app/demo.ts` builds the entire view model server-side**: Phase 2 conversational agent can be wired similarly — server-side conversation generation with streaming proxied through Next.js API routes.
