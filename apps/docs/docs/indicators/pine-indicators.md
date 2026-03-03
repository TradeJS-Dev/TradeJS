---
title: Add Pine Script Indicators
---

TradeJS supports Pine indicators through `pinets` inside Pine-based strategies.

Important design note:

- Pine indicators are rendered from `figures` produced by strategy runtime.
- Standalone pane indicators are still best implemented through regular indicator plugins (`indicators/write-indicators`).

## 1. Add Indicator Plot to Pine Script

Example Pine code:

```pinescript
//@version=5
indicator("TradeJS Pine MA + RSI", overlay=true)

fast = ta.sma(close, 9)
slow = ta.sma(close, 21)
rsiValue = ta.rsi(close, 14)

entryLong = fast > slow and fast[1] <= slow[1]
entryShort = fast < slow and fast[1] >= slow[1]

plot(fast, "fast")
plot(slow, "slow")
plot(rsiValue, "rsi")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
```

## 2. Register Plot Keys in Strategy Config

For `PineScript` strategy config, include `rsi` in line plots:

```json
{
  "PINE_LINE_PLOTS": ["fast", "slow", "rsi"],
  "PINE_ENTRY_LONG_PLOT": "entryLong",
  "PINE_ENTRY_SHORT_PLOT": "entryShort"
}
```

## 3. Run Signals/Backtest

```bash
yarn signals --user root --cacheOnly
```

or

```bash
yarn backtest --user root --config PineScript:ma-cross
```

## 4. Where Indicator Is Rendered

The Pine plots are converted into line figures by strategy runtime and shown in:

- dashboard signal chart
- backtest trade chart

Implementation path:

- script execution: `packages/core/src/utils/pine.ts`
- figure conversion: `packages/core/src/strategy/PineScript/figures.ts`

## 5. Common Pitfalls

- No line appears:
  `PINE_LINE_PLOTS` key does not match Pine `plot(..., "name")`.
- Values look flat:
  check your Pine script warmup periods and lookback bars.
- No entry signals:
  verify `PINE_ENTRY_LONG_PLOT` / `PINE_ENTRY_SHORT_PLOT` names.
