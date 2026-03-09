---
title: Backup and Restore Guide
---

Backups must cover application artifacts and stateful services.

## What to Backup

- `data/` directory
- Postgres/Timescale data volume
- Redis data volume (if needed for runtime continuity)
- Model artifacts and reports

## Recommended Schedule

- Daily incremental backups
- Weekly full backups
- Frequent snapshots before major releases

## Restore Drill

1. Restore data into staging.
2. Start services (`npx @tradejs/cli infra-init && npx @tradejs/cli infra-up` for local) and run `doctor`.
3. Verify API + runtime smoke checks.
4. Confirm model aliases and critical Redis keys.

## Practical Rule

If restore is untested, backup reliability is unknown. Run recovery drills regularly.
