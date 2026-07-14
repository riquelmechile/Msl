# R5 Economic SQLite Writer Inventory

| Writer | File | Table(s) | Seller | Receipt | Fence | Epoch |
|---|---|---|---:|---:|---:|---:|
| outcome | `economicOutcomeStore.ts` | `economic_outcomes` | yes | yes | yes | +1/session |
| component | `economicOutcomeStore.ts` | `economic_cost_components` | yes | yes | yes | +1/session |
| snapshot | `economicOutcomeStore.ts` | `unit_economics_snapshots` | yes | yes | yes | +1/session |
| evidence | `economicEvidenceStore.ts` | `economic_evidence_references` | yes | yes | yes | +1/session |
| run | `economicIngestionRunStore.ts` | `economic_ingestion_runs` | yes | yes | yes | +1/session |
| checkpoint | `economicIngestionRunStore.ts` | checkpoint tables | yes | yes | yes | +1/session |
| backlog | `economicIngestionRunStore.ts` | retry backlog | yes | yes | yes | +1/session |
| source health | `economicIngestionRunStore.ts` | `economic_source_health` | yes | yes | yes | +1/session |
| alert intent | `economicIngestionRunStore.ts` | alert intents | yes | yes | yes | +1/session |

Fence/lease CAS coordination is epoch-neutral. DDL is limited to `MaintenanceWriteAdmission`; the only bootstrap exception is before metadata/fence creation on a new database.
