# AGENTS.md

## Scope
These instructions apply to this repository (`/Users/aleksnick/dev/investing`).

## ML Training Workflow
- Use `yarn ml-train:trendline:*` scripts for model training (`rf`, `xgboost`, `lightgbm`, etc.).
- Training scripts are wrapped by `bin/ml-train-with-redis.sh`:
  - Redis is stopped before train.
  - Redis is restored on exit (success/error/interrupt).

## Dataset Handling
- Training uses the latest base export file (`ml-dataset-*.jsonl`) only.
- Derived split files are generated automatically:
  - `*.holdout-train.<key>.jsonl`
  - `*.holdout-test.<key>.jsonl`
  - `*.walk-forward.<key>.jsonl`
- Derived files are cached and reused when:
  - same export filename hash
  - same `ML_TRAIN_TEST_DAYS`
  - same `ML_TRAIN_RECENT_DAYS`
  - same `ML_TRAIN_WALK_FORWARD_FOLDS`
- Never treat derived split files as source exports.

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

## Logging Conventions
- Training logs include heartbeat every 30s with:
  - elapsed time
  - Node RSS
  - ML container memory usage
- Console output is normalized line-by-line (no carriage-return drift).
- `COMPOSE_IGNORE_ORPHANS=1` is used for cleaner train logs.

## Reports
- Markdown and HTML reports are saved next to model artifacts.
- Reports include:
  - main holdout metrics and threshold table
  - walk-forward windows
  - walk-forward threshold tables per fold

## Testing
- Run unit tests with `yarn unit`.
- Keep Jest focused on unit suites (ignore temp artifacts and non-unit script entrypoints).

## Indicator Architecture
- Keep shared strategy indicators in `src/utils/indicators.ts`.
- Do not add strategy-specific branches/options into the shared indicator module.
- If a strategy needs extra derived series, define them as neutral indicator periods/fields (for all strategies), not as per-strategy toggles.
- For config refactors, do not keep backward-compatibility aliases or legacy fallback keys unless explicitly requested.
