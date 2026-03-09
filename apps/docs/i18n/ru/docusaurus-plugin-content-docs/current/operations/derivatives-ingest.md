---
title: Ingest деривативов и spread
---

TradeJS умеет загружать рыночные features по деривативам и spread в TimescaleDB.

Основные скрипты:

- `npx @tradejs/cli derivatives:ingest`
- `npx @tradejs/cli derivatives:ingest:coinalyze:all`

Источники:

- `@tradejs/cli`
- `@tradejs/cli`
- `@tradejs/connectors`

## 1. Ingest через provider

Команда:

```bash
npx @tradejs/cli derivatives:ingest --provider coinalyze --symbols BTCUSDT,ETHUSDT --intervals 15m,1h --days 120
```

Поддерживаемые providers:

- `coinalyze` -> строки деривативов
- `binance_coinbase_spread` -> строки spread

Полезные флаги:

- `--symbols`
- `--intervals` (`15m`, `1h`)
- `--days`
- `--batchDays`

## 2. Режим Coinalyze-All

Команда:

```bash
npx @tradejs/cli derivatives:ingest:coinalyze:all --user root --days 120 --intervals 15m,1h
```

Поведение:

- загружает тикеры через ByBit connector (`getTickers`)
- матчится к рынкам Coinalyze
- тянет open interest, funding, liquidations
- объединяет и upsert-ит в Timescale

Полезные флаги:

- `--tickers`, `--exclude`, `--tickersLimit`, `--chunk`
- `--exchangePriority`
- `--symbolBatchSize`
- `--requestDelayMs`, `--requestTimeoutMs`

## 3. Таблицы БД

Ingest пишет в:

- `derivatives_market`
- `market_spread`

Bootstrap схемы и upsert логика:

- `@tradejs/core`

## 4. Обязательные env

Для Coinalyze provider:

- `COINALYZE_API_KEY`
- опционально: `COINALYZE_BASE_URL`, `COINALYZE_MAX_RETRIES`

## 5. Операционные заметки

- Перед ingest убедитесь, что PostgreSQL/Timescale доступен.
- Начинайте с короткого lookback и малого списка символов.
- Держите `batchDays` умеренным, чтобы снизить API/rate-limit нагрузку.
