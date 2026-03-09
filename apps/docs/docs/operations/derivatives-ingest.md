---
title: Derivatives and Spread Ingest
---

TradeJS can ingest derivatives and spread market features into TimescaleDB.

Main scripts:

- `npx @tradejs/cli derivatives:ingest`
- `npx @tradejs/cli derivatives:ingest:coinalyze:all`

Sources:

- `@tradejs/cli`
- `@tradejs/cli`
- `@tradejs/connectors`

## 1. Provider-Based Ingest

Command:

```bash
npx @tradejs/cli derivatives:ingest --provider coinalyze --symbols BTCUSDT,ETHUSDT --intervals 15m,1h --days 120
```

Supported providers:

- `coinalyze` -> derivatives rows
- `binance_coinbase_spread` -> spread rows

Useful flags:

- `--symbols`
- `--intervals` (`15m`, `1h`)
- `--days`
- `--batchDays`

## 2. Coinalyze-All Mode

Command:

```bash
npx @tradejs/cli derivatives:ingest:coinalyze:all --user root --days 120 --intervals 15m,1h
```

Behavior:

- loads tickers through ByBit connector (`getTickers` logic)
- matches to Coinalyze markets
- fetches open interest, funding, liquidations
- merges and upserts to Timescale

Useful flags:

- `--tickers`, `--exclude`, `--tickersLimit`, `--chunk`
- `--exchangePriority`
- `--symbolBatchSize`
- `--requestDelayMs`, `--requestTimeoutMs`

## 3. DB Tables

Ingest writes to:

- `derivatives_market`
- `market_spread`

Schema bootstrap and upsert logic:

- `@tradejs/core`

## 4. Required Env

For Coinalyze provider:

- `COINALYZE_API_KEY`
- optional: `COINALYZE_BASE_URL`, `COINALYZE_MAX_RETRIES`

## 5. Operational Notes

- Ensure PostgreSQL/Timescale is running before ingest.
- Begin with short lookback and small symbol set.
- Keep `batchDays` moderate to reduce API/rate-limit pressure.
