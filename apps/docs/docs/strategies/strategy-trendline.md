---
title: 'Strategy Reference: TrendLine'
---

`TrendLine` is a TypeScript strategy (`packages/core/src/strategy/TrendLine`) that trades trendline breakout setups with risk guards.

## How Entry Works

1. Build trendlines from highs/lows via `createTrendlineEngine`.
2. Pick best line (`lows` preferred, otherwise `highs`).
3. Skip if no line, open position exists, cooldown active, or candle volatility is too high (`filterByVeryVolatility`).
4. Resolve side config:

- `HIGHS` for resistance-line breakout
- `LOWS` for support-line breakout

5. Compute TP/SL/qty via `strategyApi.getDirectionalTpSlPrices`.
6. Enforce `minRiskRatio` and (non-backtest) `MAX_CORRELATION` guard.
7. Return `entry` with trendline figures and metadata.

## Exits

`core.ts` does not force an active-management exit for held positions.
Position lifecycle is handled by TP/SL and runtime/order engine; optional opposite-position closing is done by manifest hook when enabled.

## Config Parameters

Core trading parameters:

- `HIGHS.enable`, `HIGHS.direction`, `HIGHS.TP`, `HIGHS.SL`, `HIGHS.minRiskRatio`
- `LOWS.enable`, `LOWS.direction`, `LOWS.TP`, `LOWS.SL`, `LOWS.minRiskRatio`
- `TRENDLINE.minTouches`, `TRENDLINE.offset`, `TRENDLINE.epsilon`, `TRENDLINE.epsilonOffset`
- `FEE_PERCENT`, `MAX_LOSS_VALUE`, `MAX_CORRELATION`
- `CLOSE_OPPOSITE_POSITIONS` (used in `hooks.ts`)

Shared runtime parameters:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

Shared indicator periods used by this strategy:

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`, `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`, `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

## Signal Payload

`figures`:

- `lines[]`: selected trendline
- `points[]`: trendline points/touches

`additionalIndicators`:

- `touches`
- `distance`
- `trendLine` (full geometry)

## Example Runtime Config

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": true,
  "CLOSE_OPPOSITE_POSITIONS": false,
  "TRENDLINE": {
    "minTouches": 4,
    "offset": 3,
    "epsilon": 0.003,
    "epsilonOffset": 0.004
  },
  "HIGHS": {
    "enable": true,
    "direction": "LONG",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  },
  "LOWS": {
    "enable": true,
    "direction": "SHORT",
    "TP": 4,
    "SL": 1.3,
    "minRiskRatio": 2
  }
}
```

## Run

Backtest:

```bash
yarn backtest --user root --config TrendLine:base --connector bybit --timeframe 15
```

Runtime:

```bash
yarn signals --user root --timeframe 15
```
