---
title: Add Pine Script Indicators
---

TradeJS supports two indicator authoring paths:

- TypeScript indicator plugins (recommended for reusable pane indicators)
- Pine plots inside standalone Pine strategies (for strategy-native visuals/signals)

## 1. TypeScript Indicator Path

Use plugin indicators when you need reusable chart panes independent of one strategy.

Guide:

- `indicators/authoring`

## 2. Pine Indicator Path (Inside Pine Strategy)

For Pine strategies (example: `AdaptiveMomentumRibbon`), indicator lines come from Pine `plot(...)` outputs and are converted to `figures`.

Implementation path:

- Pine source: `packages/core/src/strategy/AdaptiveMomentumRibbon/adaptiveMomentumRibbon.pine`
- Figure mapping: `packages/core/src/strategy/AdaptiveMomentumRibbon/figures.ts`
- Runtime signal mapping: `packages/core/src/strategy/AdaptiveMomentumRibbon/core.ts`

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
yarn backtest --user root --config AdaptiveMomentumRibbon:amr-default
```

or

```bash
yarn signals --user root --cacheOnly
```

The new Pine plot should appear in signal/backtest figures.

## 5. Common Pitfalls

- No line on chart:
  plot name in config does not match `plot(..., "name")`.
- Flat/incorrect values:
  check Pine warmup and lookback window (`AMR_LOOKBACK_BARS`).
- No entries/exits:
  verify strategy signal plots (`entryLong`, `entryShort`, `invalidated`).
