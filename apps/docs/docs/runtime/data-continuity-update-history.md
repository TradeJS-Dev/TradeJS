---
title: 'Data Sync: continuity and update-history'
---

This page explains how to refresh market history via `yarn continuity` and `yarn update-history`, and how to select a specific exchange.

## 1. `yarn update-history`

`yarn update-history` is an alias of:

```bash
yarn backtest --updateOnly
```

Source:

- `package.json` (`update-history` script)
- `packages/cli/src/scripts/backtest.ts`

What it does:

- resolves backtest config from Redis
- loads ticker list from selected connector
- updates candles in DB (without running tests)

### Choose Exchange For Update

Use `--connector` (`bybit|binance|coinbase`):

```bash
yarn update-history -- --user root --config TrendLine:base --connector bybit --timeframe 15
yarn update-history -- --user root --config TrendLine:base --connector binance --timeframe 15
yarn update-history -- --user root --config TrendLine:base --connector coinbase --timeframe 15
```

Tip: pass `--tickers BTCUSDT,ETHUSDT` to limit symbols.

## 2. `yarn continuity`

`yarn continuity` checks historical gaps and can auto-repair broken ranges.

Source:

- `packages/cli/src/scripts/continuity.ts`

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
yarn continuity --user root --timeframe 15 --provider all
yarn continuity --user root --timeframe 15 --provider bybit
yarn continuity --user root --timeframe 15 --provider binance --tickers BTCUSDT,ETHUSDT
```

## 3. Which Command To Use

- Use `update-history` for normal periodic refresh.
- Use `continuity` when you suspect gaps/corruption and need repair.

## 4. Operational Notes

- `continuity` may be heavy and destructive for affected symbol+interval (it deletes then reloads).
- Keep interval explicit (`--timeframe`) and start with a narrow ticker list for first runs.
- Ensure TimescaleDB is up before running either command.
