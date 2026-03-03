---
title: Postgres and Timescale Schema Guide
---

TimescaleDB stores market time-series and supports historical queries used by runtime and backtests.

## Deployment Files

- `docker-compose.db.yml` - local infra run.
- `docker-compose.yml` - full stack deployment.
- `sql/create.sql` - initial DB bootstrap.

## What to Keep in Schema Design

- Use hypertables for candle-like time-series.
- Index by time and by high-cardinality dimensions (`symbol`, `interval`, provider).
- Keep ingestion idempotent where possible.

## Query and Performance Tips

- Avoid full scans on wide windows without filters.
- Ensure `symbol + interval + time` paths are indexed.
- Watch for slow range queries used by backtest/signal APIs.

## Migrations

- Run schema changes in maintenance windows.
- Always keep rollback SQL for destructive changes.
- Version migrations and test them on staging snapshots first.
