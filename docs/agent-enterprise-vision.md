# MSL Agent Enterprise Vision

MSL is a CEO-led AI company operating system: a hierarchy of specialized agents that learn, collaborate, and propose high-utility business actions while the human CEO keeps control of business decisions through Telegram approvals.

MercadoLibre is the first operating channel, not the product boundary. The product goal is to build a cost-aware learning organization that can run Plasticov and Maustian today, then expand into owned ecommerce, social commerce, supplier operations, ads, content, and additional marketplaces.

## What MSL is

| MSL is                               | Meaning                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| A simulated company                  | Agents act like departments, managers, and specialists with clear responsibility boundaries.                                    |
| CEO-controlled                       | The human CEO approves, rejects, or redirects business decisions; agents do cheap autonomous work first.                        |
| Learning infrastructure              | Cortex stores operational memory; Darwinian feedback strengthens useful patterns and weakens bad ones.                          |
| Cost-aware AI operations             | DeepSeek cache-resident specialists use stable prompts and routing rules to keep repeated reasoning cheap.                      |
| Multichannel commerce infrastructure | MercadoLibre is the first channel; the architecture must grow toward ecommerce, social, suppliers, ads, and other marketplaces. |

## Current repository alignment

The repository now contains the first durable workforce kernel. It is real, but intentionally bounded.

| Area                   | Implemented today                                                                                                                                                                                | Not complete yet                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Company-agent registry | SQLite-backed company-agent profiles; authorized CEO/admin tools can create and list company agents.                                                                                             | Full department/manager lifecycle, broad self-management, and organization-wide activation policies. |
| Workforce learning     | SQLite-backed lesson store; authorized tools can record and list lessons for agents/departments.                                                                                                 | Inter-agent evidence protocol, cost ledger, utility scoring, and complete training lifecycle.        |
| Runtime wiring         | Telegram wires the registry and learning store when SQLite is configured.                                                                                                                        | Broad production mutation flows through Telegram.                                                    |
| Agent context          | `AgentLoop` injects bounded `## Workforce Lessons` only for explicit active company agents. Lessons are capped, sanitized, hostile text filtered, and parity-tested for streaming/non-streaming. | Unbounded context sharing or implicit lesson injection for every conversation.                       |

## What MSL is not

- Not a MercadoLibre sync bot.
- Not just a dashboard.
- Not a loose collection of tools.
- Not an autonomous mutation engine that spends money or changes listings without approval.
- Not a single assistant trying to know everything equally well.

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

## Commerce expansion path

The current base business is two MercadoLibre Chile accounts:

- **Plasticov**
- **Maustian**

The business model is hybrid: dropshipping, arbitrage, and some owned stock. These accounts are parallel commercial channels; a configured sync path is only one bounded operation.

MSL must grow beyond MercadoLibre:

- Owned ecommerce storefront.
- Social channels and content/creative workflows.
- Ripley and other marketplaces.
- Supplier discovery, negotiation, and catalog intelligence.
- Ads planning and budget control.
- Opportunity detection across channels.

Every new channel should plug into the same company model: specialist agents, evidence requests, CEO approval gates, Cortex memory, Darwinian feedback, and cost-aware routing.

## First implementation kernel

The first architectural kernel has started: PR #65 made the company model durable with registry/lesson storage and admin tools; PR #67 connected bounded workforce lessons to active agent context. The table below separates what exists from what remains.

| Kernel capability            | Why it matters                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Company-agent registry       | Partially implemented: durable SQLite agent profiles and authorized create/list tools. Still needs full department/manager lifecycle, budgets, allowed-tool enforcement, and stable prefix governance. |
| Agent lifecycle              | Planned: create/train/activate/pause/retire policies beyond the current controlled admin surface.                                                                                                      |
| Skill and training memory    | Partially implemented: durable lessons can be recorded/listed and injected for active agents. Still needs richer provenance and training workflows.                                                    |
| Evidence request protocol    | Planned: allows agents to ask other agents for bounded research before escalating.                                                                                                                     |
| Cost ledger                  | Planned: tracks LLM spend, cache hits, agent work, and proposal utility.                                                                                                                               |
| Proposal escalation contract | Existing approval-gate philosophy remains; deeper delegation records are still planned.                                                                                                                |
| Outcome feedback             | Cortex/Darwinian feedback exists; direct linkage from workforce lessons to operational outcomes is still planned.                                                                                      |

This kernel should start proposal-only. It should make collaboration and learning real before enabling broader production mutations.

The main missing pieces are no longer basic durability. They are lifecycle depth and governance: full department/manager operations, inter-agent evidence records, cost ledgering, utility feedback, allowed-tool policy enforcement, and multichannel expansion.

## Related material

- [`docs/propuesta-ceo-socio.md`](./propuesta-ceo-socio.md) is prior Spanish proposal material for the CEO/Socio hierarchy and phased expansion.
- [`../README.md`](../README.md) describes the current runtime boundary and implemented capabilities.
- [`../ROADMAP.md`](../ROADMAP.md) tracks implementation phases.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) describes the current monorepo architecture.
