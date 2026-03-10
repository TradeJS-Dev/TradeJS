---
title: Backtest Grid Config for Mass Parameter Search
---

This guide explains how to configure a backtest grid in Redis and run mass tests with parameter combinations.

## 1. How Grid Backtests Work

`npx @tradejs/cli backtest` reads a Redis config and builds a Cartesian product of parameter arrays.

Code path:

- `@tradejs/cli`
- `@tradejs/core`

Key points:

- every grid field must be an array
- one combination = one value from each field
- total tests before `--tests` cap = `tickers_count * combinations_count`

## 2. Redis Key Format

Use this key pattern:

- `users:<user>:backtests:configs:<Strategy>:<configName>`

Example:

- `users:root:backtests:configs:AdaptiveMomentumRibbon:grid-v1`

Important:

- `--config` must be `<Strategy>:<configName>`
- strategy name is taken from the first part before `:`

## 3. Example Grid Config

Example for `AdaptiveMomentumRibbon`:

```bash
redis-cli JSON.SET users:root:backtests:configs:AdaptiveMomentumRibbon:grid-v1 '$' '{
  "ENV": ["BACKTEST"],
  "INTERVAL": ["15"],
  "MAKE_ORDERS": [true],
  "BACKTEST_PRICE_MODE": ["mid"],

  "AMR_MOMENTUM_PERIOD": [14, 20, 28],
  "AMR_BUTTERWORTH_SMOOTHING": [2, 3],
  "AMR_ATR_MULTIPLIER": [1.8, 2.2],

  "AMR_WAIT_CLOSE": [true],
  "AMR_SHOW_INVALIDATION_LEVELS": [true],
  "AMR_SHOW_KELTNER_CHANNEL": [true],
  "AMR_KC_LENGTH": [20],
  "AMR_KC_MA_TYPE": ["EMA"],
  "AMR_ATR_LENGTH": [14],
  "AMR_EXIT_ON_INVALIDATION": [true],
  "AMR_LOOKBACK_BARS": [300],
  "AMR_LINE_PLOTS": [["kcMidline", "kcUpper", "kcLower", "invalidationLevel"]],

  "LONG": [
    {"enable": true, "direction": "LONG", "TP": 1.5, "SL": 0.8},
    {"enable": true, "direction": "LONG", "TP": 2.0, "SL": 1.0}
  ],
  "SHORT": [
    {"enable": true, "direction": "SHORT", "TP": 2.0, "SL": 1.0}
  ],

  "AI_ENABLED": [false],
  "ML_ENABLED": [false],
  "ML_THRESHOLD": [0.1],
  "MIN_AI_QUALITY": [3]
}'
```

Combination count in this example:

- `3 * 2 * 2 * 2 * 1 = 24` combinations
- if ticker list has 120 symbols, full suite is `24 * 120 = 2880` tests

## 4. Run Mass Backtests

Run:

```bash
npx @tradejs/cli backtest --user root --config AdaptiveMomentumRibbon:grid-v1 --connector bybit --timeframe 15 --tests 3000 --parallel 6
```

Useful scaling flags:

- `--tickers BTCUSDT,ETHUSDT,...`
- `--tickersLimit 100`
- `--exclude BTCUSDT,ETHUSDT`
- `--tests 3000` hard cap for total suite
- `--parallel 6` worker count

## 5. Validate and Iterate

Check config:

```bash
redis-cli JSON.GET users:root:backtests:configs:AdaptiveMomentumRibbon:grid-v1
```

Inspect winners:

```bash
npx @tradejs/cli results --strategy AdaptiveMomentumRibbon --coverage --user root
```

Promote best configs to runtime:

```bash
npx @tradejs/cli results --strategy AdaptiveMomentumRibbon --merge --user root
```

## 6. Common Mistakes

- scalar value instead of array (`"INTERVAL": "15"` is invalid for grid)
- empty array in any field (`[]`) produces zero combinations
- config key without strategy prefix (`AdaptiveMomentumRibbon:<name>`)
- too many combinations without `--tests` limit

## 7. Related Guides

- [How Backtests Work](./overview)
- [Results -> Runtime Config Promotion](./results-runtime-config)
- [Runtime Playbook (TrendLine + AdaptiveMomentumRibbon)](./strategy-playbook)
