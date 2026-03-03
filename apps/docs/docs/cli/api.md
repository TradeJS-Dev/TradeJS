---
sidebar_position: 6
title: CLI API
---

TradeJS CLI scripts are in `packages/cli/src/scripts/*` and exposed through root `yarn` commands.

## Core Commands

```bash
yarn doctor
yarn backtest
yarn signals
yarn bot
yarn results
```

## Data/Infra Commands

```bash
yarn infra-up
yarn infra-down
yarn redis-up
yarn redis-down
yarn clean-redis
```

## ML Commands

```bash
yarn ml-export
yarn ml-inspect
yarn ml-train:latest
yarn ml-train:trendline:xgboost
yarn ml-upload:prod
```

## Backtest Flags

`yarn backtest --help` (via `args`) supports key flags:

- `-c, --config` backtest config key (default: `breakout`)
- `-t, --tickers` custom symbol list
- `-e, --exclude` exclude symbols
- `-n, --tests` max tests
- `-p, --parallel` worker count
- `-u, --updateOnly` update market cache only
- `-C, --cacheOnly` do not refresh market cache
- `-m, --ml` write ML rows to dataset chunks

## Signals Flags

- `-t, --tickers`
- `-e, --exclude`
- `-m, --makeOrders`
- `-N, --notify` send Telegram notifications
- `-u, --updateOnly`
- `-C, --cacheOnly`
- `-c, --chunk` chunk mode like `1/3`

## Doctor Flags

- `--require-ml` make ML gRPC check mandatory
- `--skip-ml` skip ML gRPC check
