---
title: 'Strategy Reference: AdaptiveMomentumRibbon'
---

`AdaptiveMomentumRibbon` is a Pine-backed strategy integrated as a standalone core strategy (`packages/core/src/strategy/AdaptiveMomentumRibbon`).

Pine source file:

- `packages/core/src/strategy/AdaptiveMomentumRibbon/adaptiveMomentumRibbon.pine`

The runtime injects a script loader (`loadPineScript`) into strategy core, so Pine strategy can stay self-contained.

## How Entry Works

1. `core.ts` loads Pine code using `loadPineScript('adaptiveMomentumRibbon.pine')`.
2. Takes recent candles (`AMR_LOOKBACK_BARS`) and runs Pine via `runPineScript`.
3. Reads latest plot values:

- `entryLong`, `entryShort`
- `invalidated`, `activeBuy`, `activeSell`
- `signalOsc`, KC lines, `invalidationLevel`

4. If both entry plots are `true` -> conflict skip.
5. If position exists:

- close on opposite signal
- optionally close on invalidation (`AMR_EXIT_ON_INVALIDATION`)

6. If no position and valid entry signal:

- apply side config (`LONG` or `SHORT`)
- calculate TP/SL/qty and emit `entry`.

## Exits

- `CLOSE_BY_AMR_SIGNAL` on opposite entry signal
- `CLOSE_BY_AMR_INVALIDATION` when invalidated and `AMR_EXIT_ON_INVALIDATION=true`

## Config Parameters

Pine inputs mapping:

- `AMR_MOMENTUM_PERIOD` -> `Momentum Period`
- `AMR_BUTTERWORTH_SMOOTHING` -> `Butterworth Smoothing`
- `AMR_WAIT_CLOSE` -> `Confirm Signals on Bar Close`
- `AMR_SHOW_INVALIDATION_LEVELS` -> `Show Invalidation Levels`
- `AMR_SHOW_KELTNER_CHANNEL` -> `Show Keltner Channel`
- `AMR_KC_LENGTH` -> `KC Length`
- `AMR_KC_MA_TYPE` -> `KC MA Type`
- `AMR_ATR_LENGTH` -> `ATR Length`
- `AMR_ATR_MULTIPLIER` -> `ATR Multiplier`

Execution/display:

- `AMR_LOOKBACK_BARS`
- `AMR_EXIT_ON_INVALIDATION`
- `AMR_LINE_PLOTS` (figure lines to render from Pine plots)

Side configs:

- `LONG.enable`, `LONG.direction`, `LONG.TP`, `LONG.SL`
- `SHORT.enable`, `SHORT.direction`, `SHORT.TP`, `SHORT.SL`

Shared runtime:

- `ENV`, `INTERVAL`, `MAKE_ORDERS`, `BACKTEST_PRICE_MODE`
- `AI_ENABLED`, `MIN_AI_QUALITY`
- `ML_ENABLED`, `ML_THRESHOLD`

## Signal Payload

`figures`:

- configurable AMR plot lines from `AMR_LINE_PLOTS` (for example: KC bands + invalidation)
- entry point marker

`additionalIndicators.amr`:

- `entryLong`, `entryShort`, `activeBuy`, `activeSell`, `invalidated`
- `signalOsc`
- KC values and invalidation level
- `lineValues` dictionary for selected plots

## Example Runtime Config

```json
{
  "ENV": "CRON",
  "INTERVAL": "15",
  "AMR_LOOKBACK_BARS": 400,
  "AMR_MOMENTUM_PERIOD": 20,
  "AMR_BUTTERWORTH_SMOOTHING": 3,
  "AMR_WAIT_CLOSE": true,
  "AMR_KC_LENGTH": 20,
  "AMR_KC_MA_TYPE": "EMA",
  "AMR_ATR_LENGTH": 14,
  "AMR_ATR_MULTIPLIER": 2,
  "AMR_EXIT_ON_INVALIDATION": true,
  "AMR_LINE_PLOTS": ["kcMidline", "kcUpper", "kcLower", "invalidationLevel"],
  "LONG": { "enable": true, "direction": "LONG", "TP": 2, "SL": 1 },
  "SHORT": { "enable": true, "direction": "SHORT", "TP": 2, "SL": 1 }
}
```

## Run

```bash
yarn backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --timeframe 15
yarn signals --user root --timeframe 15
```
