---
title: 'VolumeDivergence'
---

`VolumeDivergence` is a built-in TypeScript reversal strategy from `@tradejs/strategies` that compares price pivots with normalized volume pivots.

## Entry Logic

1. Builds normalized volume series (`0..100`) over `NORMALIZATION_LENGTH`.
2. Confirms pivot highs on normalized volume (`PIVOT_LOOKBACK_LEFT`, `PIVOT_LOOKBACK_RIGHT`).
3. Compares current and previous pivot:

- bullish divergence: price makes lower low while normalized volume makes higher low
- bearish divergence: price makes higher high while normalized volume makes lower high

4. Validates pivot confirmation distance (`MIN_BARS_BETWEEN_PIVOTS`, `MAX_BARS_BETWEEN_PIVOTS`).
5. Applies side config (`BULLISH` or `BEARISH`) and TP/SL/risk checks.
6. Applies correlation guard.

## Exits

The strategy opens only when there is no active position.
`core.ts` does not perform active exit management; closing is handled by TP/SL and runtime.

## Config Parameters (What Each One Means)

### Shared Runtime Parameters

- `ENV` — runtime mode.
- `INTERVAL` — strategy timeframe.
- `MAKE_ORDERS` — whether to execute orders.
- `BACKTEST_PRICE_MODE` — backtest execution price mode.

### AI/ML Parameters

- `AI_ENABLED` — enables AI enrichment/gating.
- `MIN_AI_QUALITY` — minimum AI quality.
- `ML_ENABLED` — enables ML enrichment.
- `ML_THRESHOLD` — ML threshold in runtime policy.

### Trading and Risk Parameters

- `CLOSE_OPPOSITE_POSITIONS` — close opposite position before new entry (hook-level).
- `FEE_PERCENT` — fee in risk/reward calculations.
- `MAX_LOSS_VALUE` — max loss value for quantity sizing.
- `MAX_CORRELATION` — maximum allowed BTC correlation.

### Divergence Model Parameters

- `NORMALIZATION_LENGTH` — window used to normalize volume.
- `PIVOT_LOOKBACK_LEFT` — candles to the left for pivot confirmation.
- `PIVOT_LOOKBACK_RIGHT` — candles to the right for pivot confirmation.
- `MIN_BARS_BETWEEN_PIVOTS` — minimum distance between pivot confirmations.
- `MAX_BARS_BETWEEN_PIVOTS` — maximum distance between pivot confirmations.

### `BULLISH` Scenario Parameters

- `BULLISH.enable` — enable/disable bullish scenario.
- `BULLISH.direction` — order direction.
- `BULLISH.TP` — take-profit in percent.
- `BULLISH.SL` — stop-loss in percent.
- `BULLISH.minRiskRatio` — minimum allowed risk/reward.

### `BEARISH` Scenario Parameters

- `BEARISH.enable` — enable/disable bearish scenario.
- `BEARISH.direction` — order direction.
- `BEARISH.TP` — take-profit in percent.
- `BEARISH.SL` — stop-loss in percent.
- `BEARISH.minRiskRatio` — minimum allowed risk/reward.

## Indicators Used (What Each One Means)

### Used in Strategy Logic

- `normalizedVolume` (derived series) — volume normalized to local rolling max.
- `volume pivot high` — pivot confirmation on normalized volume.
- `price pivot high/low` — pivot prices used for divergence checks.
- `deltaAtPivot` — proxy candle delta at pivot (`volume * bodyBias`).
- `correlation` — BTC correlation guard.

## Signal Payload

`figures`:

- divergence line between two pivots
- pivot points

`additionalIndicators`:

- `divergenceKind`
- normalized volume at current/previous pivot
- `deltaAtPivot`
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
npx @tradejs/cli backtest --user root --config VolumeDivergence:base --connector bybit --timeframe 15
npx @tradejs/cli signals --user root --timeframe 15
```
