# deferred-message-bus-audit Specification

## Purpose

Write-only system audit for four scoped lifecycle APIs; no replay.

## MutationScope

Every API SHALL require validated scope. Seller `{kind:"seller",sellerId}` filters `seller_id` and writes zero audit. System `{kind:"system",operationId,reason,evidenceRef}` requires non-empty fields, globally unique operation ID, and one audit row.

## Audit Table

Exactly 12 columns, all TEXT except `queryLimit INTEGER`: `operationId TEXT PRIMARY KEY NOT NULL`; `operation`, `scopeJson`, `reason`, `evidenceRef`, `createdAt` are `TEXT NOT NULL`; nullable `messageId TEXT`, `queryAsOf TEXT`, `queryCursorJson TEXT`, `queryLimit INTEGER`, `resultMessageIdsJson TEXT`, `nextCursorJson TEXT`. Scope uses `JSON.stringify(scope)`; clocks use SQLite `datetime('now')`.

Mutations set messageId and SQL NULL all five query columns. Query sets messageId SQL NULL; stores transaction-start queryAsOf, exact limit, and JSON text for caller cursor, ordered IDs, next cursor (`"null"` when absent).

## Requirements

### Requirement: Mutation Audit (defer, resumeDeferred, settle)

System mutations SHALL audit in the SAME transaction as mutation/idempotent classification. Fresh-ID retry returns the domain result and adds exactly one row. Duplicate ID/INSERT failure SHALL throw, rollback, and return no result, never a no-op success. Seller writes zero. Persist exact scope JSON/reason/evidenceRef/SQLite clock and mutation NULLs.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| Each mutation API | system scope | defer/resumeDeferred/settle | Exact operation/message/fields; query columns SQL NULL |
| Seller | seller scope | each mutation | Domain result; zero audit |
| Fresh retry | prior transition, new ID | same request | Same result; one new row |
| Duplicate/failure | duplicate ID or INSERT error | each mutation | Throws; full rollback; no result |

### Requirement: Query Audit (getExpiredDeferrals)

System query SHALL use ONE snapshot: capture SQLite queryAsOf→SELECT→capture IDs/cursor→INSERT→commit→return captured result. Fresh-ID retry is a new snapshot/row; fixed clock plus unchanged DB reproduces result. Duplicate ID/INSERT failure SHALL throw, rollback, and return no result, never `[]`. Seller uses the snapshot with zero audit.

| Scenario | GIVEN | WHEN | THEN |
|----------|-------|------|------|
| System fields | cursor or none | query | messageId SQL NULL; exact scope/reason/evidenceRef/clocks/limit; JSON text cursor/results/next |
| Seller | seller scope | query | Snapshot result; zero audit |
| Fresh retry | unchanged DB/fixed clock/new ID | repeat | Same result; one new row |
| Duplicate/failure | duplicate ID or INSERT error | query | Throws; rollback; no result |
