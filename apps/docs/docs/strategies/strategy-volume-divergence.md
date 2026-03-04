---
title: 'Strategy Reference: VolumeDivergence'
---

`VolumeDivergence` is a TypeScript reversal strategy (`packages/core/src/strategy/VolumeDivergence`) that compares price pivots vs normalized volume pivots.

## How Entry Works

1. Keep normalized volume series (`0..100`) over rolling `NORMALIZATION_LENGTH`.
2. Confirm pivot highs on normalized volume (`PIVOT_LOOKBACK_LEFT`, `PIVOT_LOOKBACK_RIGHT`).
3. Compare current and previous pivot:

- bullish divergence: price lower low + normalized volume higher low
- bearish divergence: price higher high + normalized volume lower high

4. Enforce pivot distance bounds:

- `MIN_BARS_BETWEEN_PIVOTS`
- `MAX_BARS_BETWEEN_PIVOTS`

5. Apply side config (`BULLISH` or `BEARISH`) and TP/SL/risk checks.
6. Apply non-backtest correlation guard.

## Exits

`core.ts` opens only when no active position; it does not run active exit logic for held positions.
Closing is handled by TP/SL or runtime-level position management.

## Config Parameters

Divergence model:

- `NORMALIZATION_LENGTH`
- `PIVOT_LOOKBACK_LEFT`
- `PIVOT_LOOKBACK_RIGHT`
- `MIN_BARS_BETWEEN_PIVOTS`
- `MAX_BARS_BETWEEN_PIVOTS`

Side/risk model:

- `BULLISH.enable`, `BULLISH.direction`, `BULLISH.TP`, `BULLISH.SL`, `BULLISH.minRiskRatio`
- `BEARISH.enable`, `BEARISH.direction`, `BEARISH.TP`, `BEARISH.SL`, `BEARISH.minRiskRatio`
- `FEE_PERCENT`, `MAX_LOSS_VALUE`, `MAX_CORRELATION`
- `CLOSE_OPPOSITE_POSITIONS` (hook-level)

Shared runtime:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

Shared indicator periods available for payload/ML context:

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`, `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`, `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

## Signal Payload

`figures`:

- divergence line between two price pivots
- two pivot points

`additionalIndicators` includes rich divergence block:

- `divergenceKind`
- normalized volumes on pivots
- proxy delta at pivot (`deltaAtPivot`)
- pivot timestamps/indices/price levels

## Example Runtime Config

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "NORMALIZATION_LENGTH": 1000,
  "PIVOT_LOOKBACK_LEFT": 21,
  "PIVOT_LOOKBACK_RIGHT": 5,
  "MIN_BARS_BETWEEN_PIVOTS": 5,
  "MAX_BARS_BETWEEN_PIVOTS": 60,
  "BULLISH": {
    "enable": true,
    "direction": "LONG",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  },
  "BEARISH": {
    "enable": true,
    "direction": "SHORT",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  }
}
```

## Run

```bash
yarn backtest --user root --config VolumeDivergence:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
