# AGENTS.md

## Scope
These instructions apply to this repository (`/Users/aleksnick/dev/investing`).

## ML Training Workflow
- Use `yarn ml-train:trendline:*` scripts for model training (`rf`, `xgboost`, `lightgbm`, etc.).
- Training scripts are wrapped by `bin/ml-train-with-redis.sh`:
  - Redis is stopped before train.
  - Redis is restored on exit (success/error/interrupt).

## Dataset Handling
- Backtest workers write ML rows directly to per-worker chunk files:
  - `ml-dataset-[strategyName]-[chunkId].jsonl`
- ML rows are transformed immediately on signal creation (no `ml:*` Redis keys).
- `yarn ml-export` merges chunk files into one dataset:
  - `ml-dataset-[strategyName]-merged-[timestamp].jsonl`
- CSV export is disabled; only JSONL is generated.
- Training uses the latest merged/base export file (`ml-dataset-*.jsonl`) only.
- Derived split files are generated automatically:
  - `*.holdout-train.<key>.jsonl`
  - `*.holdout-test.<key>.jsonl`
  - `*.prod.<key>.jsonl`
  - `*.walk-forward-fold-<N>.train.<key>.jsonl`
  - `*.walk-forward-fold-<N>.test.<key>.jsonl`
- Split metadata is stored in:
  - `*.windows.<key>.meta.json`
  - contains `files.holdout`, `files.prod`, `files.walkForwardFolds`
- Derived files are cached and reused when:
  - same export filename hash
  - same `ML_TRAIN_TEST_DAYS`
  - same `ML_TRAIN_RECENT_DAYS`
  - same `ML_TRAIN_WALK_FORWARD_FOLDS`
- Never treat derived split files as source exports.
- Keep feature-window parity across stages:
  - backtest dataset write path uses trimmed windows (`trimMlTrainingRowWindows(..., 5)`),
  - inference path must use the same trim policy before grpc predict.
- In ML transform, last element of candle/indicator arrays is dropped before feature generation to avoid closed-vs-open candle mismatch.
- Feature naming convention:
  - use `TF*_ALT_*` for current-asset features,
  - use `TF*_BTC_*` for BTC features.
- Training reports include holdout TOP feature table (single-feature threshold) in both `md` and `html`.

## Train Parameters
- `ML_TRAIN_RECENT_DAYS`: train window size (days).
- `ML_TRAIN_TEST_DAYS`: holdout window size (days).
- `ML_TRAIN_WALK_FORWARD_FOLDS`:
  - `0` = disabled
  - `1+` = enabled with that many folds
- `ML_TRAIN_FEATURE_PROFILE`: `all` or `robust`.
- `ML_TRAIN_FEATURE_SET`: `legacy` or `enriched`.

## Robust Profile Rule
- `robust` keeps informative binary (0/1) features.
- Constant binary features are dropped.

## Walk-forward + Ensemble
- Ensemble is applied to main holdout when enabled.
- Ensemble is also applied inside walk-forward folds when enabled.
- Reports include `ensemble_members_used` per fold.
- Prod ensemble is trained from `--prod-input` / `*.prod.<key>.jsonl` when provided.

## Logging Conventions
- Training logs can include heartbeat with:
  - elapsed time
  - Node RSS
  - ML container memory usage
- Heartbeat is printed only when `ML_TRAIN_DEBUG=1`.
- Console output is normalized line-by-line (no carriage-return drift).
- `COMPOSE_IGNORE_ORPHANS=1` is used for cleaner train logs.

## Reports
- Markdown and HTML reports are saved next to model artifacts.
- Reports include:
  - main holdout metrics and threshold table
  - walk-forward windows
  - walk-forward threshold tables per fold
- One `md` and one `html` report are produced per run (final file includes eval + prod summary).
- Console no longer prints threshold tables; they stay in `md/html`.

## Upload / Infer Artifacts
- Stable inference aliases:
  - single: `<Strategy>.joblib`
  - ensemble: `<Strategy>.modelN.joblib`
- Each prod model (`*.prod.*.joblib` and alias `*.joblib`) has a sidecar metrics JSON with holdout/fold AUC summary.
- Before each new train, previous strategy artifacts (`.joblib`, sidecar `.json`, `.md`, `.report.html`) are moved to `data/ml/models/archived/`.
- `ml-upload:prod` uploads alias inference artifacts only (not archived `*.eval.*` / `*.prod.*` snapshots).

## Causality Guard
- Train step enforces no-lookahead checks for timestamp-like features (`*Ts`, `*Timestamp`, `*AtMs`) against `entryTimestamp`.
- Guard runs during split generation and Python train stages.
- Disable only for debugging with `ML_TRAIN_DISABLE_CAUSALITY_GUARD=1`.

## Testing
- Run unit tests with `yarn unit`.
- Run type checks with `yarn dev-tsc`.
- Keep Jest focused on unit suites (ignore temp artifacts and non-unit script entrypoints).
- For changes in `src/utils/ai.ts`, `src/strategy/*`, signal generation, or ML/testing helpers, re-run both `yarn unit` and `yarn dev-tsc` before commit.

## Runtime AI Signal Review (TrendLine)
- Runtime AI analysis for live TrendLine signals is triggered inside `src/strategy/TrendLine/strategy.ts` after `signal` is assembled.
- AI writes analysis to Redis key `analysis:${symbol}:${signalId}`.
- Telegram sending reads Redis `analysis` and posts AI analysis as a separate follow-up message after the main signal message.
- In non-BACKTEST mode, order placement is gated by AI only if AI confirms the current signal direction (`analysis.direction === signal.direction`) and `analysis.quality` is `4` or `5`.
- AI prompt analyzes the current strategy signal only (it must not invent an opposite trade direction).
- AI response includes retest guidance:
  - `needRetest`
  - `retestPrice`
  - plus `quality`, `takeProfitPrice`, `stopLossPrice`, `comment`.
- LLM payload uses runtime indicator keys (`maFast`, `btcMaFast1h`, `candles15m`, etc.) and trims indicator/candle arrays to the last 5 values; `figures.trendLine` is sent untrimmed.

## Indicator Architecture
- Keep shared strategy indicators in `src/utils/indicators.ts`.
- Do not add strategy-specific branches/options into the shared indicator module.
- If a strategy needs extra derived series, define them as neutral indicator periods/fields (for all strategies), not as per-strategy toggles.
- For config refactors, do not keep backward-compatibility aliases or legacy fallback keys unless explicitly requested.
