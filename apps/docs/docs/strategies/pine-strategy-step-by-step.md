---
title: Pine Script Strategy Step by Step
---

This guide explains how to add and run a strategy written in Pine Script using the built-in `PineScript` runtime strategy.

## 1. Understand the Runtime Contract

`PineScript` strategy still returns standard TradeJS decisions:

- `skip`
- `entry`
- `exit`

So AI/ML gates, order policy, and all existing APIs continue to work.

Core files:

- `packages/core/src/strategy/PineScript/core.ts`
- `packages/core/src/utils/pine.ts`

## 2. Prepare Pine Script

Use a script that exposes entry/exit plots:

```pinescript
//@version=5
indicator("TradeJS Pine MA Cross", overlay=true)

fast = ta.sma(close, 9)
slow = ta.sma(close, 21)

entryLong = fast > slow and fast[1] <= slow[1]
entryShort = fast < slow and fast[1] >= slow[1]

plot(fast, "fast")
plot(slow, "slow")
plot(entryLong ? 1 : 0, "entryLong")
plot(entryShort ? 1 : 0, "entryShort")
```

## 3. Save Runtime Config in Redis

```bash
redis-cli JSON.SET users:root:strategies:PineScript:config '$' '{
  "ENV": "CRON",
  "INTERVAL": "15",
  "MAKE_ORDERS": false,
  "BACKTEST_PRICE_MODE": "mid",
  "PINE_SCRIPT": "//@version=5\\nindicator(\"TradeJS Pine MA Cross\", overlay=true)\\nfast = ta.sma(close, 9)\\nslow = ta.sma(close, 21)\\nentryLong = fast > slow and fast[1] <= slow[1]\\nentryShort = fast < slow and fast[1] >= slow[1]\\nplot(fast, \"fast\")\\nplot(slow, \"slow\")\\nplot(entryLong ? 1 : 0, \"entryLong\")\\nplot(entryShort ? 1 : 0, \"entryShort\")",
  "PINE_SCRIPT_INPUTS": {},
  "PINE_LOOKBACK_BARS": 300,
  "PINE_ENTRY_LONG_PLOT": "entryLong",
  "PINE_ENTRY_SHORT_PLOT": "entryShort",
  "PINE_EXIT_LONG_PLOT": "",
  "PINE_EXIT_SHORT_PLOT": "",
  "PINE_LINE_PLOTS": ["fast", "slow"],
  "LONG": {"enable": true, "direction": "LONG", "TP": 2, "SL": 1, "minRiskRatio": 1.5},
  "SHORT": {"enable": true, "direction": "SHORT", "TP": 2, "SL": 1, "minRiskRatio": 1.5},
  "FEE_PERCENT": 0.005,
  "MAX_LOSS_VALUE": 10,
  "MAX_CORRELATION": 0.45,
  "TRADE_COOLDOWN_MS": 0,
  "AI_ENABLED": false,
  "ML_ENABLED": false,
  "ML_THRESHOLD": 0.1,
  "MIN_AI_QUALITY": 3
}'
```

## 4. Save Backtest Grid Config

```bash
redis-cli JSON.SET users:root:backtests:configs:PineScript:ma-cross '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],
  "PINE_SCRIPT": ["//@version=5\\nindicator(\"TradeJS Pine MA Cross\", overlay=true)\\nfast = ta.sma(close, 9)\\nslow = ta.sma(close, 21)\\nentryLong = fast > slow and fast[1] <= slow[1]\\nentryShort = fast < slow and fast[1] >= slow[1]\\nplot(fast, \"fast\")\\nplot(slow, \"slow\")\\nplot(entryLong ? 1 : 0, \"entryLong\")\\nplot(entryShort ? 1 : 0, \"entryShort\")"],
  "PINE_SCRIPT_INPUTS": [{}],
  "PINE_LOOKBACK_BARS": [300],
  "PINE_ENTRY_LONG_PLOT": ["entryLong"],
  "PINE_ENTRY_SHORT_PLOT": ["entryShort"],
  "PINE_EXIT_LONG_PLOT": [""],
  "PINE_EXIT_SHORT_PLOT": [""],
  "PINE_LINE_PLOTS": [["fast", "slow"]],
  "LONG": [{"enable": true, "direction": "LONG", "TP": 2, "SL": 1, "minRiskRatio": 1.5}],
  "SHORT": [{"enable": true, "direction": "SHORT", "TP": 2, "SL": 1, "minRiskRatio": 1.5}],
  "FEE_PERCENT": [0.005],
  "MAX_LOSS_VALUE": [10],
  "MAX_CORRELATION": [0.45],
  "TRADE_COOLDOWN_MS": [0],
  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

## 5. Run and Verify

Backtest:

```bash
yarn backtest --user root --config PineScript:ma-cross --connector bybit --tests 200 --parallel 4
```

Signals:

```bash
yarn signals --user root --cacheOnly
```

## 6. Inspect in App

1. Start app: `yarn dev`
2. Open `/routes/backtest`
3. Filter strategy: `PineScript`
4. Open test card and verify:
   - entry/exit events
   - Pine lines (`fast`, `slow`) rendered as figures

## 7. Extend the Strategy

- Add more `plot(..., "name")` lines and include those names in `PINE_LINE_PLOTS`.
- Add explicit exits with `PINE_EXIT_LONG_PLOT` / `PINE_EXIT_SHORT_PLOT`.
- Tune risk with `LONG` / `SHORT` TP/SL/minRiskRatio.
