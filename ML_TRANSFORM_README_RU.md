# ML Transform Notes (Legacy RU Filename)

This file keeps its historical name (`*_RU.md`) but now documents the current ML transform flow in English.

Last updated: 2026-03-04.

Applies to:

- `packages/core/src/utils/testing.ts`
- `packages/core/src/utils/mlTrainingTransform.ts`
- `packages/core/src/utils/mlGrpc.ts`
- `packages/core/src/utils/mlDatasetFile.ts`

## 1. Data Flow

1. `yarn backtest` generates ML payload rows from signals and writes worker chunk JSONL files.
2. `yarn ml-export` merges chunk files into a merged JSONL export.
3. Training splits merged JSONL into `holdout`, `prod`, and `walk-forward` windows.
4. Model training consumes train windows only, evaluation consumes test windows only.

## 2. Windowing and Causality

Before feature construction from `signal.indicators`:

- the last element of all indicator/candle arrays is removed

Base windows after that step:

- `indicatorWindow = max(1, ML_BASE_CANDLES_WINDOW - 1)`
- `candleWindow = max(1, ML_CANDLE_FEATURE_WINDOW - 1)`

Final row trimming:

- `trimMlTrainingRowWindows(row, 5)`

Net effect:

- dataset and inference use only `_1.._5` tails
- `_49/_50` tails are not included in ML features

## 3. Feature Naming Convention

Unified naming:

- `TF*_ALT_*` for current traded asset features
- `TF*_BTC_*` for BTC features

Mixed relational features without asset prefix (for example `RelRet`, `AltToBtc`) keep their dedicated names.

## 4. Train/Prod Parity Rules

Backtest write path:

- `buildMlTrainingRow` -> `trimMlTrainingRowWindows(..., 5)` -> JSONL

Inference path (`mlGrpc`):

- `buildMlTrainingRow` -> `trimMlTrainingRowWindows(..., 5)` -> gRPC `Predict`

This enforces schema parity across backtest, training, and production inference.

## 5. Runtime AI vs ML Transform

This document covers ML feature transform only.

Runtime AI signal analysis is separate:

- uses runtime signal payload (`maFast`, `btcMaFast1h`, `candles15m`, etc.)
- series are also trimmed to last 5 values for LLM payload
- strategy figures use shared normalized shape (`lines/points/zones`)

AI/ML enrichment and order gating happen in shared runtime:

- `packages/core/src/utils/strategyRuntime.ts`

Strategy-specific AI/ML customizations are provided via strategy adapters/manifests.

## 6. Bollinger Moments

For `BB_Upper`, `BB_Middle`, and `BB_Lower`, moments are generated:

- `_Mean`
- `_Std`
- `_Skew`
- `_Kurt`

Computed across all supported timeframes for both ALT and BTC.

## 7. Exceptions

- `POINTS_*` / `TOUCHES_*` are not candle-series and should not be trimmed as "last candle".
- `entryTimestamp` remains in row for guard/audit, but is excluded from inference feature vectors.

## 8. Reports and Validation

Training reports now include TOP holdout single-feature thresholds in both formats:

- `*.md`
- `*.report.html`

Relevant tests:

- `packages/core/src/utils/__tests__/mlTrainingTransform.test.ts`
- `packages/core/src/utils/__tests__/mlGrpc.test.ts`
