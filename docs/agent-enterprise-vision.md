# MSL Agent Enterprise Vision

MSL is a CEO-led AI company operating system: a hierarchy of specialized agents that learn, collaborate, and propose high-utility business actions while the human CEO keeps control of business decisions through Telegram approvals.

MercadoLibre is the first operating channel, not the product boundary. The product goal is to build a cost-aware learning organization that can run Plasticov and Maustian today, then expand into owned ecommerce, social commerce, supplier operations, ads, content, and additional marketplaces.

## Current implementation boundary

- Telegram is CEO-only. The user talks to the CEO agent, not directly to workers, managers, departments, or specialists.
- Workers, managers, and departments are internal orchestration resources coordinated by the CEO agent.
- Workforce lessons are durable company-agent context. They can inform routing and proposals, but they never override system, safety, or CEO policy.
- Active company-agent routing uses environment/configuration context for lessons and delegation. It does not grant admin authorization.
- Cost/cache ledger evidence is internal operating evidence for routing decisions, not billing truth and not a user-facing dashboard.
- Provider usage capture stores bounded numeric counters and boring metadata only. LLM context and ledger summaries must not include prompts, responses, tool args, secrets, raw metadata, full entry IDs, or raw agent/provider labels.
- Cost/cache context belongs in Block C dynamic evidence, not the system prompt, so Block A remains prefix-cache stable.

## What MSL is

| MSL is                               | Meaning                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A simulated company                  | Agents act like departments, managers, and specialists with clear responsibility boundaries.                                    |
| CEO-controlled                       | The human CEO approves, rejects, or redirects business decisions; agents do cheap autonomous work first.                        |
| Learning infrastructure              | Cortex stores operational memory; Darwinian feedback strengthens useful patterns and weakens bad ones.                          |
| Cost-aware AI operations             | DeepSeek cache-resident specialists use stable prompts and routing rules to keep repeated reasoning cheap.                      |
| Multichannel commerce infrastructure | MercadoLibre is the first channel; the architecture must grow toward ecommerce, social, suppliers, ads, and other marketplaces. |

## What MSL is not

- Not a MercadoLibre sync bot.
- Not just a dashboard.
- Not a loose collection of tools.
- Not an autonomous mutation engine that spends money or changes listings without approval.
- Not a single assistant trying to know everything equally well.
- Not a worker-selection UI or a place where the user chats directly with individual workers.
- Not a billing dashboard; ledger evidence is operational routing context only.

## Operating model

MSL should behave like a real company whose employees are AI agents.

```text
Human CEO
  └─ Executive / CEO Agent
      ├─ Operations Manager
      │   ├─ MercadoLibre Specialist
      │   ├─ Stock / Fulfillment Specialist
      │   └─ Claims / Reputation Specialist
      ├─ Commercial Manager
      │   ├─ Pricing / Margin Specialist
      │   ├─ Ads Specialist
      │   └─ Creative / Listing Specialist
      ├─ Expansion Manager
      │   ├─ Owned Ecommerce Specialist
      │   ├─ Social Commerce Specialist
      │   └─ Marketplace Expansion Specialist
      └─ Finance / Cost Manager
          ├─ Unit Economics Specialist
          └─ LLM Cost / Cache Specialist
```

The hierarchy is not cosmetic. It defines who can investigate, who can request evidence, who can draft a proposal, and which decisions must be escalated to the CEO.

## Decision loop

1. A specialist detects an opportunity or risk from operational data, market signals, or CEO strategy.
2. The specialist asks other agents for missing evidence instead of guessing.
3. The manager combines evidence into a proposal with expected upside, cost, risk, and confidence.
4. The CEO agent sends only the business decision to Telegram.
5. The human CEO approves, rejects, or redirects.
6. Cortex records the outcome and Darwinian learning updates future behavior.

The CEO should not be interrupted for routine evidence collection. The CEO should be interrupted when there is a decision with meaningful business utility.

## Example: ads proposal with inter-agent evidence

```text
Ads Specialist:
  "Product X has strong conversion and low ad exposure. I need margin before proposing spend."

Costs Specialist:
  "Unit cost is CLP 4,200, MercadoLibre fee is CLP 1,600, current price is CLP 12,990.
   Estimated contribution margin before ads is CLP 7,190. Safe CPA ceiling: CLP 2,100."

Market Specialist:
  "Catalog competitors are priced between CLP 12,490 and CLP 14,990.
   Plasticov has better reputation; Maustian needs exposure."

Commercial Manager:
  "Proposal: run a 7-day Maustian Product Ads test with CLP 2,000/day cap,
   pause if CPA exceeds CLP 2,100 or ROAS drops below target."

CEO Telegram escalation:
  "I found a controlled ad test for Product X. Expected upside: more Maustian sales
   without breaking margin. Max spend: CLP 14,000. Stop rule: CPA > CLP 2,100.
   Approve? Reply 'dale', reject, or redirect."
```

## Learning model

MSL learns like employees learn: through training, domain research, supervised decisions, and operational outcomes.

| Learning input                 | How it improves the company                                                                                       |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| CEO approvals/rejections       | Reinforces or penalizes the activated Cortex constellation behind a proposal.                                     |
| Operational outcomes           | Compares proposal expectations against real sales, margin, claims, stock movement, and ad performance.            |
| Corrections                    | Turns CEO redirection into durable policy or specialist memory.                                                   |
| Specialist research            | Stores domain-specific knowledge such as marketplace rules, supplier terms, category dynamics, and ad benchmarks. |
| Market data                    | Updates pricing, competition, demand, reputation, and opportunity detection.                                      |
| Training/course-like knowledge | Lets agents improve their craft over time instead of relying only on generic prompting.                           |

Cortex is the shared company brain. Darwinian feedback is the performance review system: useful reasoning paths become easier to activate; bad or rejected paths become less likely to recur.

## DeepSeek cache economics

DeepSeek cache economics are a product constraint, not an implementation detail.

MSL should prefer cache-resident specialists with stable prompts, stable role definitions, and predictable context blocks. The goal is to use strong LLM reasoning without paying full price for repeated context.

| Cache principle            | Product implication                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| Stable specialist prefixes | Departments should have durable identities and responsibilities.                                         |
| Reused company context     | Business identity, policies, and durable operating rules should remain cache-friendly.                   |
| Small dynamic evidence     | Agents inject only the current evidence needed for a decision.                                           |
| Cost-aware routing         | Cheap deterministic logic, cached specialists, or no LLM call should be used before expensive reasoning. |
| Ledgered decisions         | The system should know which agent spent tokens, why, and what utility resulted.                         |

The company should become smarter without becoming expensive to operate.

Cost-aware CEO guardrails prefer recent, cached, or lower-cost evidence when it is sufficient. The CEO agent should ask before expensive, broad, or duplicate investigations, while preserving exceptions for urgent, safety-related, explicitly approved, or policy-required work.

## Commerce expansion path

The current base business is two MercadoLibre Chile accounts:

- **Plasticov**
- **Maustian**

The business model is hybrid: dropshipping, arbitrage, and some owned stock. These accounts are parallel commercial channels; a configured sync path is only one bounded operation.

MSL must grow beyond MercadoLibre:

- Owned ecommerce: evidence-backed Medusa-oriented storefront projections and static previews are implemented. Runtime approval execution (domain/store contracts, Medusa runtime executor, regression verification) is merged as a stacked-PR SDD cycle and gated behind approvals + env credentials. Live Medusa deployment, checkout, and public publish remain future gated work.
- Social channels and content/creative workflows.
- Ripley and other marketplaces.
- Supplier discovery, negotiation, and catalog intelligence.
- Ads planning and budget control.
- Opportunity detection across channels.

Every new channel should plug into the same company model: specialist agents, evidence requests, CEO approval gates, Cortex memory, Darwinian feedback, and cost-aware routing.

## Implemented kernel foundation

The current branch includes the first durable company-agent foundation. It makes the company model real enough for internal routing, learning, and cost-aware operating evidence while keeping Telegram CEO-only.

| Kernel capability            | Current boundary                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Company-agent registry       | Stores active company agents with department, stable prefix, inputs, outputs, evidence needs, and boundaries. |
| Agent lifecycle              | Supports active/archived records; admin-capable mutation remains separated from routing context.              |
| Skill and training memory    | Records bounded lessons for agents or departments as durable context, not policy overrides.                   |
| Evidence request protocol    | Allows bounded evidence requests before CEO escalation; no external business mutation is executed.            |
| Cost/cache ledger            | Tracks bounded counters and safe metadata for operating evidence; summaries are not billing truth.            |
| Proposal escalation contract | Keeps Telegram focused on CEO approve/reject/redirect decisions.                                              |
| Outcome feedback             | Connects approvals, rejections, operational outcomes, and corrections back into Cortex.                       |

The kernel foundation is live: company-agent registry, learning store, admin learning tools, cost/cache ledger, and runtime approval execution contracts are all merged. Collaboration and learning are real; broader production mutations remain gated behind explicit approvals, env credentials, and CEO authorization.

## Current repository alignment

The repository already contains important foundations:

- Telegram runtime and `AgentLoop` wiring.
- CEO and specialist lanes plus a durable company-agent registry.
- Durable workforce lessons for agent/department context.
- Cost/cache operating ledger summaries injected as Block C evidence.
- Cortex neural graph memory and operational read model.
- DeepSeek 3-block cache design and telemetry.
- `delegate_to_subagent` as a static proposal-oriented primitive.
- MercadoLibre tooling and approval-gated business operations.

The runtime execution path for owned ecommerce (contracts, Medusa executor, regression matrix) was completed as a stacked-PR SDD cycle and is merged. Remaining product hardening includes richer lifecycle workflows, broader evidence protocols, operational utility feedback, live production policy, and the roadmap for multichannel expansion.

## Related material

- [`docs/propuesta-ceo-socio.md`](./propuesta-ceo-socio.md) is prior Spanish proposal material for the CEO/Socio hierarchy and phased expansion.
- [`../README.md`](../README.md) describes the current runtime boundary and implemented capabilities.
- [`../ROADMAP.md`](../ROADMAP.md) tracks implementation phases.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) describes the current monorepo architecture.
