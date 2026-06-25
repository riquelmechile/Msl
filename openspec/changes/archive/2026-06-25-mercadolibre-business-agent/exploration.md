## Exploration: MercadoLibre business agent foundation

### Current State
The repository is effectively blank: it contains `README.md`, OpenSpec scaffolding, and ATL metadata only. `openspec/config.yaml` confirms that no application stack, architecture, test runner, linter, type checker, formatter, or project style has been established yet. There are no source files or main specs under `openspec/specs/`.

The canonical Mercado Libre MCP candidate is `https://github.com/mercadolibre/mercadolibre-mcp-server`. It is owned by the `mercadolibre` GitHub organization, so it should be treated as official unless later Mercado Libre channels contradict it. The repository currently contains only `README.md` and points to the remote MCP endpoint `https://mcp.mercadolibre.com/mcp` plus official documentation at `https://developers.mercadolibre.com.ar/en_us/mcp-server`.

The official MCP documentation says the server provides documentation-oriented tools, not direct seller-operation tools:
- `search_documentation` — searches Mercado Libre developer documentation by query, language, optional site ID, limit, and offset.
- `get_documentation_page` — retrieves full documentation page content by path, language, and optional site ID.

This means the MCP is a strong source of truth for API discovery and implementation guidance, but it should not be assumed to be the runtime integration layer for managing the user's business. The future product will likely need its own Mercado Libre API integration, OAuth handling, persistence, domain model, and safety controls for business actions.

### Affected Areas
- `openspec/config.yaml` — establishes that the project has no stack, architecture, or verification commands yet.
- `openspec/specs/` — currently empty; future proposal/spec phases should define domains such as agent memory, Mercado Libre integration, user onboarding, insights, and action safety.
- `openspec/changes/mercadolibre-business-agent/exploration.md` — records this exploration for the named change.
- `README.md` — currently only the project title; future documentation should explain the product vision, development workflow, and integration assumptions.

### Approaches
1. **Documentation-first assistant shell** — Build a professional assistant that uses the official MCP only to retrieve Mercado Libre documentation and guide the user through manual or semi-manual decisions.
   - Pros: Lowest risk; aligns tightly with the official MCP's current exposed tools; useful for discovery and planning.
   - Cons: Does not yet operationalize the business; limited differentiation; business learning remains mostly conversational unless persistence is added separately.
   - Effort: Low

2. **Progressive business intelligence agent** — Build a backend-centered product that stores seller context, syncs Mercado Libre business data through official APIs, uses the MCP as documentation/source-of-truth support, and produces daily insights before enabling actions.
   - Pros: Best fit for “becomes progressively expert day by day”; supports durable memory, analytics, explainability, and future automation.
   - Cons: Requires early decisions on stack, OAuth, data storage, privacy, sync cadence, and user approval flows.
   - Effort: Medium

3. **Autonomous operations agent** — Build toward direct operational actions such as listing updates, pricing changes, question responses, promotions, and order workflows from the beginning.
   - Pros: High product value if correct; can become a true business copilot.
   - Cons: High risk without domain constraints, audit trails, permissions, sandboxing, rate-limit handling, and explicit human approvals.
   - Effort: High

### Recommendation
Use the **Progressive business intelligence agent** approach as the foundation. The project should start with read-heavy learning loops: connect account, discover seller profile, ingest business signals, build daily memory, generate explainable recommendations, and require explicit approval before any write action. Treat the official Mercado Libre MCP and developer docs as the documentation/source-of-truth layer, while designing the application around direct Mercado Libre API integration for real business data and operations.

Before proposal, clarify these product decisions:
- Target Mercado Libre site/country and language for the first supported seller.
- Initial business scope: listings, pricing, questions, orders, shipping, promotions, reputation, ads, or analytics.
- Whether MVP is read-only insights, assisted actions, or approved write automation.
- Data retention expectations for business memory and whether sensitive data may be stored locally or remotely.
- Preferred product surface: CLI, web dashboard, chat interface, IDE-assisted tool, or background service.
- Authentication model: personal seller account OAuth, app-based integration, or both.
- Human-in-the-loop policy for risky actions such as price changes, listing edits, cancellations, refunds, and customer messages.
- Desired stack and deployment target, since the repo currently has no established technology baseline.

### Risks
- The official MCP repository is very small and exposes documentation tools only; assuming it can directly operate the seller business would be incorrect.
- The README example references bearer-token configuration, while the official documentation emphasizes client-managed OAuth; proposal should follow the official docs and verify client support.
- Business automation can cause financial, reputation, privacy, or compliance harm without explicit permissions, audit logs, and approval gates.
- Mercado Libre API limits, OAuth scopes, country-specific behavior, and documentation changes may shape the architecture significantly.
- A blank repo means stack, testing, security, and deployment decisions are still open and must be made deliberately before implementation.

### Ready for Proposal
Yes, with constraints. The proposal should define an MVP as a read-first business intelligence agent that learns from the seller's Mercado Libre context over time, uses the official MCP/documentation to guide API integration, and postpones autonomous write operations until safety, permissions, and auditability are specified.
