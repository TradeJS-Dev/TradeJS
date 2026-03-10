---
sidebar_position: 6
title: CLI API
---

TradeJS command-line interface is exposed as the `@tradejs/cli` package.
Use it directly after package install via `npx @tradejs/cli <command>`.

## Core Commands

```bash
npx @tradejs/cli doctor
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
npx @tradejs/cli infra-down
npx @tradejs/cli backtest
npx @tradejs/cli signals
npx @tradejs/cli bot
npx @tradejs/cli results
```

## ML Commands

```bash
npx @tradejs/cli ml-export
npx @tradejs/cli ml-inspect
npx @tradejs/cli ml-train:latest
npx @tradejs/cli ml-train:trendline:xgboost
```

## Backtest Flags

`npx @tradejs/cli backtest --help` supports key flags:

- `-c, --config` backtest config key (default: `breakout`)
- `-t, --tickers` custom symbol list
- `-e, --exclude` exclude symbols
- `-n, --tests` max tests
- `-p, --parallel` worker count
- `-u, --updateOnly` update market cache only
- `-C, --cacheOnly` do not refresh market cache
- `-m, --ml` write ML rows to dataset chunks

## Signals Flags

`npx @tradejs/cli signals --help`:

- `-t, --tickers`
- `-e, --exclude`
- `-m, --makeOrders`
- `-N, --notify` send Telegram notifications
- `-u, --updateOnly`
- `-C, --cacheOnly`
- `-c, --chunk` chunk mode like `1/3`

## Doctor Flags

`npx @tradejs/cli doctor --help`:

- `--require-ml` make ML gRPC check mandatory
- `--skip-ml` skip ML gRPC check

## Deep Dives

- [Grid config for backtests](../runtime/backtesting/grid-config) - how to define Redis grid configs for mass parameter search
- [Results and runtime promotion](../runtime/backtesting/results-runtime-config) - promoting backtest configs with `@tradejs/cli results`, `isConfigFromBacktest`
- [Data Sync](../getting-started/data-sync) - data refresh via `continuity` and `backtest --updateOnly`
