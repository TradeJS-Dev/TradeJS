# ML Pipeline Audit

Last reviewed: 2026-03-04.

## Scope

- Project: `tradejs`
- Primary strategy family validated: `TrendLine` (rules are reusable for other strategies)
- Pipeline stages: export -> split -> train -> evaluate -> infer -> upload/promote

## Current State Summary

- Time-based split is implemented (`holdout`, `walk-forward`, `prod`).
- Walk-forward produces fold-level metrics and threshold tables.
- Single-model and ensemble inference aliases are supported.
- Feature-window parity is enforced across backtest write path and runtime inference:
  - `buildMlTrainingRow`
  - `trimMlTrainingRowWindows(..., 5)`
- Last candle/indicator point is removed before feature construction to avoid closed-vs-open mismatch.
- Runtime strategy execution is centralized in shared runtime (`strategyRuntime.ts`).
- Strategy-local AI/ML behavior is integrated through manifests/adapters, not through shared hardcoded branches.

## Key Risks

1. Leakage risk from timestamp/feature alignment.
2. Overfitting risk from repeated threshold optimization on the same holdout.
3. PnL realism gap if costs/slippage assumptions drift from production.
4. Regime drift risk between train and live environments.
5. Promotion governance risk without strict artifact + rollback manifests.

## Recommended Hard Gates

### Data Gates

- `labeled_rows > 0`
- both positive and negative labels exist
- split boundary validation has zero out-of-range rows
- every walk-forward fold has non-empty train/test partitions
- prod partition is non-empty and aligned to configured start

### Statistical Gates

- holdout ROC-AUC >= configured floor (example baseline: `0.62`)
- walk-forward mean AUC >= configured floor (example baseline: `0.58`)
- fold variance controlled (`std_auc` ceiling, e.g. `<= 0.08`)
- threshold stability across folds (avoid extreme fold drift)

### Trading Utility Gates

- positive net expectancy after configured costs
- turnover within operational budget
- minimum signal coverage at chosen threshold

## Monitoring and Rollback

### Online Alerts

Warn if:

- score distribution drift exceeds configured PSI/KS limits
- live precision/expectancy degrades beyond tolerated delta

Critical if:

- net expectancy turns non-positive for consecutive windows
- gating precision drops below mandatory floor

### Rollback Policy

- keep immutable alias snapshots and deployment manifest
- rollback to last known good alias set on critical trigger
- record: model aliases, split key, training stamp, threshold policy hash

## Practical Roadmap

### Phase 1 (Must Have)

1. Keep leakage tests mandatory in CI.
2. Keep cost-aware report section mandatory.
3. Keep promotion gate script as hard fail on violations.
4. Keep deploy manifest + explicit rollback command.

### Phase 2 (High Value)

1. Add calibration/nested validation for threshold selection.
2. Add daily drift jobs for features and score distribution.
3. Add shadow deployment mode before full promotion.

### Phase 3 (Maturity)

1. Portfolio-aware model/threshold selection across strategies.
2. Regime-aware threshold policies with guardrails.
3. Controlled auto-retrain policy with cooldown + approval.

## Operational Checklist per Training Run

- split artifacts match split metadata (`*.windows.<key>.meta.json`)
- train command uses holdout train/test + prod + optional fold inputs correctly
- inference alias resolution works for:
  - single model (`<Strategy>.joblib`)
  - ensemble members (`<Strategy>.modelN.joblib`)
- upload list contains inference aliases only
- report artifacts generated (`.md`, `.report.html`)
