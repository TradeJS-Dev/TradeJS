---
title: Runtime Playbook (TrendLine + AdaptiveMomentumRibbon)
---

This playbook is a copy-paste command set for your current setup:

- user: `root`
- connector: `bybit`
- timeframe: `15`
- strategies: `TrendLine`, `AdaptiveMomentumRibbon`

## 1. Check Available Backtest Configs

```bash
redis-cli --scan --pattern 'users:root:backtests:configs:TrendLine:*'
redis-cli --scan --pattern 'users:root:backtests:configs:AdaptiveMomentumRibbon:*'
```

Use keys from output as `--config` values in commands below.

## 2. TrendLine: Backtest -> Promote -> Runtime

Backtest:

```bash
yarn backtest --user root --config TrendLine:base --connector bybit --timeframe 15 --tests 500 --parallel 4
```

Inspect winners:

```bash
yarn results --strategy TrendLine --coverage --user root
```

Promote positive configs to runtime (`users:root:strategies:TrendLine:results`):

```bash
yarn results --strategy TrendLine --merge --user root
```

Run runtime signals with promoted config:

```bash
yarn signals --user root --cacheOnly --timeframe 15
```

Quick check that promoted config is used (`isConfigFromBacktest=true`):

```bash
KEY=$(redis-cli --scan --pattern 'store:signals:BTCUSDT:*' | tail -n 1)
redis-cli JSON.GET "$KEY" '$.isConfigFromBacktest'
```

## 3. AdaptiveMomentumRibbon: Backtest -> Promote -> Runtime

Backtest:

```bash
yarn backtest --user root --config AdaptiveMomentumRibbon:amr-default --connector bybit --timeframe 15 --tests 200 --parallel 4
```

Inspect winners:

```bash
yarn results --strategy AdaptiveMomentumRibbon --coverage --user root
```

Promote positive configs to runtime (`users:root:strategies:AdaptiveMomentumRibbon:results`):

```bash
yarn results --strategy AdaptiveMomentumRibbon --merge --user root
```

Run runtime signals with promoted config:

```bash
yarn signals --user root --cacheOnly --timeframe 15
```

Optional check for AMR signal payload:

```bash
KEY=$(redis-cli --scan --pattern 'store:signals:BTCUSDT:*' | tail -n 1)
redis-cli JSON.GET "$KEY" '$.additionalIndicators.amr'
```

## 4. Data Pump Commands (ByBit)

Regular history refresh:

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
```

Continuity repair (gap scan + auto-fix):

```bash
yarn continuity --user root --timeframe 15 --provider bybit
yarn continuity --user root --timeframe 15 --provider bybit --tickers BTCUSDT,ETHUSDT
```

## 5. Roll Back Promoted Results

```bash
yarn results --strategy TrendLine --clear --user root
yarn results --strategy AdaptiveMomentumRibbon --clear --user root
```

## 6. Related Docs

- `runtime/backtesting/results-runtime-config`
- `runtime/data/continuity-update-history`
- `strategies/authoring/pine-strategy-step-by-step`
