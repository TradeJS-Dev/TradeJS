---
sidebar_position: 10
title: ML Pipeline and Configuration
---

## Main Flow

1. Backtests can write ML chunk files (`--ml`).
2. `npx @tradejs/cli ml-export` merges chunk files into one JSONL dataset.
3. Train script builds derived windows (`holdout`, `prod`, `walk-forward`).
4. Python train container generates model artifacts and reports.
5. Runtime inference uses gRPC (`ML_GRPC_ADDRESS`).

## Real Commands

```bash
npx @tradejs/cli backtest --config trendline --ml
npx @tradejs/cli ml-export
npx @tradejs/cli ml-inspect
npx @tradejs/cli ml-train:trendline:xgboost
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

## Local Artifact Chain (Export -> Train -> Signals)

1. `npx @tradejs/cli backtest --ml` writes chunk files to local project folder:
   `data/ml/export/ml-dataset-<strategy>-chunk-<chunkId>.jsonl`
2. `npx @tradejs/cli ml-export` merges chunks into:
   `data/ml/export/ml-dataset-<strategy>-merged-<timestamp>.jsonl`
3. `npx @tradejs/cli ml-train:latest` reads export files from `data/ml/export` and writes model aliases to:
   `data/ml/models/<Strategy>.joblib`
   or ensemble aliases `data/ml/models/<Strategy>.modelN.joblib`
4. ML infer service must read the same model directory (`MODEL_DIR`).
5. `npx @tradejs/cli signals` (with strategy config `ML_ENABLED=true`) sends `signal.strategy` to gRPC `Predict`.
   Inference service loads `<Strategy>.joblib` / `<Strategy>.modelN.joblib` for that strategy.

If strategy name and model alias prefix match, runtime automatically uses the trained local model.

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
