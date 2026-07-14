# Run Association Policy

New evidence, cost components, and snapshots MUST carry `sellerId` and `ingestionRunId`. Store APIs are seller-first and require both dimensions for run reads/counts:

```ts
listComponentsByRun(sellerId, runId); countComponentsByRun(sellerId, runId);
listSnapshotsByRun(sellerId, runId); countSnapshotsByRun(sellerId, runId);
listByRun(sellerId, runId); countByRun(sellerId, runId);
```

Every query predicates both columns and uses matching composite indexes. CLI `--run` supplies the selected runtime seller and never exposes cross-seller rows or PII. Re-ingested canonical evidence remains associated with its original producing run; later runs report it as ignored rather than rewriting provenance. Existing rows retain null provenance where no trustworthy relationship can be reconstructed.
