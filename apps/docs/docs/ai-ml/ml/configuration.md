---
sidebar_position: 10
title: ML Pipeline and Configuration
---

## Main Flow

1. Backtests can write ML chunk files (`--ml`).
2. `yarn ml-export` merges chunk files into one JSONL dataset.
3. Train script builds derived windows (`holdout`, `prod`, `walk-forward`).
4. Python train container generates model artifacts and reports.
5. Runtime inference uses gRPC (`ML_GRPC_ADDRESS`).

## Real Commands

```bash
yarn backtest --config trendline --ml
yarn ml-export
yarn ml-inspect
yarn ml-train:trendline:xgboost
yarn ml-upload:prod
```

## Useful `.env` Example

```env
ML_GRPC_ADDRESS=127.0.0.1:50051
ML_TRAIN_RECENT_DAYS=60
ML_TRAIN_TEST_DAYS=30
ML_TRAIN_WALK_FORWARD_FOLDS=2
ML_TRAIN_FEATURE_PROFILE=all
ML_TRAIN_FEATURE_SET=enriched
ML_TRAIN_ENSEMBLE=1
ML_TRAIN_ENSEMBLE_MEMBERS=3
```

## Dataset File Patterns

Source chunk files:

```text
ml-dataset-<strategy>-<chunkId>.jsonl
```

Derived split files (generated automatically):

```text
*.holdout-train.<key>.jsonl
*.holdout-test.<key>.jsonl
*.prod.<key>.jsonl
*.walk-forward-fold-<N>.train.<key>.jsonl
*.walk-forward-fold-<N>.test.<key>.jsonl
```

## Quality and Causality

- Train validates lookahead leakage on timestamp-like fields.
- Guard can be disabled only for debugging:

```env
ML_TRAIN_DISABLE_CAUSALITY_GUARD=1
```

- Runtime inference uses the same feature trimming policy as train.

## Reports

Each train run saves markdown and HTML reports with:

- holdout metrics,
- walk-forward metrics,
- threshold tables,
- holdout TOP feature table.
