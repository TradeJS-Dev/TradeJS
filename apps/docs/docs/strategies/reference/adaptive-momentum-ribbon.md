---
title: 'AdaptiveMomentumRibbon'
---

`AdaptiveMomentumRibbon` is a Pine-backed strategy integrated as a standalone strategy (`@tradejs/core`).

Pine source:

- `@tradejs/core`

Runtime injects `loadPineScript` into `core.ts`, so Pine logic is maintained separately from TypeScript orchestration.

## Entry Logic

1. `core.ts` loads Pine code using `loadPineScript('adaptiveMomentumRibbon.pine')`.
2. Takes recent candles (`AMR_LOOKBACK_BARS`) and runs Pine via `runPineScript`.
3. Reads latest plot values:

- `entryLong`, `entryShort`
- `invalidated`, `activeBuy`, `activeSell`
- `signalOsc`, `kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`

4. If both entry signals are `true`, strategy skips (conflict).
5. If a position exists:

- closes on opposite signal
- optionally closes on invalidation (`AMR_EXIT_ON_INVALIDATION`)

6. If no position and entry signal is valid:

- applies side config (`LONG` or `SHORT`)
- computes TP/SL/qty
- returns `entry`

## Exits

- `CLOSE_BY_AMR_SIGNAL` — opposite signal
- `CLOSE_BY_AMR_INVALIDATION` — invalidation when `AMR_EXIT_ON_INVALIDATION=true`

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

### AMR Pine Model Parameters

- `AMR_MOMENTUM_PERIOD` — Pine input `Momentum Period`.
- `AMR_BUTTERWORTH_SMOOTHING` — Pine input `Butterworth Smoothing`.
- `AMR_WAIT_CLOSE` — confirm signals only on closed bars.
- `AMR_SHOW_INVALIDATION_LEVELS` — render invalidation levels.
- `AMR_SHOW_KELTNER_CHANNEL` — render Keltner Channel.
- `AMR_KC_LENGTH` — Keltner midline period.
- `AMR_KC_MA_TYPE` — MA type for Keltner midline (`SMA`, `EMA`, `SMMA (RMA)`, `WMA`, `VWMA`).
- `AMR_ATR_LENGTH` — ATR period for Keltner bands.
- `AMR_ATR_MULTIPLIER` — ATR multiplier for Keltner bands.

### Execution/Visualization Parameters

- `AMR_LOOKBACK_BARS` — number of candles passed to Pine per calculation.
- `AMR_EXIT_ON_INVALIDATION` — exit on invalidation signal.
- `AMR_LINE_PLOTS` — Pine plot names mapped into `figures.lines`.
- `CLOSE_OPPOSITE_POSITIONS` — present in shared config template, not used by current `AdaptiveMomentumRibbon` hook logic.

### `LONG` Scenario Parameters

- `LONG.enable` — enable/disable long scenario.
- `LONG.direction` — order direction (`LONG`).
- `LONG.TP` — take-profit in percent.
- `LONG.SL` — stop-loss in percent.

### `SHORT` Scenario Parameters

- `SHORT.enable` — enable/disable short scenario.
- `SHORT.direction` — order direction (`SHORT`).
- `SHORT.TP` — take-profit in percent.
- `SHORT.SL` — stop-loss in percent.

## Indicators Used (What Each One Means)

### Pine Series Used by the Strategy

- `entryLong`, `entryShort` — binary entry signals.
- `activeBuy`, `activeSell` — active buy/sell context flags.
- `invalidated` — signal invalidation flag.
- `signalOsc` — smoothed AMR oscillator.
- `kcMidline` — Keltner center line.
- `kcUpper` — Keltner upper band.
- `kcLower` — Keltner lower band.
- `invalidationLevel` — current invalidation level.

### Lines Rendered in `figures`

- all series listed in `AMR_LINE_PLOTS` are exported to `figures.lines`
- this allows explicit control over chart overlays in runtime/backtests

## Signal Payload

`figures`:

- lines selected via `AMR_LINE_PLOTS`
- entry point marker

`additionalIndicators.amr`:

- `entryLong`, `entryShort`, `activeBuy`, `activeSell`, `invalidated`
- `signalOsc`
- Keltner values and invalidation level
- `lineValues` map for selected plots

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
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --timeframe 15
npx @tradejs/cli signals --user root --timeframe 15
```
