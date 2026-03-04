---
title: Model Promotion Policy
---

Define objective promotion gates before publishing model aliases.

## Required Inputs

- Latest training report (`.md`/`.html`)
- Holdout and walk-forward metrics
- Split metadata and dataset provenance

## Suggested Gates

- Holdout AUC above baseline threshold.
- Walk-forward mean quality above floor.
- Acceptable variance across folds.
- Stable threshold policy and non-trivial coverage.

## Promotion Steps

1. Validate metrics against policy.
2. Snapshot current production aliases.
3. Publish new aliases (`<Strategy>.joblib` or ensemble aliases).
4. Enable monitoring for post-promotion drift.

## Rollback Rules

- Roll back if critical quality or runtime health alerts fire.
- Keep previous alias set immutable for quick restore.
