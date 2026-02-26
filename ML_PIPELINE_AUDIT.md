# ML Pipeline Audit

## Scope
- Project: `investing`
- Strategy family: `TrendLine` (applicable to other strategies)
- Pipeline: export -> split -> train -> evaluate -> infer -> upload/deploy

## Current State (Summary)
- Time-based split exists: `holdout`, `walk-forward folds`, `prod` source.
- Walk-forward supports fold-level metrics and thresholds.
- Ensemble and single-model modes are both supported.
- Inference now correctly resolves ensemble aliases (`<Strategy>.modelN.joblib`) vs single alias (`<Strategy>.joblib`).
- Upload now ships inference aliases only (not historical eval/prod snapshots).
- Feature pipeline parity is enforced:
  - `buildMlTrainingRow` + `trimMlTrainingRowWindows(..., 5)` in backtest dataset writes.
  - `buildMlTrainingRow` + `trimMlTrainingRowWindows(..., 5)` in grpc inference path.
- Last candle/indicator element is dropped before feature construction to align backtest with live signal timing.
- Runtime (non-ML) AI signal review for live TrendLine execution is a separate layer:
  - evaluates current signal payload + trendline,
  - writes Redis `analysis:*`,
  - gates live order placement by AI-confirmed direction + quality.
- Strategy runtime is now shared across strategies (`src/utils/strategyRuntime.ts`), while strategy-specific logic stays in per-strategy `core.ts` (including signal/decision assembly).
- `core.ts` uses shared `strategyApi` DSL for entry/skip and market/position access (`getMarketData`, `getCurrentPosition`, `isCurrentPositionExists`); `getMarketData()` returns `timestamp = lastCandle.timestamp` to reduce duplicate field plumbing in strategy cores.
- AI/ML strategy customizations are now split via strategy manifests/adapters:
  - shared pipelines (`src/utils/ai.ts`, `src/utils/mlPayload.ts`, `src/utils/mlGrpc.ts`)
  - strategy-local adapters (`src/strategy/*/adapters/*`)
  - registry via `src/strategy/manifests.ts`
  - runtime `ai/ml` policy mapping can also be provided by strategy adapters and is merged in shared `strategyRuntime`

## Status Update (2026-02-18)
- Closed:
  - Inference/train feature window mismatch risk (`_49/_50` tails leaking into infer payloads) is closed.
  - Same-bar backtest close/open lookahead risk is reduced by processing SL/TP checks before new signal open on the same candle.
  - Report transparency gap reduced: TOP-10 holdout single-feature thresholds are now included in both `md` and `html` training reports.
- Implemented:
  - feature naming normalized to `TF*_ALT_*` / `TF*_BTC_*`,
  - BB moments (`_Mean/_Std/_Skew/_Kurt`) for ALT/BTC on all TF.
- Still monitor:
  - dataset duplication ratio and effective sample diversity,
  - threshold over-tuning on a single holdout window.

## Key Risks
1. Data leakage risk from feature construction and timestamp alignment.
2. Overfitting risk from repeated threshold/model decisions on same holdout.
3. PnL realism gap (fees/slippage/capacity not fully enforced in model selection loop).
4. Regime shift risk (drift not explicitly gated before/after deploy).
5. Operational risk (no strict promotion registry/rollback policy artifact).
6. Runtime AI gating risk (LLM false negatives/positives affecting live order frequency/quality if prompt/validation drifts).

## Target Quality Gates
Use these as hard gates before production promotion.

### Data Quality Gate
- `labeled_rows > 0`, `pos_rows > 0`, `neg_rows > 0`.
- No malformed timestamp rows in selected train/eval/prod sources.
- `holdout` boundaries validated: no row outside configured windows.
- `walk-forward` fold completeness:
  - every fold has `train_rows > 0` and `test_rows > 0`.
- `prod` source completeness:
  - `prod_rows > 0`
  - `prodMinTs >= prodStartMs` when `prodStartMs` is finite.

### Statistical Performance Gate
- Main holdout:
  - `ROC-AUC >= 0.62` (baseline gate; tune per strategy/market).
- Walk-forward:
  - `mean_auc >= 0.58`
  - `std_auc <= 0.08`
  - at least `70%` folds have `auc >= 0.55`.
- Threshold stability:
  - selected operating threshold must not vary by more than `0.15` across folds for chosen policy.

### Trading Utility Gate
- Net expectancy after costs > 0 on holdout and majority of folds.
- Turnover under configured cap (signals/day or trades/day).
- Coverage floor for policy threshold (avoid ultra-low coverage regime):
  - e.g. `coverage >= 0.10` unless explicitly approved.

## Recommended KPI Set
- Classification:
  - ROC-AUC, PR-AUC, Precision/Recall/F1 at operating threshold.
- Trading:
  - Expected value per signal (gross/net), win rate, payoff ratio.
  - Profit factor, max drawdown (simulated execution).
  - Turnover, capacity proxy (notional/trade count constraints).
- Stability:
  - Fold-to-fold variance of AUC and net expectancy.
  - Drift metrics (PSI/KS) on key features and score distribution.

## Alerts & Rollback Policy

### Online Monitoring Alerts
- Trigger warning:
  - live win rate drops > `10pp` vs training reference window.
  - score distribution shift PSI > `0.25`.
- Trigger critical:
  - net expectancy after costs <= 0 for `N` consecutive windows.
  - precision at deployed threshold below floor for `N` windows.

### Rollback Conditions
- Immediate rollback to previous alias set if any critical trigger fires.
- Keep last known good aliases versioned and immutable.
- Rollback artifact:
  - store deploy manifest with:
    - model aliases
    - train stamp
    - dataset/split key
    - threshold policy hash

## Roadmap (Pragmatic)

### Phase 1 (Must-have)
1. Add leakage unit tests for feature timestamp causality.
2. Add cost-aware evaluation summary (fees/slippage assumptions in reports).
3. Persist deployment manifest (`deploy-manifest.<stamp>.json`).
4. Enforce promotion gate script (`ml-promote`) with hard fail on gate violations.

### Phase 2 (High-value)
1. Add calibration set or nested validation for threshold selection.
2. Add strategy-level drift job (daily PSI/KS + score drift).
3. Add shadow mode deploy before promotion.

### Phase 3 (Maturity)
1. Portfolio-aware selection (cross-strategy correlation and turnover budget).
2. Dynamic thresholding by regime with explicit guardrails.
3. Automated retrain trigger policy with cooldown and human approval step.

## Test Checklist (Per Training Run)
- Split artifacts exist and match `meta` references.
- `meta.files.holdout`, `meta.files.walkForwardFolds`, `meta.files.prod` are consistent.
- Train command uses:
  - `--input` holdout-train
  - `--test-input` holdout-test
  - `--prod-input` prod
  - fold train/test inputs for walk-forward.
- Inference resolution test:
  - ensemble alias files -> multi-model averaging path
  - single alias only -> single-model path.
- Upload dry-run list contains only alias files:
  - `<Strategy>.joblib` and/or `<Strategy>.modelN.joblib`.

## Immediate Next Actions
1. Add leakage-focused tests for transformed features in `mlTrainingTransform`.
2. Add gate-evaluator script to parse report + meta and return pass/fail.
3. Add deploy manifest and rollback command using alias snapshots.
4. Track runtime AI gating metrics separately from ML metrics (approval rate, quality distribution, retest-required rate, disagreement with strategy direction).
