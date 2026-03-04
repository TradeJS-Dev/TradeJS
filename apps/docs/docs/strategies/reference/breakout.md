---
title: 'Strategy: Breakout'
---

`Breakout` is a TypeScript strategy (`packages/core/src/strategy/Breakout`) with weighted signal scoring for long/short breakout scenarios.

## Entry Logic

On each bar, strategy computes boolean signals and opens a position only if:

- required signals (`required: true`) are satisfied
- total score is >= `REQUIRED_SCORE_*`

Long and short use separate signal maps (`SIGNALS_LONG`, `SIGNALS_SHORT`).

## Exits

With an open position, strategy closes when:

- opposite open signal appears (`CLOSE_POSITION_BY_OPEN_SIGNAL`)
- MA trend flips against position (`CLOSE_POSITION_BY_SMA`)

Otherwise returns `POSITION_HELD`.

## Config Parameters (What Each One Means)

### Shared Runtime Parameters

- `ENV` — runtime mode.
- `INTERVAL` — strategy timeframe.
- `MAKE_ORDERS` — whether to execute orders.
- `BACKTEST_PRICE_MODE` — backtest execution price mode.

### AI/ML Parameters

- `AI_ENABLED` — enables AI enrichment/gating.
- `MIN_AI_QUALITY` — minimum AI quality for execution.
- `ML_ENABLED` — enables ML enrichment.
- `ML_THRESHOLD` — ML threshold in runtime policy.

### Scoring Parameters

- `SIGNALS_LONG` — long signal map (`weight`, `required`).
- `SIGNALS_SHORT` — short signal map (`weight`, `required`).
- `REQUIRED_SCORE_LONG` — minimum score to open long.
- `REQUIRED_SCORE_SHORT` — minimum score to open short.

### Position/Risk Parameters

- `LIMIT` — position size in quote currency (qty = `LIMIT / currentPrice`).
- `TP_LONG[]` — long take-profit ladder (`profit`, `rate`).
- `TP_SHORT[]` — short take-profit ladder (`profit`, `rate`).
- `SL_LONG` — long stop-loss (ratio).
- `SL_SHORT` — short stop-loss (ratio).
- `ATR_OPEN` — volatility threshold multiplier for `VOLATILE` signal.

### Indicator Period Parameters

- `MA_FAST` — fast MA period.
- `MA_MEDIUM` — medium MA period.
- `MA_SLOW` — slow MA period.
- `OBV_SMA` — OBV SMA period.
- `ATR` — ATR period.
- `ATR_PCT_SHORT` — short ATR% window.
- `ATR_PCT_LONG` — long ATR% window.
- `BB` — Bollinger Bands period.
- `BB_STD` — Bollinger Bands multiplier.
- `MACD_FAST` — MACD fast period.
- `MACD_SLOW` — MACD slow period.
- `MACD_SIGNAL` — MACD signal period.
- `LEVEL_LOOKBACK` — local level lookback window.
- `LEVEL_DELAY` — local level confirmation delay.

### Parameters Present but Not Used by Current `core.ts`

- `ATR_PERIOD`
- `BB_PERIOD`
- `BB_STDDEV`
- `ATR_CLOSE`
- `OBV_SMA_PERIOD`
- `BREAKOUT_LOOKBACK_DELAY`
- `BREAKOUT_LOOKBACK`

## Indicators Used (What Each One Means)

### Used in Signal Logic

- `maFast`, `maSlow` — trend direction checks.
- `obv`, `smaObv` — OBV vs OBV-SMA checks.
- `atr` — volatility threshold calculation.
- `bbUpper`, `bbLower` — Bollinger breakout checks.
- `highLevel`, `lowLevel` — local breakout/breakdown levels.
- `prevCandle` — previous candle for high/low/close comparisons.

### Used in Payload

- `correlation` — included in `indicators` for analysis/ML.

## Signal Payload

`additionalIndicators`:

- `highLevel`, `lowLevel`
- `signals` (all boolean checks)

`figures` is currently empty (`buildBreakoutFigures()` returns `{}`).

## Example Runtime Config

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "LIMIT": 100,
  "ATR_OPEN": 0.5,
  "REQUIRED_SCORE_LONG": 7,
  "REQUIRED_SCORE_SHORT": 7,
  "TP_LONG": [
    { "profit": 0.1, "rate": 0.25 },
    { "profit": 0.15, "rate": 0.5 }
  ],
  "TP_SHORT": [
    { "profit": 0.05, "rate": 0.25 },
    { "profit": 0.1, "rate": 0.5 }
  ],
  "SL_LONG": 0.06,
  "SL_SHORT": 0.03
}
```

## Run

```bash
yarn backtest --user root --config Breakout:base --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
