# AGENTS.md

## Scope

These repository rules apply to `/Users/aleksnick/dev/investing`.

## ML Training Workflow

- Use `yarn ml-train:trendline:*` scripts for model training (`rf`, `xgboost`, `lightgbm`, etc.).
- Training scripts are wrapped by `bin/ml-train-with-redis.sh`:
  - Redis is stopped before train.
  - Redis is restored on exit (success/error/interrupt).

## Dataset Handling

- Backtest workers write ML rows directly to per-worker chunk files:
  - `ml-dataset-[strategyName]-[chunkId].jsonl`
- ML rows are transformed immediately on signal creation (no `ml:*` Redis dataset keys).
- `yarn ml-export` merges chunk files into one JSONL export:
  - `ml-dataset-[strategyName]-merged-[timestamp].jsonl`
- CSV export is disabled; JSONL is the canonical format.
- Training consumes only base export files (`ml-dataset-*.jsonl`), not derived split files.
- Derived split files are generated automatically:
  - `*.holdout-train.<key>.jsonl`
  - `*.holdout-test.<key>.jsonl`
  - `*.prod.<key>.jsonl`
  - `*.walk-forward-fold-<N>.train.<key>.jsonl`
  - `*.walk-forward-fold-<N>.test.<key>.jsonl`
- Split metadata is stored in:
  - `*.windows.<key>.meta.json`
  - includes `files.holdout`, `files.prod`, `files.walkForwardFolds`
- Derived files are reused when these are unchanged:
  - export filename hash
  - `ML_TRAIN_TEST_DAYS`
  - `ML_TRAIN_RECENT_DAYS`
  - `ML_TRAIN_WALK_FORWARD_FOLDS`

## Feature Parity Rules

- Keep feature-window parity across backtest write path and inference path:
  - both must use `trimMlTrainingRowWindows(..., 5)`
- In ML transform, remove the last element of candle/indicator arrays before feature generation.
- Naming convention:
  - `TF*_ALT_*` for current-asset features
  - `TF*_BTC_*` for BTC features

## Train Parameters

- `ML_TRAIN_RECENT_DAYS`: train window size in days.
- `ML_TRAIN_TEST_DAYS`: holdout window size in days.
- `ML_TRAIN_WALK_FORWARD_FOLDS`:
  - `0` = disabled
  - `1+` = enabled with that many folds
- `ML_TRAIN_FEATURE_PROFILE`: `all` or `robust`.
- `ML_TRAIN_FEATURE_SET`: `legacy` or `enriched`.

## Robust Profile Rule

- `robust` keeps informative binary (0/1) features.
- Constant binary features are dropped.

## Walk-Forward and Ensemble

- Ensemble applies to main holdout when enabled.
- Ensemble also applies within walk-forward folds when enabled.
- Reports include `ensemble_members_used` per fold.
- Prod ensemble is trained from `--prod-input` / `*.prod.<key>.jsonl` when provided.

## Logging Conventions

- Training logs may include heartbeat with:
  - elapsed time
  - Node RSS
  - ML container memory usage
- Heartbeat is printed only when `ML_TRAIN_DEBUG=1`.
- Console output must remain line-normalized (no carriage-return drift).
- Use `COMPOSE_IGNORE_ORPHANS=1` for cleaner train logs.

## Reports

- Markdown and HTML reports are saved next to model artifacts.
- Reports include:
  - main holdout metrics and threshold table
  - walk-forward windows
  - walk-forward threshold tables per fold
- One `.md` and one `.html` report are generated per run (final file includes eval + prod summary).
- Threshold tables are report-only (not printed to console).

## Upload and Infer Artifacts

- Stable inference aliases:
  - single: `<Strategy>.joblib`
  - ensemble: `<Strategy>.modelN.joblib`
- Each prod model (`*.prod.*.joblib` and alias `*.joblib`) has a sidecar JSON with holdout/fold AUC summary.
- Before each new training run, previous strategy artifacts (`.joblib`, sidecar `.json`, `.md`, `.report.html`) are archived to `data/ml/models/archived/`.
- `ml-upload:prod` uploads inference aliases only (not archived `*.eval.*` / `*.prod.*` snapshots).

## Causality Guard

- Training enforces no-lookahead checks for timestamp-like features (`*Ts`, `*Timestamp`, `*AtMs`) against `entryTimestamp`.
- Guard runs during split generation and Python training.
- Disable only for debugging with `ML_TRAIN_DISABLE_CAUSALITY_GUARD=1`.

## Testing Rules

- Run unit tests with `yarn unit`.
- Run type checks with `yarn dev-tsc`.
- After both succeed, run `yarn prettify`.
- Keep Jest focused on unit suites.
- For changes in `packages/core/src/utils/ai.ts`, `packages/core/src/strategy/*`, signal generation, or ML/testing helpers, re-run both `yarn unit` and `yarn dev-tsc` before commit.

## Runtime AI Signal Review (TrendLine)

- Runtime AI analysis for live TrendLine signals is triggered in shared runtime (`packages/core/src/utils/strategyRuntime.ts`) after `core.ts` returns an `entry` decision with assembled signal.
- TrendLine signal assembly remains strategy-local in `packages/core/src/strategy/TrendLine/core.ts`.
- Strategy-specific AI/ML customizations must live in strategy-local adapters/manifests, not as hardcoded branches in shared utils.
- `entryContext` is the source of truth for runtime execution fields.
- `orderPlan` should contain execution-only additions (`qty`, `takeProfits`, etc.).
- Runtime AI/ML policy should come from strategy adapters/manifests (with optional `decision.runtime` overrides for special cases).
- Prefer shared `strategyApi` DSL in `core.ts`:
  - `skip`, `entry`, `getMarketData`, `getCurrentPosition`, `isCurrentPositionExists`
- `getMarketData()` provides `timestamp = lastCandle.timestamp`.

AI flow details:

- AI writes analysis to `analysis:${symbol}:${signalId}`.
- Telegram reads this key and sends AI analysis as follow-up after the main signal message.
- In non-`BACKTEST` mode, order placement is AI-gated only when:
  - `analysis.direction === signal.direction`
  - `analysis.quality` is `4` or `5`
- AI prompt must analyze the current strategy direction only.
- AI response includes retest guidance fields:
  - `needRetest`
  - `retestPrice`
  - plus `quality`, `takeProfitPrice`, `stopLossPrice`, `comment`

## Indicator Architecture

- Keep shared strategy indicators in `packages/core/src/utils/indicators.ts`.
- Do not add strategy-specific branches/toggles inside shared indicator module.
- If a strategy needs extra derived series, add neutral fields/periods usable by all strategies.
- For config refactors, do not keep backward-compat aliases or legacy fallback keys unless explicitly requested.
