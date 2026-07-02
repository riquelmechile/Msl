# Archive Report: DeepSeek Tool Smoke Test

## Outcome

The `deepseek-tool-smoke-test` change was archived on 2026-07-02 after syncing added delta requirements into the canonical OpenSpec specifications.

## Archive Status

| Field | Value |
|---|---|
| Status | intentional-with-warnings |
| Artifact store mode | openspec |
| Archived path | `openspec/changes/archive/2026-07-02-deepseek-tool-smoke-test/` |
| Verification status | Passed for focused offline tests, typecheck, lint, and format check |
| Critical verification issues | None |

## Specs Synced

| Domain | Action | Details |
|---|---|---|
| `conversational-business-agent` | Updated | Added 1 requirement: `Opt-In DeepSeek Tool Smoke Validation`. |
| `multi-agent-orchestration` | Updated | Added 1 requirement: `Forced Delegation Tool-Call Smoke`. |

## Verification Evidence

| Command | Result |
|---|---:|
| `npm test -- scripts/deepseek-tool-smoke.test.mjs packages/agent/tests/conversation/tools.test.ts` | Pass |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run format:check` | Pass |

## Preserved Follow-Up

Live DeepSeek provider behavior was not run in this environment because the required `DEEPSEEK_API_KEY` and `MSL_DEEPSEEK_LIVE_SMOKE=1` gates were absent. This is intentionally preserved as manual follow-up task `4.3`, and the required command is documented in `tasks.md`, `apply-progress.md`, and `verify-report.md`:

```bash
DEEPSEEK_API_KEY=... MSL_DEEPSEEK_LIVE_SMOKE=1 npm run smoke:deepseek:tool
```

## Archive Gate Notes

- `tasks.md` contains one unchecked manual live-smoke verification follow-up (`4.3`). This is not treated as stale completed work; it is intentionally preserved because live provider credentials and explicit opt-in were unavailable.
- The archive was requested with this known preserved follow-up and fresh non-live verification evidence.
- No CRITICAL verification issues were reported.

## Source of Truth Updated

- `openspec/specs/conversational-business-agent/spec.md`
- `openspec/specs/multi-agent-orchestration/spec.md`

## Archive Contents Verified

- `proposal.md`
- `exploration.md`
- `design.md`
- `tasks.md`
- `apply-progress.md`
- `verify-report.md`
- `archive-report.md`
- `specs/conversational-business-agent/spec.md`
- `specs/multi-agent-orchestration/spec.md`
