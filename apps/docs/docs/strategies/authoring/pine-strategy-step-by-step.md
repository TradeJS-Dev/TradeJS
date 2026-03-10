---
title: Pine Strategy Step by Step
---

This guide shows the Pine path in TradeJS: a real standalone strategy implemented in Pine Script and embedded into strategy runtime as a first-class strategy.

TradeJS now supports two strategy authoring paths:

- [TypeScript strategy with `StrategyAPI`](./ma-strategy-step-by-step)
- Pine strategy with dedicated `.pine` source file (`AdaptiveMomentumRibbon` example below)

## 1. Strategy Is a Real Module (Not a Generic Wrapper)

`AdaptiveMomentumRibbon` lives as a regular strategy module:

- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`
- `@tradejs/core`

The Pine code is stored in a separate file and loaded by `core.ts`.

## 2. Pine Contract for Runtime Signals

The runtime reads Pine plot series by name. Keep these output plots in your Pine script:

- `entryLong`
- `entryShort`
- `invalidated`
- plus line plots for figures (`kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`)

`core.ts` converts these plot values to normal TradeJS decisions (`skip`, `entry`, `exit`), so backtest/signals/AI/ML pipelines stay unchanged.

## 3. Runtime Config (Redis)

```bash
redis-cli JSON.SET users:root:strategies:AdaptiveMomentumRibbon:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "AMR_MOMENTUM_PERIOD": 20,
  "AMR_BUTTERWORTH_SMOOTHING": 3,
  "AMR_WAIT_CLOSE": true,
  "AMR_SHOW_INVALIDATION_LEVELS": true,
  "AMR_SHOW_KELTNER_CHANNEL": true,
  "AMR_KC_LENGTH": 20,
  "AMR_KC_MA_TYPE": "EMA",
  "AMR_ATR_LENGTH": 14,
  "AMR_ATR_MULTIPLIER": 2,
  "AMR_EXIT_ON_INVALIDATION": true,
  "AMR_LOOKBACK_BARS": 400,
  "AMR_LINE_PLOTS": ["kcMidline", "kcUpper", "kcLower", "invalidationLevel"],
  "LONG": {"enable": true, "direction": "LONG", "TP": 2, "SL": 1},
  "SHORT": {"enable": true, "direction": "SHORT", "TP": 2, "SL": 1},
  "AI_ENABLED": false,
  "ML_ENABLED": false,
  "ML_THRESHOLD": 0.1,
  "MIN_AI_QUALITY": 3
}'
```

## 4. Backtest Grid Config

```bash
redis-cli JSON.SET users:root:backtests:configs:AdaptiveMomentumRibbon:amr-default '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "AMR_MOMENTUM_PERIOD": [20],
  "AMR_BUTTERWORTH_SMOOTHING": [3],
  "AMR_WAIT_CLOSE": [true],
  "AMR_SHOW_INVALIDATION_LEVELS": [true],
  "AMR_SHOW_KELTNER_CHANNEL": [true],
  "AMR_KC_LENGTH": [20],
  "AMR_KC_MA_TYPE": ["EMA"],
  "AMR_ATR_LENGTH": [14],
  "AMR_ATR_MULTIPLIER": [2],
  "AMR_EXIT_ON_INVALIDATION": [true],
  "AMR_LOOKBACK_BARS": [400],
  "AMR_LINE_PLOTS": [["kcMidline", "kcUpper", "kcLower", "invalidationLevel"]],
  "LONG": [{"enable": true, "direction": "LONG", "TP": 2, "SL": 1}],
  "SHORT": [{"enable": true, "direction": "SHORT", "TP": 2, "SL": 1}],
  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

Important: config key must start with strategy name (`AdaptiveMomentumRibbon:*`).

## 5. Run and Validate

Backtest:

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --tests 200 --parallel 4
```

Signals:

```bash
npx @tradejs/cli signals --user root --cacheOnly
```

In app (`/routes/backtest`) verify:

- AMR entry/exit events
- Pine-derived figures (`kcMidline`, `kcUpper`, `kcLower`, `invalidationLevel`)

## 6. How to Add Another Pine Strategy

1. Copy `AdaptiveMomentumRibbon` folder to a new strategy name.
2. Replace `.pine` file with your strategy logic.
3. Keep explicit Pine plots for entry/exit (+ figure lines).
4. Map those plots in `core.ts` to TradeJS decisions.
5. Register manifest in `@tradejs/core`.

This keeps Pine strategies as independent modules, equivalent to TS strategies in runtime/backtest integration.
