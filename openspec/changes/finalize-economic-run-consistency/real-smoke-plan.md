# Real Smoke Plan

Persistent smoke is blocked until unchecked R1–R8 are accepted, implemented migrations 1007–1011 prove fresh/1006-upgrade/rerun/checksum/rollback, future R7 1012/1013 and R2's later run-failure migration prove their owned contracts, and the v4 review gate is resolved truthfully. It must inspect only allowlisted run, health, backlog, fence, epoch, and alert state.

Offline pre-smoke proof must cover restart-stable non-null backlog keys, all six backlog states, deterministic cadence and expired recovery, attempted-versus-unstarted abort, admin audit/alert, dead-letter replay, every fence writer boundary, immutable identity/manifest swap block, exact epoch accounting, durable failure-intent/post-CAS stale-writer rejection, hostile lease/backlog/alert CAS matrices, alert inbox/crash-after-send/dead-letter/pager, and every journaled WAL/SHM restore/rollback state. No smoke, migration, or live call occurs in this documentary correction.
