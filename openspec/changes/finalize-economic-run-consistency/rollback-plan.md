# Rollback Plan

Forward repair retains runs, health, backlog, alerts, checkpoints, and audit records. Global abort returns owned backlog work to `pending`; only approved administrative cancellation uses `administratively-cancelled` and creates an audit/alert record.

Database rollback follows the fenced, journaled restore policy only: reject writers; persist `quiescing`; close all handles; checkpoint/close and remove generation WAL/SHM sidecars; compare epoch; validate sidecar-free staging identity, generation, and manifest hash; token-recheck; journal each rename; retain/swap; reopen/validate health; and restore the retained candidate on post-swap failure. The failure path closes new handles, checkpoints/removes sidecars, journals rollback renames, restores/reopens/validates the prior candidate, and alerts. Handle, WAL/SHM, rename, reopen, or health failure blocks admission and requires manual reconciliation. No restore runs in this documentary correction.
