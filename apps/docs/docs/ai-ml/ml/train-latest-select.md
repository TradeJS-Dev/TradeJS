---
title: ML Train Latest Select
---

`npx @tradejs/cli ml-train:latest` runs interactive/selective training from latest exports and auto-prepares holdout/prod/walk-forward splits.

Runtime surface:

- `@tradejs/cli`
- your configured ML training runtime (container/service)

## What It Does

1. Select strategy and model type.
2. Pick latest dataset (or merge multiple base exports when configured).
3. Build derived split files:

- `*.holdout-train.<key>.jsonl`
- `*.holdout-test.<key>.jsonl`
- `*.prod.<key>.jsonl`
- `*.walk-forward-fold-<N>.train.<key>.jsonl`
- `*.walk-forward-fold-<N>.test.<key>.jsonl`

4. Cache split results by deterministic key/hash.
5. Enforce causality guard on timestamp-like features.
6. Start the configured ML training runtime.

## Commands

```bash
npx @tradejs/cli ml-train:latest
npx @tradejs/cli ml-train:latest --strategy TrendLine --model xgboost
```

Non-interactive options:

- `--strategy`
- `--model` (`catboost|random_forest|extra_trees|xgboost|lightgbm`)
- `--latestOnly`

## Main Environment Controls

Windows and splits:

- `ML_TRAIN_RECENT_DAYS`
- `ML_TRAIN_TEST_DAYS`
- `ML_TRAIN_WALK_FORWARD_FOLDS`

Ensemble/profile:

- `ML_TRAIN_ENSEMBLE`
- `ML_TRAIN_FORCE_ENSEMBLE`
- `ML_TRAIN_NO_ENSEMBLE`
- `ML_TRAIN_FEATURE_PROFILE`

Causality:

- `ML_TRAIN_DISABLE_CAUSALITY_GUARD=1` (debug only)

Incremental mode:

- `ML_TRAIN_INCREMENTAL_THRESHOLD_GB`
- `ML_TRAIN_INCREMENTAL`
- `ML_TRAIN_NO_INCREMENTAL`
- `ML_TRAIN_CHUNK_SIZE`
- `ML_TRAIN_INCREMENTAL_ITERATIONS`

Logging/debug:

- `ML_TRAIN_DEBUG=1`
- `ML_TRAIN_HEARTBEAT_SEC`
- `ML_TRAIN_DOCKER_NO_OUTPUT_TIMEOUT_SEC`

## Redis Safety Behavior

In the reference deployment, training runs with a safety wrapper:

- pause Redis before train
- restore Redis on exit (success/failure/interrupt)

## Output Artifacts

- model aliases (`<Strategy>.joblib`, ensemble aliases)
- eval/prod snapshots
- sidecar metrics JSON
- markdown/html reports
- split metadata (`*.windows.<key>.meta.json`)
