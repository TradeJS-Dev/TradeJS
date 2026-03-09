---
title: 'Data Sync: continuity and backtest --updateOnly'
---

This page explains how to refresh market history via `npx @tradejs/cli backtest --updateOnly` and `npx @tradejs/cli continuity`, and how to select a specific exchange.

Local infra prerequisite:

```bash
npx @tradejs/cli infra-init
npx @tradejs/cli infra-up
```

Use `npx @tradejs/cli infra-down` to stop local infra when done.

## 1. `npx @tradejs/cli backtest --updateOnly`

Use `backtest` in update-only mode:

```bash
npx @tradejs/cli backtest --updateOnly
```

Source:

- `@tradejs/cli`

What it does:

- resolves backtest config from Redis
- loads ticker list from selected connector
- updates candles in DB (without running tests)

### Choose Exchange For Update

Use `--connector` (`bybit|binance|coinbase`):

```bash
npx @tradejs/cli backtest --updateOnly --user root --config TrendLine:base --connector bybit --timeframe 15
npx @tradejs/cli backtest --updateOnly --user root --config TrendLine:base --connector binance --timeframe 15
npx @tradejs/cli backtest --updateOnly --user root --config TrendLine:base --connector coinbase --timeframe 15
```

Tip: pass `--tickers BTCUSDT,ETHUSDT` to limit symbols.

## 2. `npx @tradejs/cli continuity`

`npx @tradejs/cli continuity` checks historical gaps and can auto-repair broken ranges.

Source:

- `@tradejs/cli`

Behavior:

- load candles for selected provider(s)
- detect discontinuities by expected interval
- when gap is found: delete symbol+interval candles and reload

### Choose Exchange For Continuity

Now supports provider filter:

- `--provider all` (default)
- `--provider bybit`
- `--provider binance`
- `--provider coinbase`
- comma list, e.g. `--provider bybit,binance`

Examples:

```bash
npx @tradejs/cli continuity --user root --timeframe 15 --provider all
npx @tradejs/cli continuity --user root --timeframe 15 --provider bybit
npx @tradejs/cli continuity --user root --timeframe 15 --provider binance --tickers BTCUSDT,ETHUSDT
```

## 3. Which Command To Use

- Use `backtest --updateOnly` for normal periodic refresh.
- Use `continuity` when you suspect gaps/corruption and need repair.

## 4. Operational Notes

- `continuity` may be heavy and destructive for affected symbol+interval (it deletes then reloads).
- Keep interval explicit (`--timeframe`) and start with a narrow ticker list for first runs.
- Ensure TimescaleDB is up before running either command.
