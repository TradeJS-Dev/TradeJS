---
title: Add Pine Script Indicators
---

TradeJS supports two indicator authoring paths:

- TypeScript indicator plugins (recommended for reusable pane indicators)
- Pine plots inside standalone Pine strategies (for strategy-native visuals/signals)

## 1. TypeScript Indicator Path

Use plugin indicators when you need reusable chart panes independent of one strategy.

See [Write Custom Indicators](./authoring).

## 2. Pine Indicator Path (Inside Pine Strategy)

For Pine strategies (example: `AdaptiveMomentumRibbon`), indicator lines come from Pine `plot(...)` outputs and are converted to `figures`.

What you actually need to do:

1. Add/rename the `plot(...)` series in your Pine script.
2. Include those plot names in strategy config (`AMR_LINE_PLOTS`).
3. Run `backtest` or `signals`: selected plots will appear in `figures.lines`.

## 3. Add a New Pine Plot

Example: add RSI to Pine script.

```pinescript
rsiValue = ta.rsi(close, 14)
plot(rsiValue, "rsi")
```

Then register it in strategy config:

```json
{
  "AMR_LINE_PLOTS": [
    "kcMidline",
    "kcUpper",
    "kcLower",
    "invalidationLevel",
    "rsi"
  ]
}
```

## 4. Validate in Backtest/Signals

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default
```

or

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

The new Pine plot should appear in signal/backtest figures.

## 5. Common Pitfalls

- No line on chart:
  plot name in config does not match `plot(..., "name")`.
- Flat/incorrect values:
  check Pine warmup and lookback window (`AMR_LOOKBACK_BARS`).
- No entries/exits:
  verify strategy signal plots (`entryLong`, `entryShort`, `invalidated`).
