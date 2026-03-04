---
title: 'Strategy Reference: Breakout'
---

`Breakout` is a TypeScript strategy (`packages/core/src/strategy/Breakout`) with weighted signal scoring for long/short breakout setups.

## How Entry Works

For each bar, strategy evaluates a signal set and opens only if score and required conditions pass.

Long-side signal candidates:

- `VOLATILE`
- `SMA_UPTREND`
- `OBV_ABOVE_SMA`
- `PREV_HIGH_BREAKOUT`
- `CLOSE_ABOVE_UPPER_BB`
- `CLOSE_ABOVE_HIGH_LEVEL`
- `CLOSE_ABOVE_PREV_CLOSE`

Short-side candidates mirror it:

- `VOLATILE`
- `SMA_DOWNTREND`
- `OBV_BELOW_SMA`
- `PREV_LOW_BREAKDOWN`
- `CLOSE_BELOW_LOWER_BB`
- `CLOSE_BELOW_LOW_LEVEL`
- `CLOSE_BELOW_PREV_CLOSE`

The strategy:

1. Builds indicator snapshot (`nextIndicators`).
2. Computes booleans for each signal.
3. Applies per-signal weight/required rules from `SIGNALS_LONG` / `SIGNALS_SHORT`.
4. Compares total to `REQUIRED_SCORE_LONG` / `REQUIRED_SCORE_SHORT`.
5. Opens direction with configured TP ladder and SL.

## Exits

With an open position, strategy exits when:

- opposite open signal appears (`CLOSE_POSITION_BY_OPEN_SIGNAL`)
- MA trend flips against position (`CLOSE_POSITION_BY_SMA`)

Otherwise returns `POSITION_HELD`.

## Config Parameters

Scoring model:

- `SIGNALS_LONG`, `SIGNALS_SHORT`
- `REQUIRED_SCORE_LONG`, `REQUIRED_SCORE_SHORT`

Risk/order model:

- `LIMIT` (position value in quote currency)
- `TP_LONG[]`, `TP_SHORT[]` (ladder: `profit`, `rate`)
- `SL_LONG`, `SL_SHORT`

Signal sensitivity:

- `ATR_OPEN` (volatility threshold factor)

Shared indicator periods used by this strategy:

- `MA_FAST`, `MA_MEDIUM`, `MA_SLOW`
- `OBV_SMA`, `ATR`, `ATR_PCT_SHORT`, `ATR_PCT_LONG`
- `BB`, `BB_STD`, `MACD_FAST`, `MACD_SLOW`, `MACD_SIGNAL`
- `LEVEL_LOOKBACK`, `LEVEL_DELAY`

Legacy fields present in config but not used by current `core.ts` logic:

- `ATR_PERIOD`, `BB_PERIOD`, `BB_STDDEV`, `ATR_CLOSE`, `OBV_SMA_PERIOD`, `BREAKOUT_LOOKBACK_DELAY`, `BREAKOUT_LOOKBACK`

## Signal Payload

`additionalIndicators` includes:

- `highLevel`, `lowLevel`
- `signals` (all boolean checks)

`figures` currently empty (`buildBreakoutFigures()` returns `{}`).

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
