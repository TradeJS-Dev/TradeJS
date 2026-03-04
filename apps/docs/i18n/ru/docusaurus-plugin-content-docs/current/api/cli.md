---
sidebar_position: 6
title: API CLI
---

Вся командная работа с TradeJS идет через скрипты в `packages/cli/src/scripts/*`.

Ниже — команды, которые вы будете использовать чаще всего.

## Основные команды

```bash
yarn doctor
yarn backtest
yarn signals
yarn bot
yarn results
```

## Инфраструктура и обслуживание

```bash
yarn infra-up
yarn infra-down
yarn redis-up
yarn redis-down
yarn clean-redis
```

## ML-команды

```bash
yarn ml-export
yarn ml-inspect
yarn ml-train:latest
yarn ml-train:trendline:xgboost
yarn ml-upload:prod
```

## Часто используемые флаги `backtest`

- `-c, --config` — ключ конфигурации бэктеста (по умолчанию `breakout`)
- `-t, --tickers` — список символов
- `-e, --exclude` — исключить символы
- `-n, --tests` — ограничить число тестов
- `-p, --parallel` — число параллельных воркеров
- `-u, --updateOnly` — только обновить кэш рынка
- `-C, --cacheOnly` — не обновлять кэш рынка
- `-m, --ml` — писать ML-строки в chunk-файлы

## Часто используемые флаги `signals`

- `-t, --tickers`
- `-e, --exclude`
- `-m, --makeOrders`
- `-N, --notify` — отправить уведомления в Telegram
- `-u, --updateOnly`
- `-C, --cacheOnly`
- `-c, --chunk` — запуск по чанку, например `1/3`

## Флаги `doctor`

- `--require-ml` — сделать проверку ML gRPC обязательной
- `--skip-ml` — пропустить проверку ML gRPC

## Подробные статьи

- `runtime/backtesting/grid-config` — как задавать Redis grid-конфиги для массового перебора параметров
- `runtime/backtesting/results-runtime-config` — promotion конфигов из бэктестов, `yarn results`, `isConfigFromBacktest`
- `runtime/data/continuity-update-history` — прокачка данных через `continuity` и `update-history`
