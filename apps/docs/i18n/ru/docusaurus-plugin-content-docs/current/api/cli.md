---
sidebar_position: 6
title: CLI API
---

CLI в TradeJS предоставляется пакетом `@tradejs/cli`.
Рекомендуемый запуск после установки пакета: `npx @tradejs/cli <command>`.

Ниже — команды, которые вы будете использовать чаще всего.

## Основные команды

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

## ML-команды

```bash
npx @tradejs/cli ml-export
npx @tradejs/cli ml-inspect
npx @tradejs/cli ml-train:latest
npx @tradejs/cli ml-train:trendline:xgboost
```

## Часто используемые флаги `backtest`

`npx @tradejs/cli backtest --help`:

- `-c, --config` — ключ конфигурации бэктеста (по умолчанию `breakout`)
- `-t, --tickers` — список символов
- `-e, --exclude` — исключить символы
- `-n, --tests` — ограничить число тестов
- `-p, --parallel` — число параллельных воркеров
- `-u, --updateOnly` — только обновить кэш рынка
- `-C, --cacheOnly` — не обновлять кэш рынка
- `-m, --ml` — писать ML-строки в chunk-файлы

## Часто используемые флаги `signals`

`npx @tradejs/cli signals --help`:

- `-t, --tickers`
- `-e, --exclude`
- `-m, --makeOrders`
- `-N, --notify` — отправить уведомления в Telegram
- `-u, --updateOnly`
- `-C, --cacheOnly`
- `-c, --chunk` — запуск по чанку, например `1/3`

## Флаги `doctor`

`npx @tradejs/cli doctor --help`:

- `--require-ml` — сделать проверку ML gRPC обязательной
- `--skip-ml` — пропустить проверку ML gRPC

## Подробные статьи

- [Grid-конфиги бэктестов](../runtime/backtesting/grid-config) — как задавать Redis grid-конфиги для массового перебора параметров
- [Results и promotion в runtime](../runtime/backtesting/results-runtime-config) — promotion конфигов из бэктестов, `@tradejs/cli results`, `isConfigFromBacktest`
- [Data Sync](../getting-started/data-sync) — обновление данных через `continuity` и `backtest --updateOnly`
