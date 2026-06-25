# MSL — MercadoLibre Business Agent MVP

Deterministic TypeScript MVP for a Spanish-facing MercadoLibre Chile (`MLC`) seller assistant. The current implementation is intentionally safe: it demonstrates chat advice, OAuth connection state, daily insights, approval-gated writes, audit visibility, and creative preview approval without real MercadoLibre credentials, real OAuth calls, LLM provider calls, generated media, or autonomous publication.

## Quick path

1. Install dependencies with `npm install`.
2. Run the quality gates:
   - `npm test`
   - `npm run typecheck`
   - `npm run lint`
   - `npm run format:check`
   - `npm run build`
   - `npm run test:e2e`
3. Start the demo UI with `npm run dev --workspace @msl/web` and open `http://127.0.0.1:3000`.

## Stack

| Area         | Implementation                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web UI       | Next.js app in `apps/web` with neutral/professional Spanish product copy.                                                                                                                   |
| Domain logic | TypeScript packages under `packages/*` for domain contracts, MercadoLibre access state, memory/cache boundaries, custom tools, agent orchestration, workers, insights, and creative drafts. |
| Tests        | Vitest for package behavior and Playwright for supported-platform E2E flows.                                                                                                                |
| Quality      | TypeScript project builds, ESLint, Prettier, and guarded Playwright runner.                                                                                                                 |

## Verification limitations

- `npm run test:e2e` uses `scripts/run-e2e.mjs`.
- On unsupported local Playwright platforms, such as Android/Termux, it exits successfully with an explicit skip message.
- On supported platforms, the guard runs Playwright when `tests/e2e` specs exist, starts the built Next.js app through Playwright `webServer`, and propagates real failures.
- The UI is a deterministic demo wired to current packages; it does not call real MercadoLibre OAuth/API endpoints or external AI/media providers.
